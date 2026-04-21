import type { DatabaseClient } from './shared'
import type { AppliedMinuteMemoryTraceItem } from './types'

export const MINUTE_MIND_SCOPE_TYPES = ['agenda', 'meeting', 'committee'] as const
export const MINUTE_MIND_ENTRY_TYPES = [
  'formatting_rule',
  'writing_preference',
  'committee_fact',
  'exception',
] as const

export type MinuteMindScopeType = (typeof MINUTE_MIND_SCOPE_TYPES)[number]
export type MinuteMindEntryType = (typeof MINUTE_MIND_ENTRY_TYPES)[number]

type SupabaseLike = Pick<DatabaseClient, 'from'>
const RULE_ENTRY_TYPES: MinuteMindEntryType[] = ['writing_preference', 'exception']
const MINUTE_MEMORY_STOPWORDS = new Set([
  'this',
  'that',
  'these',
  'those',
  'with',
  'from',
  'into',
  'onto',
  'under',
  'over',
  'your',
  'their',
  'there',
  'should',
  'would',
  'could',
  'must',
  'need',
  'have',
  'has',
  'had',
  'were',
  'been',
  'being',
  'into',
  'than',
  'then',
  'only',
  'also',
  'just',
  'like',
  'same',
  'such',
  'very',
  'more',
  'most',
  'each',
  'line',
  'lines',
  'slot',
  'slots',
  'list',
  'lists',
  'minute',
  'minutes',
  'meeting',
  'future',
  'remember',
  'format',
  'formatting',
  'template',
  'section',
  'sections',
  'agenda',
  'beginning',
  'opening',
  'noted',
  'discussed',
  'resolved',
  'paper',
  'details',
  'presented',
  'purpose',
  'executive',
  'summary',
  'approval',
  'note',
  'seek',
  'taken',
  'usually',
  'part',
  'shouldnt',
  'dont',
  'dont',
  'need',
])
const FORMATTER_OPENING_PATTERNS = [
  /\bat the beginning\b/i,
  /\bbeginning of the minute\b/i,
  /\bbeginning of minute\b/i,
  /\bopening lines?\b/i,
  /\bopening paragraph\b/i,
  /\bopening sentence\b/i,
  /\btop of the minute\b/i,
  /\bstart of the minute\b/i,
]

export type MinuteFormatterSectionHint = 'noted' | 'discussed' | 'noted_discussed' | 'resolved'

export interface MinuteFormatterTarget {
  exactAgendaNos: string[]
  agendaFamilies: string[]
  sectionHints: MinuteFormatterSectionHint[]
  openingOnly: boolean
}

export interface MinuteFormatterRule {
  entryId: string
  scopeType: MinuteMindScopeType
  title: string
  content: string
  target: MinuteFormatterTarget
}

export interface MinuteApplicableMemoryEntry extends MinuteMindEntryRecord {
  normalizedEntryType: MinuteMindEntryType
  target: MinuteFormatterTarget
  keywords: string[]
  matchedKeywords: string[]
  matchScore: number
}

export interface MinuteFormatterMatchContext {
  agendaNo: string
  sectionHint?: MinuteFormatterSectionHint | null
  entryKind: 'slot' | 'list'
  entryIndex: number
  sectionEntryIndex: number
}

