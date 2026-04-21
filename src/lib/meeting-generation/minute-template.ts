import { createHash } from 'crypto'
import { z } from 'zod'

export const MINUTE_TEMPLATE_VERSION = 1 as const
export const EMPTY_TEMPLATE_SLOT_VALUE = 'Nil.'
export const RESOLUTION_PATH_PLACEHOLDER = '[RESOLUTION_PATH]'
export const LEGACY_RESOLUTION_PATH_PLACEHOLDER = '{{RESOLUTION_PATH}}'
const RESOLUTION_PATH_PLACEHOLDER_PATTERN = /(?:\[\s*RESOLUTION_PATH\s*\]|\{\{\s*RESOLUTION_PATH\s*\}\})/g
const RESOLUTION_PATH_MARKER_PATTERN = /<span[^>]*data-resolution-placeholder(?:=(?:"true"|'true'|true))?[^>]*>.*?<\/span>/gi
const MINUTE_SOURCE_ATTRIBUTE = 'data-minute-source'
const MINUTE_SOURCE_NOTE_ATTRIBUTE = 'data-minute-source-note'
const INTERNAL_MINUTE_SOURCE_MARKER_PATTERN = /^\[\[MINUTE_SOURCE:(paper|transcript)(?:\|(.+))?\]\]$/i

const minuteTemplateSourceConstraintSchema = z.enum(['paper', 'transcript'])
export type MinuteTemplateSourceConstraint = z.infer<typeof minuteTemplateSourceConstraintSchema>

const minuteTemplateNodeSourceFields = {
  sourceConstraint: minuteTemplateSourceConstraintSchema.optional(),
  sourceNote: z.string().min(1).optional(),
}

const slotNodeSchema = z.object({
  type: z.literal('slot'),
  slotId: z.string().min(1),
  slotKind: z.enum(['paragraph', 'field']),
  prefix: z.string(),
  sampleValue: z.string(),
  ...minuteTemplateNodeSourceFields,
})

const listNodeSchema = z.object({
  type: z.literal('list'),
  slotId: z.string().min(1),
  listStyle: z.enum(['bullet', 'numeric-dot', 'numeric-paren', 'alpha-dot', 'alpha-paren']),
  indent: z.string(),
  bulletMarker: z.string().optional(),
  startAt: z.number().int().min(0).optional(),
  sampleItems: z.array(z.string()).min(1),
  ...minuteTemplateNodeSourceFields,
})

const blankNodeSchema = z.object({
  type: z.literal('blank'),
})

const literalNodeSchema = z.object({
  type: z.literal('literal'),
  text: z.string().min(1),
  ...minuteTemplateNodeSourceFields,
})

const instructionNodeSchema = z.object({
  type: z.literal('instruction'),
  text: z.string().min(1),
})

const resolutionAnchorNodeSchema = z.object({
  type: z.literal('resolution_anchor'),
})

export const minuteTemplateNodeSchema = z.discriminatedUnion('type', [
  blankNodeSchema,
  literalNodeSchema,
  instructionNodeSchema,
  resolutionAnchorNodeSchema,
  slotNodeSchema,
  listNodeSchema,
])

export const minuteTemplateSchema = z.object({
  kind: z.literal('minute_template'),
  version: z.literal(MINUTE_TEMPLATE_VERSION),
  normalizedText: z.string().min(1),
  nodes: z.array(minuteTemplateNodeSchema).min(1),
})

export const legacyStoredMinuteTemplateSchema = z.object({
  kind: z.literal('legacy_raw_text'),
  version: z.literal(MINUTE_TEMPLATE_VERSION),
  normalizedText: z.string(),
})

export const storedMinuteTemplateSchema = z.union([
  minuteTemplateSchema,
  legacyStoredMinuteTemplateSchema,
])

export type MinuteTemplateNode = z.infer<typeof minuteTemplateNodeSchema>
export type MinuteTemplateSchema = z.infer<typeof minuteTemplateSchema>
export type StoredMinuteTemplate = z.infer<typeof storedMinuteTemplateSchema>

export interface MinuteTemplateFill {
  slots?: Record<string, string | undefined>
  lists?: Record<string, string[] | undefined>
}

export interface MinuteTemplateRenderOptions {
  suppressEmptySlotIds?: Iterable<string>
  suppressEmptyListIds?: Iterable<string>
}

export interface ResolutionPathMergeResult {
  template: MinuteTemplateSchema
  resolutionSlotIds: string[]
  resolutionListIds: string[]
  resolutionSlotIdMap: Record<string, string>
  resolutionListIdMap: Record<string, string>
}

export interface MinuteTemplateActionLikeEntryMatch {
  slotIds: string[]
  listIds: string[]
  labels: string[]
}

export interface MinuteTemplateOwnerLikeEntryMatch {
  slotIds: string[]
  listIds: string[]
  labels: string[]
}

export interface StoredMinuteTemplateData {
  compiledTemplateJson: StoredMinuteTemplate
  compiledTemplateVersion: number
  compiledTemplateHash: string
}

export type MinuteTemplateCompileMode = 'flexible' | 'agenda_exact' | 'generation_guided'

export type MinuteTemplateValidationIssueCode =
  | 'duplicate_resolution_placeholder'
  | 'helper_note_literal_text'
  | 'unstable_from_paper_block'
  | 'unsupported_mixed_structure'
  | 'nested_list_not_supported'
  | 'multi_paragraph_list_item_not_supported'
  | 'ambiguous_list_structure'
  | 'simple_list_supported_but_roundtrip_changed'
  | 'unstable_exact_template'

export interface MinuteTemplateValidationIssue {
  code: MinuteTemplateValidationIssueCode
  message: string
}

export class MinuteTemplateCompileError extends Error {
  issues: MinuteTemplateValidationIssue[]

  constructor(message: string, issues: MinuteTemplateValidationIssue[]) {
    super(message)
    this.name = 'MinuteTemplateCompileError'
    this.issues = issues
  }
}

interface MinuteTemplateCompileOptions {
  mode?: MinuteTemplateCompileMode
}

interface MinuteTemplateSourceMetadata {
  sourceConstraint: MinuteTemplateSourceConstraint
  sourceNote?: string
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => {
      const numericCode = Number.parseInt(code, 10)
      return Number.isFinite(numericCode) ? String.fromCodePoint(numericCode) : _
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      const numericCode = Number.parseInt(code, 16)
      return Number.isFinite(numericCode) ? String.fromCodePoint(numericCode) : _
    })
}

