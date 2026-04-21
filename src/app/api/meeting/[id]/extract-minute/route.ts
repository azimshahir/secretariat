import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prepareExtractMinuteForDownload } from '@/actions/extract-minute'
import { uuidSchema } from '@/lib/validation'
import {
  requireWritableMeetingContext,
  serializeCommitteeGenerationApiError,
} from '../../../committee-generation/_lib/write-access'

export const runtime = 'nodejs'

const bodySchema = z.object({
  agendaId: uuidSchema,
  minuteContent: z.string().optional(),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const meetingId = uuidSchema.parse(id)
    const { agendaId, minuteContent } = bodySchema.parse(await request.json())

    await requireWritableMeetingContext(meetingId)

    const result = await prepareExtractMinuteForDownload(
      meetingId,
      agendaId,
      minuteContent?.trim() || undefined,
    )

    return NextResponse.json({
      ok: true,
      ...result,
    })
  } catch (error) {
    const { status, message } = serializeCommitteeGenerationApiError(error, 'Failed to prepare Extract Minute download')
    return NextResponse.json({ ok: false, message }, { status })
  }
}
