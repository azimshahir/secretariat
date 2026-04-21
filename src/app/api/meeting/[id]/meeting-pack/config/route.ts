import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { Agenda } from '@/lib/supabase/types'
import { uuidSchema } from '@/lib/validation'
import { normalizeMeetingPackConfig } from '@/app/meeting/[id]/setup/meeting-pack-model'
import {
  requireWritableMeetingContext,
  serializeCommitteeGenerationApiError,
} from '../../../../committee-generation/_lib/write-access'

export const runtime = 'nodejs'

const meetingPackConfigBodySchema = z.object({
  config: z.unknown(),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const meetingId = uuidSchema.parse(id)
    const { config: rawConfig } = meetingPackConfigBodySchema.parse(await request.json())
    const context = await requireWritableMeetingContext(meetingId)

    const { data: agendas, error: agendasError } = await context.adminSupabase
      .from('agendas')
      .select('*')
      .eq('meeting_id', meetingId)
      .order('sort_order')
    if (agendasError) {
      throw new Error(agendasError.message)
    }

    const normalizedConfig = normalizeMeetingPackConfig(rawConfig, (agendas ?? []) as Agenda[])

    const { error: updateError } = await context.adminSupabase
      .from('meetings')
      .update({ meeting_pack_config: normalizedConfig as unknown as Record<string, unknown> })
      .eq('id', meetingId)
    if (updateError) {
      throw new Error(updateError.message)
    }

    return NextResponse.json({ ok: true, config: normalizedConfig })
  } catch (error) {
    const { status, message } = serializeCommitteeGenerationApiError(
      error,
      'Failed to save Meeting Pack',
    )
    console.error('[api/meeting/[id]/meeting-pack/config] failed:', message)
    return NextResponse.json({ ok: false, message }, { status })
  }
}
