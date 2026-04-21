import type {
  AgendaColumnDefinition,
  AgendaSyncPayload,
  AgendaSyncRowDraft,
} from '@/lib/agenda-columns'
import { normalizeAgendaCustomCells } from '@/lib/agenda-columns'
import type { Agenda } from '@/lib/supabase/types'

export interface AgendaSectionItem {
  id: string | null
  title: string
  presenter: string
  plannedTime: string
  attachedPdf: string | null
  customCells: Record<string, string>
}

export interface AgendaSection {
  id: string | null
  title: string
  presenter: string
  plannedTime: string
  attachedPdf: string | null
  customCells: Record<string, string>
  items: AgendaSectionItem[]
}

export interface AgendaPreviewRow {
  id: string
  agendaNo: string
  plannedTime: string
  title: string
  presenter: string
  level: 'section' | 'item'
}

export function isAgendaHeading(agendaNo: string | null | undefined) {
  const normalized = typeof agendaNo === 'string' ? agendaNo.trim() : ''
  if (!normalized) return false
  return normalized.endsWith('.0') || /^\d+$/.test(normalized)
}

function normalizeAgendaCellValue(value: string | null | undefined, placeholder: string) {
  const normalized = (value ?? '').trim()
  return normalized.toLowerCase() === placeholder.toLowerCase() ? '' : normalized
}

export function parseAgendaSections(agendas: Agenda[]): AgendaSection[] {
  if (agendas.length === 0) return []

  const sections: AgendaSection[] = []
  let current: AgendaSection | null = null

  for (const agenda of agendas) {
    const nextItem = {
      id: agenda.id,
      title: agenda.title,
      presenter: normalizeAgendaCellValue(agenda.presenter, 'Presenter'),
      plannedTime: normalizeAgendaCellValue(agenda.planned_time, 'Time'),
      attachedPdf: agenda.slide_pages,
      customCells: normalizeAgendaCustomCells(agenda.custom_cells),
    }

    if (isAgendaHeading(agenda.agenda_no)) {
      current = {
        ...nextItem,
        items: [],
      }
      sections.push(current)
      continue
    }

    if (!current) {
      current = {
        id: null,
        title: 'Agenda Items',
        presenter: '',
        plannedTime: '',
        attachedPdf: null,
        customCells: {},
        items: [],
      }
      sections.push(current)
    }

    current.items.push(nextItem)
  }

  return sections
}

function getRowValueForColumn(
  column: AgendaColumnDefinition,
  agendaNo: string,
  row: Pick<AgendaSection, 'title' | 'plannedTime' | 'presenter' | 'customCells'>,
) {
  if (column.kind === 'fixed' && column.fieldKey === 'agendaNo') return agendaNo
  if (column.kind === 'built_in' && column.fieldKey === 'title') return row.title
  if (column.kind === 'built_in' && column.fieldKey === 'plannedTime') return row.plannedTime
  if (column.kind === 'built_in' && column.fieldKey === 'presenter') return row.presenter
  if (column.kind === 'custom') return row.customCells[column.id] ?? ''
  return ''
}

export function toAgendaExportRows(sections: AgendaSection[], columnConfig: AgendaColumnDefinition[]) {
  const columns = columnConfig.map(column => column.label)
  const rows: string[][] = []

  sections.forEach((section, sectionIndex) => {
    rows.push([
      ...columnConfig.map(column => getRowValueForColumn(column, `${sectionIndex + 1}.0`, section)),
    ])

    section.items.forEach((item, itemIndex) => {
      rows.push([
        ...columnConfig.map(column => getRowValueForColumn(column, `${sectionIndex + 1}.${itemIndex + 1}`, item)),
      ])
    })
  })

  return { columns, rows }
}

function normalizeRowCustomCells(
  customCells: Record<string, string>,
  columnConfig: AgendaColumnDefinition[],
) {
  const allowedColumnIds = new Set(
    columnConfig
      .filter(column => column.kind === 'custom')
      .map(column => column.id),
  )

  const output: Record<string, string> = {}
  Object.entries(customCells).forEach(([key, value]) => {
    if (!allowedColumnIds.has(key)) return
    if (value.trim().length === 0) return
    output[key] = value
  })
  return output
}

export function toAgendaSyncRows(
  sections: AgendaSection[],
  columnConfig: AgendaColumnDefinition[],
): AgendaSyncPayload {
  const rows: AgendaSyncRowDraft[] = []

  sections.forEach((section, sectionIndex) => {
    rows.push({
      id: section.id,
      agendaNo: `${sectionIndex + 1}.0`,
      title: section.title,
      plannedTime: section.plannedTime,
      presenter: section.presenter,
      attachedPdf: section.attachedPdf,
      customCells: normalizeRowCustomCells(section.customCells, columnConfig),
    })

    section.items.forEach((item, itemIndex) => {
      rows.push({
        id: item.id,
        agendaNo: `${sectionIndex + 1}.${itemIndex + 1}`,
        title: item.title,
        plannedTime: item.plannedTime,
        presenter: item.presenter,
        attachedPdf: item.attachedPdf,
        customCells: normalizeRowCustomCells(item.customCells, columnConfig),
      })
    })
  })

  return {
    columnConfig: columnConfig.map((column, index) => ({ ...column, order: index })),
    rows,
  }
}

export function buildAgendaPreviewRows(agendas: Agenda[]): AgendaPreviewRow[] {
  return agendas.map(agenda => ({
    id: agenda.id,
    agendaNo: agenda.agenda_no,
    plannedTime: normalizeAgendaCellValue(agenda.planned_time, 'Time'),
    title: agenda.title,
    presenter: normalizeAgendaCellValue(agenda.presenter, 'Presenter'),
    level: isAgendaHeading(agenda.agenda_no) ? 'section' : 'item',
  }))
}
