export type AgendaBuiltInFieldKey = 'agendaNo' | 'title' | 'plannedTime' | 'presenter'
export type AgendaColumnKind = 'fixed' | 'built_in' | 'custom'

export interface AgendaColumnDefinition {
  id: string
  label: string
  kind: AgendaColumnKind
  fieldKey?: AgendaBuiltInFieldKey
  order: number
}

export interface AgendaSyncRowDraft {
  id?: string | null
  agendaNo: string
  title: string
  plannedTime: string
  presenter: string
  attachedPdf: string | null
  customCells: Record<string, string>
}

export interface AgendaSyncPayload {
  columnConfig: AgendaColumnDefinition[]
  rows: AgendaSyncRowDraft[]
}

const DEFAULT_CORE_COLUMNS: AgendaColumnDefinition[] = [
  { id: 'agendaNo', label: 'No.', kind: 'fixed', fieldKey: 'agendaNo', order: 0 },
  { id: 'title', label: 'Agenda Item', kind: 'built_in', fieldKey: 'title', order: 1 },
  { id: 'plannedTime', label: 'Time', kind: 'built_in', fieldKey: 'plannedTime', order: 2 },
  { id: 'presenter', label: 'Presenter', kind: 'built_in', fieldKey: 'presenter', order: 3 },
]

const DEFAULT_LABEL_BY_FIELD: Record<AgendaBuiltInFieldKey, string> = {
  agendaNo: 'No.',
  title: 'Agenda Item',
  plannedTime: 'Time',
  presenter: 'Presenter',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAgendaFieldKey(value: unknown): value is AgendaBuiltInFieldKey {
  return value === 'agendaNo' || value === 'title' || value === 'plannedTime' || value === 'presenter'
}

function sanitizeLabel(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback
}

function sanitizeOrder(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function createDefaultAgendaColumnConfig(): AgendaColumnDefinition[] {
  return DEFAULT_CORE_COLUMNS.map(column => ({ ...column }))
}

export function normalizeAgendaCustomCells(input: unknown): Record<string, string> {
  if (!isRecord(input)) return {}

  const output: Record<string, string> = {}
  Object.entries(input).forEach(([key, value]) => {
    if (typeof value !== 'string') return
    output[key] = value
  })
  return output
}

export function normalizeAgendaColumnConfig(input: unknown): AgendaColumnDefinition[] {
  if (!Array.isArray(input) || input.length === 0) {
    return createDefaultAgendaColumnConfig()
  }

  const fixedColumn = createDefaultAgendaColumnConfig()[0]
  const nonFixedColumns: AgendaColumnDefinition[] = []
  const seenIds = new Set<string>([fixedColumn.id])
  const seenFieldKeys = new Set<AgendaBuiltInFieldKey>(['agendaNo'])

  input.forEach((raw, index) => {
    if (!isRecord(raw)) return

    const kind = raw.kind
    const fieldKey = raw.fieldKey
    const id = typeof raw.id === 'string' ? raw.id.trim() : ''
    const order = sanitizeOrder(raw.order, index + 1)

    if (kind === 'fixed' && fieldKey === 'agendaNo') {
      return
    }

    if (kind === 'built_in' && isAgendaFieldKey(fieldKey) && fieldKey !== 'agendaNo' && !seenFieldKeys.has(fieldKey)) {
      seenFieldKeys.add(fieldKey)
      seenIds.add(id || fieldKey)
      nonFixedColumns.push({
        id: fieldKey,
        label: sanitizeLabel(raw.label, DEFAULT_LABEL_BY_FIELD[fieldKey]),
        kind: 'built_in',
        fieldKey,
        order,
      })
      return
    }

    if (kind === 'custom') {
      const customId = id || `custom-${index + 1}`
      if (seenIds.has(customId)) return
      seenIds.add(customId)
      nonFixedColumns.push({
        id: customId,
        label: sanitizeLabel(raw.label, 'New Column'),
        kind: 'custom',
        order,
      })
    }
  })

  ;([] as const).forEach((fieldKey, index) => {
    if (seenFieldKeys.has(fieldKey)) return
    nonFixedColumns.push({
      id: fieldKey,
      label: DEFAULT_LABEL_BY_FIELD[fieldKey],
      kind: 'built_in',
      fieldKey,
      order: index + 1,
    })
  })

  nonFixedColumns.sort((left, right) => left.order - right.order)

  return [fixedColumn, ...nonFixedColumns].map((column, index) => ({
    ...column,
    label: column.fieldKey === 'agendaNo' ? 'No.' : column.label,
    order: index,
  }))
}

export function getAgendaCustomColumnIds(columns: AgendaColumnDefinition[]) {
  return columns.filter(column => column.kind === 'custom').map(column => column.id)
}