function stripInvisibleMinuteTemplateChars(value: string) {
  return value.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, '')
}

function normalizeResolutionPlaceholderToken(value: string) {
  return stripInvisibleMinuteTemplateChars(value).replace(
    RESOLUTION_PATH_PLACEHOLDER_PATTERN,
    RESOLUTION_PATH_PLACEHOLDER,
  )
}

function extractHtmlAttributeValue(attributes: string, attributeName: string) {
  const patterns = [
    new RegExp(`${attributeName}\\s*=\\s*"([^"]*)"`, 'i'),
    new RegExp(`${attributeName}\\s*=\\s*'([^']*)'`, 'i'),
    new RegExp(`${attributeName}\\s*=\\s*([^\\s>]+)`, 'i'),
  ]

  for (const pattern of patterns) {
    const match = attributes.match(pattern)
    if (!match?.[1]) continue
    return decodeHtmlEntities(match[1]).trim()
  }

  return ''
}

function buildInternalMinuteSourceMarker(sourceConstraint: MinuteTemplateSourceConstraint, sourceNote?: string) {
  const note = sourceNote?.trim()
  const encodedNote = note ? `|${encodeURIComponent(note)}` : ''
  return `\n[[MINUTE_SOURCE:${sourceConstraint}${encodedNote}]]\n`
}

function injectMinuteSourceMarkersFromHtml(input: string) {
  return input.replace(/<(p|div|h[1-6]|ul|ol)\b([^>]*)>/gi, (match, _tagName, attributes) => {
    const sourceConstraint = extractHtmlAttributeValue(attributes, MINUTE_SOURCE_ATTRIBUTE)
    if (sourceConstraint !== 'paper') return match

    const sourceNote = extractHtmlAttributeValue(attributes, MINUTE_SOURCE_NOTE_ATTRIBUTE)
    return `${buildInternalMinuteSourceMarker('paper', sourceNote)}${match}`
  })
}

function parseInternalMinuteSourceMarker(value: string): MinuteTemplateSourceMetadata | null {
  const match = value.trim().match(INTERNAL_MINUTE_SOURCE_MARKER_PATTERN)
  if (!match?.[1]) return null

  const sourceConstraint = match[1].toLowerCase()
  if (sourceConstraint !== 'paper' && sourceConstraint !== 'transcript') return null

  let sourceNote = ''
  if (typeof match[2] === 'string' && match[2]) {
    try {
      sourceNote = decodeURIComponent(match[2]).trim()
    } catch {
      sourceNote = match[2].trim()
    }
  }

  return {
    sourceConstraint,
    sourceNote: sourceNote || undefined,
  }
}

