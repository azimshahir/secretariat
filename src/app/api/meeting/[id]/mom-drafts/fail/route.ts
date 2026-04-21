import { NextResponse } from 'next/server'
import { z } from 'zod'
import { saveMomDraftFailureWithClient } from '@/lib/meeting-generation/mom-drafts'
import { uuidSchema } from '@/lib/validation'
import {
  requireWritableMeetingContext,
  serializeCommitteeGenerationApiError,
} from '../../../../committee-generation/_lib/write-access'

export const runtime = 'nodejs'

const bodySchema = z.object({
  batchId: uuidSchema,
  agendaId: uuidSchema,
  reason: z.string().trim().min(1, 'Failure reason is required'),
  stage: z.string().trim().min(1).optional(),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const meetingId = uuidSchema.parse(id)
    const { batchId, agendaId, reason, stage } = bodySchema.parse(await request.json())
    const context = await requireWritableMeetingContext(meetingId)

    await saveMomDraftFailureWithClient({
      supabase: context.adminSupabase,
      meetingId,
      batchId,
      agendaId,
      status: 'failed',
      message: reason,
      stage,
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    const { status, message } = serializeCommitteeGenerationApiError(error, 'Failed to update MoM draft status')
    return NextResponse.json({ ok: false, message }, { status })
  }
}
