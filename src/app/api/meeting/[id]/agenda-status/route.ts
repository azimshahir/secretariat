import { NextResponse } from 'next/server'
import { z } from 'zod'
import { updateAgendaStatusWithClient } from '@/lib/meeting-generation/agenda-status'
import { uuidSchema } from '@/lib/validation'
import {
  requireSetupMeetingContext,
  serializeCommitteeGenerationApiError,
} from '../../../committee-generation/_lib/write-access'

export const runtime = 'nodejs'

const bodySchema = z.object({
  agendaIds: z.array(uuidSchema),
  status: z.enum(['done', 'ongoing', 'pending']),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const meetingId = uuidSchema.parse(id)
    const { agendaIds, status } = bodySchema.parse(await request.json())
    const context = await requireSetupMeetingContext(meetingId)

    await updateAgendaStatusWithClient({
      supabase: context.adminSupabase,
      meetingId,
      agendaIds,
      status,
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    const { status, message } = serializeCommitteeGenerationApiError(error, 'Failed to update agenda status')
    console.error('[api/meeting/[id]/agenda-status] failed:', message)
    return NextResponse.json({ ok: false, message }, { status })
  }
}
