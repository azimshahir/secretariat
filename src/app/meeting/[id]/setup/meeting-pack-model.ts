import type { Agenda } from '@/lib/supabase/types'

export const FIXED_BLOCK_IDS = ['front_page', 'confidentiality', 'end_notes'] as const
export type FixedBlockId = (typeof FIXED_BLOCK_IDS)[number]
export type TopLevelBlockId = FixedBlockId | `section:${string}` | `custom:${string}`

export interface MeetingPackConfig {
  version: 1
  topLevelOrder: TopLevelBlockId[]
  excludedTopLevelBlockIds: string[]
  fixedSections: {
    front_page: { pdfPath: string | null }
    confidentiality: { pdfPath: string | null }
    end_notes: { pdfPath: string | null }
  }
  customSections: Array<{
    id: string
    title: string
    pdfPath: string | null
  }>
  agendaPdfOverrides: Array<{
    agendaId: string
    pdfPath: string
  }>
  excludedAgendaIds: string[]
  includeBookmarks: boolean
  includeSectionDividerPages: boolean
  includeSubsectionDividerPages: boolean
  sectionDividerPdfPath: string | null
  subsectionDividerPdfPath: string | null
}

export interface AgendaPackSection {
  heading: Agenda
  items: Agenda[]
}

function toNonEmptyString(value: unknown) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function toNullablePath(value: unknown) {
  const parsed = toNonEmptyString(value)
  return parsed ?? null
}

function createCustomId(index: number) {
  return `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${index}`
}

function buildSectionBlockIds(agendas: Agenda[]): TopLevelBlockId[] {
  return groupAgendasForMeetingPack(agendas).map(
    section => `section:${section.heading.id}` as TopLevelBlockId,
  )
}

function buildDefaultTopLevelOrder(agendas: Agenda[], customSections: Array<{ id: string }>) {
  const sectionBlocks = buildSectionBlockIds(agendas)
  return [
    'front_page' as TopLevelBlockId,
    'confidentiality' as TopLevelBlockId,
    ...sectionBlocks,
    'end_notes' as TopLevelBlockId,
    ...customSections.map(section => `custom:${section.id}` as TopLevelBlockId),
  ]
}

export function createDefaultMeetingPackConfig(agendas: Agenda[]): MeetingPackConfig {
  return {
    version: 1,
    topLevelOrder: buildDefaultTopLevelOrder(agendas, []),
    excludedTopLevelBlockIds: [],
    fixedSections: {
      front_page: { pdfPath: null },
      confidentiality: { pdfPath: null },
      end_notes: { pdfPath: null },
    },
    customSections: [],
    agendaPdfOverrides: [],
    excludedAgendaIds: [],
    includeBookmarks: false,
    includeSectionDividerPages: false,
    includeSubsectionDividerPages: false,
    sectionDividerPdfPath: null,
    subsectionDividerPdfPath: null,
  }
}

export function isAgendaHeadingRow(agendaNo: string) {
  const normalized = agendaNo.trim()
  return normalized.endsWith('.0') || /^\d+$/.test(normalized)
}

export function groupAgendasForMeetingPack(agendas: Agenda[]): AgendaPackSection[] {
  const sections: AgendaPackSection[] = []
  let current: AgendaPackSection | null = null

  for (const agenda of agendas) {
    if (isAgendaHeadingRow(agenda.agenda_no) || !current) {
      current = { heading: agenda, items: [] }
      sections.push(current)
      continue
    }
    current.items.push(agenda)
  }

  return sections
}

