import { NextResponse } from 'next/server'
import { z } from 'zod'
import { generateAndSaveAllMinutesV2 } from '@/lib/meeting-generation/generate-minute-v2-bridge'
import { uuidSchema } from '@/lib/validation'
import {
  requireWritableMeetingContext,
  serializeCommitteeGenerationApiError,
} from '../../../committee-generation/_lib/write-access'

export const runtime = 'nodejs'
export const maxDuration = 300

const bodySchema = z.object({
  transcriptId: uuidSchema.optional(),
  concurrency: z.number().min(1).max(10).optional(),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const meetingId = uuidSchema.parse(id)
    const body = bodySchema.parse(await request.json())
    const context = await requireWritableMeetingContext(meetingId)

    const result = await generateAndSaveAllMinutesV2({
      supabase: context.adminSupabase,
      meetingId,
      userId: context.userId,
      organizationId: context.organizationId,
      transcriptId: body.transcriptId,
      concurrency: body.concurrency,
    })

    return NextResponse.json({
      ok: true,
      saved: result.saved,
      failed: result.failed,
    })
  } catch (error) {
    const { status, message } = serializeCommitteeGenerationApiError(
      error, 'Failed to generate minutes (V2 batch)',
    )
    console.error('[api/meeting/[id]/batch-generate-v2] failed', { status, message })
    return NextResponse.json({ ok: false, message }, { status })
  }
}
