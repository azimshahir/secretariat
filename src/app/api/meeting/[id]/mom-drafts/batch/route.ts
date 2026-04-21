import { NextResponse } from 'next/server'
import { z } from 'zod'
import { listAgendasMissingExactFormattingWithClient } from '@/lib/meeting-generation/generate-minutes'
import {
  createOrResetMomDraftBatchWithClient,
  getActiveMomDraftBatchForMeeting,
} from '@/lib/meeting-generation/mom-drafts'
import { generateConfigSchema, uuidSchema } from '@/lib/validation'
import {
  CommitteeGenerationApiError,
  requireWritableMeetingContext,
  serializeCommitteeGenerationApiError,
} from '../../../../committee-generation/_lib/write-access'

export const runtime = 'nodejs'

const bodySchema = z.object({
  agendaIds: z.array(uuidSchema).min(1, 'At least one agenda is required'),
  generationConfig: generateConfigSchema,
})

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const meetingId = uuidSchema.parse(id)
    const context = await requireWritableMeetingContext(meetingId)
    const batch = await getActiveMomDraftBatchForMeeting(context.adminSupabase, meetingId)

    return NextResponse.json({
      ok: true,
      batch,
    })
  } catch (error) {
    const { status, message } = serializeCommitteeGenerationApiError(error, 'Failed to load MoM draft batch')
    return NextResponse.json({ ok: false, message }, { status })
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const meetingId = uuidSchema.parse(id)
    const { agendaIds, generationConfig } = bodySchema.parse(await request.json())
    const context = await requireWritableMeetingContext(meetingId)

    if (generationConfig.requireCompleteFormatting) {
      const { data: agendas, error: agendaError } = await context.adminSupabase
        .from('agendas')
        .select('id, agenda_no, title, format_template_id, minute_playbook_id')
        .eq('meeting_id', meetingId)
        .in('id', agendaIds)

      if (agendaError) {
        throw new Error(agendaError.message)
      }

      const missingFormatting = await listAgendasMissingExactFormattingWithClient({
        supabase: context.adminSupabase,
        agendas: agendas ?? [],
      })
      if (missingFormatting.length > 0) {
        const list = missingFormatting
          .slice(0, 8)
          .map(agenda => `${agenda.agenda_no} ${agenda.title}`)
          .join(', ')
        throw new CommitteeGenerationApiError(400, `Format not complete: ${list}`)
      }
    }

    const batch = await createOrResetMomDraftBatchWithClient({
      supabase: context.adminSupabase,
      meetingId,
      userId: context.userId,
      agendaIds,
      generationConfig,
    })

    return NextResponse.json({
      ok: true,
      batch,
    })
  } catch (error) {
    const { status, message } = serializeCommitteeGenerationApiError(error, 'Failed to prepare MoM draft batch')
    return NextResponse.json({ ok: false, message }, { status })
  }
}
