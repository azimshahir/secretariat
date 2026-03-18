'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { uuidSchema } from '@/lib/validation'

function isHeadingAgendaNo(agendaNo: string) {
  const normalized = agendaNo.trim()
  return normalized.endsWith('.0') || /^\d+$/.test(normalized)
}

export async function syncAgendaRows(meetingId: string, columns: string[], rows: string[][]) {
  uuidSchema.parse(meetingId)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Find column indices by common names
  const colLower = columns.map(c => c.toLowerCase().trim())
  const noIdx = colLower.findIndex(c => c.includes('no'))
  const titleIdx = colLower.findIndex(c => c.includes('agenda') || c.includes('item') || c.includes('subject'))
  const presenterIdx = colLower.findIndex(c => c.includes('presenter') || c.includes('pic') || c.includes('by'))
  const attachedPdfIdx = colLower.findIndex(c => c.includes('attached pdf') || c.includes('pdf') || c.includes('slide'))

  // Delete existing agendas for this meeting, then re-insert from spreadsheet
  await supabase.from('agendas').delete().eq('meeting_id', meetingId)

  if (rows.length === 0) return

  const agendas = rows.map((row, i) => ({
    meeting_id: meetingId,
    agenda_no: noIdx >= 0 ? (row[noIdx] || String(i + 1)) : String(i + 1),
    title: titleIdx >= 0 ? (row[titleIdx] || '') : (row[1] ?? row[0] ?? ''),
    presenter: presenterIdx >= 0 ? (row[presenterIdx] || null) : null,
    slide_pages: attachedPdfIdx >= 0 ? (row[attachedPdfIdx] || null) : null,
    sort_order: i,
  }))

  const { error } = await supabase.from('agendas').insert(agendas)
  if (error) throw new Error(error.message)
}

export async function clearCurrentAgenda(meetingId: string) {
  uuidSchema.parse(meetingId)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: beforeRows, error: beforeError } = await supabase
    .from('agendas')
    .select('id')
    .eq('meeting_id', meetingId)

  if (beforeError) throw new Error(beforeError.message)
  const beforeCount = beforeRows?.length ?? 0

  const { error: deleteError } = await supabase
    .from('agendas')
    .delete()
    .eq('meeting_id', meetingId)

  if (deleteError) throw new Error(deleteError.message)

  const { data: afterRows, error: afterError } = await supabase
    .from('agendas')
    .select('id')
    .eq('meeting_id', meetingId)

  if (afterError) throw new Error(afterError.message)
  const afterCount = afterRows?.length ?? 0
  const deletedCount = Math.max(beforeCount - afterCount, 0)

  return {
    status: deletedCount === 0 && beforeCount > 0 ? 'no_rows_cleared' as const : 'cleared' as const,
    deletedCount,
    beforeCount,
    afterCount,
  }
}

export async function clearAgendaItemsOnly(meetingId: string) {
  uuidSchema.parse(meetingId)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: agendas, error: fetchError } = await supabase
    .from('agendas')
    .select('id, agenda_no')
    .eq('meeting_id', meetingId)

  if (fetchError) throw new Error(fetchError.message)
  const itemIds = (agendas ?? [])
    .filter(agenda => !isHeadingAgendaNo(agenda.agenda_no))
    .map(agenda => agenda.id)

  if (itemIds.length === 0) {
    return {
      status: 'no_items_cleared' as const,
      deletedCount: 0,
    }
  }

  const { data: deletedRows, error: deleteError } = await supabase
    .from('agendas')
    .delete()
    .in('id', itemIds)
    .select('id')

  if (deleteError) throw new Error(deleteError.message)

  const deletedCount = deletedRows?.length ?? 0
  return {
    status: deletedCount > 0 ? 'cleared' as const : 'no_items_cleared' as const,
    deletedCount,
  }
}