export interface MinuteMindEntryRecord {
  id: string
  organizationId: string
  committeeId: string | null
  meetingId: string | null
  agendaId: string | null
  scopeType: MinuteMindScopeType
  source: 'chat' | 'settings'
  entryType: MinuteMindEntryType
  title: string
  content: string
  appliesToGeneration: boolean
  appliesToChat: boolean
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export function isMinuteMindScopeType(value: string): value is MinuteMindScopeType {
  return (MINUTE_MIND_SCOPE_TYPES as readonly string[]).includes(value)
}

export function isMinuteMindEntryType(value: string): value is MinuteMindEntryType {
  return (MINUTE_MIND_ENTRY_TYPES as readonly string[]).includes(value)
}

export function getMinuteMindScopeLabel(scope: MinuteMindScopeType) {
  if (scope === 'agenda') return 'Agenda'
  if (scope === 'meeting') return 'Meeting'
  return 'Committee'
}

export function getMinuteMindEntryTypeLabel(entryType: MinuteMindEntryType) {
  if (entryType === 'formatting_rule') return 'Formatting Rule'
  if (entryType === 'writing_preference') return 'Writing Preference'
  if (entryType === 'committee_fact') return 'Committee Fact'
  return 'Exception'
}

export function sortMinuteMindEntries(entries: MinuteMindEntryRecord[]) {
  const scopeWeight: Record<MinuteMindScopeType, number> = {
    agenda: 0,
    meeting: 1,
    committee: 2,
  }

  return [...entries].sort((left, right) => {
    const scopeDiff = scopeWeight[left.scopeType] - scopeWeight[right.scopeType]
    if (scopeDiff !== 0) return scopeDiff
    return right.updatedAt.localeCompare(left.updatedAt)
  })
}

export interface MinuteMindCompilation {
  hardRulesBlock?: string
  committeeFactsBlock?: string
  formatterRuleBlock?: string
  formatterRules: MinuteFormatterRule[]
  allInstructionBlock?: string
}

export interface ApplicableMinuteMindCompilation extends MinuteMindCompilation {
  applicableEntries: MinuteApplicableMemoryEntry[]
  appliedTrace: AppliedMinuteMemoryTraceItem[]
}

function buildMinuteMindCombinedText(title: string | null | undefined, content: string | null | undefined) {
  return [title?.trim(), content?.trim()].filter(Boolean).join('\n')
}

export function looksLikeMinuteFormattingRule(params: {
  title?: string | null
  content: string
}) {
  const combined = buildMinuteMindCombinedText(params.title, params.content)
  const normalized = combined.toLowerCase()
  if (!normalized.trim()) return false

  if (FORMATTER_OPENING_PATTERNS.some(pattern => pattern.test(combined))) {
    return true
  }

  if (
    /\bthe paper was presented by\b/i.test(combined)
    || /\bthe purpose of the paper is\b/i.test(combined)
    || /\bthe details of the paper were as presented\b/i.test(combined)
  ) {
    return true
  }

  let signalCount = 0

  if (/\bformat(?:ting)?\b|\btemplate\b|\bprevious minute\b|\breusable formatter\b/i.test(combined)) {
    signalCount += 1
  }
  if (/\bnoted\s*(?:&|and)\s*discussed\b|\bresolved\b|\bdiscussion\b|\bdiscussed\b|\bnoted\b/i.test(combined)) {
    signalCount += 1
  }
  if (/\baction by\b|\bactions?\s*:|\bpic\b|\bowner\b|\bdue date\b|\bdeadline\b/i.test(combined)) {
    signalCount += 1
  }
  if (/^\s*\[(.+?)\]\s*$/m.test(combined)) {
    signalCount += 1
  }
  if (params.content.includes('\n')) {
    signalCount += 1
  }

  return signalCount >= 2
}

export function inferMinuteMindEntryTypeFromText(params: {
  title?: string | null
  content: string
  existingEntryType?: MinuteMindEntryType | null
}) {
  if (params.existingEntryType === 'committee_fact' || params.existingEntryType === 'exception') {
    return params.existingEntryType
  }

  if (looksLikeMinuteFormattingRule({ title: params.title, content: params.content })) {
    return 'formatting_rule' as const
  }

  if (params.existingEntryType === 'formatting_rule') {
    return 'formatting_rule' as const
  }

  return (params.existingEntryType ?? 'writing_preference') as MinuteMindEntryType
}

export function inferMinuteFormatterSectionHint(value: string | null | undefined): MinuteFormatterSectionHint | null {
  const text = value?.trim()
  if (!text) return null
  if (/\bnoted\s*(?:&|and)\s*discussed\b/i.test(text)) return 'noted_discussed'
  if (/\bresolved\b/i.test(text)) return 'resolved'
  if (/\bdiscussion\b|\bdiscussed\b/i.test(text)) return 'discussed'
  if (/\bnoted\b/i.test(text)) return 'noted'
  return null
}

function parseMinuteFormatterTarget(entry: MinuteMindEntryRecord): MinuteFormatterTarget {
  const combined = buildMinuteMindCombinedText(entry.title, entry.content)
  const agendaFamilies = new Set<string>()
  const exactAgendaNos = new Set<string>()
  const sectionHints = new Set<MinuteFormatterSectionHint>()

  const rangePattern = /\b(\d+)\.0\s*(?:-|to|hingga|until)\s*(\d+)\.0\b/gi
  let rangeMatch: RegExpExecArray | null
  while ((rangeMatch = rangePattern.exec(combined)) !== null) {
    const start = Number.parseInt(rangeMatch[1] ?? '', 10)
    const end = Number.parseInt(rangeMatch[2] ?? '', 10)
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue
    const lower = Math.min(start, end)
    const upper = Math.max(start, end)
    if (upper - lower > 24) continue
    for (let current = lower; current <= upper; current += 1) {
      agendaFamilies.add(String(current))
    }
  }

  const agendaPattern = /\b(\d+\.\d+)\b/g
  let agendaMatch: RegExpExecArray | null
  while ((agendaMatch = agendaPattern.exec(combined)) !== null) {
    const agendaNo = agendaMatch[1]
    if (!agendaNo) continue
    if (agendaNo.endsWith('.0')) {
      agendaFamilies.add(agendaNo.split('.')[0] ?? agendaNo)
    } else {
      exactAgendaNos.add(agendaNo)
    }
  }

  const combinedSectionHint = inferMinuteFormatterSectionHint(combined)
  if (combinedSectionHint) {
    sectionHints.add(combinedSectionHint)
  }
  if (/\bnoted\s*(?:&|and)\s*discussed\b/i.test(combined)) {
    sectionHints.add('noted_discussed')
  }
  if (/\bresolved\b/i.test(combined)) {
    sectionHints.add('resolved')
  }
  if (/\bdiscussion\b|\bdiscussed\b/i.test(combined) && !sectionHints.has('noted_discussed')) {
    sectionHints.add('discussed')
  }
  if (/\bnoted\b/i.test(combined) && !sectionHints.has('noted_discussed')) {
    sectionHints.add('noted')
  }

  return {
    exactAgendaNos: Array.from(exactAgendaNos),
    agendaFamilies: Array.from(agendaFamilies),
    sectionHints: Array.from(sectionHints),
    openingOnly: FORMATTER_OPENING_PATTERNS.some(pattern => pattern.test(combined)),
  }
}

function extractMinuteMemoryKeywords(entry: {
  title?: string | null
  content: string
}) {
  const combined = buildMinuteMindCombinedText(entry.title, entry.content)
    .replace(/\[[^\]]+\]/g, ' ')
    .toLowerCase()
  if (!combined.trim()) return []

