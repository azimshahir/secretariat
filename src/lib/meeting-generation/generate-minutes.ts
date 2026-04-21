import { generateObject, generateText } from 'ai'
import { z } from 'zod'
import { getDefaultPersona } from '@/lib/ai/personas'
import {
  resolveLanguageModelForOrganization,
  resolveLanguageModelForUserPlan,
} from '@/lib/ai/model-config'
import { getTranscriptIntelligenceConfigForOrganization } from '@/lib/ai/transcript-intelligence-server'
import { resolveAgendaPdfSource } from '@/lib/agenda-pdf'
import { matchIgnoredAgendasFromInstruction } from '@/lib/minute-instruction'
import type { Minute, PlanTier } from '@/lib/supabase/types'
import { uuidSchema } from '@/lib/validation'
import { NO_TRANSCRIPTION_SEGMENT_MARKER } from '@/app/meeting/[id]/setup/agenda-timeline-row'
import {
  buildPrompt1_ContextCleaning,
  buildPrompt2_CrossReference,
  buildPrompt3_MasterReportExtraction,
  buildPrompt3_PlaybookVariantSelection,
  buildPrompt3_StrictTemplateExtraction,
  extractConfidenceMarkers,
} from '@/lib/ai/prompts'
import {
  buildMinuteFormatterRuleBlock,
  inferMinuteFormatterSectionHint,
  listMinuteMindEntriesForScope,
  minuteFormatterRuleAppliesToContext,
  resolveApplicableMinuteMemory,
  type MinuteFormatterRule,
} from './minute-mind'
import { getCanonicalCurrentMinuteForAgendaId } from './current-minute'
import {
  compileMinuteTemplateFromText,
  extractMinuteTemplatePromptEntries,
  getMinuteTemplateActionLikeEntries,
  getMinuteTemplateOwnerLikeEntries,
  findClosureOnlyMinuteTemplateSignals,
  getCompiledMinuteTemplate,
  isCompiledMinuteTemplate,
  mergeMinuteTemplateWithResolutionPathDetailed,
  renderMinuteTemplate,
  renderMinuteTemplateSkeleton,
  type MinuteTemplateFill,
  type MinuteTemplateCompileMode,
  type MinuteTemplateSchema,
} from './minute-template'
import {
  getMinutePlaybookDefaultVariant,
  getMinutePlaybookMode,
  getMinutePlaybookVariant,
  getMinutePlaybookVariantLabel,
  getMinutePlaybookVariantById,
  loadMinutePlaybooksByIds,
  playbookHasCompleteExactFormatting,
  playbookHasResolutionAnchor,
  type MinutePlaybookRecord,
} from './minute-playbooks'
import {
  buildCanonicalMinuteReportContext,
  buildCanonicalMinuteReportContextWithOptions,
  getMeetingRuleTemplateConflict,
  renderCanonicalMinuteReportWithOptions,
  selectTopRelevantExcerpts,
  type ReferenceExcerpt,
} from './source-policy'
import { isMissingMeetingRulesColumn, resolveMeetingRulesPrompt, type DatabaseClient } from './shared'
import {
  inferResolvedOutcomeMode,
  mapResolvedOutcomeModeToVariantKey,
  type ResolvedOutcomeMode,
} from './resolved-outcome'
import { refineTranscriptForAgendaContext } from './transcript-intelligence'
import {
  buildStructuredTranscriptLine,
  sanitizeTranscriptOutput,
  validateStructuredTranscriptShape,
} from './transcript-output'
import type {
  AppliedMinuteMemoryTraceItem,
  CommitteeGenerationContext,
  GenerateMinuteDraftPayload,
  GenerateMinutesForAgendaResult,
  GenerationConfig,
  GenerationRuntimeContext,
  MinuteMemoryApplicationKind,
  MomDraftCheckpointPayload,
  MomDraftCompletedStage,
  ResolutionVariantSelectionSource,
} from './types'

const strictTemplateSlotSchema = z.object({
  id: z.string().min(1),
  value: z.string(),
})

const strictTemplateListSchema = z.object({
  id: z.string().min(1),
  items: z.array(z.string()),
})

const strictTemplateExtractionSchema = z.object({
  slots: z.array(strictTemplateSlotSchema),
  lists: z.array(strictTemplateListSchema),
})

const playbookVariantSelectionSchema = z.object({
  variantKey: z.enum(['default', 'with_action', 'without_action']),
  reason: z.string(),
})
const canonicalMinuteReportSchema = z.object({
  paperSummary: z.string(),
  discussionExplanation: z.string(),
  noted: z.array(z.string()),
  discussed: z.array(z.string()),
  resolved: z.array(z.string()),
})

type StrictTemplateExtraction = z.infer<typeof strictTemplateExtractionSchema>
type PlaybookVariantSelection = z.infer<typeof playbookVariantSelectionSchema>
type CanonicalMinuteReport = z.infer<typeof canonicalMinuteReportSchema>

const GENERATION_TEMPLATE_COMPILE_MODE: MinuteTemplateCompileMode = 'generation_guided'

export class AgendaMinuteGenerationError extends Error {
  stage: string

  constructor(stage: string, message: string) {
    super(message)
    this.name = 'AgendaMinuteGenerationError'
    this.stage = stage
  }
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

function isMissingAppliedMemoryTraceColumnError(message: string, table: 'mom_generation_drafts' | 'minutes') {
  return message.includes(`'applied_memory_trace' column of '${table}'`)
}

function stripAppliedMemoryTraceField<T extends Record<string, unknown>>(row: T): T {
  if (!Object.prototype.hasOwnProperty.call(row, 'applied_memory_trace')) {
    return row
  }

  const nextRow = { ...row }
  delete nextRow.applied_memory_trace
  return nextRow
}

async function runGenerationStage<T>(
  stage: string,
  fallbackMessage: string,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (error instanceof AgendaMinuteGenerationError) {
      throw error
    }

    const detail = getErrorMessage(error)
    throw new AgendaMinuteGenerationError(
      stage,
      detail ? `${fallbackMessage}: ${detail}` : fallbackMessage,
    )
  }
}

