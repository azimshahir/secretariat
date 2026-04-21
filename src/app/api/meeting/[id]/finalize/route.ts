import { NextResponse } from 'next/server'
import { z } from 'zod'
import { listCanonicalCurrentMinutesForAgendaIds } from '@/lib/meeting-generation/current-minute'
import { uuidSchema } from '@/lib/validation'
import {
  CommitteeGenerationApiError,
  requireWritableMeetingContext,
  serializeCommitteeGenerationApiError,
} from '../../../committee-generation/_lib/write-access'

export const runtime = 'nodejs'

const bodySchema = z.object({
  content: z.string().optional(),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const meetingId = uuidSchema.parse(id)
    const { content } = bodySchema.parse(await request.json())
    const context = await requireWritableMeetingContext(meetingId)

    const { data: agendas, error: agendasError } = await context.adminSupabase
      .from('agendas')
      .select('id, agenda_no, title, content_revision, is_skipped')
      .eq('meeting_id', meetingId)
      .eq('is_skipped', false)

    if (agendasError) {
      throw new Error(agendasError.message)
    }

    const agendaIds = (agendas ?? []).map(agenda => agenda.id)
    if (agendaIds.length > 0) {
      const currentMinutes = await listCanonicalCurrentMinutesForAgendaIds<{
        id: string
        agenda_id: string
        content: string
        source_agenda_revision: number | null
      }>({
        supabase: context.adminSupabase,
        agendaIds,
        extraColumns: 'content, source_agenda_revision',
      })

      const staleAgendas = (agendas ?? []).filter(agenda => {
        const minute = currentMinutes.get(agenda.id)
        if (!minute?.content?.trim()) return false
        return minute.source_agenda_revision == null || minute.source_agenda_revision < (agenda.content_revision ?? 1)
      })

      if (staleAgendas.length > 0) {
        throw new CommitteeGenerationApiError(
          409,
          staleAgendas.length === 1
            ? `Cannot finalize yet. Agenda ${staleAgendas[0].agenda_no} has a stale minute after Step 1 changes.`
            : `Cannot finalize yet. ${staleAgendas.length} agendas have stale minutes after Step 1 changes.`,
        )
      }
    }

    const updatePayload: {
      status: 'finalized'
      finalized_content?: string
      finalized_at?: string
    } = {
      status: 'finalized',
    }

    if (typeof content === 'string') {
      updatePayload.finalized_content = content
      updatePayload.finalized_at = new Date().toISOString()
    }

    const { error: updateError } = await context.adminSupabase
      .from('meetings')
      .update(updatePayload)
      .eq('id', meetingId)
    if (updateError) {
      throw new Error(updateError.message)
    }

    const auditDetails = typeof content === 'string'
      ? { content_length: content.length }
      : { status: 'finalized' }

    const { error: auditError } = await context.adminSupabase
      .from('audit_logs')
      .insert({
        organization_id: context.organizationId,
        meeting_id: meetingId,
        user_id: context.userId,
        action: 'meeting_finalized',
        details: auditDetails,
      })
    if (auditError) {
      throw new Error(auditError.message)
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    const { status, message } = serializeCommitteeGenerationApiError(error, 'Failed to finalize meeting')
    return NextResponse.json({ ok: false, message }, { status })
  }
}