  const tokens = combined.match(/[a-z0-9][a-z0-9&/-]{2,}/g) ?? []
  const seen = new Set<string>()
  const keywords: string[] = []

  for (const token of tokens) {
    const normalized = token.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
    if (!normalized) continue
    if (/^\d+(?:\.\d+)?$/.test(normalized)) continue
    if (MINUTE_MEMORY_STOPWORDS.has(normalized)) continue
    if (seen.has(normalized)) continue
    seen.add(normalized)
    keywords.push(normalized)
    if (keywords.length >= 12) break
  }

  return keywords
}

function buildMinuteMemoryKeywordSet(values: Array<string | null | undefined>) {
  const keywordSet = new Set<string>()

  for (const value of values) {
    if (!value?.trim()) continue
    for (const keyword of extractMinuteMemoryKeywords({ content: value, title: null })) {
      keywordSet.add(keyword)
    }
  }

  return keywordSet
}

function classifyMinuteMindEntries(
  entries: MinuteMindEntryRecord[],
  mode: 'generation' | 'chat',
) {
  const relevantEntries = sortMinuteMindEntries(
    entries.filter(entry => (
      entry.isActive
      && (mode === 'generation' ? entry.appliesToGeneration : entry.appliesToChat)
    )),
  )

  return relevantEntries.map(entry => {
    const normalizedEntryType = inferMinuteMindEntryTypeFromText({
      title: entry.title,
      content: entry.content,
      existingEntryType: entry.entryType,
    })

    return {
      ...entry,
      normalizedEntryType,
      target: parseMinuteFormatterTarget(entry),
      keywords: extractMinuteMemoryKeywords(entry),
      matchedKeywords: [],
      matchScore: 0,
    } satisfies MinuteApplicableMemoryEntry
  })
}