function normalizeWhitespace(value: string) {
  return value
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function compactTemplateValue(value: string) {
  return value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(part => part.trim())
    .filter(Boolean)
    .join(' ')
    .trim()
}

function normalizeTemplateEchoValue(value: string) {
  return stripConfidenceMarkers(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isLikelyTemplateSampleEcho(value: string, sampleValue: string | undefined) {
  const normalizedValue = normalizeTemplateEchoValue(value)
  const normalizedSample = normalizeTemplateEchoValue(sampleValue ?? '')
  if (!normalizedValue || !normalizedSample) return false
  const sampleWords = normalizedSample.split(/\s+/).filter(Boolean)
  if (sampleWords.length < 5) return false
  return normalizedValue === normalizedSample
}

function stripConfidenceMarkers(value: string) {
  return value.replace(/\[\[VERIFY:\s*(.*?)\]\]/g, '$1')
}

function finalizeLineBasedTranscript(params: {
  agendaNo: string
  stage: 'checkpoint_reuse' | 'prompt1_generation' | 'transcript_grounding'
  sourceTranscript: string
  candidateTranscript: string | null | undefined
  fallbackTranscript: string
}) {
  const candidateTranscript = sanitizeTranscriptOutput(params.candidateTranscript)
  if (!candidateTranscript) {
    console.warn(
      `[generate-minutes] ${params.stage} produced an empty transcript for Agenda ${params.agendaNo}; using fallback transcript.`,
    )
    return params.fallbackTranscript
  }

  const validation = validateStructuredTranscriptShape({
    sourceTranscript: params.sourceTranscript,
    candidateTranscript,
  })
  if (!validation.isValid) {
    console.warn(
      `[generate-minutes] ${params.stage} changed transcript shape for Agenda ${params.agendaNo}; using fallback transcript. ${validation.reason ?? ''}`.trim(),
    )
    return params.fallbackTranscript
  }

  return candidateTranscript
}

function buildTemplateFillFromObject(
  template: MinuteTemplateSchema,
  extracted: StrictTemplateExtraction,
): MinuteTemplateFill {
  const slotIds = new Set(
    template.nodes
      .filter(node => node.type === 'slot')
      .map(node => node.slotId),
  )
  const listIds = new Set(
    template.nodes
      .filter(node => node.type === 'list')
      .map(node => node.slotId),
  )

  const slots = Object.fromEntries(
    extracted.slots
      .filter(entry => slotIds.has(entry.id))
      .map(entry => [entry.id, compactTemplateValue(entry.value)]),
  )
  const lists = Object.fromEntries(
    extracted.lists
      .filter(entry => listIds.has(entry.id))
      .map(entry => [entry.id, entry.items.map(item => compactTemplateValue(item)).filter(Boolean)]),
  )

  return { slots, lists }
}

function templateFillHasMeaningfulContent(fill: MinuteTemplateFill) {
  const hasSlotContent = Object.values(fill.slots ?? {})
    .some(value => compactTemplateValue(value ?? '').length > 0)
  if (hasSlotContent) return true

  return Object.values(fill.lists ?? {})
    .some(items => (items ?? []).some(item => compactTemplateValue(item).length > 0))
}

function normalizeStrictTemplateExtraction(extracted: StrictTemplateExtraction): StrictTemplateExtraction {
  return {
    slots: extracted.slots.map(entry => ({
      id: entry.id,
      value: typeof entry.value === 'string' ? entry.value : '',
    })),
    lists: extracted.lists.map(entry => ({
      id: entry.id,
      items: Array.isArray(entry.items)
        ? entry.items.filter((item): item is string => typeof item === 'string')
        : [],
    })),
  }
}

function normalizePlaybookVariantSelection(selection: PlaybookVariantSelection): PlaybookVariantSelection {
  return {
    variantKey: selection.variantKey,
    reason: typeof selection.reason === 'string' ? selection.reason.trim() : '',
  }
}

type MinuteTemplatePromptEntry = ReturnType<typeof extractMinuteTemplatePromptEntries>[number] & {
  formatterPattern?: string
  matchedFormatterRuleIds?: string[]
  baseFormatFormulaPattern?: string
  baseFormatFormulaKind?: 'paper_presented' | 'paper_purpose' | 'details_presented'
}

function buildAppliedMemoryTraceMap(entries: AppliedMinuteMemoryTraceItem[]) {
  return new Map(entries.map(entry => [entry.entryId, {
    ...entry,
    matchedKeywords: [...entry.matchedKeywords],
    matchedSectionHints: [...entry.matchedSectionHints],
    appliedAs: [...entry.appliedAs],
  }]))
}

function markAppliedMemoryUsage(
  traceMap: Map<string, AppliedMinuteMemoryTraceItem>,
  entryIds: Iterable<string>,
  usage: MinuteMemoryApplicationKind,
) {
  for (const entryId of entryIds) {
    const existing = traceMap.get(entryId)
    if (!existing) continue
    if (!existing.appliedAs.includes(usage)) {
      existing.appliedAs.push(usage)
    }
  }
}

function mergeAppliedMemoryTraceEntries(
  traceMap: Map<string, AppliedMinuteMemoryTraceItem>,
  entries: AppliedMinuteMemoryTraceItem[],
) {
  for (const entry of entries) {
    const existing = traceMap.get(entry.entryId)
    if (existing) {
      existing.matchedKeywords = Array.from(new Set([
        ...existing.matchedKeywords,
        ...entry.matchedKeywords,
      ]))
      existing.matchedSectionHints = Array.from(new Set([
        ...existing.matchedSectionHints,
        ...entry.matchedSectionHints,
      ]))
      for (const usage of entry.appliedAs) {
        if (!existing.appliedAs.includes(usage)) {
          existing.appliedAs.push(usage)
        }
      }
      continue
    }

    traceMap.set(entry.entryId, {
      ...entry,
      matchedKeywords: [...entry.matchedKeywords],
      matchedSectionHints: [...entry.matchedSectionHints],
      appliedAs: [...entry.appliedAs],
    })
  }
}

function serializeAppliedMemoryTrace(traceMap: Map<string, AppliedMinuteMemoryTraceItem>) {
  return Array.from(traceMap.values())
    .filter(entry => entry.appliedAs.length > 0)
    .sort((left, right) => left.title.localeCompare(right.title))
}

function countWords(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .length
}

function normalizeFormatterPatternLine(value: string) {
  return value
    .replace(/^[\s\-*•]+/, '')
    .replace(/^\(?\d+\)?[.)]?\s+/, '')
    .replace(/^\(?[A-Za-z]\)?[.)]?\s+/, '')
    .replace(/^[“"]|[”"]$/g, '')
    .trim()
}

function normalizeBaseFormatFormulaPattern(value: string) {
  return normalizeWhitespace(
    value
      .replace(/\[role\]/gi, '[Role]')
      .replace(/\[subject\]/gi, '[subject]'),
  )
}

function looksLikeFormulaEligibleParagraphEntry(entry: MinuteTemplatePromptEntry) {
  if (entry.kind !== 'slot') return false
  const normalizedPrefix = (entry.prefix ?? '').trim()
  if (normalizedPrefix && /[:.]$/.test(normalizedPrefix)) return false
  return true
}

function isDiscussionStyleSectionHint(
  sectionHint: ReturnType<typeof inferMinuteFormatterSectionHint>,
) {
  return (
    sectionHint === 'noted_discussed'
    || sectionHint === 'noted'
    || sectionHint === 'discussed'
  )
}

function buildClosureOnlyCanonicalReport(report: CanonicalMinuteReport): CanonicalMinuteReport {
  return {
    ...report,
    discussionExplanation: '',
    discussed: [],
  }
}

function buildTranscriptlessClosureOnlyTranscript(params: {
  agendaNo: string
  agendaTitle: string
}) {
  return [
    `[NO TRANSCRIPT] Agenda ${params.agendaNo}: "${params.agendaTitle}" was intentionally marked No Transcription.`,
    'Do not infer or synthesize DISCUSSED content, questions, objections, or follow-up actions from missing transcript evidence.',
    'Use only grounded agenda-paper or committee-context evidence when available, and keep the output closure-only.',
  ].join(' ')
}

function buildClosureOnlyResolutionFallback(params: {
  agendaTitle: string
  paperSummary: string
  crossRefAnalysis: string
}) {
  const evidence = normalizeWhitespace([
    params.paperSummary,
    params.crossRefAnalysis,
    params.agendaTitle,
  ]
    .filter(Boolean)
    .join(' '))

  if (/\b(?:seek(?:ing)?|for)\s+approval\b|\bapproval\b|\bapproved\b/i.test(evidence)) {
    return 'The Committee approved the paper as presented.'
  }

  if (/\b(?:seek(?:ing)?|for)\s+endorsement\b|\bendorsement\b|\bendorsed\b/i.test(evidence)) {
    return 'The Committee endorsed the paper as presented.'
  }

  if (/\b(?:seek(?:ing)?|for)\s+noting\b|\bnoting\b|\bnoted\b/i.test(evidence)) {
    return 'The Committee noted the paper as presented.'
  }

  return `The Committee noted the agenda item on ${params.agendaTitle} without further discussion or follow-up action.`
}

function ensureClosureOnlyCanonicalReport(params: {
  report: CanonicalMinuteReport
  agendaTitle: string
  crossRefAnalysis: string
}) {
  const closureOnlyReport = buildClosureOnlyCanonicalReport(params.report)
  if (closureOnlyReport.resolved.length > 0) {
    return closureOnlyReport
  }

  return {
    ...closureOnlyReport,
    resolved: [buildClosureOnlyResolutionFallback({
      agendaTitle: params.agendaTitle,
      paperSummary: closureOnlyReport.paperSummary,
      crossRefAnalysis: params.crossRefAnalysis,
    })],
  }
}

function getClosureOnlyDiscussedTemplateEntryIds(entries: MinuteTemplatePromptEntry[]) {
  const slotIds: string[] = []
  const listIds: string[] = []

  for (const entry of entries) {
    const sectionHint = inferMinuteFormatterSectionHint(entry.context)
    if (sectionHint !== 'discussed' && sectionHint !== 'noted_discussed') {
      continue
    }

    if (entry.kind === 'slot') {
      slotIds.push(entry.id)
      continue
    }

    listIds.push(entry.id)
  }

  return { slotIds, listIds }
}

function stripClosureOnlyDiscussedSection(content: string) {
  const lines = content.replace(/\r\n?/g, '\n').split('\n')
  const discussedHeadingPattern = /^(?:\d+\.\s*)?DISCUSSED\b[:.]?$/i
  const nextHeadingPattern = /^(?:\d+\.\s*)?(?:RESOLVED|NOTED|SUMMARIZATION OF THE PAPER|EXPLANATION OF DISCUSSIONS)\b/i
  const discussedIndex = lines.findIndex(line => discussedHeadingPattern.test(line.trim()))

  if (discussedIndex === -1) {
    return content
  }

  let endIndex = lines.length
  for (let index = discussedIndex + 1; index < lines.length; index += 1) {
    const trimmed = lines[index].trim()
    if (!trimmed) continue
    if (nextHeadingPattern.test(trimmed)) {
      endIndex = index
      break
    }
  }

  const nextLines = [
    ...lines.slice(0, discussedIndex),
    ...lines.slice(endIndex),
  ]

  return normalizeWhitespace(nextLines.join('\n'))
}

function isActionLikeTemplateLabel(value: string | null | undefined) {
  const normalizedPrefix = (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')

  return /^(?:action by|action|pic|owner|person in charge|due date|deadline):$/.test(normalizedPrefix)
}

function isActionLikeTemplateEntry(entry: MinuteTemplatePromptEntry) {
  if (entry.kind === 'slot') {
    return isActionLikeTemplateLabel(entry.prefix)
  }

  return isActionLikeTemplateLabel(entry.context)
}

function isOwnerLikeResolvedEntry(entry: MinuteTemplatePromptEntry) {
  if (entry.kind === 'slot') {
    return ACTION_OWNER_FIELD_PATTERN.test(entry.prefix ?? '')
  }

  return ACTION_OWNER_FIELD_PATTERN.test(entry.context ?? '')
}

function isTranscriptConstrainedTemplateEntry(entry: MinuteTemplatePromptEntry) {
  return entry.sourceConstraint === 'transcript'
}

function isOpeningFormulaEligibleEntry(params: {
  entry: MinuteTemplatePromptEntry
  sectionHint: ReturnType<typeof inferMinuteFormatterSectionHint>
  sectionEntryIndex: number
}) {
  if (!looksLikeFormulaEligibleParagraphEntry(params.entry)) return false
  if (isActionLikeTemplateEntry(params.entry)) return false
  if (params.sectionHint === 'resolved') return false
  if (params.sectionEntryIndex >= 3) return false

  if (params.sectionHint) {
    return isDiscussionStyleSectionHint(params.sectionHint)
  }

  return detectBaseFormatOpeningFormula(params.entry) !== null
}

function classifyFormatterPattern(
  pattern: string,
): 'paper_presented' | 'paper_purpose' | 'details_presented' | 'action_label' | 'generic' {
  const normalized = normalizeFormatterPatternLine(pattern)

  if (/^the paper was presented by\s+/i.test(normalized)) {
    return 'paper_presented'
  }
  if (/^the purpose of the paper is to\s+/i.test(normalized)) {
    return 'paper_purpose'
  }
  if (/^the details of the paper were as presented\.?$/i.test(normalized)) {
    return 'details_presented'
  }
  if (/^(?:action by|action|pic|owner|person in charge|due date|deadline)\s*:/i.test(normalized)) {
    return 'action_label'
  }

  return 'generic'
}

type FormatterPatternSectionKey = 'discussion_opening' | 'resolved' | 'generic'

interface FormatterPatternGroups {
  discussionOpening: string[]
  resolved: string[]
  generic: string[]
}

function createEmptyFormatterPatternGroups(): FormatterPatternGroups {
  return {
    discussionOpening: [],
    resolved: [],
    generic: [],
  }
}

function appendUniqueFormatterPatterns(target: string[], patterns: Iterable<string>) {
  for (const pattern of patterns) {
    if (!target.includes(pattern)) {
      target.push(pattern)
    }
  }
}

function inferFormatterPatternSectionKey(
  value: string | null | undefined,
): FormatterPatternSectionKey | null {
  const sectionHint = inferMinuteFormatterSectionHint(value)
  if (!sectionHint) return null
  if (sectionHint === 'resolved') return 'resolved'
  if (isDiscussionStyleSectionHint(sectionHint)) return 'discussion_opening'
  return 'generic'
}

function extractFormatterPatternsFromLine(line: string) {
  const quotedPatterns = Array.from(line.matchAll(/[“"]([^“”"]+)[”"]/g))
    .map(match => normalizeFormatterPatternLine(match[1] ?? ''))
    .filter(pattern => isLikelyReusableFormatterSentenceLine(pattern))

  if (quotedPatterns.length > 0) {
    return Array.from(new Set(quotedPatterns))
  }

  const normalizedLine = normalizeFormatterPatternLine(line)
  if (!isLikelyReusableFormatterSentenceLine(normalizedLine)) {
    return []
  }

  return [normalizedLine]
}

function extractFormatterPatternGroups(rule: MinuteFormatterRule): FormatterPatternGroups {
  const groups = createEmptyFormatterPatternGroups()
  let activeSectionKey: FormatterPatternSectionKey | null = null

  for (const rawLine of rule.content.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue

    const explicitSectionKey = inferFormatterPatternSectionKey(line)
    if (explicitSectionKey) {
      activeSectionKey = explicitSectionKey
    }

    const patterns = extractFormatterPatternsFromLine(line)
    if (patterns.length === 0) continue

    for (const pattern of patterns) {
      const patternKind = classifyFormatterPattern(pattern)
      const targetKey: FormatterPatternSectionKey = patternKind === 'action_label'
        ? 'resolved'
        : explicitSectionKey
          ?? activeSectionKey
          ?? (
            patternKind === 'paper_presented'
            || patternKind === 'paper_purpose'
            || patternKind === 'details_presented'
              ? 'discussion_opening'
              : 'generic'
          )

      if (targetKey === 'discussion_opening') {
        appendUniqueFormatterPatterns(groups.discussionOpening, [pattern])
      } else if (targetKey === 'resolved') {
        appendUniqueFormatterPatterns(groups.resolved, [pattern])
      } else {
        appendUniqueFormatterPatterns(groups.generic, [pattern])
      }
    }
  }

  return groups
}

function buildEntryScopedFormatterGuidance(params: {
  rule: MinuteFormatterRule
  compatiblePatterns: string[]
}) {
  if (params.compatiblePatterns.length === 0) return ''

  return `Reusable formatter memory (${params.rule.title}) for this entry: ${params.compatiblePatterns.join(' | ')}`
}

function selectCompatibleFormatterPatterns(params: {
  entry: MinuteTemplatePromptEntry
  sectionHint: ReturnType<typeof inferMinuteFormatterSectionHint>
  sectionEntryIndex: number
  patternGroups: FormatterPatternGroups
}) {
  const isActionEntry = isActionLikeTemplateEntry(params.entry)
  const openerEligible = isOpeningFormulaEligibleEntry({
    entry: params.entry,
    sectionHint: params.sectionHint,
    sectionEntryIndex: params.sectionEntryIndex,
  })

  if (isActionEntry) {
    return params.patternGroups.resolved.filter(pattern => classifyFormatterPattern(pattern) === 'action_label')
  }

  if (openerEligible) {
    const openerPatterns = params.patternGroups.discussionOpening.filter(pattern => (
      classifyFormatterPattern(pattern) !== 'action_label'
    ))

    if (openerPatterns.length > 0) {
      return openerPatterns
    }
  }

  if (params.sectionHint === 'resolved') {
    return params.patternGroups.resolved.filter(pattern => classifyFormatterPattern(pattern) === 'generic')
  }

  return params.patternGroups.generic.filter(pattern => classifyFormatterPattern(pattern) !== 'action_label')
}

function buildBaseFormatPurposePattern(sampleValue: string) {
  const normalizedSample = normalizeWhitespace(sampleValue)
  const connectorMatch = normalizedSample.match(/^(The purpose of the paper is to .*?\b(?:on|for))\s+.+?\.?$/i)
  if (connectorMatch?.[1]) {
    return normalizeBaseFormatFormulaPattern(`${connectorMatch[1]} [subject].`)
  }

  return 'The purpose of the paper is to [subject].'
}

function detectBaseFormatOpeningFormula(entry: MinuteTemplatePromptEntry) {
  if (!looksLikeFormulaEligibleParagraphEntry(entry)) return null

  const sampleValue = compactTemplateValue(entry.sampleValue ?? '')
  if (!sampleValue) return null

  if (/^the paper was presented by\s+.+?\.?$/i.test(sampleValue)) {
    return {
      kind: 'paper_presented' as const,
      pattern: 'The paper was presented by [Role].',
    }
  }

  if (/^the purpose of the paper is to\s+.+?\.?$/i.test(sampleValue)) {
    return {
      kind: 'paper_purpose' as const,
      pattern: buildBaseFormatPurposePattern(sampleValue),
    }
  }

  if (/^the details of the paper were as presented\.?$/i.test(sampleValue)) {
    return {
      kind: 'details_presented' as const,
      pattern: 'The details of the paper were as presented.',
    }
  }

  return null
}

function isLikelyReusableFormatterSentenceLine(value: string) {
  const normalized = normalizeFormatterPatternLine(value)
  if (!normalized) return false
  if (isStandaloneBracketNote(normalized)) return false
  if (inferMinuteFormatterSectionHint(normalized)) return false
  if (/:\s*$/.test(normalized)) return false
  if (countWords(normalized) < 4) return false
  if (
    /\b(?:should|must|use the above|include a blank line|retain line spacing|line spacing|opening triad|resolved action formatting|place the|directly beneath)\b/i
      .test(normalized)
  ) {
    return false
  }
  if (/\[[^\]]+\]/.test(normalized)) return true
  return /[.!?]$/.test(normalized)
}

function selectAgendaFormatterRules(params: {
  agendaNo: string
  formatterRules: MinuteFormatterRule[]
}) {
  const agendaMajor = params.agendaNo.match(/^(\d+)(?:\.|$)/)?.[1]

  return params.formatterRules.filter(rule => {
    if (rule.target.exactAgendaNos.length === 0 && rule.target.agendaFamilies.length === 0) {
      return true
    }
    if (rule.target.exactAgendaNos.includes(params.agendaNo)) {
      return true
    }
    if (!agendaMajor) {
      return false
    }
    return rule.target.agendaFamilies.includes(agendaMajor)
  })
}

function applyReusableFormatterGuidanceToTemplateEntries(params: {
  agendaNo: string
  templateEntries: MinuteTemplatePromptEntry[]
  formatterRules: MinuteFormatterRule[]
}) {
  if (params.formatterRules.length === 0 || params.templateEntries.length === 0) {
    return {
      templateEntries: params.templateEntries,
      matchedFormatterRules: [] as MinuteFormatterRule[],
    }
  }

  const matchedRuleIds = new Set<string>()
  const sectionEntryCounts = new Map<string, number>()

  const templateEntries = params.templateEntries.map((entry, entryIndex) => {
    const sectionHint = inferMinuteFormatterSectionHint(entry.context)
    const sectionKey = sectionHint ?? '__global__'
    const sectionEntryIndex = sectionEntryCounts.get(sectionKey) ?? 0
    sectionEntryCounts.set(sectionKey, sectionEntryIndex + 1)

    const matchedRules = params.formatterRules.filter(rule => minuteFormatterRuleAppliesToContext(
      rule,
      {
        agendaNo: params.agendaNo,
        sectionHint,
        entryKind: entry.kind,
        entryIndex,
        sectionEntryIndex,
      },
    ))

    if (matchedRules.length === 0) {
      return entry
    }

    const relevantRuleMatches = matchedRules
      .map(rule => {
        const patternGroups = extractFormatterPatternGroups(rule)
        const compatiblePatterns = selectCompatibleFormatterPatterns({
          entry,
          sectionHint,
          sectionEntryIndex,
          patternGroups,
        })
        if (compatiblePatterns.length === 0) return null

        const positionIndex = rule.target.sectionHints.length > 0
          ? sectionEntryIndex
          : entryIndex
        const selectedPattern = compatiblePatterns[positionIndex] ?? compatiblePatterns.at(-1)
        return {
          rule,
          compatiblePatterns,
          selectedPattern,
          scopedGuidance: buildEntryScopedFormatterGuidance({
            rule,
            compatiblePatterns,
          }),
        }
      })
      .filter((match): match is NonNullable<typeof match> => Boolean(match))

    if (relevantRuleMatches.length === 0) {
      return entry
    }

    relevantRuleMatches.forEach(match => matchedRuleIds.add(match.rule.entryId))

    const formatterGuidance = relevantRuleMatches
      .slice(0, 3)
      .map(match => match.scopedGuidance)
      .filter(Boolean)
    const formatterPattern = relevantRuleMatches
      .map(match => match.selectedPattern)
      .find(Boolean)

    const guidance = Array.from(new Set([
      entry.guidance?.trim(),
      ...formatterGuidance,
    ].filter(Boolean)))
      .join(' | ')

    return {
      ...entry,
      guidance: guidance || undefined,
      formatterPattern,
      matchedFormatterRuleIds: matchedRules.map(rule => rule.entryId),
    }
  })

  return {
    templateEntries,
    matchedFormatterRules: params.formatterRules.filter(rule => matchedRuleIds.has(rule.entryId)),
  }
}

function applyBaseFormatFormulaGuidanceToTemplateEntries(templateEntries: MinuteTemplatePromptEntry[]) {
  if (templateEntries.length === 0) return templateEntries

  const sectionEntryCounts = new Map<string, number>()

  return templateEntries.map(entry => {
    if (!looksLikeFormulaEligibleParagraphEntry(entry)) return entry
    if (isTranscriptConstrainedTemplateEntry(entry)) return entry

    const sectionHint = inferMinuteFormatterSectionHint(entry.context)
    const sectionKey = sectionHint ?? '__global__'
    const sectionEntryIndex = sectionEntryCounts.get(sectionKey) ?? 0
    sectionEntryCounts.set(sectionKey, sectionEntryIndex + 1)

    if (!isOpeningFormulaEligibleEntry({
      entry,
      sectionHint,
      sectionEntryIndex,
    })) {
      return entry
    }

    const detectedFormula = detectBaseFormatOpeningFormula(entry)
    if (!detectedFormula) return entry

    const guidance = Array.from(new Set([
      entry.guidance?.trim(),
      'Recognized Base Format opener formula: keep this sentence pattern closely, but fill it with current agenda facts only.',
    ].filter(Boolean)))
      .join(' | ')

    return {
      ...entry,
      guidance: guidance || undefined,
      baseFormatFormulaPattern: detectedFormula.pattern,
      baseFormatFormulaKind: detectedFormula.kind,
    }
  })
}

function extractOpeningSpeakerFromTranscript(transcript: string) {
  const lines = transcript
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)

  for (const line of lines) {
    const withoutTimestamp = line.replace(/^\[[^\]]+\]\s*/, '')
    const speaker = withoutTimestamp.match(/^([^:\n]+):\s+/)?.[1]?.trim()
    if (speaker) return speaker
  }

  return null
}

function deriveMemoryRoleLabel(params: {
  presenter: string | null
  cleanedTranscript: string
}) {
  return compactTemplateValue(
    params.presenter
    || extractOpeningSpeakerFromTranscript(params.cleanedTranscript)
    || 'the presenter',
  )
}

function deriveMemorySubjectLabel(params: {
  agendaTitle: string
  paperSummary: string | null
}) {
  const summary = compactTemplateValue(params.paperSummary ?? '')
  const subjectFromPurpose = summary.match(/\b(?:seek|seeks|seeking)\s+(?:alco\s+)?(?:approval|endorsement|notation|to note)\s+(?:for|on)\s+(.+?)(?:[.](?:\s|$)|$)/i)?.[1]
    || summary.match(/\b(?:proposal|paper)\s+(?:on|for)\s+(.+?)(?:[.](?:\s|$)|$)/i)?.[1]

  return compactTemplateValue(subjectFromPurpose ?? params.agendaTitle)
}

function extractPresentedByRoleFromEvidence(value: string | null | undefined) {
  const normalized = normalizeWhitespace(value ?? '')
  if (!normalized) return null

  const match = normalized.match(/\b(?:paper|proposal|item)\s+was\s+presented\s+by\s+([^.;\n]+?)(?=\s*(?:[.;\n]|$))/i)
    ?? normalized.match(/\bpresented\s+by\s+([^.;\n]+?)(?=\s*(?:[.;\n]|$))/i)

  return compactTemplateValue(match?.[1] ?? '') || null
}

function deriveBaseFormatRoleLabel(params: {
  crossRefAnalysis: string
  presenter: string | null
  cleanedTranscript: string
  allowTranscriptFallback?: boolean
}) {
  return compactTemplateValue(
    extractPresentedByRoleFromEvidence(params.crossRefAnalysis)
    || params.presenter
    || (params.allowTranscriptFallback === false ? '' : extractOpeningSpeakerFromTranscript(params.cleanedTranscript))
    || '',
  ) || null
}

function extractSubjectFromEvidence(value: string | null | undefined) {
  const normalized = normalizeWhitespace(value ?? '')
  if (!normalized) return null

  const match = normalized.match(/\bthe purpose of the paper is to .*?\b(?:on|for)\s+(.+?)(?=[.;\n]|$)/i)
    ?? normalized.match(/\b(?:seek|seeks|seeking)\s+(?:alco\s+)?(?:approval|endorsement|notation|to note)\s+(?:for|on)\s+(.+?)(?=[.;\n]|$)/i)
    ?? normalized.match(/\b(?:proposal|paper)\s+(?:on|for)\s+(.+?)(?=[.;\n]|$)/i)

  return compactTemplateValue(match?.[1] ?? '') || null
}

function deriveBaseFormatSubjectLabel(params: {
  crossRefAnalysis: string
  agendaTitle: string
  paperSummary: string | null
}) {
  return compactTemplateValue(
    extractSubjectFromEvidence(params.crossRefAnalysis)
    || extractSubjectFromEvidence(params.paperSummary)
    || params.agendaTitle,
  ) || null
}

function materializeFormatterPattern(params: {
  pattern: string
  presenter: string | null
  cleanedTranscript: string
  agendaTitle: string
  paperSummary: string | null
  crossRefAnalysis: string
  sourceConstraint?: MinuteTemplatePromptEntry['sourceConstraint']
}) {
  const roleLabel = params.sourceConstraint === 'paper'
    ? compactTemplateValue(
        extractPresentedByRoleFromEvidence(params.crossRefAnalysis)
        || params.presenter
        || '',
      )
    : deriveMemoryRoleLabel({
        presenter: params.presenter,
        cleanedTranscript: params.cleanedTranscript,
      })
  const subjectLabel = params.sourceConstraint === 'paper'
    ? compactTemplateValue(
        extractSubjectFromEvidence(params.crossRefAnalysis)
        || extractSubjectFromEvidence(params.paperSummary)
        || params.agendaTitle,
      )
    : deriveMemorySubjectLabel({
        agendaTitle: params.agendaTitle,
        paperSummary: params.paperSummary,
      })

  const materialized = params.pattern
    .replace(/\[role\]/gi, roleLabel)
    .replace(/\[subject\]/gi, subjectLabel)
    .replace(/\[(?:topic|matter|proposal|paper)\]/gi, subjectLabel)

  return normalizeWhitespace(materialized)
}

function matchesBaseFormatFormulaKind(
  value: string,
  kind: MinuteTemplatePromptEntry['baseFormatFormulaKind'],
) {
  const normalized = compactTemplateValue(stripConfidenceMarkers(value))
  if (!normalized || !kind) return false

  if (kind === 'paper_presented') {
    return /^the paper was presented by\s+.+?\.?$/i.test(normalized)
  }
  if (kind === 'paper_purpose') {
    return /^the purpose of the paper is to\s+.+?\.?$/i.test(normalized)
  }
  return /^the details of the paper were as presented\.?$/i.test(normalized)
}

function materializeBaseFormatFormula(params: {
  pattern: string
  kind: NonNullable<MinuteTemplatePromptEntry['baseFormatFormulaKind']>
  crossRefAnalysis: string
  presenter: string | null
  cleanedTranscript: string
  agendaTitle: string
  paperSummary: string | null
  sourceConstraint?: MinuteTemplatePromptEntry['sourceConstraint']
}) {
  if (params.kind === 'details_presented') {
    return normalizeBaseFormatFormulaPattern(params.pattern)
  }

  if (params.kind === 'paper_presented') {
    const roleLabel = deriveBaseFormatRoleLabel({
      crossRefAnalysis: params.crossRefAnalysis,
      presenter: params.presenter,
      cleanedTranscript: params.cleanedTranscript,
      allowTranscriptFallback: params.sourceConstraint !== 'paper',
    })
    if (!roleLabel) return ''

    return normalizeWhitespace(
      params.pattern
        .replace(/\[role\]/gi, roleLabel),
    )
  }

  const subjectLabel = deriveBaseFormatSubjectLabel({
    crossRefAnalysis: params.crossRefAnalysis,
    agendaTitle: params.agendaTitle,
    paperSummary: params.paperSummary,
  })
  if (!subjectLabel) return ''

  return normalizeWhitespace(
    params.pattern
      .replace(/\[subject\]/gi, subjectLabel)
      .replace(/\[(?:topic|matter|proposal|paper)\]/gi, subjectLabel),
  )
}

function looksLikeDiscussionLedSentence(value: string) {
  const normalized = compactTemplateValue(stripConfidenceMarkers(value))
  if (!normalized) return false
  if (/^the paper\b/i.test(normalized) || /^the purpose\b/i.test(normalized) || /^the details\b/i.test(normalized)) {
    return false
  }
  return /^(?:the committee|the chairman|chairman|head,|cbo\b|ceo\b|gcro\b|ofd\b|cmrd\b|alm\b|td\b)/i.test(normalized)
}

function applyMemoryScaffoldsToTemplateFill(params: {
  fill: MinuteTemplateFill
  templateEntries: MinuteTemplatePromptEntry[]
  presenter: string | null
  cleanedTranscript: string
  agendaTitle: string
  paperSummary: string | null
  crossRefAnalysis: string
}) {
  const usedRuleIds = new Set<string>()
  const sectionEntryCounts = new Map<string, number>()

  for (const entry of params.templateEntries) {
    if (entry.kind !== 'slot') continue
    if (!entry.formatterPattern) continue
    if (!entry.matchedFormatterRuleIds || entry.matchedFormatterRuleIds.length === 0) continue

    const sectionHint = inferMinuteFormatterSectionHint(entry.context)
    const patternKind = classifyFormatterPattern(entry.formatterPattern)
    if (patternKind === 'action_label') continue
    if (
      (patternKind === 'paper_presented'
        || patternKind === 'paper_purpose'
        || patternKind === 'details_presented')
      && (sectionHint === 'resolved' || !looksLikeFormulaEligibleParagraphEntry(entry))
    ) {
      continue
    }

    const sectionKey = sectionHint ?? '__global__'
    const sectionEntryIndex = sectionEntryCounts.get(sectionKey) ?? 0
    sectionEntryCounts.set(sectionKey, sectionEntryIndex + 1)

    const currentValue = compactTemplateValue(params.fill.slots?.[entry.id] ?? '')
    const scaffold = materializeFormatterPattern({
      pattern: entry.formatterPattern,
      presenter: params.presenter,
      cleanedTranscript: params.cleanedTranscript,
      agendaTitle: params.agendaTitle,
      paperSummary: params.paperSummary,
      crossRefAnalysis: params.crossRefAnalysis,
      sourceConstraint: entry.sourceConstraint,
    })

    if (!scaffold) continue

    const shouldApply = (
      sectionEntryIndex < 3
      && (
        !currentValue
        || isLikelyTemplateSampleEcho(currentValue, entry.sampleValue)
        || looksLikeDiscussionLedSentence(currentValue)
        || countWords(currentValue) > 24
      )
    )

    if (!shouldApply) continue

    params.fill.slots = {
      ...(params.fill.slots ?? {}),
      [entry.id]: scaffold,
    }
    entry.matchedFormatterRuleIds.forEach(ruleId => usedRuleIds.add(ruleId))
  }

  return Array.from(usedRuleIds)
}

function applyBaseFormatFormulaScaffoldsToTemplateFill(params: {
  fill: MinuteTemplateFill
  templateEntries: MinuteTemplatePromptEntry[]
  crossRefAnalysis: string
  presenter: string | null
  cleanedTranscript: string
  agendaTitle: string
  paperSummary: string | null
}) {
  const sectionEntryCounts = new Map<string, number>()

  for (const entry of params.templateEntries) {
    if (!looksLikeFormulaEligibleParagraphEntry(entry)) continue
    if (isTranscriptConstrainedTemplateEntry(entry)) continue

    const sectionHint = inferMinuteFormatterSectionHint(entry.context)
    const sectionKey = sectionHint ?? '__global__'
    const sectionEntryIndex = sectionEntryCounts.get(sectionKey) ?? 0
    sectionEntryCounts.set(sectionKey, sectionEntryIndex + 1)

    if (!isOpeningFormulaEligibleEntry({
      entry,
      sectionHint,
      sectionEntryIndex,
    })) {
      continue
    }
    if (!entry.baseFormatFormulaPattern || !entry.baseFormatFormulaKind) continue

    const scaffold = materializeBaseFormatFormula({
      pattern: entry.baseFormatFormulaPattern,
      kind: entry.baseFormatFormulaKind,
      crossRefAnalysis: params.crossRefAnalysis,
      presenter: params.presenter,
      cleanedTranscript: params.cleanedTranscript,
      agendaTitle: params.agendaTitle,
      paperSummary: params.paperSummary,
      sourceConstraint: entry.sourceConstraint,
    })
    if (!scaffold) continue

    const currentValue = compactTemplateValue(params.fill.slots?.[entry.id] ?? '')
    const shouldApply = (
      !currentValue
      || isLikelyTemplateSampleEcho(currentValue, entry.sampleValue)
      || looksLikeDiscussionLedSentence(currentValue)
      || countWords(currentValue) > 24
      || !matchesBaseFormatFormulaKind(currentValue, entry.baseFormatFormulaKind)
    )

    if (!shouldApply) continue

    params.fill.slots = {
      ...(params.fill.slots ?? {}),
      [entry.id]: scaffold,
    }
  }
}

function looksLikeOpenerFormulaSentence(value: string) {
  const patternKind = classifyFormatterPattern(value)
  return (
    patternKind === 'paper_presented'
    || patternKind === 'paper_purpose'
    || patternKind === 'details_presented'
  )
}

function looksLikeInvalidResolvedActionValue(value: string) {
  const normalized = compactTemplateValue(stripConfidenceMarkers(value))
  if (!normalized) return false
  if (looksLikeOpenerFormulaSentence(normalized)) return true
  if (looksLikeDiscussionLedSentence(normalized)) return true
  if (/[.!?]\s*$/.test(normalized)) return true
  return countWords(normalized) > 10
}

function collectExpectedOpeningFormulaLines(params: {
  templateEntries: MinuteTemplatePromptEntry[]
  crossRefAnalysis: string
  presenter: string | null
  cleanedTranscript: string
  agendaTitle: string
  paperSummary: string | null
}) {
  const lines: Array<{
    kind: NonNullable<MinuteTemplatePromptEntry['baseFormatFormulaKind']>
    text: string
  }> = []
  const sectionEntryCounts = new Map<string, number>()

  for (const entry of params.templateEntries) {
    if (!entry.baseFormatFormulaPattern || !entry.baseFormatFormulaKind) continue
    if (!looksLikeFormulaEligibleParagraphEntry(entry)) continue

    const sectionHint = inferMinuteFormatterSectionHint(entry.context)
    const sectionKey = sectionHint ?? '__global__'
    const sectionEntryIndex = sectionEntryCounts.get(sectionKey) ?? 0
    sectionEntryCounts.set(sectionKey, sectionEntryIndex + 1)

    if (!isOpeningFormulaEligibleEntry({
      entry,
      sectionHint,
      sectionEntryIndex,
    })) {
      continue
    }

    const text = materializeBaseFormatFormula({
      pattern: entry.baseFormatFormulaPattern,
      kind: entry.baseFormatFormulaKind,
      crossRefAnalysis: params.crossRefAnalysis,
      presenter: params.presenter,
      cleanedTranscript: params.cleanedTranscript,
      agendaTitle: params.agendaTitle,
      paperSummary: params.paperSummary,
      sourceConstraint: entry.sourceConstraint,
    })

    if (!text) continue

    lines.push({
      kind: entry.baseFormatFormulaKind,
      text,
    })
  }

  return lines
}

function repairRenderedMinuteOpeningFormulas(params: {
  content: string
  templateEntries: MinuteTemplatePromptEntry[]
  crossRefAnalysis: string
  presenter: string | null
  cleanedTranscript: string
  agendaTitle: string
  paperSummary: string | null
}) {
  const expectedLines = collectExpectedOpeningFormulaLines({
    templateEntries: params.templateEntries,
    crossRefAnalysis: params.crossRefAnalysis,
    presenter: params.presenter,
    cleanedTranscript: params.cleanedTranscript,
    agendaTitle: params.agendaTitle,
    paperSummary: params.paperSummary,
  })
  if (expectedLines.length === 0) return params.content

  const visibleTopLines = params.content
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, 8)

  const missingLines = expectedLines.filter(line => (
    !visibleTopLines.some(candidate => matchesBaseFormatFormulaKind(candidate, line.kind))
  ))
  if (missingLines.length === 0) return params.content

  const lines = params.content.replace(/\r\n?/g, '\n').split('\n')
  let insertionIndex = lines.findIndex(line => /^(?:noted(?:\s*&\s*discussed)?|discussed|discussion)\b/i.test(line.trim()))
  if (insertionIndex >= 0) {
    insertionIndex += 1
    while (insertionIndex < lines.length && !lines[insertionIndex]?.trim()) {
      insertionIndex += 1
    }
  } else {
    insertionIndex = lines.findIndex(line => line.trim().length > 0)
    if (insertionIndex < 0) {
      insertionIndex = 0
    }
  }

  const insertionBlock = missingLines.map(line => line.text).join('\n\n')
  const next = [...lines]
  next.splice(insertionIndex, 0, insertionBlock, '')

  return next.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function sanitizeResolvedTemplateFill(params: {
  fill: MinuteTemplateFill
  templateEntries: MinuteTemplatePromptEntry[]
  crossRefAnalysis: string
  cleanedTranscript: string
  paperSummary: string | null
}) {
  const ownerCandidates = extractResolutionOwnerCandidates([
    params.crossRefAnalysis,
    params.cleanedTranscript,
    params.paperSummary ?? '',
  ])
  const ownerValue = ownerCandidates.join(' / ')

  for (const entry of params.templateEntries) {
    if (entry.kind !== 'slot') continue

    const sectionHint = inferMinuteFormatterSectionHint(entry.context)
    const currentValue = compactTemplateValue(params.fill.slots?.[entry.id] ?? '')
    if (!currentValue) continue

    if (isActionLikeTemplateEntry(entry)) {
      if (!isOwnerLikeResolvedEntry(entry)) {
        if (looksLikeOpenerFormulaSentence(currentValue) && params.fill.slots) {
          delete params.fill.slots[entry.id]
        }
        continue
      }

      if (!looksLikeInvalidResolvedActionValue(currentValue)) continue

      if (ownerValue) {
        params.fill.slots = {
          ...(params.fill.slots ?? {}),
          [entry.id]: ownerValue,
        }
      } else if (params.fill.slots) {
        delete params.fill.slots[entry.id]
      }
      continue
    }

    if (sectionHint === 'resolved' && looksLikeOpenerFormulaSentence(currentValue) && params.fill.slots) {
      delete params.fill.slots[entry.id]
    }
  }
}

interface ResolvedPlaybookExactTemplate {
  template: MinuteTemplateSchema
  resolutionSlotIds: string[]
  resolutionListIds: string[]
  omittedSlotIds: string[]
  omittedListIds: string[]
  requiredOwnerSlotIds: string[]
  requiredOwnerListIds: string[]
  requiredOwnerLabels: string[]
}

interface ResolutionPathVariantSelectionResult {
  variantKey: 'default' | 'with_action' | 'without_action'
  variant: ReturnType<typeof getMinutePlaybookVariantById> | ReturnType<typeof getMinutePlaybookDefaultVariant>
  source: ResolutionVariantSelectionSource
}

function remapResolutionEntryIds(ids: string[], idMap: Record<string, string>) {
  return ids.map(id => idMap[id] ?? id)
}

function resolvePlaybookRuntimeState(playbook: MinutePlaybookRecord | null | undefined) {
  const playbookMode = getMinutePlaybookMode(playbook)
  const resolutionPathsEnabled = Boolean(
    playbook
    && playbookMode === 'resolution_paths'
    && playbookHasResolutionAnchor(playbook),
  )

  return {
    playbookMode,
    resolutionPathsEnabled,
  }
}

function normalizeCanonicalMinuteReport(report: CanonicalMinuteReport): CanonicalMinuteReport {
  const normalizeList = (items: string[]) => (
    Array.isArray(items)
      ? items
        .filter((item): item is string => typeof item === 'string')
        .map(item => compactTemplateValue(item))
        .filter(Boolean)
      : []
  )

  return {
    paperSummary: typeof report.paperSummary === 'string' ? normalizeWhitespace(report.paperSummary) : '',
    discussionExplanation: typeof report.discussionExplanation === 'string'
      ? normalizeWhitespace(report.discussionExplanation)
      : '',
    noted: normalizeList(report.noted),
    discussed: normalizeList(report.discussed),
    resolved: normalizeList(report.resolved),
  }
}

const RESOLUTION_DECISION_PATTERN = /\b(approved|endorsed|accepted|adopted|agreed|decided|decision|resolved|noted|confirmed|closed|deferred|ratified|concurred)\b/i
const RESOLUTION_FOLLOW_UP_PATTERNS = [
  /\bactions?\s*:/i,
  /\baction by\b/i,
  /\bpic\b/i,
  /\bperson in charge\b/i,
  /\bdue date\b/i,
  /\bdeadline\b/i,
  /\bfollow[- ]?up\b/i,
  /\b(?:submit|circulate|prepare|update|review|provide|complete|finali[sz]e|table|conduct|investigate|identify|revert|notify|share)\b/i,
  /\b(?:shall|must|will|is to|are to|was tasked to|were tasked to|requested to|directed to|tasked to)\b/i,
  /\bby\s+\d{1,2}\s+[A-Za-z]+\s+\d{4}\b/i,
]

const RESOLUTION_ACTION_OUTPUT_PATTERNS = [
  /^actions?\s*:/i,
  /\baction by\b/i,
  /\bpic\b/i,
  /\bperson in charge\b/i,
  /\bdue date\b/i,
  /\bdeadline\b/i,
  /\bowner\b/i,
  /\bfollow[- ]?up\b/i,
  /^[A-Z][A-Za-z0-9 ,/&().'’-]+?\s+to\s+(?:submit|circulate|prepare|update|review|provide|complete|finali[sz]e|table|conduct|investigate|identify|revert|notify|share)\b/i,
]
const RESOLUTION_OWNER_EVIDENCE_PATTERNS = [
  /\baction by\b/i,
  /\bpic\b/i,
  /\bperson in charge\b/i,
  /\bowner\b/i,
  /^[A-Z][A-Za-z0-9 ,/&().'’-]+?\s+to\s+(?:submit|circulate|prepare|update|review|provide|complete|finali[sz]e|table|conduct|investigate|identify|revert|notify|share)\b/i,
]
const EXPLICIT_RESOLUTION_OWNER_LINE_PATTERN = /^(?:action by|pic|person in charge|owner)\s*:\s*(.+)$/i
const RESOLUTION_OWNER_TASK_CAPTURE_PATTERN = /^([A-Z][A-Za-z0-9 ,/&().'’-]+?)\s+to\s+(?:submit|circulate|prepare|update|review|provide|complete|finali[sz]e|table|conduct|investigate|identify|revert|notify|share)\b/i
const NON_OWNER_GENERIC_ROLE_PATTERNS = [
  /^the committee$/i,
  /^committee$/i,
  /^the chairman$/i,
  /^chairman$/i,
  /^the chair$/i,
  /^chair$/i,
]

function findResolutionActionSignals(values: string[]) {
  const signals = new Set<string>()

  for (const value of values) {
    const normalized = normalizeWhitespace(value)
    if (!normalized) continue

    const lines = normalized.split('\n').map(line => line.trim()).filter(Boolean)
    for (const line of lines) {
      if (RESOLUTION_ACTION_OUTPUT_PATTERNS.some(pattern => pattern.test(line))) {
        signals.add(line)
      }
    }
  }

  return Array.from(signals)
}

function hasResolutionOwnerEvidence(
  canonicalReport: CanonicalMinuteReport,
  crossRefAnalysis: string,
) {
  const evidenceText = [canonicalReport.resolved.join('\n'), crossRefAnalysis]
    .filter(Boolean)
    .join('\n')
  if (!evidenceText.trim()) return false

  const lines = normalizeWhitespace(evidenceText)
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)

  return lines.some(line => RESOLUTION_OWNER_EVIDENCE_PATTERNS.some(pattern => pattern.test(line)))
}

function stripLeadingResolutionListLabel(value: string) {
  return value.replace(/^\s*(?:[-*•]|\(?\d+\)?[.)]?|\(?[A-Za-z]\)?[.)])\s+/, '').trim()
}

function isNonOwnerGenericRole(value: string) {
  const normalized = compactTemplateValue(stripConfidenceMarkers(value))
  if (!normalized) return false
  return NON_OWNER_GENERIC_ROLE_PATTERNS.some(pattern => pattern.test(normalized))
}

function extractResolutionOwnerCandidates(values: string[]) {
  const candidates: string[] = []
  const seen = new Set<string>()

  const addCandidate = (value: string) => {
    const normalized = compactTemplateValue(stripLeadingResolutionListLabel(stripConfidenceMarkers(value)))
    if (!normalized || isNonOwnerGenericRole(normalized)) return
    const key = normalized.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    candidates.push(normalized)
  }

  for (const value of values) {
    const lines = normalizeWhitespace(value)
      .split('\n')
      .map(line => stripLeadingResolutionListLabel(line.trim()))
      .filter(Boolean)

    for (const line of lines) {
      const explicitOwner = line.match(EXPLICIT_RESOLUTION_OWNER_LINE_PATTERN)?.[1]
      if (explicitOwner) {
        addCandidate(explicitOwner)
        continue
      }

      const actorOwner = line.match(RESOLUTION_OWNER_TASK_CAPTURE_PATTERN)?.[1]
      if (actorOwner) {
        addCandidate(actorOwner)
      }
    }
  }

  return candidates
}

function backfillResolutionOwnerFields(params: {
  extracted: StrictTemplateExtraction
  resolvedTemplate: ResolvedPlaybookExactTemplate
  branchTexts: string[]
  canonicalReport: CanonicalMinuteReport
  crossRefAnalysis: string
}) {
  const ownerCandidates = extractResolutionOwnerCandidates([
    ...params.branchTexts,
    ...params.canonicalReport.resolved,
    params.crossRefAnalysis,
  ])
  if (ownerCandidates.length === 0) {
    return false
  }

  let didFill = false
  const joinedOwnerValue = ownerCandidates.join(' / ')

  for (const slotId of params.resolvedTemplate.requiredOwnerSlotIds) {
    const existingEntry = params.extracted.slots.find(entry => entry.id === slotId)
    if (existingEntry) {
      if (compactTemplateValue(existingEntry.value)) continue
      existingEntry.value = joinedOwnerValue
      didFill = true
      continue
    }

    params.extracted.slots.push({
      id: slotId,
      value: joinedOwnerValue,
    })
    didFill = true
  }

  for (const listId of params.resolvedTemplate.requiredOwnerListIds) {
    const existingEntry = params.extracted.lists.find(entry => entry.id === listId)
    if (existingEntry) {
      if (existingEntry.items.some(item => compactTemplateValue(item))) continue
      existingEntry.items = [...ownerCandidates]
      didFill = true
      continue
    }

    params.extracted.lists.push({
      id: listId,
      items: [...ownerCandidates],
    })
    didFill = true
  }

  return didFill
}

function collectResolutionBranchExtractionTexts(params: {
  extracted: StrictTemplateExtraction
  template: MinuteTemplateSchema
  resolutionSlotIds: string[]
  resolutionListIds: string[]
  resolutionVariantKey: 'default' | 'with_action' | 'without_action' | null
}) {
  if (!params.resolutionVariantKey || params.resolutionVariantKey === 'default') {
    return []
  }

  const slotIds = params.resolutionSlotIds.length > 0
    ? new Set(params.resolutionSlotIds)
    : new Set(
        params.template.nodes
          .filter((node): node is Extract<MinuteTemplateSchema['nodes'][number], { type: 'slot' }> => node.type === 'slot')
          .map(node => node.slotId),
      )
  const listIds = params.resolutionListIds.length > 0
    ? new Set(params.resolutionListIds)
    : new Set(
        params.template.nodes
          .filter((node): node is Extract<MinuteTemplateSchema['nodes'][number], { type: 'list' }> => node.type === 'list')
          .map(node => node.slotId),
      )

  return [
    ...params.extracted.slots
      .filter(entry => slotIds.has(entry.id))
      .map(entry => compactTemplateValue(entry.value))
      .filter(Boolean),
    ...params.extracted.lists
      .filter(entry => listIds.has(entry.id))
      .flatMap(entry => entry.items.map(item => compactTemplateValue(item)).filter(Boolean)),
  ]
}

function hasExtractedResolutionEntryValue(params: {
  extracted: StrictTemplateExtraction
  slotIds: string[]
  listIds: string[]
}) {
  const slotIds = new Set(params.slotIds)
  const listIds = new Set(params.listIds)

  if (params.extracted.slots.some(entry => (
    slotIds.has(entry.id) && compactTemplateValue(entry.value).length > 0
  ))) {
    return true
  }

  return params.extracted.lists.some(entry => (
    listIds.has(entry.id)
    && entry.items.some(item => compactTemplateValue(item).length > 0)
  ))
}

function validateResolutionBranchConsistency(params: {
  selectedVariant: ReturnType<typeof getMinutePlaybookDefaultVariant> | null
  resolutionVariantKey: 'default' | 'with_action' | 'without_action' | null
  extracted: StrictTemplateExtraction
  resolvedTemplate: ResolvedPlaybookExactTemplate
  canonicalReport: CanonicalMinuteReport
  crossRefAnalysis: string
}) {
  if (!params.selectedVariant || !params.resolutionVariantKey || params.resolutionVariantKey === 'default') {
    return
  }

  const branchTexts = collectResolutionBranchExtractionTexts({
    extracted: params.extracted,
    template: params.resolvedTemplate.template,
    resolutionSlotIds: params.resolvedTemplate.resolutionSlotIds,
    resolutionListIds: params.resolvedTemplate.resolutionListIds,
    resolutionVariantKey: params.resolutionVariantKey,
  })

  if (params.resolutionVariantKey === 'without_action') {
    const actionSignals = findResolutionActionSignals(branchTexts)
    if (actionSignals.length > 0) {
      console.warn(
        `[generate-minutes] Decision / Closure Only produced follow-up wording; continuing with best-effort render. ${actionSignals.slice(0, 3).join(' | ')}`,
      )
    }
    return
  }

  const templateSignals = findClosureOnlyMinuteTemplateSignals(params.selectedVariant.promptText)
  if (templateSignals.length > 0) {
    console.warn(
      `[generate-minutes] Decision + Follow-up branch contains closure-only wording in the saved template; continuing with best-effort render. ${templateSignals.slice(0, 3).join(' | ')}`,
    )
  }

  const renderedSignals = findClosureOnlyMinuteTemplateSignals(branchTexts.join('\n'))
  if (renderedSignals.length > 0) {
    console.warn(
      `[generate-minutes] Decision + Follow-up produced closure-only wording; continuing with best-effort render. ${renderedSignals.slice(0, 3).join(' | ')}`,
    )
  }

  const templateHasOwnerField = params.resolvedTemplate.requiredOwnerSlotIds.length > 0
    || params.resolvedTemplate.requiredOwnerListIds.length > 0
  if (!templateHasOwnerField) {
    return
  }

  const hasOwnerEvidence = hasResolutionOwnerEvidence(
    params.canonicalReport,
    params.crossRefAnalysis,
  )
  if (!hasOwnerEvidence) {
    return
  }

  const hasOwnerValue = hasExtractedResolutionEntryValue({
    extracted: params.extracted,
    slotIds: params.resolvedTemplate.requiredOwnerSlotIds,
    listIds: params.resolvedTemplate.requiredOwnerListIds,
  })
  if (!hasOwnerValue) {
    backfillResolutionOwnerFields({
      extracted: params.extracted,
      resolvedTemplate: params.resolvedTemplate,
      branchTexts,
      canonicalReport: params.canonicalReport,
      crossRefAnalysis: params.crossRefAnalysis,
    })
  }
}

function splitResolutionEvidenceIntoUnits(values: string[]) {
  const units: string[] = []
  const seen = new Set<string>()

  const addUnit = (value: string) => {
    const normalized = compactTemplateValue(stripConfidenceMarkers(value))
    if (!normalized) return
    const key = normalized.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    units.push(normalized)
  }

  for (const value of values) {
    const normalized = normalizeWhitespace(value)
    if (!normalized) continue

    for (const line of normalized.split('\n').map(item => item.trim()).filter(Boolean)) {
      const sentenceMatches = line.match(/[^.!?]+(?:[.!?]+|$)/g) ?? [line]
      for (const sentence of sentenceMatches) {
        addUnit(sentence)
      }
    }
  }

  return units
}

function isExplicitResolutionOwnerOnlyLine(value: string) {
  return EXPLICIT_RESOLUTION_OWNER_LINE_PATTERN.test(compactTemplateValue(stripConfidenceMarkers(value)))
}

function collectResolutionDecisionCandidates(params: {
  canonicalReport: CanonicalMinuteReport
  crossRefAnalysis: string
}) {
  return splitResolutionEvidenceIntoUnits([
    params.canonicalReport.resolved.join('\n'),
    params.crossRefAnalysis,
  ]).filter(line => {
    if (looksLikeOpenerFormulaSentence(line)) return false
    if (isExplicitResolutionOwnerOnlyLine(line)) return false
    return RESOLUTION_DECISION_PATTERN.test(line)
  })
}

function collectResolutionFollowUpCandidates(params: {
  canonicalReport: CanonicalMinuteReport
  crossRefAnalysis: string
}) {
  return splitResolutionEvidenceIntoUnits([
    params.canonicalReport.resolved.join('\n'),
    params.crossRefAnalysis,
  ]).filter(line => {
    if (looksLikeOpenerFormulaSentence(line)) return false
    if (isExplicitResolutionOwnerOnlyLine(line)) return false
    return RESOLUTION_ACTION_OUTPUT_PATTERNS.some(pattern => pattern.test(line))
  })
}

function collectResolutionBranchEntryIds(resolvedTemplate: ResolvedPlaybookExactTemplate) {
  const slotIds = resolvedTemplate.resolutionSlotIds.length > 0
    ? resolvedTemplate.resolutionSlotIds
    : resolvedTemplate.template.nodes
      .filter((node): node is Extract<MinuteTemplateSchema['nodes'][number], { type: 'slot' }> => node.type === 'slot')
      .map(node => node.slotId)
  const listIds = resolvedTemplate.resolutionListIds.length > 0
    ? resolvedTemplate.resolutionListIds
    : resolvedTemplate.template.nodes
      .filter((node): node is Extract<MinuteTemplateSchema['nodes'][number], { type: 'list' }> => node.type === 'list')
      .map(node => node.slotId)

  return {
    slotIds,
    listIds,
  }
}

function listResolutionBranchTemplateEntries(params: {
  templateEntries: MinuteTemplatePromptEntry[]
  resolvedTemplate: ResolvedPlaybookExactTemplate
}) {
  const { slotIds, listIds } = collectResolutionBranchEntryIds(params.resolvedTemplate)
  const slotIdSet = new Set(slotIds)
  const listIdSet = new Set(listIds)

  return params.templateEntries.filter(entry => (
    entry.kind === 'slot'
      ? slotIdSet.has(entry.id)
      : listIdSet.has(entry.id)
  ))
}

function cloneMinuteTemplateFill(fill: MinuteTemplateFill): MinuteTemplateFill {
  return {
    slots: fill.slots ? { ...fill.slots } : {},
    lists: fill.lists
      ? Object.fromEntries(Object.entries(fill.lists).map(([id, items]) => [id, [...(items ?? [])]]))
      : {},
  }
}

function clearResolutionBranchFill(params: {
  fill: MinuteTemplateFill
  resolvedTemplate: ResolvedPlaybookExactTemplate
}) {
  const { slotIds, listIds } = collectResolutionBranchEntryIds(params.resolvedTemplate)
  for (const slotId of slotIds) {
    if (params.fill.slots) {
      delete params.fill.slots[slotId]
    }
  }
  for (const listId of listIds) {
    if (params.fill.lists) {
      delete params.fill.lists[listId]
    }
  }
}

function setResolutionSlotFill(fill: MinuteTemplateFill, slotId: string, value: string) {
  fill.slots = {
    ...(fill.slots ?? {}),
    [slotId]: compactTemplateValue(value),
  }
}

function setResolutionListFill(fill: MinuteTemplateFill, listId: string, items: string[]) {
  fill.lists = {
    ...(fill.lists ?? {}),
    [listId]: items.map(item => compactTemplateValue(item)).filter(Boolean),
  }
}

function buildFallbackResolutionDecisionSentence(params: {
  agendaTitle: string
  crossRefAnalysis: string
  paperSummary: string | null
  resolutionVariantKey: 'with_action' | 'without_action'
  hasFollowUp: boolean
}) {
  const subject = deriveBaseFormatSubjectLabel({
    crossRefAnalysis: params.crossRefAnalysis,
    agendaTitle: params.agendaTitle,
    paperSummary: params.paperSummary,
  })

  if (params.resolutionVariantKey === 'with_action' && params.hasFollowUp) {
    return `The Committee considered the proposal on ${subject} and resolved as follows.`
  }

  return `The Committee considered the proposal on ${subject}.`
}

function resolutionBranchHasMeaningfulContent(params: {
  fill: MinuteTemplateFill
  templateEntries: MinuteTemplatePromptEntry[]
  resolvedTemplate: ResolvedPlaybookExactTemplate
  resolutionVariantKey: 'with_action' | 'without_action'
}) {
  const branchEntries = listResolutionBranchTemplateEntries({
    templateEntries: params.templateEntries,
    resolvedTemplate: params.resolvedTemplate,
  })

  let hasMeaningfulBody = false
  let hasMeaningfulFollowUp = false

  for (const entry of branchEntries) {
    const values = entry.kind === 'slot'
      ? [compactTemplateValue(params.fill.slots?.[entry.id] ?? '')]
      : (params.fill.lists?.[entry.id] ?? []).map(item => compactTemplateValue(item))

    for (const value of values) {
      if (!value || looksLikeOpenerFormulaSentence(value)) continue
      if (isOwnerLikeResolvedEntry(entry)) continue

      if (isActionLikeTemplateEntry(entry)) {
        hasMeaningfulFollowUp = true
      } else {
        hasMeaningfulBody = true
      }
    }
  }

  return params.resolutionVariantKey === 'with_action'
    ? hasMeaningfulBody || hasMeaningfulFollowUp
    : hasMeaningfulBody
}

function rebuildResolutionBranchFillFromEvidence(params: {
  fill: MinuteTemplateFill
  templateEntries: MinuteTemplatePromptEntry[]
  resolvedTemplate: ResolvedPlaybookExactTemplate
  resolutionVariantKey: 'with_action' | 'without_action'
  agendaTitle: string
  canonicalReport: CanonicalMinuteReport
  crossRefAnalysis: string
  paperSummary: string | null
}) {
  const branchEntries = listResolutionBranchTemplateEntries({
    templateEntries: params.templateEntries,
    resolvedTemplate: params.resolvedTemplate,
  })
  if (branchEntries.length === 0) {
    return false
  }

  const decisionCandidates = collectResolutionDecisionCandidates({
    canonicalReport: params.canonicalReport,
    crossRefAnalysis: params.crossRefAnalysis,
  })
  const followUpCandidates = collectResolutionFollowUpCandidates({
    canonicalReport: params.canonicalReport,
    crossRefAnalysis: params.crossRefAnalysis,
  })
  const ownerCandidates = extractResolutionOwnerCandidates([
    params.canonicalReport.resolved.join('\n'),
    params.crossRefAnalysis,
    params.paperSummary ?? '',
  ])
  const ownerValue = ownerCandidates.join(' / ')

  clearResolutionBranchFill({
    fill: params.fill,
    resolvedTemplate: params.resolvedTemplate,
  })

  const nonActionEntries = branchEntries.filter(entry => !isActionLikeTemplateEntry(entry))
  const genericActionEntries = branchEntries.filter(entry => (
    isActionLikeTemplateEntry(entry) && !isOwnerLikeResolvedEntry(entry)
  ))
  const ownerEntries = branchEntries.filter(entry => isOwnerLikeResolvedEntry(entry))

  const decisionTexts = decisionCandidates.length > 0
    ? [...decisionCandidates]
    : [
        buildFallbackResolutionDecisionSentence({
          agendaTitle: params.agendaTitle,
          crossRefAnalysis: params.crossRefAnalysis,
          paperSummary: params.paperSummary,
          resolutionVariantKey: params.resolutionVariantKey,
          hasFollowUp: followUpCandidates.length > 0,
        }),
      ]

  const assignTextToEntries = (
    entries: MinuteTemplatePromptEntry[],
    texts: string[],
  ) => {
    if (entries.length === 0 || texts.length === 0) return

    const slotEntries = entries.filter(entry => entry.kind === 'slot')
    const listEntries = entries.filter(entry => entry.kind === 'list')

    let textIndex = 0

    for (const entry of slotEntries) {
      if (textIndex >= texts.length) break
      setResolutionSlotFill(params.fill, entry.id, texts[textIndex] ?? '')
      textIndex += 1
    }

    if (textIndex < texts.length && listEntries.length > 0) {
      setResolutionListFill(params.fill, listEntries[0].id, texts.slice(textIndex))
      textIndex = texts.length
    }

    if (textIndex < texts.length && slotEntries.length > 0) {
      setResolutionSlotFill(
        params.fill,
        slotEntries[slotEntries.length - 1].id,
        texts.slice(textIndex - 1).filter(Boolean).join(' '),
      )
    }
  }

  if (params.resolutionVariantKey === 'without_action') {
    assignTextToEntries(nonActionEntries.length > 0 ? nonActionEntries : branchEntries, decisionTexts)
    return resolutionBranchHasMeaningfulContent({
      fill: params.fill,
      templateEntries: params.templateEntries,
      resolvedTemplate: params.resolvedTemplate,
      resolutionVariantKey: params.resolutionVariantKey,
    })
  }

  assignTextToEntries(nonActionEntries, decisionTexts)

  if (followUpCandidates.length > 0) {
    if (genericActionEntries.length > 0) {
      assignTextToEntries(genericActionEntries, followUpCandidates)
    } else if (nonActionEntries.length > 1) {
      assignTextToEntries(nonActionEntries.slice(1), followUpCandidates)
    } else if (nonActionEntries.length === 1) {
      const fallbackEntry = nonActionEntries[0]
      const existingValue = fallbackEntry.kind === 'slot'
        ? compactTemplateValue(params.fill.slots?.[fallbackEntry.id] ?? '')
        : compactTemplateValue((params.fill.lists?.[fallbackEntry.id] ?? []).join(' '))
      const appendedValue = [existingValue, ...followUpCandidates]
        .filter(Boolean)
        .join(' ')

      if (fallbackEntry.kind === 'slot') {
        setResolutionSlotFill(params.fill, fallbackEntry.id, appendedValue)
      } else {
        setResolutionListFill(params.fill, fallbackEntry.id, [appendedValue])
      }
    }
  }

  if (ownerValue) {
    for (const entry of ownerEntries) {
      if (entry.kind === 'slot') {
        setResolutionSlotFill(params.fill, entry.id, ownerValue)
        continue
      }
      setResolutionListFill(params.fill, entry.id, ownerCandidates)
    }
  }

  return resolutionBranchHasMeaningfulContent({
    fill: params.fill,
    templateEntries: params.templateEntries,
    resolvedTemplate: params.resolvedTemplate,
    resolutionVariantKey: params.resolutionVariantKey,
  })
}

function hasResolutionDecisionEvidence(
  canonicalReport: CanonicalMinuteReport,
  crossRefAnalysis: string,
) {
  const resolvedText = canonicalReport.resolved.join('\n')
  return canonicalReport.resolved.length > 0 || RESOLUTION_DECISION_PATTERN.test(`${resolvedText}\n${crossRefAnalysis}`)
}

function hasResolutionFollowUpEvidence(
  canonicalReport: CanonicalMinuteReport,
  crossRefAnalysis: string,
) {
  const evidenceText = [canonicalReport.resolved.join('\n'), crossRefAnalysis]
    .filter(Boolean)
    .join('\n')

  return RESOLUTION_FOLLOW_UP_PATTERNS.some(pattern => pattern.test(evidenceText))
}

function resolveResolutionPathVariant(params: {
  playbook: MinutePlaybookRecord
  overrideVariant: ReturnType<typeof getMinutePlaybookVariantById> | null
  canonicalReport: CanonicalMinuteReport
  crossRefAnalysis: string
}) : ResolutionPathVariantSelectionResult {
  if (params.overrideVariant) {
    return {
      variantKey: params.overrideVariant.variantKey,
      variant: params.overrideVariant,
      source: 'manual',
    }
  }

  const candidateVariantKeys: Array<'default' | 'with_action' | 'without_action'> = (
    hasResolutionFollowUpEvidence(params.canonicalReport, params.crossRefAnalysis)
      ? ['with_action', 'without_action', 'default']
      : hasResolutionDecisionEvidence(params.canonicalReport, params.crossRefAnalysis)
        ? ['without_action', 'default']
        : ['default']
  )

  for (const nextVariantKey of candidateVariantKeys) {
    const nextVariant = nextVariantKey === 'default'
      ? getMinutePlaybookDefaultVariant(params.playbook)
      : getMinutePlaybookVariant(params.playbook, nextVariantKey)

    if (!nextVariant) {
      continue
    }

    return {
      variantKey: nextVariantKey,
      variant: nextVariant,
      source: 'auto',
    }
  }

  const expectedVariantKey = candidateVariantKeys[0] ?? 'default'
  throw new AgendaMinuteGenerationError(
    'resolution_variant_selection',
    `Resolution path "${getMinutePlaybookVariantLabel(expectedVariantKey)}" is not configured for this playbook`,
  )
}

function assertManualResolutionOverride(params: {
  hasManualOverrideId: boolean
  overrideVariant: ReturnType<typeof getMinutePlaybookVariantById> | null
}) {
  if (!params.hasManualOverrideId) {
    return
  }

  if (!params.overrideVariant) {
    throw new AgendaMinuteGenerationError(
      'resolution_variant_selection',
      'Manual RESOLVED override is no longer configured for this playbook',
    )
  }
}

function getSiblingResolutionVariantKey(
  variantKey: 'default' | 'with_action' | 'without_action' | null,
) {
  if (variantKey === 'with_action') return 'without_action'
  if (variantKey === 'without_action') return 'with_action'
  return null
}

const LIST_LABEL_PATTERN = /^\s*(?:[-*•]|\d+[.)]|[A-Za-z][.)])\s+/
const SLOT_MARKER_PATTERN = /<\s*(?:slot|list)_[^>]+>/i
const STANDALONE_BRACKET_NOTE_PATTERN = /^\s*\[(.+?)\]\s*$/
const STANDALONE_ROLE_FRAGMENT_PATTERNS = [
  /^the committee$/i,
  /^the chairman$/i,
  /^chairman$/i,
  /^the chair$/i,
  /^chair$/i,
  /^committee members?$/i,
  /^committee member \d+$/i,
]
const HEAD_ROLE_FRAGMENT_PATTERN = /^head,\s*(.+)$/i
const ROLE_SENTENCE_SIGNAL_PATTERN = /\b(?:also|and|but|noted|updated|informed|stated|explained|shared|highlighted|reported|clarified|advised|requested|presented|confirmed|recommended|commented|mentioned|observed|agreed|resolved|approved|endorsed|accepted|deferred|concurred|was|were|is|are|inquired|asked|queried|sought|directed)\b/i
const AGENDA_OBJECTIVE_OPENING_PATTERN = /^to\s+(?:deliberate|discuss|note|consider|review|table|present|update|seek|obtain|confirm|highlight|outline|explain|address)\b/i
const ROLE_FRAGMENT_CONTINUATION_PATTERN = /^(?:noted|updated|informed|stated|explained|shared|highlighted|reported|clarified|advised|requested|presented|confirmed|recommended|commented|mentioned|observed|agreed|resolved|approved|endorsed|accepted|deferred|concurred|was|were|is|are)\b/i
const ROLE_FRAGMENT_OBJECTIVE_CONTINUATION_PATTERN = /^to\s+continue\s+deliberation\b/i
const ACTION_OWNER_FIELD_PATTERN = /^(?:action by|pic|owner|person in charge)\s*:/i
const RESOLUTION_HEADING_PATTERN = /^(?:resolved|decided|decision)\b/i

