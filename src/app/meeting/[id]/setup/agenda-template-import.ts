'use server'

import { createClient } from '@/lib/supabase/server'
import { maybeApplyCommitteeFormattingDefaultToMeeting } from '@/lib/committee-formatting-defaults-server'
import type { DatabaseClient } from '@/lib/meeting-generation/shared'
import {
  assertFileSize,
} from '@/actions/file-upload/validation'
import {
  compareAgendaNo,
  normalizeAgendaNo,
  normalizeHeader,
  parseTemplateRows,
  type AgendaImportResult,
  type PresenterImportResult,
} from '@/lib/agenda-template-import'
import { uuidSchema } from '@/lib/validation'

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

async function recomputeSortOrderForMeeting(supabase: SupabaseClient, meetingId: string) {
  const { data: agendas, error } = await supabase
    .from('agendas')
    .select('id, agenda_no, title')
    .eq('meeting_id', meetingId)

  if (error || !agendas) throw new Error(error?.message ?? 'Failed to fetch agendas for sorting')

  const sorted = [...agendas].sort((a, b) => {
    const byNo = compareAgendaNo(a.agenda_no, b.agenda_no)
    if (byNo !== 0) return byNo
    return a.title.localeCompare(b.title)
  })

  await Promise.all(sorted.map((agenda, index) =>
    supabase
      .from('agendas')
      .update({ sort_order: index })
      .eq('id', agenda.id),
  ))
}

export async function importAgendaToCurrentAgenda(meetingId: string, file: File): Promise<AgendaImportResult> {
  uuidSchema.parse(meetingId)
  assertFileSize(file)

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const parsed = await parseTemplateRows(file)

  const { error: deleteError } = await supabase.from('agendas').delete().eq('meeting_id', meetingId)
  if (deleteError) throw new Error(deleteError.message)

  const agendas = parsed.rows.map((row, index) => ({
    meeting_id: meetingId,
    agenda_no: row.agendaNo,
    planned_time: row.plannedTime,
    title: row.title,
    presenter: row.presenter,
    sort_order: index,
  }))

  const { error: insertError } = await supabase.from('agendas').insert(agendas)
  if (insertError) throw new Error(insertError.message)

  try {
    await maybeApplyCommitteeFormattingDefaultToMeeting(
      supabase as unknown as DatabaseClient,
      meetingId,
    )
  } catch (error) {
    console.error('[importAgendaToCurrentAgenda] committee formatting default apply failed:', error)
  }

  return {
    importedCount: agendas.length,
    skippedCount: parsed.skippedCount,
    usedAiOcr: parsed.usedAiOcr,
    warnings: parsed.warnings,
  }
}

export async function importPresenterListToCurrentAgenda(
  meetingId: string,
  file: File,
): Promise<PresenterImportResult> {
  uuidSchema.parse(meetingId)
  assertFileSize(file)

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const parsed = await parseTemplateRows(file)

  const { data: existingAgendas, error: existingError } = await supabase
    .from('agendas')
    .select('id, agenda_no, title, presenter, planned_time, sort_order')
    .eq('meeting_id', meetingId)

  if (existingError) throw new Error(existingError.message)

  const agendas = existingAgendas ?? []
  const byNo = new Map(agendas.map(agenda => [normalizeAgendaNo(agenda.agenda_no), agenda]))
  const byTitle = new Map(agendas.map(agenda => [normalizeHeader(agenda.title), agenda]))
  let nextSortOrder = agendas.reduce((max, agenda) => Math.max(max, agenda.sort_order), -1) + 1

  let updatedCount = 0
  let createdCount = 0
  let skippedCount = parsed.skippedCount

  for (const row of parsed.rows) {
    const target = byNo.get(normalizeAgendaNo(row.agendaNo))
      ?? byTitle.get(normalizeHeader(row.title))

    if (target) {
      if (
        (row.presenter && row.presenter !== target.presenter)
        || (row.plannedTime !== null && row.plannedTime !== target.planned_time)
      ) {
        const { error } = await supabase
          .from('agendas')
          .update({
            presenter: row.presenter,
            planned_time: row.plannedTime,
          })
          .eq('id', target.id)
        if (error) throw new Error(error.message)
        updatedCount += 1
      } else {
        skippedCount += 1
      }
      continue
    }

    const { data: created, error } = await supabase
      .from('agendas')
      .insert({
        meeting_id: meetingId,
        agenda_no: row.agendaNo,
        planned_time: row.plannedTime,
        title: row.title,
        presenter: row.presenter,
        sort_order: nextSortOrder,
      })
      .select('id, agenda_no, title, presenter, planned_time, sort_order')
      .single()

    if (error || !created) throw new Error(error?.message ?? 'Failed to create missing agenda row')

    createdCount += 1
    nextSortOrder += 1
    byNo.set(normalizeAgendaNo(created.agenda_no), created)
    byTitle.set(normalizeHeader(created.title), created)
  }

  if (updatedCount + createdCount === 0) {
    throw new Error('No presenter rows were imported. Check your template content.')
  }

  await recomputeSortOrderForMeeting(supabase, meetingId)

  return {
    updatedCount,
    createdCount,
    skippedCount,
    usedAiOcr: parsed.usedAiOcr,
    warnings: parsed.warnings,
  }
}
