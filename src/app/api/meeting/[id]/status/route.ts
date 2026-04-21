import { NextResponse } from 'next/server'
import { z } from 'zod'
import { meetingStatusSchema, uuidSchema } from '@/lib/validation'
import {
  requireWritableMeetingContext,
  serializeCommitteeGenerationApiError,
} from '../../../committee-generation/_lib/write-access'

export const runtime = 'nodejs'

const bodySchema = z.object({
  status: meetingStatusSchema,
})

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const meetingId = uuidSchema.parse(id)
    const { status } = bodySchema.parse(await request.json())
    const context = await requireWritableMeetingContext(meetingId)

    const { error } = await context.adminSupabase
      .from('meetings')
      .update({ status })
      .eq('id', meetingId)

    if (error) {
      throw new Error(error.message)
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    const { status, message } = serializeCommitteeGenerationApiError(error, 'Failed to update meeting status')
    return NextResponse.json({ ok: false, message }, { status })
  }
}