function isStandaloneBracketNote(value: string) {
  return STANDALONE_BRACKET_NOTE_PATTERN.test(value.trim())
}

function normalizeTemplateComparisonValue(value: string) {
  return compactTemplateValue(stripConfidenceMarkers(value)).toLowerCase()
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isStandaloneRoleFragment(value: string) {
  const normalized = compactTemplateValue(stripConfidenceMarkers(value))
  if (!normalized) return false
  if (STANDALONE_ROLE_FRAGMENT_PATTERNS.some(pattern => pattern.test(normalized))) {
    return true
  }

  const headRoleMatch = normalized.match(HEAD_ROLE_FRAGMENT_PATTERN)
  if (!headRoleMatch) return false

  const roleText = headRoleMatch[1]?.trim() ?? ''
  if (!roleText) return false
  if (/[.!?:;]/.test(roleText)) return false
  if (ROLE_SENTENCE_SIGNAL_PATTERN.test(roleText)) return false
  return roleText.split(/\s+/).filter(Boolean).length <= 6
}

function blankRecoverableTemplateEntries(
  extracted: StrictTemplateExtraction,
  issues: string[],
): StrictTemplateExtraction {
  const slotIdsToBlank = new Set<string>()
  const listIdsToBlank = new Set<string>()

  for (const issue of issues) {
    const slotMatch = issue.match(/^Slot (\S+)/)
    if (slotMatch?.[1]) {
      slotIdsToBlank.add(slotMatch[1])
      continue
    }

    const listMatch = issue.match(/^List (\S+)/)
    if (listMatch?.[1]) {
      listIdsToBlank.add(listMatch[1])
    }
  }

  if (slotIdsToBlank.size === 0 && listIdsToBlank.size === 0) {
    return extracted
  }

  return {
    slots: extracted.slots.map(entry => (
      slotIdsToBlank.has(entry.id)
        ? { id: entry.id, value: '' }
        : entry
    )),
    lists: extracted.lists.map(entry => (
      listIdsToBlank.has(entry.id)
        ? { id: entry.id, items: [] }
        : entry
    )),
  }
}

function buildAgendaTitleTokens(agendaTitle: string) {
  return agendaTitle
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map(token => token.trim())
    .filter(token => token.length >= 4)
}

function includesAgendaReference(value: string, agendaNo: string, agendaTitle: string) {
  const cleanedValue = stripConfidenceMarkers(value)
  const normalized = normalizeTemplateComparisonValue(cleanedValue)
  const agendaNoPattern = new RegExp(`\\bagenda\\s+${escapeRegExp(agendaNo)}\\b`, 'i')
  if (agendaNoPattern.test(cleanedValue)) return true

  const titleTokens = buildAgendaTitleTokens(agendaTitle)
  if (titleTokens.length === 0) return false

  const matchedTokenCount = titleTokens.filter(token => normalized.includes(token)).length
  return matchedTokenCount >= Math.min(2, titleTokens.length)
}

function sampleAllowsAgendaObjective(sampleValue: string | undefined) {
  return AGENDA_OBJECTIVE_OPENING_PATTERN.test(compactTemplateValue(stripConfidenceMarkers(sampleValue ?? '')))
}

function findUnexpectedAgendaObjectiveSignal(params: {
  value: string
  agendaNo: string
  agendaTitle: string
  sampleValue?: string
}) {
  const normalized = compactTemplateValue(stripConfidenceMarkers(params.value))
  if (!normalized) return null
  if (!AGENDA_OBJECTIVE_OPENING_PATTERN.test(normalized)) return null
  if (!includesAgendaReference(normalized, params.agendaNo, params.agendaTitle)) return null
  if (sampleAllowsAgendaObjective(params.sampleValue)) return null
  return normalized
}

function hasNearbyResolutionContext(lines: string[], index: number) {
  let previousNonEmpty = 0
  for (let cursor = index - 1; cursor >= 0 && previousNonEmpty < 3; cursor -= 1) {
    const trimmed = lines[cursor]?.trim() ?? ''
    if (!trimmed) continue
    previousNonEmpty += 1
    if (RESOLUTION_HEADING_PATTERN.test(trimmed) || ACTION_OWNER_FIELD_PATTERN.test(trimmed)) {
      return true
    }
  }

  let nextNonEmpty = 0
  for (let cursor = index + 1; cursor < lines.length && nextNonEmpty < 4; cursor += 1) {
    const trimmed = lines[cursor]?.trim() ?? ''
    if (!trimmed) continue
    nextNonEmpty += 1
    if (RESOLUTION_HEADING_PATTERN.test(trimmed) || ACTION_OWNER_FIELD_PATTERN.test(trimmed)) {
      return true
    }
  }

  return false
}

function isDuplicatedResolutionSpilloverLine(lines: string[], index: number) {
  const current = compactTemplateValue(stripConfidenceMarkers(lines[index] ?? ''))
  if (!current || current.length < 24) return false

  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const candidate = compactTemplateValue(stripConfidenceMarkers(lines[cursor] ?? ''))
    if (!candidate || candidate !== current) continue
    if (hasNearbyResolutionContext(lines, cursor)) {
      return true
    }
  }

  return false
}