function buildApplicableMinuteMemoryTrace(
  entries: MinuteApplicableMemoryEntry[],
): AppliedMinuteMemoryTraceItem[] {
  return entries.map(entry => ({
    entryId: entry.id,
    scopeType: entry.scopeType,
    entryType: entry.normalizedEntryType,
    title: entry.title,
    matchedKeywords: entry.matchedKeywords,
    matchedSectionHints: entry.target.sectionHints,
    openingOnly: entry.target.openingOnly,
    appliedAs: [
      entry.normalizedEntryType === 'formatting_rule'
        ? 'formatter_prompt'
        : entry.normalizedEntryType === 'committee_fact'
          ? 'fact_prompt'
          : entry.normalizedEntryType === 'exception'
            ? 'exception_prompt'
            : 'style_prompt',
    ],
  }))
}

function summarizeMinuteFormatterTarget(target: MinuteFormatterTarget) {
  const parts: string[] = []

  if (target.exactAgendaNos.length > 0 || target.agendaFamilies.length > 0) {
    const agendaLabels = [
      ...target.exactAgendaNos.map(agendaNo => `Agenda ${agendaNo}`),
      ...target.agendaFamilies.map(major => `Agenda ${major}.x`),
    ]
    parts.push(`targets ${agendaLabels.join(', ')}`)
  }

  if (target.sectionHints.length > 0) {
    const sectionLabels = target.sectionHints.map(section => {
      if (section === 'noted_discussed') return 'NOTED & DISCUSSED'
      if (section === 'resolved') return 'RESOLVED'
      if (section === 'discussed') return 'DISCUSSION'
      return 'NOTED'
    })
    parts.push(`sections ${sectionLabels.join(', ')}`)
  }

  if (target.openingOnly) {
    parts.push('opening lines only')
  }

  return parts.join('; ')
}

function renderMinuteFormatterSections(
  rules: MinuteFormatterRule[],
  sectionTitles: Record<MinuteMindScopeType, string>,
) {
  if (rules.length === 0) return undefined

  const grouped = {
    agenda: rules.filter(rule => rule.scopeType === 'agenda'),
    meeting: rules.filter(rule => rule.scopeType === 'meeting'),
    committee: rules.filter(rule => rule.scopeType === 'committee'),
  }

  const sections: Array<[string, MinuteFormatterRule[]]> = [
    [sectionTitles.agenda, grouped.agenda],
    [sectionTitles.meeting, grouped.meeting],
    [sectionTitles.committee, grouped.committee],
  ].filter((section): section is [string, MinuteFormatterRule[]] => section[1].length > 0)

  if (sections.length === 0) return undefined

  return sections
    .map(([label, items]) => (
      `${label}:\n${items.map(item => {
        const targetSummary = summarizeMinuteFormatterTarget(item.target)
        const titleSuffix = targetSummary ? ` (${targetSummary})` : ''
        return `- [Formatting Rule] ${item.title}${titleSuffix}: ${item.content}`
      }).join('\n')}`
    ))
    .join('\n\n')
}

