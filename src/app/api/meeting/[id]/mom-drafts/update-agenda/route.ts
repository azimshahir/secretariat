import { NextResponse } from 'next/server'
import { z } from 'zod'
import { updateMomDraftContentWithClient } from '@/lib/meeting-generation/mom-drafts'
import { uuidSchema } from '@/lib/validation'
import {
  requireWritableMeetingContext,
  serializeCommitteeGenerationApiError,
} from '../../../../committee-generation/_lib/write-access'

export const runtime = 'nodejs'

const bodySchema = z.object({
  batchId: uuidSchema,
  agendaId: uuidSchema,
  content: z.string().min(1, 'Draft minute content is required'),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const meetingId = uuidSchema.parse(id)
    const { batchId, agendaId, content } = bodySchema.parse(await request.json())
    const context = await requireWritableMeetingContext(meetingId)

    const draft = await updateMomDraftContentWithClient({
      supabase: context.adminSupabase,
      meetingId,
      batchId,
      agendaId,
      content,
    })

    return NextResponse.json({
      ok: true,
      draft,
    })
  } catch (error) {
    const { status, message } = serializeCommitteeGenerationApiError(error, 'Failed to update draft minutes')
    return NextResponse.json({ ok: false, message }, { status })
  }
}
