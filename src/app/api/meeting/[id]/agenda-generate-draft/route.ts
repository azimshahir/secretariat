import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  AgendaMinuteGenerationError,
  buildMinuteDraftForAgendaWithClient,
} from '@/lib/meeting-generation/generate-minutes'
import {
  markMomDraftRunningWithClient,
  saveMomDraftCheckpointWithClient,
  saveMomDraftFailureWithClient,
  saveMomDraftSuccessWithClient,
} from '@/lib/meeting-generation/mom-drafts'
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
  batchId: uuidSchema,
  generationConfig: generateConfigSchema,
})

function isMissingSegmentsError(error: unknown): error is AgendaMinuteGenerationError {
  if (!(error instanceof AgendaMinuteGenerationError)) return false
  return error.stage === 'transcript_segment_lookup'
    && error.message.toLowerCase().includes('no transcript segments')
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const meetingId = uuidSchema.parse(id)
  let draftRequest: z.infer<typeof bodySchema> | null = null

  try {
    draftRequest = bodySchema.parse(await request.json())
    const { agendaId, batchId, generationConfig } = draftRequest
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

    const { data: batch, error: batchError } = await context.adminSupabase
      .from('mom_generation_batches')
      .select('id, is_active, imported_at')
      .eq('id', batchId)
      .eq('meeting_id', meetingId)
      .maybeSingle()

    if (batchError) {
      throw new Error(batchError.message)
    }
    if (!batch || !batch.is_active || batch.imported_at) {
      throw new Error('MoM draft batch is not active anymore')
    }

    const runningDraft = await markMomDraftRunningWithClient({
      supabase: context.adminSupabase,
      meetingId,
      batchId,
      agendaId,
    })
    const forcedResolvedOutcomeMode = generationConfig.forcedResolvedOutcomeModes?.[agendaId] ?? null

    const draft = await buildMinuteDraftForAgendaWithClient({
      supabase: context.adminSupabase,
      agendaId,
      userId: context.userId,
      organizationId: context.organizationId,
      config: generationConfig,
      runtimeContext: {
        userPlanTier: context.planTier,
        resolvedOutcomeModeOverride: forcedResolvedOutcomeMode,
        skipDiscussedSection: forcedResolvedOutcomeMode === 'closed',
        momDraftCheckpoint: runningDraft,
        onMomDraftCheckpoint: async (checkpoint) => {
          const didSaveCheckpoint = await saveMomDraftCheckpointWithClient({
            supabase: context.adminSupabase,
            meetingId,
            batchId,
            agendaId,
            checkpoint,
          })

          if (!didSaveCheckpoint) {
            throw new AgendaMinuteGenerationError(
              'draft_checkpoint_persist',
              'MoM draft row is no longer running',
            )
          }
        },
      },
    })

    const didSaveDraft = await saveMomDraftSuccessWithClient({
      supabase: context.adminSupabase,
      meetingId,
      batchId,
      agendaId,
      draft,
    })

    if (!didSaveDraft) {
      return NextResponse.json(
        {
          ok: false,
          message: 'MoM draft row is no longer running',
        },
        { status: 409 },
      )
    }

    return NextResponse.json({
      ok: true,
      status: 'done',
      content: draft.content,
      markers: draft.markers,
      resolvedOutcomeMode: draft.resolvedOutcomeMode,
      resolutionVariantKey: draft.resolutionVariantKey,
      resolutionVariantLabel: draft.resolutionVariantLabel,
      resolutionVariantSource: draft.resolutionVariantSource,
      resolutionExactRenderEnforced: draft.resolutionExactRenderEnforced,
    })
  } catch (error) {
    const agendaId = draftRequest?.agendaId
    const batchId = draftRequest?.batchId
    const normalizedError = error instanceof Error ? error : null

    if (normalizedError?.message.startsWith('Format not complete:')) {
      error = new CommitteeGenerationApiError(400, normalizedError.message)
    } else if (normalizedError?.message.startsWith('Format fidelity check failed:')) {
      error = new CommitteeGenerationApiError(422, normalizedError.message)
    }

    if (agendaId && batchId && isMissingSegmentsError(error)) {
      try {
        const context = await requireWritableMeetingContext(meetingId)
        await saveMomDraftFailureWithClient({
          supabase: context.adminSupabase,
          meetingId,
          batchId,
          agendaId,
          status: 'skipped',
          message: error.message,
          stage: error.stage,
        })
      } catch {
        // Keep the original skipped response even if the draft row could not be updated.
      }

      return NextResponse.json({
        ok: true,
        status: 'skipped',
        message: error.message,
      })
    }

    if (agendaId && batchId) {
      try {
        const context = await requireWritableMeetingContext(meetingId)
        await saveMomDraftFailureWithClient({
          supabase: context.adminSupabase,
          meetingId,
          batchId,
          agendaId,
          status: 'failed',
          message: error instanceof Error ? error.message : 'Failed to generate draft minutes',
          stage: error instanceof AgendaMinuteGenerationError ? error.stage : 'route',
        })
      } catch {
        // Keep the original route failure even if the draft row could not be updated.
      }
    }

    const { status, message } = serializeCommitteeGenerationApiError(error, 'Failed to generate draft minutes')
    const stage = error instanceof AgendaMinuteGenerationError ? error.stage : 'route'
    console.error('[api/meeting/[id]/agenda-generate-draft] failed', {
      stage,
      status,
      message,
      agendaId,
      batchId,
    })
    return NextResponse.json({ ok: false, message }, { status })
  }
}
