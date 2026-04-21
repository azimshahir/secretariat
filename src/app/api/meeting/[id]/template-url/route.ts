import { NextResponse } from 'next/server'
import { z } from 'zod'
import { uuidSchema } from '@/lib/validation'
import {
  requireWritableMeetingContext,
  serializeCommitteeGenerationApiError,
} from '../../../committee-generation/_lib/write-access'

export const runtime = 'nodejs'

const bodySchema = z.object({
  storagePath: z.string().min(1),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const meetingId = uuidSchema.parse(id)
    const { storagePath } = bodySchema.parse(await request.json())
    const context = await requireWritableMeetingContext(meetingId)

    const { data, error } = await context.adminSupabase.storage
      .from('meeting-files')
      .createSignedUrl(storagePath, 3600)
    if (error || !data?.signedUrl) {
      throw new Error(error?.message ?? 'Failed to create template URL')
    }

    return NextResponse.json({ ok: true, signedUrl: data.signedUrl })
  } catch (error) {
    const { status, message } = serializeCommitteeGenerationApiError(error, 'Failed to resolve template URL')
    return NextResponse.json({ ok: false, message }, { status })
  }
}
