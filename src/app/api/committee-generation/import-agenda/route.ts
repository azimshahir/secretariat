import { NextResponse } from 'next/server'
import { assertFileSize } from '@/actions/file-upload/validation'
import { maybeApplyCommitteeFormattingDefaultToMeeting } from '@/lib/committee-formatting-defaults-server'
import {
  parseTemplateRows,
  type AgendaImportResult,
} from '@/lib/agenda-template-import'
import { uuidSchema } from '@/lib/validation'
import {
  assertMeetingAgendaEditable,
  requireWritableMeetingContext,
  serializeCommitteeGenerationApiError,
} from '../_lib/write-access'

export const runtime = 'nodejs'

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

    const { error: deleteError } = await context.adminSupabase
      .from('agendas')
      .delete()
      .eq('meeting_id', meetingId)
    if (deleteError) throw new Error(deleteError.message)

    const agendas = parsed.rows.map((row, index) => ({
      meeting_id: meetingId,
      agenda_no: row.agendaNo,
      planned_time: row.plannedTime,
      title: row.title,
      presenter: row.presenter,
      sort_order: index,
    }))

    const { error: insertError } = await context.adminSupabase.from('agendas').insert(agendas)
    if (insertError) throw new Error(insertError.message)

    try {
      await maybeApplyCommitteeFormattingDefaultToMeeting(
        context.adminSupabase,
        meetingId,
      )
    } catch (error) {
      console.error('[api/committee-generation/import-agenda] committee formatting default apply failed:', error)
    }

    const result: AgendaImportResult = {
      importedCount: agendas.length,
      skippedCount: parsed.skippedCount,
      usedAiOcr: parsed.usedAiOcr,
      warnings: parsed.warnings,
    }

    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    const { status, message } = serializeCommitteeGenerationApiError(error, 'Failed to import agenda template')
    console.error('[api/committee-generation/import-agenda] failed:', message)
    return NextResponse.json({ ok: false, message }, { status })
  }
}