function repairRenderedMinuteTopLines(params: {
  content: string
  agendaNo: string
  agendaTitle: string
}) {
  const lines = params.content.replace(/\r\n?/g, '\n').split('\n')
  let nonEmptyLineCount = 0

  for (let index = 0; index < lines.length && nonEmptyLineCount < 6; index += 1) {
    const trimmed = lines[index]?.trim() ?? ''
    if (!trimmed) continue

    nonEmptyLineCount += 1
    if (isDuplicatedResolutionSpilloverLine(lines, index)) {
      lines[index] = ''
      continue
    }

    const unexpectedAgendaObjective = findUnexpectedAgendaObjectiveSignal({
      value: trimmed,
      agendaNo: params.agendaNo,
      agendaTitle: params.agendaTitle,
    })
    if (unexpectedAgendaObjective) {
      lines[index] = ''
      continue
    }

    if (!isStandaloneRoleFragment(trimmed)) continue

    let nextIndex = index + 1
    while (nextIndex < lines.length && !(lines[nextIndex]?.trim())) {
      nextIndex += 1
    }

    if (nextIndex >= lines.length) {
      lines[index] = ''
      continue
    }

    const nextLine = lines[nextIndex] ?? ''
    const nextTrimmed = nextLine.trim()
    const cleanedNextLine = stripConfidenceMarkers(nextTrimmed)
    const unexpectedNextAgendaObjective = findUnexpectedAgendaObjectiveSignal({
      value: cleanedNextLine,
      agendaNo: params.agendaNo,
      agendaTitle: params.agendaTitle,
    })

    if (unexpectedNextAgendaObjective || ROLE_FRAGMENT_OBJECTIVE_CONTINUATION_PATTERN.test(cleanedNextLine)) {
      lines[index] = ''
      lines[nextIndex] = ''
      continue
    }

    if (ROLE_FRAGMENT_CONTINUATION_PATTERN.test(cleanedNextLine)) {
      const indent = nextLine.match(/^\s*/)?.[0] ?? ''
      lines[nextIndex] = `${indent}${compactTemplateValue(`${trimmed} ${nextTrimmed}`)}`
      lines[index] = ''
      continue
    }

    lines[index] = ''
  }

  return lines.join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function summarizeTemplateValidationIssues(issues: string[]) {
  if (issues.length <= 4) return issues.join(' | ')
  return `${issues.slice(0, 4).join(' | ')} | +${issues.length - 4} more`
}

const MOM_DRAFT_STAGE_ORDER: Record<MomDraftCompletedStage, number> = {
  prompt1: 1,
  prompt2: 2,
  summary: 3,
  final: 4,
}

function hasCompletedMomDraftStage(
  currentStage: MomDraftCompletedStage | null | undefined,
  requiredStage: MomDraftCompletedStage,
) {
  if (!currentStage) return false
  return MOM_DRAFT_STAGE_ORDER[currentStage] >= MOM_DRAFT_STAGE_ORDER[requiredStage]
}

function buildStrictTemplateLiteralEchoSet(template: MinuteTemplateSchema) {
  return new Set(
    template.nodes
      .filter((node): node is Extract<MinuteTemplateSchema['nodes'][number], { type: 'literal' }> => node.type === 'literal')
      .map(node => normalizeTemplateComparisonValue(node.text))
      .filter(Boolean),
  )
}

function validateStrictTemplateExtraction(
  template: MinuteTemplateSchema,
  extracted: StrictTemplateExtraction,
  options: {
    agendaNo: string
    agendaTitle: string
  },
) {
  const issues: string[] = []
  const literalEchoes = buildStrictTemplateLiteralEchoSet(template)
  const slotById = new Map(
    template.nodes
      .filter((node): node is Extract<MinuteTemplateSchema['nodes'][number], { type: 'slot' }> => node.type === 'slot')
      .map(node => [node.slotId, node]),
  )
  const listById = new Map(
    template.nodes
      .filter((node): node is Extract<MinuteTemplateSchema['nodes'][number], { type: 'list' }> => node.type === 'list')
      .map(node => [node.slotId, node]),
  )

  for (const entry of extracted.slots) {
    const slot = slotById.get(entry.id)
    if (!slot) continue

    const value = compactTemplateValue(entry.value)
    if (!value) continue

    const normalizedValue = normalizeTemplateComparisonValue(value)
    const normalizedPrefix = normalizeTemplateComparisonValue(slot.prefix)

    if (normalizedPrefix && normalizedValue.startsWith(normalizedPrefix)) {
      issues.push(`Slot ${entry.id} repeats fixed prefix "${slot.prefix.trim()}"`)
    }
    if (value.includes('[RESOLUTION_PATH]')) {
      issues.push(`Slot ${entry.id} contains [RESOLUTION_PATH]`)
    }
    if (isStandaloneBracketNote(value)) {
      issues.push(`Slot ${entry.id} returned a bracket guidance note instead of content`)
    }
    if (SLOT_MARKER_PATTERN.test(value)) {
      issues.push(`Slot ${entry.id} echoes template markers instead of content`)
    }
    if (literalEchoes.has(normalizedValue)) {
      issues.push(`Slot ${entry.id} echoes a template heading/literal instead of filling the slot`)
    }
    if (slot.slotKind === 'paragraph' && isStandaloneRoleFragment(value)) {
      issues.push(`Slot ${entry.id} returned a standalone role fragment instead of a full sentence`)
    }
    if (slot.slotKind === 'paragraph' && isLikelyTemplateSampleEcho(value, slot.sampleValue)) {
      issues.push(`Slot ${entry.id} copies template sample wording instead of fresh agenda content`)
    }
    const unexpectedAgendaObjective = findUnexpectedAgendaObjectiveSignal({
      value,
      agendaNo: options.agendaNo,
      agendaTitle: options.agendaTitle,
      sampleValue: slot.sampleValue,
    })
    if (unexpectedAgendaObjective) {
      issues.push(`Slot ${entry.id} introduced an agenda objective opener instead of minute content: "${unexpectedAgendaObjective}"`)
    }
  }

  for (const entry of extracted.lists) {
    const list = listById.get(entry.id)
    if (!list) continue

    for (const item of entry.items) {
      const value = compactTemplateValue(item)
      if (!value) continue

      const normalizedValue = normalizeTemplateComparisonValue(value)
      if (LIST_LABEL_PATTERN.test(value)) {
        issues.push(`List ${entry.id} item includes its own bullet or numbering label`)
      }
      if (value.includes('[RESOLUTION_PATH]')) {
        issues.push(`List ${entry.id} item contains [RESOLUTION_PATH]`)
      }
      if (isStandaloneBracketNote(value)) {
        issues.push(`List ${entry.id} item returned a bracket guidance note instead of content`)
      }
      if (SLOT_MARKER_PATTERN.test(value)) {
        issues.push(`List ${entry.id} item echoes template markers instead of content`)
      }
      if (literalEchoes.has(normalizedValue)) {
        issues.push(`List ${entry.id} item echoes a template heading/literal instead of filling the list`)
      }
      if (list.listStyle === 'bullet' && /^bullet\s*[:\-]/i.test(value)) {
        issues.push(`List ${entry.id} item repeats a bullet label instead of plain item text`)
      }
      if (isStandaloneRoleFragment(value)) {
        issues.push(`List ${entry.id} item returned a standalone role fragment instead of a full sentence`)
      }
      const unexpectedAgendaObjective = findUnexpectedAgendaObjectiveSignal({
        value,
        agendaNo: options.agendaNo,
        agendaTitle: options.agendaTitle,
        sampleValue: list.sampleItems[0],
      })
      if (unexpectedAgendaObjective) {
        issues.push(`List ${entry.id} item introduced an agenda objective opener instead of minute content: "${unexpectedAgendaObjective}"`)
      }
    }
  }

  return issues
}

function repairStrictTemplateRoleFragments(
  template: MinuteTemplateSchema,
  extracted: StrictTemplateExtraction,
  options: {
    agendaNo: string
    agendaTitle: string
  },
): StrictTemplateExtraction {
  const slotMap = new Map(
    extracted.slots.map(entry => [entry.id, typeof entry.value === 'string' ? entry.value : '']),
  )
  const listMap = new Map(
    extracted.lists.map(entry => [entry.id, Array.isArray(entry.items) ? [...entry.items] : []]),
  )

  type OrderedExtractionValue =
    | { kind: 'slot'; slotId: string }
    | { kind: 'list_item'; slotId: string; itemIndex: number }

  const orderedValues: OrderedExtractionValue[] = []
  for (const node of template.nodes) {
    if (node.type === 'slot') {
      orderedValues.push({
        kind: 'slot',
        slotId: node.slotId,
      })
      continue
    }

    if (node.type === 'list') {
      const items = listMap.get(node.slotId) ?? []
      for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
        orderedValues.push({
          kind: 'list_item',
          slotId: node.slotId,
          itemIndex,
        })
      }
    }
  }

  const readValue = (entry: OrderedExtractionValue) => {
    if (entry.kind === 'slot') {
      return slotMap.get(entry.slotId) ?? ''
    }
    return listMap.get(entry.slotId)?.[entry.itemIndex] ?? ''
  }

  const writeValue = (entry: OrderedExtractionValue, value: string) => {
    if (entry.kind === 'slot') {
      slotMap.set(entry.slotId, value)
      return
    }

    const items = listMap.get(entry.slotId) ?? []
    items[entry.itemIndex] = value
    listMap.set(entry.slotId, items)
  }

  const findNextContentIndex = (startIndex: number) => {
    for (let cursor = startIndex + 1; cursor < orderedValues.length; cursor += 1) {
      const value = compactTemplateValue(readValue(orderedValues[cursor]))
      if (value) return cursor
    }
    return -1
  }

  for (let index = 0; index < orderedValues.length; index += 1) {
    const current = orderedValues[index]
    const currentValue = compactTemplateValue(readValue(current))
    if (!currentValue || !isStandaloneRoleFragment(currentValue)) continue

    const nextIndex = findNextContentIndex(index)
    if (nextIndex < 0) {
      writeValue(current, '')
      continue
    }

    const next = orderedValues[nextIndex]
    const nextValue = compactTemplateValue(readValue(next))
    const cleanedNextValue = stripConfidenceMarkers(nextValue)
    const unexpectedAgendaObjective = findUnexpectedAgendaObjectiveSignal({
      value: cleanedNextValue,
      agendaNo: options.agendaNo,
      agendaTitle: options.agendaTitle,
    })

    if (unexpectedAgendaObjective || ROLE_FRAGMENT_OBJECTIVE_CONTINUATION_PATTERN.test(cleanedNextValue)) {
      writeValue(current, '')
      continue
    }

    if (ROLE_FRAGMENT_CONTINUATION_PATTERN.test(cleanedNextValue)) {
      writeValue(next, compactTemplateValue(`${currentValue} ${nextValue}`))
      writeValue(current, '')
      continue
    }

    writeValue(current, '')
  }

  return {
    slots: extracted.slots.map(entry => ({
      id: entry.id,
      value: slotMap.get(entry.id) ?? '',
    })),
    lists: extracted.lists.map(entry => ({
      id: entry.id,
      items: (listMap.get(entry.id) ?? [])
        .map(item => typeof item === 'string' ? item : '')
        .filter(item => compactTemplateValue(item).length > 0),
    })),
  }
}