export function buildMinuteFormatterRuleBlock(rules: MinuteFormatterRule[]) {
  return renderMinuteFormatterSections(
    rules,
    {
      agenda: 'AGENDA REUSABLE FORMATTERS',
      meeting: 'MEETING REUSABLE FORMATTERS',
      committee: 'COMMITTEE REUSABLE FORMATTERS',
    },
  )
}

function ruleMatchesAgendaNo(rule: MinuteFormatterRule, agendaNo: string) {
  if (rule.target.exactAgendaNos.length === 0 && rule.target.agendaFamilies.length === 0) {
    return true
  }

  if (rule.target.exactAgendaNos.includes(agendaNo)) {
    return true
  }

  const agendaMajor = agendaNo.match(/^(\d+)(?:\.|$)/)?.[1]
  if (!agendaMajor) return false
  return rule.target.agendaFamilies.includes(agendaMajor)
}

function ruleMatchesSection(
  rule: MinuteFormatterRule,
  sectionHint: MinuteFormatterSectionHint | null | undefined,
) {
  if (rule.target.sectionHints.length === 0) {
    return true
  }
  if (!sectionHint) {
    return false
  }
  if (rule.target.sectionHints.includes(sectionHint)) {
    return true
  }

  return rule.target.sectionHints.includes('noted_discussed')
    && (sectionHint === 'noted' || sectionHint === 'discussed')
}

export function minuteFormatterRuleAppliesToContext(
  rule: MinuteFormatterRule,
  context: MinuteFormatterMatchContext,
) {
  if (!ruleMatchesAgendaNo(rule, context.agendaNo)) {
    return false
  }
  if (!ruleMatchesSection(rule, context.sectionHint)) {
    return false
  }
  if (!rule.target.openingOnly) {
    return true
  }
  if (context.entryKind !== 'slot') {
    return false
  }

  const positionIndex = rule.target.sectionHints.length > 0
    ? context.sectionEntryIndex
    : context.entryIndex

  return positionIndex < 3
}

function renderMinuteMindSections(
  entries: Array<Pick<MinuteMindEntryRecord, 'scopeType' | 'title' | 'content'> & {
    entryType: MinuteMindEntryType
  }>,
  sectionTitles: Record<MinuteMindScopeType, string>,
) {
  if (entries.length === 0) return undefined

  const grouped = {
    agenda: entries.filter(entry => entry.scopeType === 'agenda'),
    meeting: entries.filter(entry => entry.scopeType === 'meeting'),
    committee: entries.filter(entry => entry.scopeType === 'committee'),
  }

  const sections: Array<[string, typeof entries]> = [
    [sectionTitles.agenda, grouped.agenda],
    [sectionTitles.meeting, grouped.meeting],
    [sectionTitles.committee, grouped.committee],
  ].filter((section): section is [string, typeof entries] => section[1].length > 0)

  if (sections.length === 0) return undefined

  return sections
    .map(([label, items]) => (
      `${label}:\n${items.map(item => `- [${getMinuteMindEntryTypeLabel(item.entryType)}] ${item.title}: ${item.content}`).join('\n')}`
    ))
    .join('\n\n')
}

