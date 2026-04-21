import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  AgendaMinuteGenerationError,
  generateMinutesForAgendaWithClient,
} from '@/lib/meeting-generation/generate-minutes'
import { generateConfigSchema, uuidSchema } from '@/lib/validation'
import {
  CommitteeGenerationApiError,
  requireWritableMeetingContext,
  serializeCommitteeGenerationApiError,
} from '../../../committee-generation/_lib/write-access'

export const runtime = 'nodejs'
export const maxDuration = 300

const bodySchema = z.object({
  agendaId: uuidSchema,
  generationConfig: generateConfigSchema,
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const meetingId = uuidSchema.parse(id)
    const { agendaId, generationConfig } = bodySchema.parse(await request.json())
    const context = await requireWritableMeetingContext(meetingId)

    const { data: agenda, error: agendaError } = await context.adminSupabase
      .from('agendas')
      .select('id')
      .eq('id', agendaId)
      .eq('meeting_id', meetingId)
      .maybeSingle()
    if (agendaError) {
      throw new Error(agendaError.message)
    }
    if (!agenda) {
      throw new Error('Agenda not found in this meeting')
    }
    const forcedResolvedOutcomeMode = generationConfig.forcedResolvedOutcomeModes?.[agendaId] ?? null

    const result = await generateMinutesForAgendaWithClient({
      supabase: context.adminSupabase,
      agendaId,
      userId: context.userId,
      organizationId: context.organizationId,
      config: generationConfig,
      runtimeContext: {
        userPlanTier: context.planTier,
        resolvedOutcomeModeOverride: forcedResolvedOutcomeMode,
        skipDiscussedSection: forcedResolvedOutcomeMode === 'closed',
      },
    })

    return NextResponse.json({
      ok: true,
      content: result.content,
      markers: result.markers,
      minuteId: result.minuteId,
      resolvedOutcomeMode: result.resolvedOutcomeMode,
      resolutionVariantKey: result.resolutionVariantKey,
      resolutionVariantLabel: result.resolutionVariantLabel,
      resolutionVariantSource: result.resolutionVariantSource,
      resolutionExactRenderEnforced: result.resolutionExactRenderEnforced,
    })
  } catch (error) {
    const normalizedError = error instanceof Error ? error : null
    if (normalizedError?.message.startsWith('Format not complete:')) {
      error = new CommitteeGenerationApiError(400, normalizedError.message)
    } else if (normalizedError?.message.startsWith('Format fidelity check failed:')) {
      error = new CommitteeGenerationApiError(422, normalizedError.message)
    }
    const { status, message } = serializeCommitteeGenerationApiError(error, 'Failed to generate minutes')
    const stage = error instanceof AgendaMinuteGenerationError ? error.stage : 'route'
    console.error('[api/meeting/[id]/agenda-generate] failed', {
      stage,
      status,
      message,
    })
    return NextResponse.json({ ok: false, message }, { status })
  }
}