async function runStrictTemplateExtractionWithValidation(params: {
  model: Awaited<ReturnType<typeof resolveLanguageModelForOrganization>>
  persona: string
  prompt: string
  template: MinuteTemplateSchema
  agendaNo: string
  agendaTitle: string
}) {
  const runExtraction = async (prompt: string) => {
    const result = await generateObject({
      model: params.model,
      system: params.persona,
      schema: strictTemplateExtractionSchema,
      prompt,
    })

    return normalizeStrictTemplateExtraction(result.object)
  }

  const initialExtraction = repairStrictTemplateRoleFragments(
    params.template,
    await runExtraction(params.prompt),
    {
      agendaNo: params.agendaNo,
      agendaTitle: params.agendaTitle,
    },
  )
  const initialIssues = validateStrictTemplateExtraction(params.template, initialExtraction, {
    agendaNo: params.agendaNo,
    agendaTitle: params.agendaTitle,
  })
  if (initialIssues.length === 0) {
    return initialExtraction
  }

  const repairPrompt = `${params.prompt}

PREVIOUS ATTEMPT FAILED THE EXACT-FORMAT FIDELITY CHECK.

VALIDATION ERRORS:
${initialIssues.map(issue => `- ${issue}`).join('\n')}

PREVIOUS INVALID JSON:
${JSON.stringify(initialExtraction, null, 2)}

Return corrected JSON only. Keep the exact same schema and correct every validation error above.`

  const repairedExtraction = repairStrictTemplateRoleFragments(
    params.template,
    await runExtraction(repairPrompt),
    {
      agendaNo: params.agendaNo,
      agendaTitle: params.agendaTitle,
    },
  )
  const repairedIssues = validateStrictTemplateExtraction(params.template, repairedExtraction, {
    agendaNo: params.agendaNo,
    agendaTitle: params.agendaTitle,
  })
  if (repairedIssues.length === 0) {
    return repairedExtraction
  }

  const sanitizedExtraction = blankRecoverableTemplateEntries(repairedExtraction, repairedIssues)
  const sanitizedIssues = validateStrictTemplateExtraction(params.template, sanitizedExtraction, {
    agendaNo: params.agendaNo,
    agendaTitle: params.agendaTitle,
  })
  if (sanitizedIssues.length === 0) {
    console.warn(
      `[generate-minutes] recovered strict-template extraction for Agenda ${params.agendaNo} by omitting invalid entries. ${summarizeTemplateValidationIssues(repairedIssues)}`,
    )
    return sanitizedExtraction
  }

  throw new AgendaMinuteGenerationError(
    'prompt3_fidelity',
    `Format fidelity check failed: ${summarizeTemplateValidationIssues(sanitizedIssues)}`,
  )
}

function collectRenderedMinuteTopLineIssues(params: {
  content: string
  agendaNo: string
  agendaTitle: string
}) {
  const issues: string[] = []
  const lines = params.content
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, 6)

  for (const line of lines) {
    if (isStandaloneRoleFragment(line)) {
      issues.push(`Rendered minute contains a stray standalone role fragment near the top: "${line}"`)
    }

    const unexpectedAgendaObjective = findUnexpectedAgendaObjectiveSignal({
      value: line,
      agendaNo: params.agendaNo,
      agendaTitle: params.agendaTitle,
    })
    if (unexpectedAgendaObjective) {
      issues.push(`Rendered minute contains an unexpected agenda objective opener near the top: "${unexpectedAgendaObjective}"`)
    }
  }

  return issues
}

async function resolveRelevantMinuteMindContext(params: {
  supabase: DatabaseClient
  organizationId: string
  committeeId?: string | null
  meetingId: string
  agendaId: string
  agendaNo: string
  agendaTitle: string
  additionalInfo?: string | null
}) {
  const entries = await listMinuteMindEntriesForScope({
    supabase: params.supabase,
    organizationId: params.organizationId,
    committeeId: params.committeeId ?? null,
    meetingId: params.meetingId,
    agendaId: params.agendaId,
  })

  return {
    sourceEntries: entries,
    ...resolveApplicableMinuteMemory({
      entries,
      agendaNo: params.agendaNo,
      agendaTitle: params.agendaTitle,
      additionalInfo: params.additionalInfo,
    }),
  }
}

async function selectPlaybookVariant(params: {
  model: Awaited<ReturnType<typeof resolveLanguageModelForOrganization>>
  persona: string
  playbook: MinutePlaybookRecord
  playbookMode: 'resolution_paths' | 'legacy_full'
  cleanedTranscript: string
  crossRefAnalysis: string
  agendaNo: string
  agendaTitle: string
  presenter: string | null
  additionalInfo?: string
  mindInstructionBlock?: string
  meetingRulesPrompt?: string
  ignoredAgendaNos?: string[]
}) {
  const defaultVariant = getMinutePlaybookDefaultVariant(params.playbook)
  if (!defaultVariant) return null

  if (params.playbook.variants.length <= 1) {
    return defaultVariant
  }

  const prompt = buildPrompt3_PlaybookVariantSelection({
    agendaNo: params.agendaNo,
    agendaTitle: params.agendaTitle,
    presenter: params.presenter,
    cleanedTranscript: params.cleanedTranscript,
    crossRefAnalysis: params.crossRefAnalysis,
    playbookMode: params.playbookMode,
    availableVariantKeys: params.playbook.variants.map(variant => variant.variantKey),
    additionalInfo: params.additionalInfo,
    meetingRulesPrompt: params.meetingRulesPrompt,
    ignoredAgendaNos: params.ignoredAgendaNos,
    mindInstructionBlock: params.mindInstructionBlock,
  })

  const selection = await generateObject({
    model: params.model,
    system: params.persona,
    schema: playbookVariantSelectionSchema,
    prompt,
  })

  const normalizedSelection = normalizePlaybookVariantSelection(selection.object)

  return (
    getMinutePlaybookVariant(params.playbook, normalizedSelection.variantKey)
    ?? defaultVariant
  )
}

async function loadFormatTemplateRecords(
  supabase: DatabaseClient,
  templateIds: string[],
) {
  if (templateIds.length === 0) return new Map<string, {
    id: string
    promptText: string
    compiledTemplateJson: unknown
    compiledTemplateVersion: number | null
  }>()

  const { data: templates, error } = await supabase
    .from('format_templates')
    .select('id, prompt_text, compiled_template_json, compiled_template_version')
    .in('id', templateIds)

  if (error) {
    throw new Error(error.message)
  }

  return new Map(
    (templates ?? []).map(template => [template.id, {
      id: template.id,
      promptText: template.prompt_text,
      compiledTemplateJson: template.compiled_template_json,
      compiledTemplateVersion: template.compiled_template_version ?? null,
    }]),
  )
}

function resolveTemplateCompileModeForPlaybook(_playbook: MinutePlaybookRecord): MinuteTemplateCompileMode {
  void _playbook
  return GENERATION_TEMPLATE_COMPILE_MODE
}

function resolveCompiledMinuteTemplateRecord(params: {
  promptText: string
  compiledTemplateJson: unknown
  compileMode: MinuteTemplateCompileMode
  contextLabel: string
}) {
  const storedTemplate = getCompiledMinuteTemplate(params.compiledTemplateJson)
  if (params.compileMode === 'flexible' && storedTemplate) {
    return storedTemplate
  }

  try {
    return compileMinuteTemplateFromText(params.promptText, {
      mode: params.compileMode,
    })
  } catch (error) {
    if (storedTemplate) {
      console.warn(
        `[generate-minutes] failed to recompile ${params.contextLabel} in ${params.compileMode} mode; falling back to stored compiled template. ${getErrorMessage(error)}`,
      )
      return storedTemplate
    }

    return null
  }
}

