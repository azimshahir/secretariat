import type { Minute } from '@/lib/supabase/types'
import type { DatabaseClient } from './shared'

type MinuteClient = Pick<DatabaseClient, 'from'>

type CurrentMinuteRow = Pick<Minute, 'id' | 'agenda_id'>

function buildMinuteSelect(extraColumns?: string) {
  const normalized = extraColumns?.trim()
  if (!normalized) return 'id, agenda_id'
  if (normalized === '*') return '*'

  const columns = new Set(
    normalized
      .split(',')
      .map(column => column.trim())
      .filter(Boolean),
  )
  columns.add('id')
  columns.add('agenda_id')

  return Array.from(columns).join(', ')
}

export async function listCanonicalCurrentMinutesForAgendaIds<T extends CurrentMinuteRow>(params: {
  supabase: MinuteClient
  agendaIds: string[]
  extraColumns?: string
}): Promise<Map<string, T>> {
  const agendaIds = Array.from(new Set(params.agendaIds.filter(Boolean)))
  if (agendaIds.length === 0) {
    return new Map()
  }

  const { data, error } = await params.supabase
    .from('minutes')
    .select(buildMinuteSelect(params.extraColumns))
    .in('agenda_id', agendaIds)
    .eq('is_current', true)
    .order('agenda_id', { ascending: true })
    .order('updated_at', { ascending: false })
    .order('generated_at', { ascending: false })
    .order('id', { ascending: false })

  if (error) {
    throw new Error(error.message)
  }

  const canonicalRows = new Map<string, T>()
  const duplicateMinuteIds: string[] = []

  for (const row of ((data ?? []) as unknown as T[])) {
    if (!canonicalRows.has(row.agenda_id)) {
      canonicalRows.set(row.agenda_id, row)
      continue
    }

    duplicateMinuteIds.push(row.id)
  }

  if (duplicateMinuteIds.length > 0) {
    const { error: healError } = await params.supabase
      .from('minutes')
      .update({ is_current: false })
      .in('id', duplicateMinuteIds)

    if (healError) {
      console.warn('[current-minute] failed to heal duplicate current minutes', {
        agendaIds,
        duplicateMinuteIds,
        message: healError.message,
      })
    }
  }

  return canonicalRows
}

export async function getCanonicalCurrentMinuteForAgendaId<T extends CurrentMinuteRow>(params: {
  supabase: MinuteClient
  agendaId: string
  extraColumns?: string
}): Promise<T | null> {
  const rows = await listCanonicalCurrentMinutesForAgendaIds<T>({
    supabase: params.supabase,
    agendaIds: [params.agendaId],
    extraColumns: params.extraColumns,
  })

  return rows.get(params.agendaId) ?? null
}
