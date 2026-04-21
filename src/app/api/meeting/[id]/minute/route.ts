import { NextResponse } from 'next/server'
import { z } from 'zod'
import { uuidSchema } from '@/lib/validation'
import {
  requireWritableMeetingContext,
  serializeCommitteeGenerationApiError,
} from '../../../committee-generation/_lib/write-access'

export const runtime = 'nodejs'

const bodySchema = z.object({
  minuteId: uuidSchema,
  content: z.string(),
  mode: z.enum(['manual', 'ai']).default('manual'),
})

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const meetingId = uuidSchema.parse(id)
    const { minuteId, content, mode } = bodySchema.parse(await request.json())
    const context = await requireWritableMeetingContext(meetingId)

    const { data: minute, error: minuteError } = await context.adminSupabase
      .from('minutes')
      .select('id, agenda_id, content, version')
      .eq('id', minuteId)
      .maybeSingle()

    if (minuteError) {
      throw new Error(minuteError.message)
    }
    if (!minute) {
      throw new Error('Minute not found')
    }

    const { data: agenda, error: agendaError } = await context.adminSupabase
      .from('agendas')
      .select('id, content_revision')
      .eq('id', minute.agenda_id)
      .eq('meeting_id', meetingId)
      .maybeSingle()

    if (agendaError) {
      throw new Error(agendaError.message)
    }
    if (!agenda) {
      throw new Error('Minute does not belong to this meeting')
    }

    const { error: versionError } = await context.adminSupabase
      .from('minute_versions')
      .insert({
        minute_id: minuteId,
        content: minute.content,
        version: minute.version,
        change_summary: mode === 'ai' ? 'AI-assisted edit via Agent' : 'Manual edit by CoSec',
        changed_by: context.userId,
      })
    if (versionError) {
      throw new Error(versionError.message)
    }

    const { error: updateError } = await context.adminSupabase
      .from('minutes')
      .update({
        content,
        source_agenda_revision: agenda.content_revision ?? 1,
        version: minute.version + 1,
      })
      .eq('id', minuteId)
    if (updateError) {
      throw new Error(updateError.message)
    }

    return NextResponse.json({ ok: true, version: minute.version + 1 })
  } catch (error) {
    const { status, message } = serializeCommitteeGenerationApiError(error, 'Failed to save minute content')
    return NextResponse.json({ ok: false, message }, { status })
  }
}