function resolvePlaybookExactTemplate(params: {
  playbook: MinutePlaybookRecord
  selectedVariant: ReturnType<typeof getMinutePlaybookDefaultVariant>
}): ResolvedPlaybookExactTemplate | null {
  const playbookMode = getMinutePlaybookMode(params.playbook)
  const defaultVariant = getMinutePlaybookDefaultVariant(params.playbook)
  const compileMode = resolveTemplateCompileModeForPlaybook(params.playbook)
  const baseTemplate = defaultVariant
    ? resolveCompiledMinuteTemplateRecord({
        promptText: defaultVariant.promptText,
        compiledTemplateJson: defaultVariant.compiledTemplateJson,
        compileMode,
        contextLabel: `${params.playbook.scope} playbook default variant`,
      })
    : null

  if (!params.selectedVariant) return null
  if (playbookMode === 'legacy_full') {
    const template = resolveCompiledMinuteTemplateRecord({
      promptText: params.selectedVariant.promptText,
      compiledTemplateJson: params.selectedVariant.compiledTemplateJson,
      compileMode,
      contextLabel: `${params.playbook.scope} playbook variant ${params.selectedVariant.variantKey}`,
    })
    if (!template) return null
    const actionLikeEntries = params.selectedVariant.variantKey === 'without_action'
      ? getMinuteTemplateActionLikeEntries(template)
      : { slotIds: [], listIds: [], labels: [] }
    const ownerLikeEntries = params.selectedVariant.variantKey === 'with_action'
      ? getMinuteTemplateOwnerLikeEntries(template)
      : { slotIds: [], listIds: [], labels: [] }
    return {
      template,
      resolutionSlotIds: [],
      resolutionListIds: [],
      omittedSlotIds: actionLikeEntries.slotIds,
      omittedListIds: actionLikeEntries.listIds,
      requiredOwnerSlotIds: ownerLikeEntries.slotIds,
      requiredOwnerListIds: ownerLikeEntries.listIds,
      requiredOwnerLabels: ownerLikeEntries.labels,
    }
  }
  if (!baseTemplate) return null
  if (params.selectedVariant.variantKey === 'default') {
    return {
      ...mergeMinuteTemplateWithResolutionPathDetailed(baseTemplate, null),
      omittedSlotIds: [],
      omittedListIds: [],
      requiredOwnerSlotIds: [],
      requiredOwnerListIds: [],
      requiredOwnerLabels: [],
    }
  }

  const selectedResolutionTemplate = resolveCompiledMinuteTemplateRecord({
    promptText: params.selectedVariant.promptText,
    compiledTemplateJson: params.selectedVariant.compiledTemplateJson,
    compileMode,
    contextLabel: `${params.playbook.scope} playbook variant ${params.selectedVariant.variantKey}`,
  })
  if (!selectedResolutionTemplate) return null
  const mergedTemplate = mergeMinuteTemplateWithResolutionPathDetailed(baseTemplate, selectedResolutionTemplate)
  const actionLikeEntries = params.selectedVariant.variantKey === 'without_action'
    ? getMinuteTemplateActionLikeEntries(selectedResolutionTemplate)
    : { slotIds: [], listIds: [], labels: [] }
  const ownerLikeEntries = params.selectedVariant.variantKey === 'with_action'
    ? getMinuteTemplateOwnerLikeEntries(selectedResolutionTemplate)
    : { slotIds: [], listIds: [], labels: [] }
  return {
    ...mergedTemplate,
    omittedSlotIds: remapResolutionEntryIds(actionLikeEntries.slotIds, mergedTemplate.resolutionSlotIdMap),
    omittedListIds: remapResolutionEntryIds(actionLikeEntries.listIds, mergedTemplate.resolutionListIdMap),
    requiredOwnerSlotIds: remapResolutionEntryIds(ownerLikeEntries.slotIds, mergedTemplate.resolutionSlotIdMap),
    requiredOwnerListIds: remapResolutionEntryIds(ownerLikeEntries.listIds, mergedTemplate.resolutionListIdMap),
    requiredOwnerLabels: ownerLikeEntries.labels,
  }
}

export async function listAgendasMissingExactFormattingWithClient(params: {
  supabase: DatabaseClient
  agendas: Array<{
    id: string
    agenda_no: string
    title: string
    format_template_id: string | null
    minute_playbook_id?: string | null
  }>
}) {
  const templateIds = params.agendas
    .map(agenda => agenda.format_template_id)
    .filter((value): value is string => Boolean(value))
  const templateRecords = await loadFormatTemplateRecords(params.supabase, templateIds)
  const playbookIds = params.agendas
    .map(agenda => agenda.minute_playbook_id)
    .filter((value): value is string => Boolean(value))
  const playbooks = await loadMinutePlaybooksByIds(params.supabase, playbookIds)

  return params.agendas.filter(agenda => {
    if (agenda.minute_playbook_id) {
      const playbook = playbooks.get(agenda.minute_playbook_id)
      return !playbookHasCompleteExactFormatting(playbook)
    }

    if (!agenda.format_template_id) return true
    const template = templateRecords.get(agenda.format_template_id)
    return !template || !isCompiledMinuteTemplate(template.compiledTemplateJson)
  })
}

async function getCommitteeGenerationContext(
  supabase: DatabaseClient,
  committeeId: string | null | undefined,
): Promise<CommitteeGenerationContext> {
  if (!committeeId) {
    return {
      defaultFormatTemplateId: null,
      minuteInstruction: '',
    }
  }

  const { data: settings } = await supabase
    .from('committee_generation_settings')
    .select('default_format_template_id, minute_instruction')
    .eq('committee_id', committeeId)
    .maybeSingle()

  return {
    defaultFormatTemplateId: settings?.default_format_template_id ?? null,
    minuteInstruction: settings?.minute_instruction ?? '',
  }
}

async function getAgendaPdfExcerpts(
  supabase: DatabaseClient,
  storagePath: string | null,
  queryText: string,
  context: { meetingId: string; agendaId: string; sourceLabel?: string },
): Promise<ReferenceExcerpt[]> {
  if (!storagePath) return []

  let parser: {
    getText: () => Promise<{ pages: Array<{ num: number; text: string }> }>
    destroy?: () => Promise<void> | void
  } | null = null
  try {
    const { data, error } = await supabase.storage.from('meeting-files').download(storagePath)
    if (error || !data) {
      console.warn('[generateMinutesForAgendaWithClient] agenda PDF download failed', {
        stage: 'pdf_excerpt_extraction',
        meetingId: context.meetingId,
        agendaId: context.agendaId,
        storagePath,
        message: error?.message ?? 'File download returned no data',
      })
      return []
    }

    const { PDFParse } = await import('pdf-parse')
    parser = new PDFParse({ data: Buffer.from(await data.arrayBuffer()) })

    const extracted = await parser.getText()
    const pageCandidates = extracted.pages
      .map(page => ({
        source: `${context.sourceLabel ?? 'Agenda PDF'} page ${page.num}`,
        text: normalizeWhitespace(page.text),
      }))
      .filter(page => page.text.length > 0)
    return selectTopRelevantExcerpts(queryText, pageCandidates, 4)
  } catch (error) {
    console.warn('[generateMinutesForAgendaWithClient] agenda PDF extraction failed', {
      stage: 'pdf_excerpt_extraction',
      meetingId: context.meetingId,
      agendaId: context.agendaId,
      storagePath,
      message: getErrorMessage(error),
    })
    return []
  } finally {
    try {
      await parser?.destroy?.()
    } catch {
      // Ignore parser cleanup errors.
    }
  }
}

async function getCommitteeRagExcerpts(
  supabase: DatabaseClient,
  committeeId: string | null | undefined,
  queryText: string,
): Promise<ReferenceExcerpt[]> {
  if (!committeeId) return []

  const { data: chunks, error } = await supabase
    .from('committee_rag_chunks')
    .select(`
      content,
      chunk_index,
      committee_rag_documents!inner(
        document_name,
        file_name
      )
    `)
    .eq('committee_id', committeeId)
    .limit(400)

  if (error || !chunks || chunks.length === 0) return []

  const candidates = chunks.map(chunk => {
    const doc = Array.isArray(chunk.committee_rag_documents)
      ? chunk.committee_rag_documents[0]
      : chunk.committee_rag_documents
    const sourceName = doc?.document_name || doc?.file_name || 'Committee RAG'
    const chunkNo = typeof chunk.chunk_index === 'number' ? chunk.chunk_index + 1 : 1
    return {
      source: `Committee RAG - ${sourceName} (chunk ${chunkNo})`,
      text: normalizeWhitespace(chunk.content ?? ''),
    }
  }).filter(candidate => candidate.text.length > 0)

  return selectTopRelevantExcerpts(queryText, candidates, 6)
}