export function compileMinuteMindContext(
  entries: MinuteMindEntryRecord[],
  mode: 'generation' | 'chat',
) {
  const classifiedEntries = classifyMinuteMindEntries(entries, mode)

  if (classifiedEntries.length === 0) {
    return {
      formatterRules: [],
    } satisfies MinuteMindCompilation
  }

  const hardRuleEntries = classifiedEntries
    .filter(entry => RULE_ENTRY_TYPES.includes(entry.normalizedEntryType))
    .map(entry => ({
      ...entry,
      entryType: entry.normalizedEntryType,
    }))
  const committeeFactEntries = classifiedEntries
    .filter(entry => entry.normalizedEntryType === 'committee_fact')
    .map(entry => ({
      ...entry,
      entryType: entry.normalizedEntryType,
    }))
  const formatterRules = classifiedEntries
    .filter(entry => entry.normalizedEntryType === 'formatting_rule')
    .map(entry => ({
      entryId: entry.id,
      scopeType: entry.scopeType,
      title: entry.title,
      content: entry.content,
      target: parseMinuteFormatterTarget(entry),
    } satisfies MinuteFormatterRule))

  const hardRulesBlock = renderMinuteMindSections(
    hardRuleEntries,
    {
      agenda: 'AGENDA MIND HARD RULES',
      meeting: 'MEETING MIND HARD RULES',
      committee: 'COMMITTEE MIND HARD RULES',
    },
  )

  const committeeFactsBlock = renderMinuteMindSections(
    committeeFactEntries,
    {
      agenda: 'AGENDA MIND STANDING FACTS',
      meeting: 'MEETING MIND STANDING FACTS',
      committee: 'COMMITTEE MIND STANDING FACTS',
    },
  )

  const formatterRuleBlock = buildMinuteFormatterRuleBlock(formatterRules)

  const allInstructionBlock = [
    formatterRuleBlock,
    hardRulesBlock,
    committeeFactsBlock,
  ]
    .filter(Boolean)
    .join('\n\n')

  return {
    hardRulesBlock,
    committeeFactsBlock,
    formatterRuleBlock,
    formatterRules,
    allInstructionBlock: allInstructionBlock || undefined,
  } satisfies MinuteMindCompilation
}

export function resolveApplicableMinuteMemory(params: {
  entries: MinuteMindEntryRecord[]
  agendaNo: string
  agendaTitle: string
  additionalInfo?: string | null
  templateStructureText?: string | null
  paperSummary?: string | null
}) {
  const classifiedEntries = classifyMinuteMindEntries(params.entries, 'generation')
  if (classifiedEntries.length === 0) {
    return {
      formatterRules: [],
      applicableEntries: [],
      appliedTrace: [],
    } satisfies ApplicableMinuteMindCompilation
  }

  const keywordSet = buildMinuteMemoryKeywordSet([
    params.agendaTitle,
    params.additionalInfo,
    params.templateStructureText,
    params.paperSummary,
  ])
  const scopeWeight: Record<MinuteMindScopeType, number> = {
    agenda: 300,
    meeting: 200,
    committee: 100,
  }

  const applicableEntries = classifiedEntries
    .flatMap(entry => {
      if (
        entry.target.exactAgendaNos.length > 0
        || entry.target.agendaFamilies.length > 0
      ) {
        if (!ruleMatchesAgendaNo({
          entryId: entry.id,
          scopeType: entry.scopeType,
          title: entry.title,
          content: entry.content,
          target: entry.target,
        }, params.agendaNo)) {
          return []
        }
      }

      const matchedKeywords = entry.keywords.filter(keyword => keywordSet.has(keyword))
      const requiresKeywordMatch = entry.normalizedEntryType === 'formatting_rule'
        && entry.keywords.length > 0
        && entry.target.exactAgendaNos.length === 0
        && entry.target.agendaFamilies.length === 0
        && entry.target.sectionHints.length === 0
        && !entry.target.openingOnly

      if (requiresKeywordMatch && matchedKeywords.length === 0) {
        return []
      }

      return [{
        ...entry,
        matchedKeywords,
        matchScore: scopeWeight[entry.scopeType]
          + matchedKeywords.length * 12
          + (entry.target.exactAgendaNos.length > 0 ? 50 : 0)
          + (entry.target.agendaFamilies.length > 0 ? 30 : 0)
          + (entry.target.sectionHints.length > 0 ? 10 : 0)
          + (entry.target.openingOnly ? 8 : 0),
      }]
    })
    .sort((left, right) => {
      const scoreDiff = right.matchScore - left.matchScore
      if (scoreDiff !== 0) return scoreDiff
      return right.updatedAt.localeCompare(left.updatedAt)
    })

  if (applicableEntries.length === 0) {
    return {
      formatterRules: [],
      applicableEntries: [],
      appliedTrace: [],
    } satisfies ApplicableMinuteMindCompilation
  }

  const hardRuleEntries = applicableEntries
    .filter(entry => RULE_ENTRY_TYPES.includes(entry.normalizedEntryType))
    .map(entry => ({
      ...entry,
      entryType: entry.normalizedEntryType,
    }))
  const committeeFactEntries = applicableEntries
    .filter(entry => entry.normalizedEntryType === 'committee_fact')
    .map(entry => ({
      ...entry,
      entryType: entry.normalizedEntryType,
    }))
  const formatterRules = applicableEntries
    .filter(entry => entry.normalizedEntryType === 'formatting_rule')
    .map(entry => ({
      entryId: entry.id,
      scopeType: entry.scopeType,
      title: entry.title,
      content: entry.content,
      target: entry.target,
    } satisfies MinuteFormatterRule))

  const hardRulesBlock = renderMinuteMindSections(
    hardRuleEntries,
    {
      agenda: 'AGENDA MIND HARD RULES',
      meeting: 'MEETING MIND HARD RULES',
      committee: 'COMMITTEE MIND HARD RULES',
    },
  )

  const committeeFactsBlock = renderMinuteMindSections(
    committeeFactEntries,
    {
      agenda: 'AGENDA MIND STANDING FACTS',
      meeting: 'MEETING MIND STANDING FACTS',
      committee: 'COMMITTEE MIND STANDING FACTS',
    },
  )

  const formatterRuleBlock = buildMinuteFormatterRuleBlock(formatterRules)
  const allInstructionBlock = [
    formatterRuleBlock,
    hardRulesBlock,
    committeeFactsBlock,
  ]
    .filter(Boolean)
    .join('\n\n')

  return {
    hardRulesBlock,
    committeeFactsBlock,
    formatterRuleBlock,
    formatterRules,
    allInstructionBlock: allInstructionBlock || undefined,
    applicableEntries,
    appliedTrace: buildApplicableMinuteMemoryTrace(applicableEntries),
  } satisfies ApplicableMinuteMindCompilation
}

