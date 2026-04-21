import { NextResponse } from 'next/server'
import { z } from 'zod'
import { importMomDraftAgendaWithClient } from '@/lib/meeting-generation/mom-drafts'
import { uuidSchema } from '@/lib/validation'
import {
  requireWritableMeetingContext,
  serializeCommitteeGenerationApiError,
} from '../../../../committee-generation/_lib/write-access'

export const runtime = 'nodejs'

const bodySchema = z.object({
  batchId: uuidSchema,
  agendaId: uuidSchema,
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const meetingId = uuidSchema.parse(id)
    const { batchId, agendaId } = bodySchema.parse(await request.json())
    const context = await requireWritableMeetingContext(meetingId)

    const result = await importMomDraftAgendaWithClient({
      supabase: context.adminSupabase,
      meetingId,
      batchId,
      agendaId,
      userId: context.userId,
      organizationId: context.organizationId,
    })

    return NextResponse.json({
      ok: true,
      minuteId: result.minuteId,
      batchDeactivated: result.batchDeactivated,
    })
  } catch (error) {
    const { status, message } = serializeCommitteeGenerationApiError(error, 'Failed to commit draft minutes')
    return NextResponse.json({ ok: false, message }, { status })
  }
}