async function resolveTranscriptIdForMeeting(
  supabase: DatabaseClient,
  meetingId: string,
  preferredTranscriptId?: string | null,
) {
  if (preferredTranscriptId) return preferredTranscriptId

  const { data: transcript } = await supabase
    .from('transcripts')
    .select('id')
    .eq('meeting_id', meetingId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return transcript?.id ?? null
}

async function extractAndSaveActionItems(
  supabase: DatabaseClient,
  agendaId: string,
  meetingId: string,
  minuteContent: string,
  model: Awaited<ReturnType<typeof resolveLanguageModelForOrganization>>,
  persona: string,
) {
  const result = await generateText({
    model,
    system: persona,
    prompt: `Extract all action items from the following meeting minutes. Return them as a JSON array.
Each item should have: "description" (string), "pic" (string or null for Person In Charge), "due_date" (string or null in YYYY-MM-DD format).
If no action items exist, return an empty array [].

MINUTES:
---
${minuteContent}
---

Return ONLY the JSON array, no other text.`,
  })

  try {
    const jsonMatch = result.text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return

    const items = JSON.parse(jsonMatch[0]) as Array<{
      description: string
      pic: string | null
      due_date: string | null
    }>

    await supabase.from('action_items').delete().eq('agenda_id', agendaId)

    if (items.length > 0) {
      await supabase.from('action_items').insert(
        items.map((item, index) => ({
          agenda_id: agendaId,
          meeting_id: meetingId,
          description: item.description,
          pic: item.pic,
          due_date: item.due_date,
          sort_order: index,
        })),
      )
    }

    return items.length
  } catch {
    // Skip action items when extraction fails.
    return 0
  }
}

function extractResolvedSection(content: string) {
  const normalized = content.replace(/\r\n?/g, '\n')
  const match = normalized.match(/(?:^|\n)RESOLVED\s*\n([\s\S]*?)(?=\n[A-Z][A-Z &/()'-]{2,}\n|$)/i)
  return match?.[1]?.trim() ?? ''
}

function buildFallbackActionItemsFromMinuteContent(content: string) {
  const resolvedSection = extractResolvedSection(content)
  if (!resolvedSection) return []

  const normalized = resolvedSection
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (!normalized) return []

  const paragraphs = normalized
    .split(/\n\s*\n/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean)
  const explicitOwnerMatches = Array.from(normalized.matchAll(/(?:^|\n)\s*(?:Action By|PIC|Owner)\s*:\s*(.+)$/gim))
  const explicitOwner = explicitOwnerMatches
    .map(match => match[1]?.trim() ?? '')
    .find(Boolean) ?? null

  const descriptionCandidates = paragraphs
    .map(paragraph => paragraph
      .replace(/^(?:Action By|PIC|Owner)\s*:\s*.+$/gim, '')
      .trim())
    .filter(Boolean)

  const followUpCandidates = descriptionCandidates.filter(candidate => (
    /^(?:\([a-z0-9]+\)|[-*•])\s*/i.test(candidate)
    || /\b(?:shall|must|will|is to|are to|requested to|directed to|tasked to|review|prepare|submit|update|schedule|conduct|table|circulate)\b/i.test(candidate)
  ))

  const candidates = followUpCandidates.length > 0
    ? followUpCandidates
    : descriptionCandidates.slice(1).length > 0
      ? descriptionCandidates.slice(1)
      : descriptionCandidates.slice(0, 1)

  return candidates.slice(0, 4).map((description, index) => ({
    description: description
      .replace(/^\([a-z0-9]+\)\s*/i, '')
      .replace(/^[-*•]\s*/, '')
      .trim(),
    pic: explicitOwner,
    due_date: null as string | null,
    sort_order: index,
  })).filter(item => item.description.length > 0)
}

async function syncActionItemsForResolvedOutcome(params: {
  supabase: DatabaseClient
  agendaId: string
  meetingId: string
  minuteContent: string
  resolvedOutcomeMode: ResolvedOutcomeMode | null
  model: Awaited<ReturnType<typeof resolveLanguageModelForOrganization>>
  persona: string
}) {
  await params.supabase.from('action_items').delete().eq('agenda_id', params.agendaId)

  if (params.resolvedOutcomeMode !== 'follow_up') {
    return
  }

  const extractedCount = await extractAndSaveActionItems(
    params.supabase,
    params.agendaId,
    params.meetingId,
    params.minuteContent,
    params.model,
    params.persona,
  )

  if ((extractedCount ?? 0) > 0) return

  const fallbackItems = buildFallbackActionItemsFromMinuteContent(params.minuteContent)
  if (fallbackItems.length === 0) return

  await params.supabase.from('action_items').insert(
    fallbackItems.map(item => ({
      agenda_id: params.agendaId,
      meeting_id: params.meetingId,
      description: item.description,
      pic: item.pic,
      due_date: item.due_date,
      sort_order: item.sort_order,
    })),
  )
}

export async function buildMinuteDraftForAgendaWithClient(params: {
  supabase: DatabaseClient
  agendaId: string
  userId: string
  organizationId?: string | null
  config?: GenerationConfig
  runtimeContext?: GenerationRuntimeContext
}): Promise<GenerateMinuteDraftPayload> {
  const agendaId = uuidSchema.parse(params.agendaId)

  const { data: agenda } = await params.supabase
    .from('agendas')
    .select('*, meetings(*, committees(*))')
    .eq('id', agendaId)
    .single()

  if (!agenda) throw new Error('Agenda not found')

  const meeting = agenda.meetings as unknown as {
    id: string
    organization_id: string
    meeting_rules: string | null
    committees: { id: string; slug: string; persona_prompt: string | null } | null
  }

  if (params.organizationId && meeting.organization_id !== params.organizationId) {
    throw new Error('Agenda not found or inaccessible')
  }

  const committeeSlug = meeting.committees?.slug ?? 'board'
  const persona = meeting.committees?.persona_prompt || getDefaultPersona(committeeSlug)

  const activeTranscriptId = params.runtimeContext?.transcriptId
    ?? await resolveTranscriptIdForMeeting(params.supabase, meeting.id, params.config?.transcriptId ?? null)
  const skipDiscussedSection = params.runtimeContext?.skipDiscussedSection === true

  let segmentsQuery = params.supabase
    .from('transcript_segments')
    .select('content, speaker, start_offset')
    .eq('agenda_id', agendaId)
    .order('sort_order')

  if (activeTranscriptId) {
    segmentsQuery = segmentsQuery.eq('transcript_id', activeTranscriptId)
  }

  const { data: segments, error: segmentsError } = await segmentsQuery
  if (segmentsError) {
    throw new AgendaMinuteGenerationError(
      'transcript_segment_lookup',
      `Failed to load transcript segments: ${segmentsError.message}`,
    )
  }
  const nonPlaceholderSegments = (segments ?? []).filter(segment => segment.content !== NO_TRANSCRIPTION_SEGMENT_MARKER)
  const hasNoTranscriptionMarker = (segments ?? []).some(segment => segment.content === NO_TRANSCRIPTION_SEGMENT_MARKER)
  const shouldForceTranscriptlessClosureOnly = skipDiscussedSection || hasNoTranscriptionMarker
  const effectiveSkipDiscussedSection = shouldForceTranscriptlessClosureOnly
  const isTranscriptlessClosureOnly = shouldForceTranscriptlessClosureOnly && nonPlaceholderSegments.length === 0
  if (!isTranscriptlessClosureOnly && nonPlaceholderSegments.length === 0) {
    throw new AgendaMinuteGenerationError(
      'transcript_segment_lookup',
      'No transcript segments assigned to this agenda',
    )
  }

  const { data: glossary } = await params.supabase
    .from('glossary')
    .select('acronym, full_meaning')
    .eq('committee_id', meeting.committees?.id ?? '')

  const { data: meetingAgendas } = await params.supabase
    .from('agendas')
    .select('id, agenda_no, title, slide_pages, sort_order')
    .eq('meeting_id', meeting.id)
    .order('sort_order')

  const committeeContext = params.runtimeContext?.committeeContext
    ?? await getCommitteeGenerationContext(params.supabase, meeting.committees?.id)
  const meetingRulesPrompt = params.runtimeContext?.meetingRulesPrompt
    ?? resolveMeetingRulesPrompt(params.config, meeting.meeting_rules)
  const mindContext = await resolveRelevantMinuteMindContext({
    supabase: params.supabase,
    organizationId: meeting.organization_id,
    committeeId: meeting.committees?.id ?? null,
    meetingId: meeting.id,
    agendaId,
    agendaNo: agenda.agenda_no,
    agendaTitle: agenda.title,
    additionalInfo: agenda.additional_info ?? null,
  })
  const appliedMemoryTrace = buildAppliedMemoryTraceMap(mindContext.appliedTrace ?? [])
  const mindInstructionBlock = mindContext.allInstructionBlock
  const hardRulesBlock = mindContext.hardRulesBlock
  const committeeFactsBlock = mindContext.committeeFactsBlock
  const formatterRules = mindContext.formatterRules ?? []
  const agendaFormatterRuleBlock = buildMinuteFormatterRuleBlock(selectAgendaFormatterRules({
    agendaNo: agenda.agenda_no,
    formatterRules,
  }))
  const generationMindInstructionBlock = [
    hardRulesBlock,
    committeeFactsBlock,
  ]
    .filter(Boolean)
    .join('\n\n') || undefined

  const playbooks = agenda.minute_playbook_id
    ? await loadMinutePlaybooksByIds(params.supabase, [agenda.minute_playbook_id])
    : new Map()
  const agendaPlaybook = agenda.minute_playbook_id
    ? playbooks.get(agenda.minute_playbook_id) ?? null
    : null
  const overridePlaybookVariant = getMinutePlaybookVariantById(
    agendaPlaybook,
    agenda.minute_playbook_variant_override_id ?? null,
  )
  const defaultPlaybookVariant = getMinutePlaybookDefaultVariant(agendaPlaybook)
  const {
    playbookMode: agendaPlaybookMode,
    resolutionPathsEnabled: agendaResolutionPathsEnabled,
  } = resolvePlaybookRuntimeState(agendaPlaybook)

  const candidateTemplateIds = agendaPlaybook
    ? []
    : (
      params.config?.requireCompleteFormatting
        ? [agenda.format_template_id]
        : [agenda.format_template_id, committeeContext.defaultFormatTemplateId]
    ).filter((value): value is string => Boolean(value))
  const templateRecords = await loadFormatTemplateRecords(params.supabase, candidateTemplateIds)
  const agendaTemplateRecord = agendaPlaybook
    ? null
    : agenda.format_template_id
      ? templateRecords.get(agenda.format_template_id) ?? null
      : null
  const committeeDefaultTemplateRecord = !agendaPlaybook && !params.config?.requireCompleteFormatting && committeeContext.defaultFormatTemplateId
    ? templateRecords.get(committeeContext.defaultFormatTemplateId) ?? null
    : null

  if (params.config?.requireCompleteFormatting) {
    if (agendaPlaybook) {
      if (!playbookHasCompleteExactFormatting(agendaPlaybook)) {
        throw new Error(`Format not complete: ${agenda.agenda_no} ${agenda.title}`)
      }
    } else {
      if (!agendaTemplateRecord || !getCompiledMinuteTemplate(agendaTemplateRecord.compiledTemplateJson ?? null)) {
        throw new Error(`Format not complete: ${agenda.agenda_no} ${agenda.title}`)
      }
    }
  }

  const resolvedAgendaPdf = resolveAgendaPdfSource(
    meetingAgendas ?? [{
      id: agenda.id,
      agenda_no: agenda.agenda_no,
      title: agenda.title,
      slide_pages: agenda.slide_pages,
      sort_order: agenda.sort_order,
    }],
    agendaId,
  )
  const attachedSlidePath = resolvedAgendaPdf.path
  const inheritedPdfGuidance = resolvedAgendaPdf.source === 'header' && resolvedAgendaPdf.headerAgendaNo
    ? `The agenda PDF was inherited from header Agenda ${resolvedAgendaPdf.headerAgendaNo}: "${resolvedAgendaPdf.headerAgendaTitle ?? 'Section Header'}". The document may cover multiple sub-items. Only use the content that clearly belongs to Agenda ${agenda.agenda_no}: "${agenda.title}".`
    : undefined

  const model = await runGenerationStage(
    'model_resolution',
    'Failed to resolve Generate MoM model',
    async () => (
      params.runtimeContext?.userPlanTier
        ? resolveLanguageModelForUserPlan(
            meeting.organization_id,
            params.runtimeContext.userPlanTier,
            'generate_mom',
          )
        : resolveLanguageModelForOrganization(meeting.organization_id, 'generate_mom')
    ),
  )
  const transcriptIntelligenceConfig = await runGenerationStage(
    'transcript_intelligence_resolution',
    'Failed to resolve transcript intelligence preset',
    async () => getTranscriptIntelligenceConfigForOrganization(meeting.organization_id),
  )
  const sourceAgendaRevision = agenda.content_revision ?? 1
  const reusableDraftCheckpoint = params.runtimeContext?.momDraftCheckpoint
    && params.runtimeContext.momDraftCheckpoint.sourceAgendaRevision === sourceAgendaRevision
    ? params.runtimeContext.momDraftCheckpoint
    : null
  const persistedMinute = params.runtimeContext?.resolvedOutcomeModeOverride
    || reusableDraftCheckpoint?.resolvedOutcomeMode
    ? null
    : await getCanonicalCurrentMinuteForAgendaId<Pick<Minute, 'id' | 'agenda_id' | 'resolved_outcome_mode' | 'content'>>({
        supabase: params.supabase,
        agendaId,
        extraColumns: 'resolved_outcome_mode, content',
      })
  const persistedResolvedOutcomeMode = params.runtimeContext?.resolvedOutcomeModeOverride
    ?? reusableDraftCheckpoint?.resolvedOutcomeMode
    ?? inferResolvedOutcomeMode({
      resolvedOutcomeMode: persistedMinute?.resolved_outcome_mode ?? null,
      resolutionVariantKey: reusableDraftCheckpoint?.resolutionVariantKey ?? null,
      content: persistedMinute?.content ?? null,
    })

  async function persistMomDraftCheckpoint(checkpoint: MomDraftCheckpointPayload) {
    if (!params.runtimeContext?.onMomDraftCheckpoint) return

    await runGenerationStage(
      'draft_checkpoint_persist',
      'Failed to save draft checkpoint',
      async () => {
        await params.runtimeContext?.onMomDraftCheckpoint?.({
          ...checkpoint,
          sourceAgendaRevision,
        })
      },
    )
  }

  const transcriptChunks = (isTranscriptlessClosureOnly ? [] : nonPlaceholderSegments)
    .map(segment => buildStructuredTranscriptLine({
      content: segment.content,
      speaker: segment.speaker,
      startOffset: segment.start_offset,
    }))
    .filter(Boolean)
  const sourceTranscript = transcriptChunks.join('\n')

  let agendaPdfExcerpts: ReferenceExcerpt[] = []
  let committeeRagExcerpts: ReferenceExcerpt[] = []
  let referenceExcerpts: ReferenceExcerpt[] = []
  let referenceExcerptsLoaded = false

  async function loadReferenceExcerpts(transcriptForReference: string) {
    if (referenceExcerptsLoaded) {
      return
    }

    const referenceQuery = isTranscriptlessClosureOnly
      ? `${agenda.agenda_no} ${agenda.title}`
      : transcriptForReference

    ;[agendaPdfExcerpts, committeeRagExcerpts] = await Promise.all([
      getAgendaPdfExcerpts(params.supabase, attachedSlidePath, referenceQuery, {
        meetingId: meeting.id,
        agendaId,
        sourceLabel: resolvedAgendaPdf.source === 'header' && resolvedAgendaPdf.headerAgendaNo
          ? `Header PDF (Agenda ${resolvedAgendaPdf.headerAgendaNo})`
          : 'Agenda PDF',
      }),
      getCommitteeRagExcerpts(params.supabase, meeting.committees?.id, referenceQuery),
    ])
    referenceExcerpts = [...agendaPdfExcerpts, ...committeeRagExcerpts]
    referenceExcerptsLoaded = true
  }

  const reusablePrompt1Output = !isTranscriptlessClosureOnly && reusableDraftCheckpoint?.prompt1Output?.trim()
    && hasCompletedMomDraftStage(reusableDraftCheckpoint.lastCompletedStage, 'prompt1')
    ? finalizeLineBasedTranscript({
        agendaNo: agenda.agenda_no,
        stage: 'checkpoint_reuse',
        sourceTranscript,
        candidateTranscript: reusableDraftCheckpoint.prompt1Output,
        fallbackTranscript: '',
      })
    : null
  const canReuseCheckpointOutputs = Boolean(reusablePrompt1Output)
  let groundedTranscript = reusablePrompt1Output || null

  if (!groundedTranscript) {
    if (isTranscriptlessClosureOnly) {
      groundedTranscript = buildTranscriptlessClosureOnlyTranscript({
        agendaNo: agenda.agenda_no,
        agendaTitle: agenda.title,
      })
      await loadReferenceExcerpts(groundedTranscript)
    } else {
      const prompt1 = buildPrompt1_ContextCleaning({
        agendaNo: agenda.agenda_no,
        agendaTitle: agenda.title,
        presenter: agenda.presenter,
        transcriptChunks,
        glossary: glossary ?? [],
        agendaDeviationNote: params.config?.agendaDeviationPrompt || undefined,
        additionalInfo: agenda.additional_info || undefined,
        meetingRulesPrompt,
        hardRulesBlock,
        committeeFactsBlock,
      })

      const result1 = await runGenerationStage(
        'prompt1_generation',
        'Prompt 1 generation failed',
        async () => generateText({
          model,
          system: persona,
          prompt: prompt1,
        }),
      )

      const cleanedTranscript = finalizeLineBasedTranscript({
        agendaNo: agenda.agenda_no,
        stage: 'prompt1_generation',
        sourceTranscript,
        candidateTranscript: result1.text,
        fallbackTranscript: sourceTranscript,
      })
      await loadReferenceExcerpts(cleanedTranscript)
      const refinedTranscript = await runGenerationStage(
        'transcript_grounding',
        'Transcript grounding failed',
        async () => refineTranscriptForAgendaContext({
          config: transcriptIntelligenceConfig,
          agendaNo: agenda.agenda_no,
          agendaTitle: agenda.title,
          presenter: agenda.presenter,
          cleanedTranscript,
          referenceGuidance: inheritedPdfGuidance,
          referenceExcerpts,
        }),
      )
      groundedTranscript = finalizeLineBasedTranscript({
        agendaNo: agenda.agenda_no,
        stage: 'transcript_grounding',
        sourceTranscript: cleanedTranscript,
        candidateTranscript: refinedTranscript,
        fallbackTranscript: cleanedTranscript,
      })
    }

    await persistMomDraftCheckpoint({
      lastCompletedStage: 'prompt1',
      prompt1Output: groundedTranscript,
    })
  }

  let crossRefAnalysis = canReuseCheckpointOutputs && reusableDraftCheckpoint?.prompt2Output?.trim()
    && hasCompletedMomDraftStage(reusableDraftCheckpoint.lastCompletedStage, 'prompt2')
    ? reusableDraftCheckpoint.prompt2Output
    : null

  if (!crossRefAnalysis) {
    await loadReferenceExcerpts(groundedTranscript)

    const prompt2 = buildPrompt2_CrossReference({
      agendaNo: agenda.agenda_no,
      agendaTitle: agenda.title,
      cleanedTranscript: groundedTranscript,
      slideContent: agendaPdfExcerpts.length > 0 ? 'Agenda PDF excerpts included below.' : null,
      referenceGuidance: inheritedPdfGuidance,
      agendaReferenceExcerpts: agendaPdfExcerpts,
      committeeRagExcerpts,
      meetingRulesPrompt,
      hardRulesBlock,
      committeeFactsBlock,
    })

    const result2 = await runGenerationStage(
      'prompt2_generation',
      'Prompt 2 generation failed',
      async () => generateText({
        model,
        system: persona,
        prompt: prompt2,
      }),
    )

    crossRefAnalysis = result2.text

    await persistMomDraftCheckpoint({
      lastCompletedStage: 'prompt2',
      prompt1Output: groundedTranscript,
      prompt2Output: crossRefAnalysis,
    })
  }

  if (!groundedTranscript || !crossRefAnalysis) {
    throw new Error(`Draft checkpoints are incomplete for Agenda ${agenda.agenda_no}`)
  }

  let renderedMinuteContent = ''
  const canonicalReport = await runGenerationStage(
    'prompt3_master_report',
    'Prompt 3 master report extraction failed',
    async () => {
      const result = await generateObject({
        model,
        system: persona,
        schema: canonicalMinuteReportSchema,
        prompt: buildPrompt3_MasterReportExtraction({
          agendaNo: agenda.agenda_no,
          agendaTitle: agenda.title,
          presenter: agenda.presenter,
          cleanedTranscript: groundedTranscript,
          crossRefAnalysis,
          additionalInfo: agenda.additional_info || undefined,
          secretariatInstructions: committeeContext.minuteInstruction || undefined,
          ignoredAgendaNos: params.runtimeContext?.ignoredAgendaNos,
          meetingRulesPrompt,
          excludeDeckPoints: params.config?.excludeDeckPoints,
          languages: params.config?.languages,
          formatterRuleBlock: agendaFormatterRuleBlock,
          hardRulesBlock,
          committeeFactsBlock,
        }),
      })

      return normalizeCanonicalMinuteReport(result.object)
    },
  )
  const effectiveCanonicalReport = effectiveSkipDiscussedSection
    ? ensureClosureOnlyCanonicalReport({
        report: canonicalReport,
        agendaTitle: agenda.title,
        crossRefAnalysis,
      })
    : canonicalReport

  const summaryPaper = effectiveCanonicalReport.paperSummary || null
  const summaryDiscussion = effectiveCanonicalReport.discussionExplanation || null
  const summaryHeated = null

  await persistMomDraftCheckpoint({
    lastCompletedStage: 'summary',
    prompt1Output: groundedTranscript,
    prompt2Output: crossRefAnalysis,
    summaryPaper,
    summaryDiscussion,
    summaryHeated,
  })

  let selectedPlaybookVariant = overridePlaybookVariant ?? defaultPlaybookVariant ?? null
  let selectedExactTemplate: ResolvedPlaybookExactTemplate | null = null
  let resolutionVariantKey: GenerateMinuteDraftPayload['resolutionVariantKey'] = null
  let resolutionVariantLabel: GenerateMinuteDraftPayload['resolutionVariantLabel'] = null
  let resolutionVariantSource: GenerateMinuteDraftPayload['resolutionVariantSource'] = null
  const resolutionExactRenderEnforced = Boolean(agendaPlaybook && agendaResolutionPathsEnabled)

  if (agendaPlaybook) {
    if (agendaResolutionPathsEnabled) {
      assertManualResolutionOverride({
        hasManualOverrideId: Boolean(agenda.minute_playbook_variant_override_id),
        overrideVariant: overridePlaybookVariant,
      })

      const persistedVariantKey = persistedResolvedOutcomeMode
        ? mapResolvedOutcomeModeToVariantKey(persistedResolvedOutcomeMode)
        : null
      const persistedVariant = persistedVariantKey
        ? getMinutePlaybookVariant(agendaPlaybook, persistedVariantKey)
        : null

      if (persistedVariantKey && persistedVariant) {
        selectedPlaybookVariant = persistedVariant
        resolutionVariantKey = persistedVariantKey
        resolutionVariantLabel = getMinutePlaybookVariantLabel(persistedVariantKey)
        resolutionVariantSource = 'manual'
      } else {
        const resolutionSelection = resolveResolutionPathVariant({
          playbook: agendaPlaybook,
          overrideVariant: overridePlaybookVariant,
          canonicalReport: effectiveCanonicalReport,
          crossRefAnalysis,
        })

        selectedPlaybookVariant = resolutionSelection.variant
        resolutionVariantKey = resolutionSelection.variantKey
        resolutionVariantLabel = getMinutePlaybookVariantLabel(resolutionSelection.variantKey)
        resolutionVariantSource = resolutionSelection.source
      }

      selectedExactTemplate = resolvePlaybookExactTemplate({
        playbook: agendaPlaybook,
        selectedVariant: selectedPlaybookVariant,
      })

      if (!selectedExactTemplate) {
        if (params.config?.requireCompleteFormatting) {
          throw new AgendaMinuteGenerationError(
            'resolution_exact_template',
            `Exact RESOLVED branch could not be rendered: ${resolutionVariantLabel} template is missing or invalid`,
          )
        }
        console.warn(
          `[generate-minutes] falling back to canonical render for Agenda ${agenda.agenda_no}; ${resolutionVariantLabel} template is missing or invalid.`,
        )
      }
    } else if (agendaPlaybookMode === 'resolution_paths') {
      selectedPlaybookVariant = defaultPlaybookVariant ?? null
      selectedExactTemplate = selectedPlaybookVariant
        ? resolvePlaybookExactTemplate({
            playbook: agendaPlaybook,
            selectedVariant: selectedPlaybookVariant,
          })
        : null

      if (!selectedExactTemplate) {
        if (params.config?.requireCompleteFormatting) {
          throw new AgendaMinuteGenerationError(
            'resolution_exact_template',
            'Exact playbook template could not be rendered for this agenda',
          )
        }
        console.warn(
          `[generate-minutes] falling back to canonical render for Agenda ${agenda.agenda_no}; exact playbook template could not be rendered.`,
        )
      }
    } else {
      if (!overridePlaybookVariant) {
        const autoSelectedVariant = await runGenerationStage(
          'playbook_variant_selection',
          'Playbook variant selection failed',
          async () => selectPlaybookVariant({
            model,
            persona,
            playbook: agendaPlaybook,
            playbookMode: agendaPlaybookMode,
            agendaNo: agenda.agenda_no,
            agendaTitle: agenda.title,
            presenter: agenda.presenter,
            cleanedTranscript: groundedTranscript,
            crossRefAnalysis,
            additionalInfo: agenda.additional_info || undefined,
            mindInstructionBlock,
            meetingRulesPrompt,
            ignoredAgendaNos: params.runtimeContext?.ignoredAgendaNos,
          }),
        )

        if (autoSelectedVariant) {
          selectedPlaybookVariant = autoSelectedVariant
        }
      }

      selectedExactTemplate = selectedPlaybookVariant
        ? resolvePlaybookExactTemplate({
            playbook: agendaPlaybook,
            selectedVariant: selectedPlaybookVariant,
          })
        : null

      if (!selectedExactTemplate) {
        if (params.config?.requireCompleteFormatting) {
          throw new AgendaMinuteGenerationError(
            'resolution_exact_template',
            'Exact playbook template could not be rendered for this agenda',
          )
        }
        console.warn(
          `[generate-minutes] falling back to canonical render for Agenda ${agenda.agenda_no}; exact playbook template could not be rendered.`,
        )
      }
    }
  } else {
    const standaloneExactTemplate = agendaTemplateRecord
      ? resolveCompiledMinuteTemplateRecord({
          promptText: agendaTemplateRecord.promptText,
          compiledTemplateJson: agendaTemplateRecord.compiledTemplateJson,
          compileMode: GENERATION_TEMPLATE_COMPILE_MODE,
          contextLabel: `agenda template ${agendaTemplateRecord.id}`,
        })
      : committeeDefaultTemplateRecord
        ? resolveCompiledMinuteTemplateRecord({
            promptText: committeeDefaultTemplateRecord.promptText,
            compiledTemplateJson: committeeDefaultTemplateRecord.compiledTemplateJson,
            compileMode: GENERATION_TEMPLATE_COMPILE_MODE,
            contextLabel: `committee default template ${committeeDefaultTemplateRecord.id}`,
          })
        : null

    selectedExactTemplate = standaloneExactTemplate
      ? {
          template: standaloneExactTemplate,
          resolutionSlotIds: [],
          resolutionListIds: [],
          omittedSlotIds: [],
          omittedListIds: [],
          requiredOwnerSlotIds: [],
          requiredOwnerListIds: [],
          requiredOwnerLabels: [],
        }
      : null
  }

  if (params.config?.requireCompleteFormatting && !selectedExactTemplate) {
    throw new Error(`Format not complete: ${agenda.agenda_no} ${agenda.title}`)
  }

  if (selectedExactTemplate) {
    try {
      const templateConflict = getMeetingRuleTemplateConflict(
        meetingRulesPrompt,
        renderMinuteTemplateSkeleton(selectedExactTemplate.template),
      )
      if (templateConflict) {
        throw new AgendaMinuteGenerationError(
          'prompt3_template_conflict',
          `Meeting rules conflict with exact template structure: ${templateConflict}`,
        )
      }

      const templateAwareMemoryContext = resolveApplicableMinuteMemory({
        entries: mindContext.sourceEntries ?? [],
        agendaNo: agenda.agenda_no,
        agendaTitle: agenda.title,
        additionalInfo: agenda.additional_info ?? null,
        templateStructureText: renderMinuteTemplateSkeleton(selectedExactTemplate.template),
        paperSummary: summaryPaper,
      })
      mergeAppliedMemoryTraceEntries(
        appliedMemoryTrace,
        templateAwareMemoryContext.appliedTrace ?? [],
      )
      const templateEntryContext = applyReusableFormatterGuidanceToTemplateEntries({
        agendaNo: agenda.agenda_no,
        templateEntries: extractMinuteTemplatePromptEntries(selectedExactTemplate.template),
        formatterRules: templateAwareMemoryContext.formatterRules,
      })
      let templateEntriesWithBaseFormatFormulas = applyBaseFormatFormulaGuidanceToTemplateEntries(
        templateEntryContext.templateEntries,
      )
      markAppliedMemoryUsage(
        appliedMemoryTrace,
        templateEntryContext.matchedFormatterRules.map(rule => rule.entryId),
        'template_entry_guidance',
      )

      const prompt3 = buildPrompt3_StrictTemplateExtraction({
        agendaNo: agenda.agenda_no,
        agendaTitle: agenda.title,
        presenter: agenda.presenter,
        cleanedTranscript: groundedTranscript,
        crossRefAnalysis,
        canonicalReportBlock: effectiveSkipDiscussedSection
          ? buildCanonicalMinuteReportContextWithOptions(effectiveCanonicalReport, {
              omitDiscussedSection: true,
            })
          : buildCanonicalMinuteReportContext(effectiveCanonicalReport),
        templateSkeleton: renderMinuteTemplateSkeleton(selectedExactTemplate.template),
        templateEntries: templateEntriesWithBaseFormatFormulas,
        additionalInfo: agenda.additional_info || undefined,
        secretariatInstructions: committeeContext.minuteInstruction || undefined,
        mindInstructionBlock: [
          templateAwareMemoryContext.hardRulesBlock,
          templateAwareMemoryContext.committeeFactsBlock,
        ].filter(Boolean).join('\n\n') || generationMindInstructionBlock,
        formatterRuleBlock: buildMinuteFormatterRuleBlock(templateEntryContext.matchedFormatterRules),
        ignoredAgendaNos: params.runtimeContext?.ignoredAgendaNos,
        meetingRulesPrompt,
        agendaPaperExcerpts: agendaPdfExcerpts,
        hardRulesBlock: templateAwareMemoryContext.hardRulesBlock ?? hardRulesBlock,
        committeeFactsBlock: templateAwareMemoryContext.committeeFactsBlock ?? committeeFactsBlock,
        excludeDeckPoints: params.config?.excludeDeckPoints,
        languages: params.config?.languages,
        activeResolutionVariantKey: resolutionVariantKey,
        activeResolutionVariantLabel: resolutionVariantLabel,
        activeResolutionVariantSource: resolutionVariantSource,
      })

      let result3: StrictTemplateExtraction
      try {
        result3 = await runGenerationStage(
          resolutionExactRenderEnforced ? 'resolution_exact_render' : 'prompt3_generation',
          resolutionExactRenderEnforced ? 'Exact RESOLVED branch could not be rendered' : 'Prompt 3 template extraction failed',
          async () => runStrictTemplateExtractionWithValidation({
            model,
            persona,
            prompt: prompt3,
            template: selectedExactTemplate.template,
            agendaNo: agenda.agenda_no,
            agendaTitle: agenda.title,
          }),
        )
      } catch (error) {
        if (resolutionExactRenderEnforced) {
          throw new AgendaMinuteGenerationError(
            'resolution_exact_render',
            `Exact RESOLVED branch could not be rendered: ${getErrorMessage(error)}`,
          )
        }
        throw error
      }

      validateResolutionBranchConsistency({
        selectedVariant: selectedPlaybookVariant,
        resolutionVariantKey,
        extracted: result3,
        resolvedTemplate: selectedExactTemplate,
        canonicalReport: effectiveCanonicalReport,
        crossRefAnalysis,
      })

      let activeExactTemplate = selectedExactTemplate
      let templateFill = buildTemplateFillFromObject(activeExactTemplate.template, result3)
      const scaffoldedMemoryEntryIds = applyMemoryScaffoldsToTemplateFill({
        fill: templateFill,
        templateEntries: templateEntriesWithBaseFormatFormulas,
        presenter: agenda.presenter,
        cleanedTranscript: groundedTranscript,
        agendaTitle: agenda.title,
        paperSummary: summaryPaper,
        crossRefAnalysis,
      })
      markAppliedMemoryUsage(appliedMemoryTrace, scaffoldedMemoryEntryIds, 'formatter_scaffold')
      applyBaseFormatFormulaScaffoldsToTemplateFill({
        fill: templateFill,
        templateEntries: templateEntriesWithBaseFormatFormulas,
        crossRefAnalysis,
        presenter: agenda.presenter,
        cleanedTranscript: groundedTranscript,
        agendaTitle: agenda.title,
        paperSummary: summaryPaper,
      })
      sanitizeResolvedTemplateFill({
        fill: templateFill,
        templateEntries: templateEntriesWithBaseFormatFormulas,
        crossRefAnalysis,
        cleanedTranscript: groundedTranscript,
        paperSummary: summaryPaper,
      })

      if (resolutionExactRenderEnforced && resolutionVariantKey && resolutionVariantKey !== 'default') {
        let hasMeaningfulResolvedBranch = resolutionBranchHasMeaningfulContent({
          fill: templateFill,
          templateEntries: templateEntriesWithBaseFormatFormulas,
          resolvedTemplate: activeExactTemplate,
          resolutionVariantKey,
        })

        if (!hasMeaningfulResolvedBranch) {
          hasMeaningfulResolvedBranch = rebuildResolutionBranchFillFromEvidence({
            fill: templateFill,
            templateEntries: templateEntriesWithBaseFormatFormulas,
            resolvedTemplate: activeExactTemplate,
            resolutionVariantKey,
            agendaTitle: agenda.title,
            canonicalReport: effectiveCanonicalReport,
            crossRefAnalysis,
            paperSummary: summaryPaper,
          })
        }

        if (!hasMeaningfulResolvedBranch && agendaPlaybook) {
          const siblingVariantKey = getSiblingResolutionVariantKey(resolutionVariantKey)
          const siblingVariant = siblingVariantKey
            ? getMinutePlaybookVariant(agendaPlaybook, siblingVariantKey)
            : null
          const siblingExactTemplate = siblingVariant
            ? resolvePlaybookExactTemplate({
                playbook: agendaPlaybook,
                selectedVariant: siblingVariant,
              })
            : null

          if (siblingVariantKey && siblingVariant && siblingExactTemplate) {
            const siblingTemplateEntries = applyBaseFormatFormulaGuidanceToTemplateEntries(
              extractMinuteTemplatePromptEntries(siblingExactTemplate.template),
            )
            const siblingFill = cloneMinuteTemplateFill(templateFill)
            const siblingRecovered = rebuildResolutionBranchFillFromEvidence({
              fill: siblingFill,
              templateEntries: siblingTemplateEntries,
              resolvedTemplate: siblingExactTemplate,
              resolutionVariantKey: siblingVariantKey,
              agendaTitle: agenda.title,
              canonicalReport: effectiveCanonicalReport,
              crossRefAnalysis,
              paperSummary: summaryPaper,
            })

            if (siblingRecovered) {
              activeExactTemplate = siblingExactTemplate
              templateEntriesWithBaseFormatFormulas = siblingTemplateEntries
              templateFill = siblingFill
              selectedPlaybookVariant = siblingVariant
              resolutionVariantKey = siblingVariantKey
              resolutionVariantLabel = getMinutePlaybookVariantLabel(siblingVariantKey)
              resolutionVariantSource = 'auto'
            }
          }
        }

        if (!resolutionBranchHasMeaningfulContent({
          fill: templateFill,
          templateEntries: templateEntriesWithBaseFormatFormulas,
          resolvedTemplate: activeExactTemplate,
          resolutionVariantKey,
        })) {
          throw new AgendaMinuteGenerationError(
            'resolution_exact_render',
            'Exact RESOLVED branch could not be rebuilt with grounded content',
          )
        }
      }

      for (const slotId of activeExactTemplate.omittedSlotIds) {
        delete templateFill.slots?.[slotId]
      }
      for (const listId of activeExactTemplate.omittedListIds) {
        delete templateFill.lists?.[listId]
      }

      let closureOnlyDiscussedEntryIds: ReturnType<typeof getClosureOnlyDiscussedTemplateEntryIds> | null = null
      if (effectiveSkipDiscussedSection) {
        closureOnlyDiscussedEntryIds = getClosureOnlyDiscussedTemplateEntryIds(templateEntriesWithBaseFormatFormulas)
        for (const slotId of closureOnlyDiscussedEntryIds.slotIds) {
          delete templateFill.slots?.[slotId]
        }
        for (const listId of closureOnlyDiscussedEntryIds.listIds) {
          delete templateFill.lists?.[listId]
        }
      }

      if (!templateFillHasMeaningfulContent(templateFill)) {
        throw new AgendaMinuteGenerationError(
          'prompt3_fidelity',
          'Structured template extraction produced no grounded content after recovery',
        )
      }

      const suppressEmptySlotIds = Array.from(new Set([
        ...(resolutionExactRenderEnforced ? activeExactTemplate.resolutionSlotIds : []),
        ...activeExactTemplate.omittedSlotIds,
        ...(closureOnlyDiscussedEntryIds?.slotIds ?? []),
      ]))
      const suppressEmptyListIds = Array.from(new Set([
        ...(resolutionExactRenderEnforced ? activeExactTemplate.resolutionListIds : []),
        ...activeExactTemplate.omittedListIds,
        ...(closureOnlyDiscussedEntryIds?.listIds ?? []),
      ]))

      renderedMinuteContent = renderMinuteTemplate(
        activeExactTemplate.template,
        templateFill,
        suppressEmptySlotIds.length > 0 || suppressEmptyListIds.length > 0
          ? {
              suppressEmptySlotIds,
              suppressEmptyListIds,
            }
          : undefined,
      )
      renderedMinuteContent = repairRenderedMinuteOpeningFormulas({
        content: renderedMinuteContent,
        templateEntries: templateEntriesWithBaseFormatFormulas,
        crossRefAnalysis,
        presenter: agenda.presenter,
        cleanedTranscript: groundedTranscript,
        agendaTitle: agenda.title,
        paperSummary: summaryPaper,
      })
      if (effectiveSkipDiscussedSection) {
        renderedMinuteContent = stripClosureOnlyDiscussedSection(renderedMinuteContent)
      }
    } catch (error) {
      console.warn(
        `[generate-minutes] structured template render fallback for Agenda ${agenda.agenda_no} "${agenda.title}". ${getErrorMessage(error)}`,
      )
      renderedMinuteContent = renderCanonicalMinuteReportWithOptions(effectiveCanonicalReport, {
        omitDiscussedSection: effectiveSkipDiscussedSection,
      })
    }
  } else {
    renderedMinuteContent = renderCanonicalMinuteReportWithOptions(effectiveCanonicalReport, {
      omitDiscussedSection: effectiveSkipDiscussedSection,
    })
  }

  renderedMinuteContent = repairRenderedMinuteTopLines({
    content: renderedMinuteContent,
    agendaNo: agenda.agenda_no,
    agendaTitle: agenda.title,
  })

  const { cleanContent, markers } = extractConfidenceMarkers(renderedMinuteContent)
  const resolvedOutcomeMode = inferResolvedOutcomeMode({
    resolvedOutcomeMode: persistedResolvedOutcomeMode,
    resolutionVariantKey,
    content: cleanContent,
  })
  const topLineIssues = collectRenderedMinuteTopLineIssues({
    content: cleanContent,
    agendaNo: agenda.agenda_no,
    agendaTitle: agenda.title,
  })
  if (topLineIssues.length > 0) {
    console.warn(
      `[generate-minutes] continuing after rendered-minute cleanup warnings for Agenda ${agenda.agenda_no}. ${topLineIssues.join(' | ')}`,
    )
  }

  return {
    content: cleanContent,
    markers,
    sourceAgendaRevision,
    prompt1Output: groundedTranscript,
    prompt2Output: crossRefAnalysis,
    summaryPaper,
    summaryDiscussion,
    summaryHeated,
    resolvedOutcomeMode,
    resolutionVariantKey,
    resolutionVariantLabel,
    resolutionVariantSource,
    resolutionExactRenderEnforced,
    appliedMemoryTrace: serializeAppliedMemoryTrace(appliedMemoryTrace),
  }
}

export async function commitMinuteDraftToCurrentMinutesWithClient(params: {
  supabase: DatabaseClient
  agendaId: string
  userId: string
  organizationId?: string | null
  userPlanTier?: PlanTier | null
  draft: GenerateMinuteDraftPayload
  changeSummary?: string
}): Promise<string | null> {
  const agendaId = uuidSchema.parse(params.agendaId)

  const { data: agenda } = await params.supabase
    .from('agendas')
    .select('agenda_no, title, content_revision, meetings(id, organization_id, committees(id, slug, persona_prompt))')
    .eq('id', agendaId)
    .single()

  if (!agenda) throw new Error('Agenda not found')

  const meeting = agenda.meetings as unknown as {
    id: string
    organization_id: string
    committees: { id: string; slug: string; persona_prompt: string | null } | null
  }

  if (params.organizationId && meeting.organization_id !== params.organizationId) {
    throw new Error('Agenda not found or inaccessible')
  }

  const minuteId = await runGenerationStage(
    'minute_save',
    'Failed to save generated minutes',
    async () => {
      const existingMinute = await getCanonicalCurrentMinuteForAgendaId<Pick<Minute, 'id' | 'agenda_id' | 'version'>>({
        supabase: params.supabase,
        agendaId,
        extraColumns: 'version',
      })

      let savedMinuteId = existingMinute?.id ?? null

      if (existingMinute) {
        const { data: oldMinute, error: oldMinuteError } = await params.supabase
          .from('minutes')
          .select('content, version')
          .eq('id', existingMinute.id)
          .single()

        if (oldMinuteError) {
          throw new Error(oldMinuteError.message)
        }

        if (oldMinute) {
          const { error: versionInsertError } = await params.supabase.from('minute_versions').insert({
            minute_id: existingMinute.id,
            content: oldMinute.content,
            version: oldMinute.version,
            change_summary: params.changeSummary ?? 'Regenerated by AI',
            changed_by: params.userId,
          })

          if (versionInsertError) {
            throw new Error(versionInsertError.message)
          }
        }

        const minuteUpdatePayload = {
          content: params.draft.content,
          source_agenda_revision: params.draft.sourceAgendaRevision,
          confidence_data: params.draft.markers,
          applied_memory_trace: params.draft.appliedMemoryTrace ?? null,
          resolved_outcome_mode: params.draft.resolvedOutcomeMode ?? null,
          prompt_1_output: params.draft.prompt1Output,
          prompt_2_output: params.draft.prompt2Output,
          summary_paper: params.draft.summaryPaper,
          summary_discussion: params.draft.summaryDiscussion,
          summary_heated: params.draft.summaryHeated,
          version: (existingMinute.version ?? 1) + 1,
        }

        let { error: minuteUpdateError } = await params.supabase
          .from('minutes')
          .update(minuteUpdatePayload)
          .eq('id', existingMinute.id)

        if (minuteUpdateError && isMissingAppliedMemoryTraceColumnError(minuteUpdateError.message, 'minutes')) {
          ;({ error: minuteUpdateError } = await params.supabase
            .from('minutes')
            .update(stripAppliedMemoryTraceField(minuteUpdatePayload))
            .eq('id', existingMinute.id))
        }

        if (minuteUpdateError) {
          throw new Error(minuteUpdateError.message)
        }
      } else {
        const minuteInsertPayload = {
          agenda_id: agendaId,
          content: params.draft.content,
          source_agenda_revision: params.draft.sourceAgendaRevision,
          confidence_data: params.draft.markers,
          applied_memory_trace: params.draft.appliedMemoryTrace ?? null,
          resolved_outcome_mode: params.draft.resolvedOutcomeMode ?? null,
          prompt_1_output: params.draft.prompt1Output,
          prompt_2_output: params.draft.prompt2Output,
          summary_paper: params.draft.summaryPaper,
          summary_discussion: params.draft.summaryDiscussion,
          summary_heated: params.draft.summaryHeated,
          version: 1,
          is_current: true,
        }

        const { data: inserted, error: insertMinuteError } = await params.supabase
          .from('minutes')
          .insert(minuteInsertPayload)
          .select('id')
          .single()

        let insertedMinute = inserted
        let finalInsertError = insertMinuteError

        if (finalInsertError && isMissingAppliedMemoryTraceColumnError(finalInsertError.message, 'minutes')) {
          const retryResult = await params.supabase
            .from('minutes')
            .insert(stripAppliedMemoryTraceField(minuteInsertPayload))
            .select('id')
            .single()
          insertedMinute = retryResult.data
          finalInsertError = retryResult.error
        }

        if (finalInsertError) {
          throw new Error(finalInsertError.message)
        }

        savedMinuteId = insertedMinute?.id ?? null
      }

      return savedMinuteId
    },
  )

  try {
    const committeeSlug = meeting.committees?.slug ?? 'board'
    const persona = meeting.committees?.persona_prompt || getDefaultPersona(committeeSlug)
    const model = params.userPlanTier
      ? await resolveLanguageModelForUserPlan(
          meeting.organization_id,
          params.userPlanTier,
          'generate_mom',
        )
      : await resolveLanguageModelForOrganization(meeting.organization_id, 'generate_mom')
    const resolvedOutcomeMode = inferResolvedOutcomeMode({
      resolvedOutcomeMode: params.draft.resolvedOutcomeMode,
      resolutionVariantKey: params.draft.resolutionVariantKey,
      content: params.draft.content,
    })
    await syncActionItemsForResolvedOutcome({
      supabase: params.supabase,
      agendaId,
      meetingId: meeting.id,
      minuteContent: params.draft.content,
      resolvedOutcomeMode,
      model,
      persona,
    })
  } catch (error) {
    console.warn('[commitMinuteDraftToCurrentMinutesWithClient] action item extraction failed', {
      stage: 'action_item_extraction',
      meetingId: meeting.id,
      agendaId,
      message: getErrorMessage(error),
    })
  }

  try {
    const auditOrganizationId = params.organizationId ?? meeting.organization_id
    const { error: auditError } = await params.supabase.from('audit_logs').insert({
      organization_id: auditOrganizationId,
      meeting_id: meeting.id,
      user_id: params.userId,
      action: 'minutes_generated',
      details: { agenda_id: agendaId, agenda_no: agenda.agenda_no },
    })

    if (auditError) {
      throw new Error(auditError.message)
    }
  } catch (error) {
    console.warn('[commitMinuteDraftToCurrentMinutesWithClient] audit log insert failed', {
      stage: 'audit_log_write',
      meetingId: meeting.id,
      agendaId,
      message: getErrorMessage(error),
    })
  }

  return minuteId
}

export async function generateMinutesForAgendaWithClient(params: {
  supabase: DatabaseClient
  agendaId: string
  userId: string
  organizationId?: string | null
  config?: GenerationConfig
  runtimeContext?: GenerationRuntimeContext
}): Promise<GenerateMinutesForAgendaResult> {
  const draft = await buildMinuteDraftForAgendaWithClient(params)
  const minuteId = await commitMinuteDraftToCurrentMinutesWithClient({
    supabase: params.supabase,
    agendaId: params.agendaId,
    userId: params.userId,
    organizationId: params.organizationId,
    userPlanTier: params.runtimeContext?.userPlanTier,
    draft,
  })

  return {
    content: draft.content,
    markers: draft.markers,
    minuteId,
    resolvedOutcomeMode: draft.resolvedOutcomeMode,
    resolutionVariantKey: draft.resolutionVariantKey,
    resolutionVariantLabel: draft.resolutionVariantLabel,
    resolutionVariantSource: draft.resolutionVariantSource,
    resolutionExactRenderEnforced: draft.resolutionExactRenderEnforced,
  }
}

export async function generateAllMinutesWithClient(params: {
  supabase: DatabaseClient
  meetingId: string
  userId: string
  organizationId?: string | null
  userPlanTier?: PlanTier | null
  config?: GenerationConfig
}) {
  const meetingId = uuidSchema.parse(params.meetingId)

  let { data: meeting, error: meetingError } = await params.supabase
    .from('meetings')
    .select('committee_id, meeting_rules')
    .eq('id', meetingId)
    .single()

  if (meetingError && isMissingMeetingRulesColumn(meetingError)) {
    const fallback = await params.supabase
      .from('meetings')
      .select('committee_id')
      .eq('id', meetingId)
      .single()
    meeting = {
      committee_id: fallback.data?.committee_id ?? null,
      meeting_rules: '',
    }
    meetingError = fallback.error
  }

  if (meetingError) {
    throw new Error(meetingError.message)
  }

  const committeeContext = await getCommitteeGenerationContext(
    params.supabase,
    meeting?.committee_id ?? null,
  )
  const meetingRulesPrompt = resolveMeetingRulesPrompt(params.config, meeting?.meeting_rules ?? null)

  const { data: agendas } = await params.supabase
    .from('agendas')
    .select('id, agenda_no, title, format_template_id, minute_playbook_id, is_skipped')
    .eq('meeting_id', meetingId)
    .order('sort_order')

  if (!agendas) throw new Error('No agendas found')

  const activeTranscriptId = await resolveTranscriptIdForMeeting(
    params.supabase,
    meetingId,
    params.config?.transcriptId ?? null,
  )
  const manualSkipped = new Set(params.config?.skippedAgendaIds ?? [])
  const dbSkipped = new Set(agendas.filter(agenda => agenda.is_skipped).map(agenda => agenda.id))
  const { ignoredAgendaIds, ignoredAgendaNos } = matchIgnoredAgendasFromInstruction(
    committeeContext.minuteInstruction,
    agendas,
  )
  const skipped = new Set([...manualSkipped, ...dbSkipped, ...ignoredAgendaIds])
  const skippedEntries: Array<{ agendaId: string; agendaNo: string; reason: string }> = []

  if (params.config?.requireCompleteFormatting) {
    const missingFormatting = await listAgendasMissingExactFormattingWithClient({
      supabase: params.supabase,
      agendas: agendas.filter(agenda => !skipped.has(agenda.id)),
    })
    if (missingFormatting.length > 0) {
      const list = missingFormatting
        .slice(0, 8)
        .map(agenda => `${agenda.agenda_no} ${agenda.title}`)
        .join(', ')
      throw new Error(`Format not complete: ${list}`)
    }
  }

  let generatedCount = 0
  for (const agenda of agendas) {
    if (skipped.has(agenda.id)) {
      skippedEntries.push({
        agendaId: agenda.id,
        agendaNo: agenda.agenda_no,
        reason: 'Skipped by instruction or user selection',
      })
      continue
    }

    try {
      const forcedResolvedOutcomeMode = params.config?.forcedResolvedOutcomeModes?.[agenda.id] ?? null
      await generateMinutesForAgendaWithClient({
        supabase: params.supabase,
        agendaId: agenda.id,
        userId: params.userId,
        organizationId: params.organizationId,
        config: params.config,
        runtimeContext: {
          committeeContext,
          ignoredAgendaNos,
          meetingRulesPrompt,
          transcriptId: activeTranscriptId,
          userPlanTier: params.userPlanTier,
          resolvedOutcomeModeOverride: forcedResolvedOutcomeMode,
          skipDiscussedSection: forcedResolvedOutcomeMode === 'closed',
        },
      })
      generatedCount += 1
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.toLowerCase().includes('no transcript segments assigned to this agenda')) {
        skippedEntries.push({
          agendaId: agenda.id,
          agendaNo: agenda.agenda_no,
          reason: 'No chunk mapped',
        })
        continue
      }
      throw error
    }
  }

  await params.supabase
    .from('meetings')
    .update({ status: 'in_progress' })
    .eq('id', meetingId)

  return {
    generatedCount,
    skippedCount: skippedEntries.length,
    skipped: skippedEntries,
  }
}
