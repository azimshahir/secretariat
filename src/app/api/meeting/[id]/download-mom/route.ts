import { NextResponse } from 'next/server'
import { z } from 'zod'
import { formatMomForDownload } from '@/actions/download-mom'
import { uuidSchema } from '@/lib/validation'
import {
  requireWritableMeetingContext,
  serializeCommitteeGenerationApiError,
} from '../../../committee-generation/_lib/write-access'

export const runtime = 'nodejs'

const bodySchema = z.object({
  instruction: z.string().optional(),
  format: z.enum(['docx', 'pdf']).optional(),
  mode: z.enum(['standard', 'best-fit']).optional(),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const meetingId = uuidSchema.parse(id)
    const { instruction, format, mode } = bodySchema.parse(await request.json())
    await requireWritableMeetingContext(meetingId)
    const result = await formatMomForDownload(meetingId, {
      extraInstruction: instruction?.trim() || undefined,
      format: format ?? 'docx',
      mode: mode ?? 'standard',
    })

    return NextResponse.json({
      ok: true,
      ...result,
    })
  } catch (error) {
    const { status, message } = serializeCommitteeGenerationApiError(error, 'Failed to prepare MoM download')
    return NextResponse.json({ ok: false, message }, { status })
  }
}
