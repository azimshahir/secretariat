import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { GenerationConfig, GenerateMinuteDraftPayload } from '@/lib/meeting-generation/types'
import {
  buildMinuteDraftForAgendaWithClient,
  commitMinuteDraftToCurrentMinutesWithClient,
} from '@/lib/meeting-generation/generate-minutes'
import { getActiveMomDraftBatchForMeeting } from '@/lib/meeting-generation/mom-drafts'
import { getCanonicalCurrentMinuteForAgendaId } from '@/lib/meeting-generation/current-minute'
import {
  getMinutePlaybookVariant,
  getMinutePlaybookVariantLabel,
  loadMinutePlaybooksByIds,
} from '@/lib/meeting-generation/minute-playbooks'
import {
  getResolvedOutcomeLabel,
  mapResolvedOutcomeModeToVariantKey,
  type ResolvedOutcomeMode,
} from '@/lib/meeting-generation/resolved-outcome'
import type { Minute } from '@/lib/supabase/types'
import { uuidSchema } from '@/lib/validation'
import {
  requireWritableMeetingContext,
  serializeCommitteeGenerationApiError,
} from '../../../committee-generation/_lib/write-access'

export const runtime = 'nodejs'
export const maxDuration = 300

const bodySchema = z.object({
  agendaId: uuidSchema,
  nextMode: z.enum(['closed', 'follow_up']),
  minuteContent: z.string().optional(),
  source: z.enum(['agent', 'manual_toggle']),
})

function buildFallbackGenerationConfig(): GenerationConfig {
  return {
    useTeamsTranscription: false,
    speakerMatchMethod: 'manual',
    transcriptId: null,
    languages: ['English'],
    agendaDeviationPrompt: '',
    meetingRulesPrompt: '',
    highlightPrompt: '',
    excludeDeckPoints: false,
    requireCompleteFormatting: true,
    skippedAgendaIds: [],
    forcedResolvedOutcomeModes: {},
  }
}

function normalizeMinuteContent(value?: string) {
  const normalized = value?.trim()
  return normalized && normalized.length > 0 ? normalized : null
}

function normalizeMinuteNewlines(value: string) {
  return value.replace(/\r\n?/g, '\n').trim()
}