export function normalizeMeetingPackConfig(raw: unknown, agendas: Agenda[]): MeetingPackConfig {
  const defaults = createDefaultMeetingPackConfig(agendas)
  const agendaIdSet = new Set(agendas.map(agenda => agenda.id))
  const headingIdSet = new Set(
    groupAgendasForMeetingPack(agendas).map(section => section.heading.id),
  )

  const source = raw && typeof raw === 'object'
    ? raw as Partial<MeetingPackConfig> & Record<string, unknown>
    : {}

  const rawCustomSections = Array.isArray(source.customSections) ? source.customSections : []
  const customSections: MeetingPackConfig['customSections'] = []
  const customIds = new Set<string>()

  rawCustomSections.forEach((item, index) => {
    if (!item || typeof item !== 'object') return
    const row = item as Record<string, unknown>
    let id = toNonEmptyString(row.id)
    if (!id) id = createCustomId(index + 1)
    if (customIds.has(id)) id = `${id}-${index + 1}`
    customIds.add(id)
    customSections.push({
      id,
      title: toNonEmptyString(row.title) ?? `Custom Section ${index + 1}`,
      pdfPath: toNullablePath(row.pdfPath),
    })
  })

  const allowedCustomBlockIds = new Set(customSections.map(section => `custom:${section.id}`))
  const sectionBlockIds = buildSectionBlockIds(agendas)
  const allowedSectionBlockIds = new Set(sectionBlockIds)

  const rawTopLevelOrder = Array.isArray(source.topLevelOrder) ? source.topLevelOrder : []
  const excludedTopLevelBlockIds = Array.isArray(source.excludedTopLevelBlockIds)
    ? source.excludedTopLevelBlockIds
        .map(value => toNonEmptyString(value))
        .filter((value): value is string => Boolean(value))
    : []
  const excludedTopLevelBlockSet = new Set(excludedTopLevelBlockIds)
  const normalizedTopLevelOrder: TopLevelBlockId[] = []
  const seen = new Set<string>()

  rawTopLevelOrder.forEach(value => {
    if (typeof value !== 'string' || seen.has(value)) return

    // Backward compat: expand old 'agenda' block into individual section:* entries
    if ((value as string) === 'agenda') {
      sectionBlockIds.forEach(sectionBlock => {
        if (!seen.has(sectionBlock) && !excludedTopLevelBlockSet.has(sectionBlock)) {
          seen.add(sectionBlock)
          normalizedTopLevelOrder.push(sectionBlock)
        }
      })
      return
    }

    if (
      (FIXED_BLOCK_IDS as readonly string[]).includes(value)
      || allowedSectionBlockIds.has(value as TopLevelBlockId)
      || allowedCustomBlockIds.has(value)
    ) {
      seen.add(value)
      normalizedTopLevelOrder.push(value as TopLevelBlockId)
    }
  })

  // Append any missing blocks from the default order
  const fallbackOrder = buildDefaultTopLevelOrder(agendas, customSections)
  fallbackOrder.forEach(block => {
    if (!seen.has(block) && !excludedTopLevelBlockSet.has(block)) {
      seen.add(block)
      normalizedTopLevelOrder.push(block)
    }
  })

  // Remove section:* entries for deleted agendas
  const cleanedOrder = normalizedTopLevelOrder.filter(block => {
    if (block.startsWith('section:')) {
      return headingIdSet.has(block.slice('section:'.length))
    }
    return true
  })

  const fixedSource = source.fixedSections && typeof source.fixedSections === 'object'
    ? source.fixedSections as Record<string, unknown>
    : {}

  const agendaOverrideSource = Array.isArray(source.agendaPdfOverrides) ? source.agendaPdfOverrides : []
  const agendaOverrideMap = new Map<string, string>()
  agendaOverrideSource.forEach(item => {
    if (!item || typeof item !== 'object') return
    const row = item as Record<string, unknown>
    const agendaId = toNonEmptyString(row.agendaId)
    const pdfPath = toNonEmptyString(row.pdfPath)
    if (!agendaId || !pdfPath || !agendaIdSet.has(agendaId)) return
    agendaOverrideMap.set(agendaId, pdfPath)
  })

  const excludedAgendaIds = Array.isArray(source.excludedAgendaIds)
    ? source.excludedAgendaIds
        .map(value => toNonEmptyString(value))
        .filter((value): value is string => Boolean(value && agendaIdSet.has(value)))
    : []

  return {
    version: 1,
    topLevelOrder: cleanedOrder,
    excludedTopLevelBlockIds,
    fixedSections: {
      front_page: {
        pdfPath: toNullablePath((fixedSource.front_page as Record<string, unknown> | undefined)?.pdfPath)
          ?? defaults.fixedSections.front_page.pdfPath,
      },
      confidentiality: {
        pdfPath: toNullablePath((fixedSource.confidentiality as Record<string, unknown> | undefined)?.pdfPath)
          ?? defaults.fixedSections.confidentiality.pdfPath,
      },
      end_notes: {
        pdfPath: toNullablePath((fixedSource.end_notes as Record<string, unknown> | undefined)?.pdfPath)
          ?? defaults.fixedSections.end_notes.pdfPath,
      },
    },
    customSections,
    agendaPdfOverrides: Array.from(agendaOverrideMap.entries()).map(([agendaId, pdfPath]) => ({ agendaId, pdfPath })),
    excludedAgendaIds,
    includeBookmarks: typeof source.includeBookmarks === 'boolean'
      ? source.includeBookmarks
      : defaults.includeBookmarks,
    includeSectionDividerPages: typeof source.includeSectionDividerPages === 'boolean'
      ? source.includeSectionDividerPages
      : defaults.includeSectionDividerPages,
    includeSubsectionDividerPages: typeof source.includeSubsectionDividerPages === 'boolean'
      ? source.includeSubsectionDividerPages
      : defaults.includeSubsectionDividerPages,
    sectionDividerPdfPath: toNullablePath(source.sectionDividerPdfPath) ?? defaults.sectionDividerPdfPath,
    subsectionDividerPdfPath: toNullablePath(source.subsectionDividerPdfPath) ?? defaults.subsectionDividerPdfPath,
  }
}
