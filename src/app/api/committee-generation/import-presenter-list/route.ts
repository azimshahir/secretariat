import { NextResponse } from 'next/server'
import { assertFileSize } from '@/actions/file-upload/validation'
import {
  compareAgendaNo,
  normalizeAgendaNo,
  normalizeHeader,
  parseTemplateRows,
  type PresenterImportResult,
} from '@/lib/agenda-template-import'
import { uuidSchema } from '@/lib/validation'
import {
  assertMeetingAgendaEditable,
  requireWritableMeetingContext,
  serializeCommitteeGenerationApiError,
} from '../_lib/write-access'

export const runtime = 'nodejs'

async function recomputeSortOrderForMeeting(
  adminSupabase: Awaited<ReturnType<typeof requireWritableMeetingContext>>['adminSupabase'],
  meetingId: string,
) {
  const { data: agendas, error } = await adminSupabase
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
    adminSupabase
      .from('agendas')
      .update({ sort_order: index })
      .eq('id', agenda.id),
  ))
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const meetingId = uuidSchema.parse(String(formData.get('meetingId') ?? ''))
    const file = formData.get('file')

    if (!(file instanceof File)) {
      throw new Error('Template file is required')
    }

    assertFileSize(file)
    const context = await requireWritableMeetingContext(meetingId)
    await assertMeetingAgendaEditable(context.adminSupabase, meetingId)
    const parsed = await parseTemplateRows(file)

    const { data: existingAgendas, error: existingError } = await context.adminSupabase
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
          const { error } = await context.adminSupabase
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

      const { data: created, error } = await context.adminSupabase
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

    await recomputeSortOrderForMeeting(context.adminSupabase, meetingId)

    const result: PresenterImportResult = {
      updatedCount,
      createdCount,
      skippedCount,
      usedAiOcr: parsed.usedAiOcr,
      warnings: parsed.warnings,
    }

    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    const { status, message } = serializeCommitteeGenerationApiError(error, 'Failed to import presenter list template')
    console.error('[api/committee-generation/import-presenter-list] failed:', message)
    return NextResponse.json({ ok: false, message }, { status })
  }
}