function extractResolvedBlock(content: string) {
  const normalized = normalizeMinuteNewlines(content)
  const match = normalized.match(/(^|\n)(RESOLVED\s*\n[\s\S]*?)(?=\n[A-Z][A-Z &/()'-]{2,}\n|$)/i)
  return match?.[2]?.trim() ?? ''
}

function mergeResolvedBlockIntoMinute(baseContent: string, resolvedSourceContent: string) {
  const normalizedBase = normalizeMinuteNewlines(baseContent)
  const resolvedBlock = extractResolvedBlock(resolvedSourceContent)
  if (!resolvedBlock) {
    return normalizeMinuteNewlines(resolvedSourceContent) || normalizedBase
  }

  if (!normalizedBase) {
    return resolvedBlock
  }

  const resolvedPattern = /(^|\n)RESOLVED\s*\n[\s\S]*?(?=\n[A-Z][A-Z &/()'-]{2,}\n|$)/i
  if (resolvedPattern.test(normalizedBase)) {
    return normalizedBase.replace(resolvedPattern, `$1${resolvedBlock}`)
  }

  return `${normalizedBase}\n\n${resolvedBlock}`
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const meetingId = uuidSchema.parse(id)
    const { agendaId, nextMode, minuteContent, source } = bodySchema.parse(await request.json())
    const context = await requireWritableMeetingContext(meetingId)

    const { data: agenda, error: agendaError } = await context.adminSupabase
      .from('agendas')
      .select('id, meeting_id, content_revision, minute_playbook_id')
      .eq('id', agendaId)
      .eq('meeting_id', meetingId)
      .maybeSingle()

    if (agendaError) {
      throw new Error(agendaError.message)
    }
    if (!agenda) {
      throw new Error('Agenda not found in this meeting')
    }

    const targetVariantKey = mapResolvedOutcomeModeToVariantKey(nextMode)
    let targetVariantId: string | null = null
    let resolutionVariantLabel: string | null = getResolvedOutcomeLabel(nextMode)
    let resolutionExactRenderEnforced = false

    if (agenda.minute_playbook_id) {
      const playbooks = await loadMinutePlaybooksByIds(context.adminSupabase, [agenda.minute_playbook_id])
      const playbook = playbooks.get(agenda.minute_playbook_id) ?? null
      const targetVariant = getMinutePlaybookVariant(playbook, targetVariantKey)
      if (targetVariant) {
        targetVariantId = targetVariant.id
        resolutionVariantLabel = getMinutePlaybookVariantLabel(targetVariant.variantKey)
        resolutionExactRenderEnforced = true
      }
    }

    const { error: overrideError } = await context.adminSupabase
      .from('agendas')
      .update({ minute_playbook_variant_override_id: targetVariantId })
      .eq('id', agendaId)

    if (overrideError) {
      throw new Error(overrideError.message)
    }

    const normalizedContent = normalizeMinuteContent(minuteContent)
    const currentMinuteForMerge = await getCanonicalCurrentMinuteForAgendaId<Pick<
      Minute,
      | 'id'
      | 'agenda_id'
      | 'content'
      | 'prompt_1_output'
      | 'prompt_2_output'
      | 'summary_paper'
      | 'summary_discussion'
      | 'summary_heated'
    >>({
      supabase: context.adminSupabase,
      agendaId,
      extraColumns: 'content, prompt_1_output, prompt_2_output, summary_paper, summary_discussion, summary_heated',
    })
    let committedDraft: GenerateMinuteDraftPayload

    if (source === 'agent' && normalizedContent) {
      committedDraft = {
        content: normalizedContent,
        markers: [],
        sourceAgendaRevision: agenda.content_revision ?? 1,
        prompt1Output: currentMinuteForMerge?.prompt_1_output ?? '',
        prompt2Output: currentMinuteForMerge?.prompt_2_output ?? '',
        summaryPaper: currentMinuteForMerge?.summary_paper ?? null,
        summaryDiscussion: currentMinuteForMerge?.summary_discussion ?? null,
        summaryHeated: currentMinuteForMerge?.summary_heated ?? null,
        resolvedOutcomeMode: nextMode,
        resolutionVariantKey: targetVariantKey,
        resolutionVariantLabel,
        resolutionVariantSource: 'manual',
        resolutionExactRenderEnforced,
        appliedMemoryTrace: null,
      }
    } else {
      const activeBatch = await getActiveMomDraftBatchForMeeting(context.adminSupabase, meetingId)
      const generationConfig = activeBatch?.batch.generationConfig ?? buildFallbackGenerationConfig()

      committedDraft = await buildMinuteDraftForAgendaWithClient({
        supabase: context.adminSupabase,
        agendaId,
        userId: context.userId,
        organizationId: context.organizationId,
        config: generationConfig,
        runtimeContext: {
          resolvedOutcomeModeOverride: nextMode,
          userPlanTier: context.planTier,
        },
      })

      if (source === 'manual_toggle') {
        const baseMinuteContent = normalizedContent ?? normalizeMinuteContent(currentMinuteForMerge?.content ?? undefined)
        if (baseMinuteContent) {
          committedDraft = {
            ...committedDraft,
            content: mergeResolvedBlockIntoMinute(baseMinuteContent, committedDraft.content),
            markers: [],
          }
        }
      }
    }

    const minuteId = await commitMinuteDraftToCurrentMinutesWithClient({
      supabase: context.adminSupabase,
      agendaId,
      userId: context.userId,
      organizationId: context.organizationId,
      userPlanTier: context.planTier,
      draft: {
        ...committedDraft,
        resolvedOutcomeMode: nextMode,
        resolutionVariantKey: targetVariantKey,
        resolutionVariantLabel,
        resolutionVariantSource: 'manual',
        resolutionExactRenderEnforced,
      },
      changeSummary: source === 'agent'
        ? `Switched RESOLVED outcome to ${getResolvedOutcomeLabel(nextMode)} via Agent`
        : `Switched RESOLVED outcome to ${getResolvedOutcomeLabel(nextMode)}`,
    })

    try {
      await context.adminSupabase
        .from('mom_generation_drafts')
        .update({
          content: committedDraft.content,
          resolved_outcome_mode: nextMode,
        })
        .eq('meeting_id', meetingId)
        .eq('agenda_id', agendaId)
    } catch (error) {
      console.warn('[resolved-outcome/route] failed to sync draft rows', {
        meetingId,
        agendaId,
        message: error instanceof Error ? error.message : String(error),
      })
    }

    return NextResponse.json({
      ok: true,
      minuteId,
      content: committedDraft.content,
      resolvedOutcomeMode: nextMode satisfies ResolvedOutcomeMode,
      resolutionVariantKey: targetVariantKey,
      resolutionVariantLabel,
      resolutionVariantSource: 'manual',
      resolutionExactRenderEnforced,
    })
  } catch (error) {
    const { status, message } = serializeCommitteeGenerationApiError(error, 'Failed to switch RESOLVED outcome')
    return NextResponse.json({ ok: false, message }, { status })
  }
}