function stripInternalMinuteSourceMarkers(value: string) {
  return value
    .split('\n')
    .filter(line => !parseInternalMinuteSourceMarker(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const ACTION_LIKE_TEMPLATE_LABEL_PATTERNS = [
  /^action by$/,
  /^actions?$/,
  /^action items?$/,
  /^pic$/,
  /^person in charge$/,
  /^due date$/,
  /^deadline$/,
  /^owner$/,
  /^follow[- ]?up$/,
  /^follow[- ]?up actions?$/,
]

const OWNER_LIKE_TEMPLATE_LABEL_PATTERNS = [
  /^action by$/,
  /^pic$/,
  /^person in charge$/,
  /^owner$/,
]

const CLOSURE_ONLY_TEMPLATE_LINE_PATTERNS = [
  /^status:\s*closed\.?$/i,
  /^closed\.?$/i,
  /^status:\s*noted as presented\.?$/i,
  /^noted as presented\.?$/i,
  /^status:\s*no further action\.?$/i,
  /^no further action\.?$/i,
]

function normalizeActionLikeTemplateLabel(value: string) {
  return stripInvisibleMinuteTemplateChars(value)
    .replace(/\s+/g, ' ')
    .replace(/\s*[:.]+\s*$/, '')
    .trim()
}

function isActionLikeTemplateLabel(value: string) {
  const normalized = normalizeActionLikeTemplateLabel(value).toLowerCase()
  if (!normalized) return false
  return ACTION_LIKE_TEMPLATE_LABEL_PATTERNS.some(pattern => pattern.test(normalized))
}

function isOwnerLikeTemplateLabel(value: string) {
  const normalized = normalizeActionLikeTemplateLabel(value).toLowerCase()
  if (!normalized) return false
  return OWNER_LIKE_TEMPLATE_LABEL_PATTERNS.some(pattern => pattern.test(normalized))
}

function dedupeLabels(labels: Iterable<string>) {
  return Array.from(new Set(
    Array.from(labels)
      .map(label => normalizeActionLikeTemplateLabel(label))
      .filter(Boolean),
  ))
}

function dedupeTextValues(values: Iterable<string>) {
  const seen = new Set<string>()
  const deduped: string[] = []

  for (const value of values) {
    const normalized = stripInvisibleMinuteTemplateChars(value)
      .replace(/\s+/g, ' ')
      .trim()

    if (!normalized) continue

    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(normalized)
  }

  return deduped
}

function isStandaloneMinuteTemplateInstructionLine(value: string) {
  const match = value.match(/^\s*\[(.+?)\]\s*$/)
  return Boolean(match?.[1]?.trim())
}

function parseMinuteTemplateInstructionText(value: string) {
  const match = value.match(/^\s*\[(.+?)\]\s*$/)
  return match?.[1]?.trim() ?? value.trim()
}

function inferMinuteTemplateSourceMetadataFromInstruction(value: string): MinuteTemplateSourceMetadata | null {
  const normalized = parseMinuteTemplateInstructionText(value)
  if (!normalized) return null

  const isPaperInstruction = /\b(?:attached pdf|from the paper|from paper|taken from the paper|paper only|pdf only|executive summary)\b/i
    .test(normalized)
  const isTranscriptInstruction = /\b(?:from the discussions?|discussion only|from the transcript(?:ion)?|transcript only|discussion flow)\b/i
    .test(normalized)

  if (!isPaperInstruction && !isTranscriptInstruction) return null

  const sourceConstraint: MinuteTemplateSourceConstraint = isPaperInstruction ? 'paper' : 'transcript'
  const sourceNote = normalized
    .replace(/^(?:this|the)\s+(?:part|block|section)\s+(?:is|was)\s+/i, '')
    .replace(/^(?:only\s+)?taken from the attached pdf\b[:,-]?\s*/i, '')
    .replace(/^(?:this was\s+)?taken from the paper\b[:,-]?\s*/i, '')
    .replace(/^(?:taken\s+)?from the paper\b[:,-]?\s*/i, '')
    .replace(/^(?:from the discussions?|discussion only|from the transcript(?:ion)?|transcript only)\b[:,-]?\s*/i, '')
    .trim()

  return {
    sourceConstraint,
    sourceNote: sourceNote && sourceNote !== normalized ? sourceNote : undefined,
  }
}

export function normalizeMinuteTemplateInput(input: string) {
  const { normalizedText } = buildNormalizedMinuteTemplateInputState(input)
  return normalizedText
}

function buildNormalizedMinuteTemplateInputState(input: string) {
  const text = normalizeResolutionPlaceholderToken(decodeHtmlEntities(
    injectMinuteSourceMarkersFromHtml(input)
      .replace(/\r\n?/g, '\n')
      .replace(RESOLUTION_PATH_MARKER_PATTERN, RESOLUTION_PATH_PLACEHOLDER)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<\/ul>/gi, '\n')
      .replace(/<\/ol>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<li[^>]*>/gi, '- ')
      .replace(/<[^>]+>/g, ''),
  ))

  const normalized = text
    .split('\n')
    .map(line => normalizeResolutionPlaceholderToken(line).replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\u00a0/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  const canonicalWithMarkers = canonicalizeMinuteTemplateMarkerLines(normalized)
  return {
    normalizedTextWithMarkers: canonicalWithMarkers,
    normalizedText: stripInternalMinuteSourceMarkers(canonicalWithMarkers),
  }
}

function normalizeGuidanceComparisonValue(value: string) {
  return stripInvisibleMinuteTemplateChars(value)
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.]+$/g, '')
    .toLowerCase()
}

function canonicalizeMinuteTemplateMarkerLines(value: string) {
  const lines = value.split('\n')
  const next: string[] = []
  let pendingSourceNote: { normalized: string; remaining: number } | null = null

  for (const line of lines) {
    const markerMetadata = parseInternalMinuteSourceMarker(line)
    if (markerMetadata) {
      next.push(line)
      pendingSourceNote = markerMetadata.sourceNote
        ? { normalized: normalizeGuidanceComparisonValue(markerMetadata.sourceNote), remaining: 6 }
        : null
      continue
    }

    const trimmed = line.trim()
    if (!trimmed) {
      next.push(line)
      continue
    }

    if (
      pendingSourceNote
      && pendingSourceNote.normalized
      && normalizeGuidanceComparisonValue(line) === pendingSourceNote.normalized
    ) {
      continue
    }

    next.push(line)
    if (pendingSourceNote) {
      pendingSourceNote.remaining -= 1
      if (pendingSourceNote.remaining <= 0) {
        pendingSourceNote = null
      }
    }
  }

  return next.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function normalizeMinuteTemplateComparisonText(value: string) {
  return normalizeMinuteTemplateInput(value)
    .split('\n')
    .map(line => stripInvisibleMinuteTemplateChars(line).replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function isMinuteTemplateFieldLine(value: string) {
  return /^\s*[A-Za-z][A-Za-z0-9 /&(),.'-]{1,50}:\s*\S.+$/.test(value)
}

function normalizeMinuteTemplateStructuralComparisonText(value: string) {
  const lines = normalizeMinuteTemplateComparisonText(value).split('\n')
  const next: string[] = []

  function findNextNonEmptyIndex(startIndex: number) {
    for (let cursor = startIndex; cursor < lines.length; cursor += 1) {
      if (lines[cursor]?.trim()) return cursor
    }
    return -1
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const trimmed = line.trim()

    if (!trimmed) {
      const previousNonEmpty = (() => {
        for (let cursor = next.length - 1; cursor >= 0; cursor -= 1) {
          const candidate = next[cursor]?.trim()
          if (candidate) return candidate
        }
        return ''
      })()
      const nextNonEmptyIndex = findNextNonEmptyIndex(index + 1)
      const nextNonEmpty = nextNonEmptyIndex >= 0 ? lines[nextNonEmptyIndex]?.trim() ?? '' : ''

      const previousIsList = Boolean(previousNonEmpty && matchListLine(previousNonEmpty))
      const nextIsList = Boolean(nextNonEmpty && matchListLine(nextNonEmpty))
      const previousIsField = Boolean(previousNonEmpty && isMinuteTemplateFieldLine(previousNonEmpty))
      const nextIsField = Boolean(nextNonEmpty && isMinuteTemplateFieldLine(nextNonEmpty))

      if (
        (previousIsList || nextIsList)
        || (previousIsField && nextIsList)
        || (previousIsList && nextIsField)
      ) {
        continue
      }
    }

    next.push(trimmed ? line : '')
  }

  return next.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function findDuplicateMinuteSourceNoteLines(value: string) {
  const lines = value.split('\n')
  const duplicates = new Set<string>()
  let pendingSourceNote: { raw: string; normalized: string; remaining: number } | null = null

  for (const line of lines) {
    const markerMetadata = parseInternalMinuteSourceMarker(line)
    if (markerMetadata) {
      pendingSourceNote = markerMetadata.sourceNote
        ? {
            raw: markerMetadata.sourceNote,
            normalized: normalizeGuidanceComparisonValue(markerMetadata.sourceNote),
            remaining: 6,
          }
        : null
      continue
    }

    const trimmed = line.trim()
    if (!trimmed) continue

    if (
      pendingSourceNote
      && pendingSourceNote.normalized
      && normalizeGuidanceComparisonValue(line) === pendingSourceNote.normalized
    ) {
      duplicates.add(pendingSourceNote.raw)
      continue
    }

    if (pendingSourceNote) {
      pendingSourceNote.remaining -= 1
      if (pendingSourceNote.remaining <= 0) {
        pendingSourceNote = null
      }
    }
  }

  return Array.from(duplicates)
}

function createMinuteTemplateCompileIssues(params: {
  normalizedTextWithMarkers: string
  parsedTemplate: MinuteTemplateSchema
  listStructureIssues?: MinuteTemplateValidationIssue[]
}): MinuteTemplateValidationIssue[] {
  const issues: MinuteTemplateValidationIssue[] = []
  const duplicateSourceNotes = findDuplicateMinuteSourceNoteLines(params.normalizedTextWithMarkers)

  if (duplicateSourceNotes.length > 0) {
    issues.push({
      code: 'helper_note_literal_text',
      message: `Keep helper notes like "${duplicateSourceNotes[0]}" only in the From the Paper note field, not as visible body text.`,
    })
  }

  if (params.normalizedTextWithMarkers.includes('[[MINUTE_SOURCE:paper')) {
    issues.push({
      code: 'unstable_from_paper_block',
      message: 'Keep each From the Paper section as one clean tagged block and avoid mixing extra helper text inside the visible minute body.',
    })
  }

  if (params.listStructureIssues?.length) {
    issues.push(...params.listStructureIssues)
  } else if (params.parsedTemplate.nodes.some(node => node.type === 'list')) {
    issues.push({
      code: 'simple_list_supported_but_roundtrip_changed',
      message: 'This exact sample uses a supported one-level list, but the saved structure still changes after normalization. Simplify the list wording or split the section into smaller blocks.',
    })
  }

  if (issues.length === 0) {
    issues.push({
      code: 'unstable_exact_template',
      message: 'Simplify the exact sample so it can be reproduced consistently after save.',
    })
  }

  return issues
}

function buildMinuteTemplateCompileErrorMessage(issues: MinuteTemplateValidationIssue[]) {
  const lead = issues[0]?.message
  return lead
    ? `Formatting sample could not be compiled into a stable exact template. ${lead}`
    : 'Formatting sample could not be compiled into a stable exact template'
}

export function isMinuteTemplateCompileError(error: unknown): error is MinuteTemplateCompileError {
  return error instanceof MinuteTemplateCompileError
}

export function findMinuteTemplateStabilityWarnings(input: string): MinuteTemplateValidationIssue[] {
  const {
    normalizedTextWithMarkers,
    normalizedText,
  } = buildNormalizedMinuteTemplateInputState(input)
  const warnings: MinuteTemplateValidationIssue[] = []
  const duplicateNotes = findDuplicateMinuteSourceNoteLines(normalizedTextWithMarkers)

  if (duplicateNotes.length > 0) {
    warnings.push({
      code: 'helper_note_literal_text',
      message: `Helper note "${duplicateNotes[0]}" appears in the visible body. Keep it in the From the Paper note field only.`,
    })
  }

  const resolutionAnchorMatches = normalizedTextWithMarkers
    .split('\n')
    .map(line => line.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, '').trim())
    .filter(line => /^(?:\[\s*RESOLUTION_PATH\s*\]|\{\{\s*RESOLUTION_PATH\s*\}\})$/.test(line))
  if (resolutionAnchorMatches.length > 1) {
    warnings.push({
      code: 'duplicate_resolution_placeholder',
      message: `Base format can only contain one ${RESOLUTION_PATH_PLACEHOLDER} placeholder.`,
    })
  }

  if (normalizedText) {
    const parsedNodes = parseMinuteTemplateNodesFromNormalizedText(
      normalizedTextWithMarkers,
      'flexible',
    )
    warnings.push(...findUnsupportedMinuteTemplateListStructureIssues({
      nodes: parsedNodes,
    }))
  }

  return warnings
}

function countWords(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .length
}

function isMostlyUppercase(value: string) {
  const letters = value.match(/[A-Za-z]/g) ?? []
  if (letters.length === 0) return false

  const uppercaseLetters = letters.filter(letter => letter === letter.toUpperCase())
  return uppercaseLetters.length / letters.length >= 0.6
}

function isLikelyLiteralLine(line: string) {
  const trimmed = line.trim()
  if (!trimmed) return false
  if (/^[_-]{3,}$/.test(trimmed)) return true
  if (/^[A-Z][A-Za-z0-9 /&(),.'-]{0,60}:\s*$/.test(trimmed)) return true
  if (/^(MINUTES?\s+OF|AGENDA|ACTION ITEMS?|NOTED|DISCUSSED|RESOLVED|DECIDED|PREPARED BY|CONFIRMED BY)\b/i.test(trimmed)) {
    return !/:\s+\S/.test(trimmed) || countWords(trimmed) <= 10
  }
  if (/^\d+(?:\.\d+)*\s+[A-Z][^.!?]{0,80}$/.test(trimmed) && countWords(trimmed) <= 12) return true
  if (isMostlyUppercase(trimmed) && countWords(trimmed) <= 14) return true
  return false
}

type ListStyle = z.infer<typeof listNodeSchema>['listStyle']

interface ListMatch {
  indent: string
  style: ListStyle
  bulletMarker?: string
  startAt?: number
  text: string
}

function matchListLine(line: string): ListMatch | null {
  let match = line.match(/^(\s*)([-*•])\s+(.*\S.*)$/)
  if (match) {
    return {
      indent: match[1] ?? '',
      style: 'bullet',
      bulletMarker: match[2],
      text: match[3],
    }
  }

  match = line.match(/^(\s*)(\d+)\.\s+(.*\S.*)$/)
  if (match) {
    return {
      indent: match[1] ?? '',
      style: 'numeric-dot',
      startAt: Number(match[2]),
      text: match[3],
    }
  }

  match = line.match(/^(\s*)(\d+)\)\s+(.*\S.*)$/)
  if (match) {
    return {
      indent: match[1] ?? '',
      style: 'numeric-paren',
      startAt: Number(match[2]),
      text: match[3],
    }
  }

  match = line.match(/^(\s*)([A-Za-z])\.\s+(.*\S.*)$/)
  if (match) {
    return {
      indent: match[1] ?? '',
      style: 'alpha-dot',
      startAt: (match[2] ?? 'a').toLowerCase().charCodeAt(0) - 96,
      text: match[3],
    }
  }

  match = line.match(/^(\s*)([A-Za-z])\)\s+(.*\S.*)$/)
  if (match) {
    return {
      indent: match[1] ?? '',
      style: 'alpha-paren',
      startAt: (match[2] ?? 'a').toLowerCase().charCodeAt(0) - 96,
      text: match[3],
    }
  }

  return null
}

function isHeadingLikeListLine(line: string, match: ListMatch) {
  const text = match.text.trim()
  if (!text) return false
  if (/^(the committee|management|members|it was noted|it was resolved)\b/i.test(text)) return false
  if (/[.!?;]$/.test(text)) return false
  if (countWords(text) > 10) return false
  return isMostlyUppercase(text) || /^[A-Z][A-Za-z0-9/&(),.' -]+$/.test(text)
}

function parseMinuteTemplateNodesFromNormalizedText(
  normalizedTextWithMarkers: string,
  compileMode: MinuteTemplateCompileMode,
) {
  const nodes: MinuteTemplateNode[] = []
  const lines = normalizedTextWithMarkers.split('\n')
  let slotIndex = 1
  let pendingSourceMetadata: MinuteTemplateSourceMetadata | null = null

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line.trim()) {
      nodes.push({ type: 'blank' })
      continue
    }

    const normalizedLine = normalizeResolutionPlaceholderToken(line)
    const sourceMarkerMetadata = parseInternalMinuteSourceMarker(normalizedLine)
    if (sourceMarkerMetadata) {
      pendingSourceMetadata = sourceMarkerMetadata
      continue
    }
    if (/^\s*(?:\[\s*RESOLUTION_PATH\s*\]|\{\{\s*RESOLUTION_PATH\s*\}\})\s*$/.test(normalizedLine)) {
      nodes.push({ type: 'resolution_anchor' })
      continue
    }
    if (isStandaloneMinuteTemplateInstructionLine(normalizedLine)) {
      nodes.push({
        type: 'instruction',
        text: normalizedLine.trim(),
      })
      continue
    }

    const listMatch = matchListLine(normalizedLine)
    if (listMatch && !isHeadingLikeListLine(normalizedLine, listMatch)) {
      const sampleItems = [listMatch.text.trim()]
      let cursor = index + 1
      while (cursor < lines.length) {
        const nextLine = stripInvisibleMinuteTemplateChars(lines[cursor] ?? '')
        const nextMatch = matchListLine(nextLine)
        if (
          !nextMatch
          || nextMatch.style !== listMatch.style
          || nextMatch.indent !== listMatch.indent
          || nextMatch.bulletMarker !== listMatch.bulletMarker
          || isHeadingLikeListLine(nextLine, nextMatch)
        ) {
          break
        }

        sampleItems.push(nextMatch.text.trim())
        cursor += 1
      }

      nodes.push({
        type: 'list',
        slotId: buildSlotId('list', slotIndex),
        listStyle: listMatch.style,
        indent: listMatch.indent,
        bulletMarker: listMatch.bulletMarker,
        startAt: listMatch.startAt,
        sampleItems,
        sourceConstraint: pendingSourceMetadata?.sourceConstraint,
        sourceNote: pendingSourceMetadata?.sourceNote,
      })
      slotIndex += 1
      index = cursor - 1
      pendingSourceMetadata = null
      continue
    }

    if (isLikelyLiteralLine(normalizedLine)) {
      nodes.push({
        type: 'literal',
        text: normalizedLine,
        sourceConstraint: pendingSourceMetadata?.sourceConstraint,
        sourceNote: pendingSourceMetadata?.sourceNote,
      })
      pendingSourceMetadata = null
      continue
    }

    const fieldMatch = normalizedLine.match(/^(\s*[A-Za-z][A-Za-z0-9 /&(),.'-]{1,50}:\s*)(.+)$/)
    if (fieldMatch) {
      nodes.push({
        type: 'slot',
        slotId: buildSlotId('slot', slotIndex),
        slotKind: 'field',
        prefix: fieldMatch[1] ?? '',
        sampleValue: (fieldMatch[2] ?? '').trim(),
        sourceConstraint: pendingSourceMetadata?.sourceConstraint,
        sourceNote: pendingSourceMetadata?.sourceNote,
      })
      slotIndex += 1
      pendingSourceMetadata = null
      continue
    }

    if (compileMode === 'agenda_exact') {
      nodes.push({
        type: 'literal',
        text: normalizedLine,
        sourceConstraint: pendingSourceMetadata?.sourceConstraint,
        sourceNote: pendingSourceMetadata?.sourceNote,
      })
    } else {
      nodes.push({
        type: 'slot',
        slotId: buildSlotId('slot', slotIndex),
        slotKind: 'paragraph',
        prefix: normalizedLine.match(/^\s*/)?.[0] ?? '',
        sampleValue: normalizedLine.trim(),
        sourceConstraint: pendingSourceMetadata?.sourceConstraint,
        sourceNote: pendingSourceMetadata?.sourceNote,
      })
      slotIndex += 1
    }
    pendingSourceMetadata = null
  }

  return nodes
}

function getNextSignificantMinuteTemplateNode(
  nodes: MinuteTemplateNode[],
  startIndex: number,
) {
  for (let index = startIndex; index < nodes.length; index += 1) {
    const node = nodes[index]
    if (!node) continue
    if (node.type === 'blank' || node.type === 'instruction' || node.type === 'resolution_anchor') continue
    return node
  }

  return null
}

function findUnsupportedMinuteTemplateListStructureIssues(params: {
  nodes: MinuteTemplateNode[]
}): MinuteTemplateValidationIssue[] {
  const issues: MinuteTemplateValidationIssue[] = []
  const seenCodes = new Set<MinuteTemplateValidationIssueCode>()
  const significantNodes = params.nodes.filter(node => (
    node.type !== 'blank'
    && node.type !== 'instruction'
    && node.type !== 'resolution_anchor'
  ))

  for (let index = 0; index < significantNodes.length; index += 1) {
    const node = significantNodes[index]
    if (!node || node.type !== 'list') continue

    if (node.indent.trim().length > 0 && !seenCodes.has('nested_list_not_supported')) {
      seenCodes.add('nested_list_not_supported')
      issues.push({
        code: 'nested_list_not_supported',
        message: 'Nested or indented lists are not supported in exact mode yet. Keep follow-up numbering at one level only.',
      })
    }

    const nextNode = getNextSignificantMinuteTemplateNode(significantNodes, index + 1)
    if (!nextNode) continue

    if (nextNode.type === 'list' && !seenCodes.has('ambiguous_list_structure')) {
      const sameShape = nextNode.indent === node.indent && nextNode.listStyle === node.listStyle
      if (!sameShape) {
        seenCodes.add('ambiguous_list_structure')
        issues.push({
          code: 'ambiguous_list_structure',
          message: 'Mixed list styles or multi-level list transitions are not supported in exact mode yet.',
        })
      }
      continue
    }

    const isUnsupportedParagraphAfterList = (
      (nextNode.type === 'slot' && nextNode.slotKind === 'paragraph')
      || (nextNode.type === 'literal' && !isLikelyLiteralLine(nextNode.text))
    )

    if (isUnsupportedParagraphAfterList && !seenCodes.has('multi_paragraph_list_item_not_supported')) {
      seenCodes.add('multi_paragraph_list_item_not_supported')
      issues.push({
        code: 'multi_paragraph_list_item_not_supported',
        message: 'List items with extra paragraph text after the numbered lines are not supported in exact mode yet. Keep follow-up items as one clean list, then continue with Action By/PIC/Due Date fields.',
      })
    }
  }

  return issues
}

function normalizeMinuteTemplateFieldPrefix(prefix: string) {
  return stripInvisibleMinuteTemplateChars(prefix)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function buildMinuteTemplateStructuralSignature(nodes: MinuteTemplateNode[]) {
  const signature: string[] = []

  for (const node of nodes) {
    if (node.type === 'blank' || node.type === 'instruction') continue
    if (node.type === 'resolution_anchor') {
      signature.push('resolution_anchor')
      continue
    }
    if (node.type === 'literal') {
      signature.push(`literal:${isLikelyLiteralLine(node.text) ? 'heading' : 'body'}`)
      continue
    }
    if (node.type === 'slot') {
      if (node.slotKind === 'field') {
        signature.push(`slot:field:${normalizeMinuteTemplateFieldPrefix(node.prefix)}`)
      } else {
        signature.push('slot:paragraph')
      }
      continue
    }

    signature.push(`list:${node.listStyle}:${node.indent.length}:${node.sampleItems.length}`)
  }

  return signature.join('|')
}

function buildSlotId(prefix: string, index: number) {
  return `${prefix}_${index}`
}

function isNilTemplateValue(value: string | undefined) {
  const normalized = (value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.]+$/g, '')
    .toLowerCase()

  return normalized === 'nil'
}

function slotAllowsNilFallback(node: Extract<MinuteTemplateNode, { type: 'slot' }>) {
  return isNilTemplateValue(node.sampleValue)
}

function listAllowsNilFallback(node: Extract<MinuteTemplateNode, { type: 'list' }>) {
  return node.sampleItems.length > 0 && node.sampleItems.every(item => isNilTemplateValue(item))
}

function compactSlotValue(
  value: string | undefined,
  options?: {
    suppressFallback?: boolean
    allowNilFallback?: boolean
  },
) {
  const compacted = (value ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(part => part.trim())
    .filter(Boolean)
    .join(' ')
    .trim()

  if (compacted) return compacted
  if (options?.suppressFallback) return ''
  return options?.allowNilFallback ? EMPTY_TEMPLATE_SLOT_VALUE : ''
}

function renderListPrefix(node: z.infer<typeof listNodeSchema>, index: number) {
  if (node.listStyle === 'bullet') {
    return `${node.indent}${node.bulletMarker ?? '-'} `
  }
  if (node.listStyle === 'numeric-dot') {
    return `${node.indent}${(node.startAt ?? 1) + index}. `
  }
  if (node.listStyle === 'numeric-paren') {
    return `${node.indent}${(node.startAt ?? 1) + index}) `
  }
  if (node.listStyle === 'alpha-dot') {
    return `${node.indent}${String.fromCharCode(96 + (node.startAt ?? 1) + index)}. `
  }
  return `${node.indent}${String.fromCharCode(96 + (node.startAt ?? 1) + index)}) `
}

function renderNode(
  node: MinuteTemplateNode,
  fill: MinuteTemplateFill,
  options?: {
    suppressEmptySlotIds?: Set<string>
    suppressEmptyListIds?: Set<string>
  },
) {
  if (node.type === 'blank') return ''
  if (node.type === 'literal') return node.text
  if (node.type === 'instruction') return ''
  if (node.type === 'resolution_anchor') return ''
  if (node.type === 'slot') {
    const slotValue = fill.slots && Object.prototype.hasOwnProperty.call(fill.slots, node.slotId)
      ? fill.slots[node.slotId]
      : undefined
    const resolvedValue = compactSlotValue(slotValue, {
      suppressFallback: options?.suppressEmptySlotIds?.has(node.slotId),
      allowNilFallback: slotAllowsNilFallback(node),
    })
    if (!resolvedValue) return ''
    return `${node.prefix}${resolvedValue}`
  }

  const items = fill.lists && Object.prototype.hasOwnProperty.call(fill.lists, node.slotId)
    ? fill.lists[node.slotId]?.filter(item => item.trim()) ?? []
    : []
  const resolvedItems = items.length > 0
    ? items
    : options?.suppressEmptyListIds?.has(node.slotId)
      ? []
      : listAllowsNilFallback(node)
        ? [EMPTY_TEMPLATE_SLOT_VALUE]
        : []
  if (resolvedItems.length === 0) return ''
  return resolvedItems.map((item, index) => `${renderListPrefix(node, index)}${compactSlotValue(item)}`).join('\n')
}

export function renderMinuteTemplate(
  template: MinuteTemplateSchema,
  fill: MinuteTemplateFill = {},
  options: MinuteTemplateRenderOptions = {},
) {
  const suppressEmptySlotIds = new Set(options.suppressEmptySlotIds ?? [])
  const suppressEmptyListIds = new Set(options.suppressEmptyListIds ?? [])
  return template.nodes.flatMap(node => {
    if (node.type === 'instruction') return []
    return [renderNode(node, fill, { suppressEmptySlotIds, suppressEmptyListIds })]
  }).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function renderMinuteTemplateWithSampleValues(template: MinuteTemplateSchema) {
  return template.nodes.map(node => {
    if (node.type === 'instruction') return node.text
    if (node.type === 'resolution_anchor') return RESOLUTION_PATH_PLACEHOLDER
    return renderNode(node, {
      slots: Object.fromEntries(
        template.nodes
          .filter(candidate => candidate.type === 'slot')
          .map(candidate => [candidate.slotId, candidate.sampleValue]),
      ),
      lists: Object.fromEntries(
        template.nodes
          .filter(candidate => candidate.type === 'list')
          .map(candidate => [candidate.slotId, candidate.sampleItems]),
      ),
    })
  }).join('\n')
}

export function renderMinuteTemplateSkeleton(template: MinuteTemplateSchema) {
  return template.nodes.flatMap(node => {
    if (node.type === 'blank') return ''
    if (node.type === 'literal') return node.text
    if (node.type === 'instruction') return []
    if (node.type === 'resolution_anchor') return RESOLUTION_PATH_PLACEHOLDER
    if (node.type === 'slot') return `${node.prefix}<${node.slotId}>`
    return `${renderListPrefix(node, 0)}<${node.slotId}[]>`
  }).join('\n')
}

export function extractMinuteTemplatePromptEntries(template: MinuteTemplateSchema) {
  const entries: Array<{
    id: string
    kind: 'slot' | 'list'
    prefix?: string
    listStyle?: ListStyle
    sampleValue?: string
    sampleItems?: string[]
    context: string
    guidance?: string
    sourceConstraint?: MinuteTemplateSourceConstraint
    sourceNote?: string
  }> = []
  let activeInstruction = ''
  let activeInstructionSourceMetadata: MinuteTemplateSourceMetadata | null = null

  for (let index = 0; index < template.nodes.length; index += 1) {
    const node = template.nodes[index]
    if (node.type === 'instruction') {
      activeInstruction = parseMinuteTemplateInstructionText(node.text)
      activeInstructionSourceMetadata = inferMinuteTemplateSourceMetadataFromInstruction(node.text)
      continue
    }
    if (node.type === 'blank' || node.type === 'literal' || node.type === 'resolution_anchor') continue

    let context = ''
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const previous = template.nodes[cursor]
      if (previous.type === 'literal') {
        context = previous.text
        break
      }
    }

    if (node.type === 'slot') {
      entries.push({
        id: node.slotId,
        kind: 'slot',
        prefix: node.prefix,
        sampleValue: node.sampleValue,
        context,
        guidance: activeInstruction || undefined,
        sourceConstraint: node.sourceConstraint ?? activeInstructionSourceMetadata?.sourceConstraint,
        sourceNote: node.sourceNote ?? activeInstructionSourceMetadata?.sourceNote,
      })
      continue
    }

    entries.push({
      id: node.slotId,
      kind: 'list',
      listStyle: node.listStyle,
      sampleItems: node.sampleItems,
      context,
      guidance: activeInstruction || undefined,
      sourceConstraint: node.sourceConstraint ?? activeInstructionSourceMetadata?.sourceConstraint,
      sourceNote: node.sourceNote ?? activeInstructionSourceMetadata?.sourceNote,
    })
  }

  return entries
}

export function hasMinuteTemplateResolutionAnchor(template: MinuteTemplateSchema) {
  return template.nodes.some(node => node.type === 'resolution_anchor')
}

export function getMinuteTemplateActionLikeEntries(
  template: MinuteTemplateSchema,
): MinuteTemplateActionLikeEntryMatch {
  const slotIds = new Set<string>()
  const listIds = new Set<string>()
  const labels = new Set<string>()
  let activeLiteralContext = ''

  for (const node of template.nodes) {
    if (node.type === 'literal') {
      activeLiteralContext = node.text
      continue
    }
    if (node.type === 'slot') {
      if (isActionLikeTemplateLabel(node.prefix)) {
        slotIds.add(node.slotId)
        labels.add(node.prefix)
      }
      continue
    }
    if (node.type === 'list') {
      if (isActionLikeTemplateLabel(activeLiteralContext)) {
        listIds.add(node.slotId)
        labels.add(activeLiteralContext)
      }
      continue
    }
  }

  return {
    slotIds: Array.from(slotIds),
    listIds: Array.from(listIds),
    labels: dedupeLabels(labels),
  }
}

export function getMinuteTemplateOwnerLikeEntries(
  template: MinuteTemplateSchema,
): MinuteTemplateOwnerLikeEntryMatch {
  const slotIds = new Set<string>()
  const listIds = new Set<string>()
  const labels = new Set<string>()
  let activeLiteralContext = ''

  for (const node of template.nodes) {
    if (node.type === 'literal') {
      activeLiteralContext = node.text
      continue
    }
    if (node.type === 'slot') {
      if (isOwnerLikeTemplateLabel(node.prefix)) {
        slotIds.add(node.slotId)
        labels.add(node.prefix)
      }
      continue
    }
    if (node.type === 'list') {
      if (isOwnerLikeTemplateLabel(activeLiteralContext)) {
        listIds.add(node.slotId)
        labels.add(activeLiteralContext)
      }
      continue
    }
  }

  return {
    slotIds: Array.from(slotIds),
    listIds: Array.from(listIds),
    labels: dedupeLabels(labels),
  }
}

export function findActionLikeMinuteTemplateLabels(input: string) {
  const normalized = normalizeMinuteTemplateInput(input)
  if (!normalized) return []

  try {
    return getMinuteTemplateActionLikeEntries(compileMinuteTemplateFromText(input)).labels
  } catch {
    const labels = new Set<string>()
    for (const line of normalized.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const fieldLabel = trimmed.match(/^([A-Za-z][A-Za-z0-9 /&(),.'-]{1,50}:)/)?.[1] ?? trimmed
      if (isActionLikeTemplateLabel(fieldLabel)) {
        labels.add(fieldLabel)
      }
    }
    return dedupeLabels(labels)
  }
}

export function findClosureOnlyMinuteTemplateSignals(input: string) {
  const normalized = normalizeMinuteTemplateInput(input)
  if (!normalized) return []

  const matches = normalized
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => CLOSURE_ONLY_TEMPLATE_LINE_PATTERNS.some(pattern => pattern.test(line)))

  return dedupeTextValues(matches)
}

function compactBlankNodes(nodes: MinuteTemplateNode[]) {
  const next: MinuteTemplateNode[] = []
  for (const node of nodes) {
    if (node.type === 'blank' && next.at(-1)?.type === 'blank') continue
    next.push(node)
  }

  while (next[0]?.type === 'blank') next.shift()
  while (next.at(-1)?.type === 'blank') next.pop()
  return next
}

function rebaseResolutionTemplateNodeIds(template: MinuteTemplateSchema) {
  const resolutionSlotIdMap: Record<string, string> = {}
  const resolutionListIdMap: Record<string, string> = {}

  const rebasedNodes = template.nodes.map(node => {
    if (node.type === 'slot') {
      const nextSlotId = `resolution__${node.slotId}`
      resolutionSlotIdMap[node.slotId] = nextSlotId
      return {
        ...node,
        slotId: nextSlotId,
      }
    }

    if (node.type === 'list') {
      const nextSlotId = `resolution__${node.slotId}`
      resolutionListIdMap[node.slotId] = nextSlotId
      return {
        ...node,
        slotId: nextSlotId,
      }
    }

    return node
  })

  return {
    template: minuteTemplateSchema.parse({
      ...template,
      nodes: rebasedNodes,
      normalizedText: renderMinuteTemplateWithSampleValues({
        ...template,
        nodes: rebasedNodes,
      }),
    }),
    resolutionSlotIdMap,
    resolutionListIdMap,
  }
}

export function mergeMinuteTemplateWithResolutionPathDetailed(
  baseTemplate: MinuteTemplateSchema,
  resolutionTemplate: MinuteTemplateSchema | null,
) : ResolutionPathMergeResult {
  const rebasedResolutionTemplate = resolutionTemplate
    ? rebaseResolutionTemplateNodeIds(resolutionTemplate)
    : null
  const resolutionSlotIds = rebasedResolutionTemplate
    ? Object.values(rebasedResolutionTemplate.resolutionSlotIdMap)
    : []
  const resolutionListIds = rebasedResolutionTemplate
    ? Object.values(rebasedResolutionTemplate.resolutionListIdMap)
    : []
  const mergedNodes = compactBlankNodes(
    baseTemplate.nodes.flatMap(node => {
      if (node.type !== 'resolution_anchor') return [node]
      return rebasedResolutionTemplate ? rebasedResolutionTemplate.template.nodes : []
    }),
  )

  const mergedTemplate: MinuteTemplateSchema = {
    kind: 'minute_template',
    version: MINUTE_TEMPLATE_VERSION,
    normalizedText: '__merged__',
    nodes: mergedNodes,
  }

  return {
    template: minuteTemplateSchema.parse({
      ...mergedTemplate,
      normalizedText: renderMinuteTemplateWithSampleValues(mergedTemplate),
    }),
    resolutionSlotIds,
    resolutionListIds,
    resolutionSlotIdMap: rebasedResolutionTemplate?.resolutionSlotIdMap ?? {},
    resolutionListIdMap: rebasedResolutionTemplate?.resolutionListIdMap ?? {},
  }
}

export function mergeMinuteTemplateWithResolutionPath(
  baseTemplate: MinuteTemplateSchema,
  resolutionTemplate: MinuteTemplateSchema | null,
) {
  return mergeMinuteTemplateWithResolutionPathDetailed(baseTemplate, resolutionTemplate).template
}

function countResolutionAnchors(nodes: MinuteTemplateNode[]) {
  return nodes.filter(node => node.type === 'resolution_anchor').length
}

export function compileMinuteTemplateFromText(
  input: string,
  options: MinuteTemplateCompileOptions = {},
): MinuteTemplateSchema {
  const {
    normalizedTextWithMarkers,
    normalizedText,
  } = buildNormalizedMinuteTemplateInputState(input)
  if (!normalizedText) {
    throw new Error('Previous minute format is required')
  }

  const compileMode = options.mode ?? 'flexible'
  const nodes = parseMinuteTemplateNodesFromNormalizedText(normalizedTextWithMarkers, compileMode)

  const compiled: MinuteTemplateSchema = {
    kind: 'minute_template',
    version: MINUTE_TEMPLATE_VERSION,
    normalizedText,
    nodes,
  }

  const parsed = minuteTemplateSchema.parse(compiled)
  if (countResolutionAnchors(parsed.nodes) > 1) {
    throw new Error(`Base format can only contain one ${RESOLUTION_PATH_PLACEHOLDER} placeholder`)
  }
  const listStructureIssues = findUnsupportedMinuteTemplateListStructureIssues({
    nodes: parsed.nodes,
  })
  if (listStructureIssues.length > 0) {
    const issues = createMinuteTemplateCompileIssues({
      normalizedTextWithMarkers,
      parsedTemplate: parsed,
      listStructureIssues,
    })
    throw new MinuteTemplateCompileError(
      buildMinuteTemplateCompileErrorMessage(issues),
      issues,
    )
  }
  const roundTrip = normalizeMinuteTemplateComparisonText(renderMinuteTemplateWithSampleValues(parsed))
  const expectedRoundTrip = normalizeMinuteTemplateComparisonText(normalizedText)
  const structuralRoundTrip = normalizeMinuteTemplateStructuralComparisonText(renderMinuteTemplateWithSampleValues(parsed))
  const structuralExpectedRoundTrip = normalizeMinuteTemplateStructuralComparisonText(normalizedText)
  const reparsedRoundTripNodes = parseMinuteTemplateNodesFromNormalizedText(
    buildNormalizedMinuteTemplateInputState(renderMinuteTemplateWithSampleValues(parsed)).normalizedTextWithMarkers,
    compileMode,
  )
  const semanticRoundTrip = buildMinuteTemplateStructuralSignature(reparsedRoundTripNodes)
  const semanticExpectedRoundTrip = buildMinuteTemplateStructuralSignature(parsed.nodes)
  if (
    roundTrip !== expectedRoundTrip
    && structuralRoundTrip !== structuralExpectedRoundTrip
    && semanticRoundTrip !== semanticExpectedRoundTrip
  ) {
    const issues = createMinuteTemplateCompileIssues({
      normalizedTextWithMarkers,
      parsedTemplate: parsed,
      listStructureIssues,
    })
    throw new MinuteTemplateCompileError(
      buildMinuteTemplateCompileErrorMessage(issues),
      issues,
    )
  }

  return parsed
}

function hashStoredMinuteTemplate(value: StoredMinuteTemplate) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function buildStoredMinuteTemplateData(
  input: string,
  options: MinuteTemplateCompileOptions = {},
): StoredMinuteTemplateData {
  const compiledTemplateJson = compileMinuteTemplateFromText(input, options)
  return {
    compiledTemplateJson,
    compiledTemplateVersion: compiledTemplateJson.version,
    compiledTemplateHash: hashStoredMinuteTemplate(compiledTemplateJson),
  }
}

export function buildLegacyStoredMinuteTemplateData(input: string): StoredMinuteTemplateData {
  const compiledTemplateJson: StoredMinuteTemplate = {
    kind: 'legacy_raw_text',
    version: MINUTE_TEMPLATE_VERSION,
    normalizedText: normalizeMinuteTemplateInput(input),
  }

  return {
    compiledTemplateJson,
    compiledTemplateVersion: MINUTE_TEMPLATE_VERSION,
    compiledTemplateHash: hashStoredMinuteTemplate(compiledTemplateJson),
  }
}

export function parseStoredMinuteTemplate(value: unknown) {
  const parsed = storedMinuteTemplateSchema.safeParse(value)
  if (!parsed.success) return null
  return parsed.data
}

export function getCompiledMinuteTemplate(value: unknown) {
  const parsed = parseStoredMinuteTemplate(value)
  if (!parsed || parsed.kind !== 'minute_template') return null
  return parsed
}

export function isCompiledMinuteTemplate(value: unknown) {
  return Boolean(getCompiledMinuteTemplate(value))
}
