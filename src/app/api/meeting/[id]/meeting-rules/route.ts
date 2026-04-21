import { NextResponse } from 'next/server'
import { z } from 'zod'
import { saveMeetingRulesWithClient } from '@/lib/meeting-generation/meeting-rules'
import { uuidSchema } from '@/lib/validation'
import {
  requireWritableMeetingContext,
  serializeCommitteeGenerationApiError,
} from '../../../committee-generation/_lib/write-access'

export const runtime = 'nodejs'

const bodySchema = z.object({
  rules: z.string(),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const meetingId = uuidSchema.parse(id)
    const { rules } = bodySchema.parse(await request.json())
    const context = await requireWritableMeetingContext(meetingId)

    await saveMeetingRulesWithClient({
      supabase: context.adminSupabase,
      meetingId,
      organizationId: context.organizationId,
      userId: context.userId,
      rules,
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    const { status, message } = serializeCommitteeGenerationApiError(error, 'Failed to save meeting rules')
    console.error('[api/meeting/[id]/meeting-rules] failed:', message)
    return NextResponse.json({ ok: false, message }, { status })
  }
}

