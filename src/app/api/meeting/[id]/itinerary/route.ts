import { NextResponse } from 'next/server'
import { z } from 'zod'
import { generateItineraryContent } from '@/actions/generate-itinerary'
import { uuidSchema } from '@/lib/validation'
import {
  requireWritableMeetingContext,
  serializeCommitteeGenerationApiError,
} from '../../../committee-generation/_lib/write-access'

export const runtime = 'nodejs'

const bodySchema = z.object({
  sectionTitle: z.string().min(1),
  sectionPrompt: z.string().default(''),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const meetingId = uuidSchema.parse(id)
    const { sectionTitle, sectionPrompt } = bodySchema.parse(await request.json())
    await requireWritableMeetingContext(meetingId)
    const result = await generateItineraryContent(meetingId, sectionTitle, sectionPrompt)

    return NextResponse.json({
      ok: true,
      ...result,
    })
  } catch (error) {
    const { status, message } = serializeCommitteeGenerationApiError(error, 'Failed to generate itinerary')
    return NextResponse.json({ ok: false, message }, { status })
  }
}