export function buildMinuteMindPromptBlock(
  entries: MinuteMindEntryRecord[],
  mode: 'generation' | 'chat',
) {
  return compileMinuteMindContext(entries, mode).allInstructionBlock
}

export async function listMinuteMindEntriesForScope(params: {
  supabase: SupabaseLike
  organizationId: string
  committeeId?: string | null
  meetingId?: string | null
  agendaId?: string | null
}): Promise<MinuteMindEntryRecord[]> {
  const filters: string[] = []
  if (params.agendaId) filters.push(`agenda_id.eq.${params.agendaId}`)
  if (params.meetingId) filters.push(`meeting_id.eq.${params.meetingId}`)
  if (params.committeeId) filters.push(`committee_id.eq.${params.committeeId}`)

  if (filters.length === 0) return [] as MinuteMindEntryRecord[]

  const query = params.supabase
    .from('minute_mind_entries')
    .select(`
      id,
      organization_id,
      committee_id,
      meeting_id,
      agenda_id,
      scope_type,
      source,
      entry_type,
      title,
      content,
      applies_to_generation,
      applies_to_chat,
      is_active,
      created_at,
      updated_at
    `)
    .eq('organization_id', params.organizationId)
    .or(filters.join(','))

  const { data, error } = await query.order('updated_at', { ascending: false })
  if (error) {
    throw new Error(error.message)
  }

  return (data ?? [])
    .filter(row => isMinuteMindScopeType(row.scope_type) && isMinuteMindEntryType(row.entry_type))
    .map(row => ({
      id: row.id,
      organizationId: row.organization_id,
      committeeId: row.committee_id,
      meetingId: row.meeting_id,
      agendaId: row.agenda_id,
      scopeType: row.scope_type,
      source: row.source === 'settings' ? 'settings' : 'chat',
      entryType: row.entry_type,
      title: row.title,
      content: row.content,
      appliesToGeneration: Boolean(row.applies_to_generation),
      appliesToChat: Boolean(row.applies_to_chat),
      isActive: Boolean(row.is_active),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    } satisfies MinuteMindEntryRecord))
}

