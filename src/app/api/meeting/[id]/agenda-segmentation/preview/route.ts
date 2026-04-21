import { NextResponse } from 'next/server'
import { analyzeAgendaSegmentationWithClient } from '@/lib/meeting-generation/agenda-segmentation'
import { analyzeAgendaSegmentationOptionsSchema, uuidSchema } from '@/lib/validation'
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
    const options = analyzeAgendaSegmentationOptionsSchema.parse(await request.json())
    const context = await requireWritableMeetingContext(meetingId)

    const result = await analyzeAgendaSegmentationWithClient({
      supabase: context.adminSupabase,
      meetingId,
      organizationId: context.organizationId,
      userPlanTier: context.planTier,
      options,
    })

    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    const { status, message } = serializeCommitteeGenerationApiError(error, 'Failed to analyze transcript timeline')
    console.error('[api/meeting/[id]/agenda-segmentation/preview] failed:', message)
    return NextResponse.json({ ok: false, message }, { status })
  }
}
