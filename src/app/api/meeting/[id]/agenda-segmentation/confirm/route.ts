import { NextResponse } from 'next/server'
import { confirmAgendaSegmentationWithClient } from '@/lib/meeting-generation/agenda-segmentation'
import { confirmAgendaSegmentationInputSchema, uuidSchema } from '@/lib/validation'
import {
  requireWritableMeetingContext,
  serializeCommitteeGenerationApiError,
} from '../../../../committee-generation/_lib/write-access'

export const runtime = 'nodejs'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const meetingId = uuidSchema.parse(id)
    const input = confirmAgendaSegmentationInputSchema.parse(await request.json())
    const context = await requireWritableMeetingContext(meetingId)

    const result = await confirmAgendaSegmentationWithClient({
      supabase: context.adminSupabase,
      meetingId,
      organizationId: context.organizationId,
      input,
    })

    return NextResponse.json({ ok: true, savedSegmentCount: result.savedSegmentCount })
  } catch (error) {
    const { status, message } = serializeCommitteeGenerationApiError(error, 'Failed to confirm transcript timeline')
    console.error('[api/meeting/[id]/agenda-segmentation/confirm] failed:', message)
    return NextResponse.json({ ok: false, message }, { status })
  }
}