export async function createMinuteMindEntry(params: {
  supabase: SupabaseLike
  organizationId: string
  committeeId?: string | null
  meetingId?: string | null
  agendaId?: string | null
  scopeType: MinuteMindScopeType
  source: 'chat' | 'settings'
  entryType: MinuteMindEntryType
  title: string
  content: string
  appliesToGeneration: boolean
  appliesToChat: boolean
  isActive: boolean
  createdBy?: string | null
}) {
  const { data, error } = await params.supabase
    .from('minute_mind_entries')
    .insert({
      organization_id: params.organizationId,
      committee_id: params.committeeId ?? null,
      meeting_id: params.meetingId ?? null,
      agenda_id: params.agendaId ?? null,
      scope_type: params.scopeType,
      source: params.source,
      entry_type: params.entryType,
      title: params.title,
      content: params.content,
      applies_to_generation: params.appliesToGeneration,
      applies_to_chat: params.appliesToChat,
      is_active: params.isActive,
      created_by: params.createdBy ?? null,
    })
    .select(`
      id,
      organization_id,
      committee_id,
      meeting_id,
      agenda_id,
      scope_type,
      source,
      entry_type,
      title,
      content,
      applies_to_generation,
      applies_to_chat,
      is_active,
      created_at,
      updated_at
    `)
    .single()

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to save minute mind entry')
  }

  return {
    id: data.id,
    organizationId: data.organization_id,
    committeeId: data.committee_id,
    meetingId: data.meeting_id,
    agendaId: data.agenda_id,
    scopeType: data.scope_type,
    source: data.source === 'settings' ? 'settings' : 'chat',
    entryType: data.entry_type,
    title: data.title,
    content: data.content,
    appliesToGeneration: Boolean(data.applies_to_generation),
    appliesToChat: Boolean(data.applies_to_chat),
    isActive: Boolean(data.is_active),
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  } satisfies MinuteMindEntryRecord
}

export async function updateMinuteMindEntry(params: {
  supabase: SupabaseLike
  entryId: string
  title: string
  content: string
  entryType: MinuteMindEntryType
  appliesToGeneration: boolean
  appliesToChat: boolean
  isActive: boolean
}) {
  const { data, error } = await params.supabase
    .from('minute_mind_entries')
    .update({
      title: params.title,
      content: params.content,
      entry_type: params.entryType,
      applies_to_generation: params.appliesToGeneration,
      applies_to_chat: params.appliesToChat,
      is_active: params.isActive,
    })
    .eq('id', params.entryId)
    .select(`
      id,
      organization_id,
      committee_id,
      meeting_id,
      agenda_id,
      scope_type,
      source,
      entry_type,
      title,
      content,
      applies_to_generation,
      applies_to_chat,
      is_active,
      created_at,
      updated_at
    `)
    .single()

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to update minute mind entry')
  }

  return {
    id: data.id,
    organizationId: data.organization_id,
    committeeId: data.committee_id,
    meetingId: data.meeting_id,
    agendaId: data.agenda_id,
    scopeType: data.scope_type,
    source: data.source === 'settings' ? 'settings' : 'chat',
    entryType: data.entry_type,
    title: data.title,
    content: data.content,
    appliesToGeneration: Boolean(data.applies_to_generation),
    appliesToChat: Boolean(data.applies_to_chat),
    isActive: Boolean(data.is_active),
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  } satisfies MinuteMindEntryRecord
}

export async function deleteMinuteMindEntry(params: {
  supabase: SupabaseLike
  entryId: string
}) {
  const { error } = await params.supabase
    .from('minute_mind_entries')
    .delete()
    .eq('id', params.entryId)

  if (error) {
    throw new Error(error.message)
  }
}
