'use client'

import type { AgendaMinuteStatus } from '@/lib/meeting-generation/agenda-status'
import type { ResolvedOutcomeMode } from '@/lib/meeting-generation/resolved-outcome'
import type {
  ConfirmSegmentationResult,
  ResolutionVariantMetadata,
  MomDraftBatchWithRows,
  GenerationConfig,
  MomDraftRow,
  SegmentationPreviewResult,
  TranscriptUploadErrorPayload,
  TranscriptUploadResult,
} from '@/lib/meeting-generation/types'

interface ApiResultShape {
  ok?: boolean
  message?: string
}

export class MeetingGenerationApiError extends Error {
  stage?: string
  code?: string

  constructor(message: string, options?: { stage?: string; code?: string }) {
    super(message)
    this.stage = options?.stage
    this.code = options?.code
  }
}

export function buildDefaultGenerationConfig(
  generationConfig?: Partial<GenerationConfig>,
): GenerationConfig {
  return {
    useTeamsTranscription: false,
    speakerMatchMethod: 'manual',
    languages: ['English'],
    agendaDeviationPrompt: '',
    meetingRulesPrompt: '',
    highlightPrompt: '',
    excludeDeckPoints: false,
    requireCompleteFormatting: true,
    skippedAgendaIds: [],
    forcedResolvedOutcomeModes: {},
    transcriptId: null,
    ...generationConfig,
  }
}

async function readMeetingGenerationApiResult<T extends ApiResultShape>(
  response: Response,
): Promise<T> {
  const contentType = response.headers.get('content-type') ?? ''

  if (contentType.includes('application/json')) {
    return await response.json() as T
  }

  const text = await response.text()
  const titleMatch = text.match(/<title>([^<]+)<\/title>/i)

  return {
    ok: false,
    message: titleMatch?.[1]?.trim() || text.trim() || `Request failed with status ${response.status}`,
  } as T
}

export async function saveMeetingRulesRequest(meetingId: string, rules: string) {
  const response = await fetch(`/api/meeting/${meetingId}/meeting-rules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rules }),
  })

  const result = await readMeetingGenerationApiResult<ApiResultShape>(response)
  if (!response.ok || !result.ok) {
    throw new Error(result.message || 'Failed to save meeting rules')
  }
}

export async function uploadMeetingTranscriptRequest(
  meetingId: string,
  file: File,
  durationSec?: number | null,
) {
  const formData = new FormData()
  formData.set('file', file)
  if (typeof durationSec === 'number' && Number.isFinite(durationSec) && durationSec > 0) {
    formData.set('durationSec', String(Math.round(durationSec)))
  }

  const response = await fetch(`/api/meeting/${meetingId}/transcript`, {
    method: 'POST',
    body: formData,
  })

  const result = await readMeetingGenerationApiResult<ApiResultShape & TranscriptUploadResult & Partial<TranscriptUploadErrorPayload>>(response)
  if (!response.ok || !result.ok || !result.transcriptId) {
    throw new MeetingGenerationApiError(
      result.message || 'Failed to upload transcript',
      { stage: result.stage, code: result.code },
    )
  }

  return {
    transcriptId: result.transcriptId,
    source: result.source,
    storagePath: result.storagePath,
  } satisfies TranscriptUploadResult
}

export async function previewAgendaSegmentationRequest(
  meetingId: string,
  options: {
    transcriptId?: string | null
    useTeamsTranscription: boolean
    agendaDeviationPrompt?: string
    meetingRulesPrompt?: string
    highlightPrompt?: string
  },
) {
  const response = await fetch(`/api/meeting/${meetingId}/agenda-segmentation/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  })

  const result = await readMeetingGenerationApiResult<ApiResultShape & SegmentationPreviewResult>(response)
  if (!response.ok || !result.ok || !result.transcriptId || !Array.isArray(result.rows)) {
    throw new Error(result.message || 'Failed to analyze transcript timeline')
  }

  return {
    transcriptId: result.transcriptId,
    rows: result.rows,
    warnings: result.warnings ?? [],
    durationSec: result.durationSec ?? 0,
  } satisfies SegmentationPreviewResult
}

export async function confirmAgendaSegmentationRequest(
  meetingId: string,
  input: {
    transcriptId: string
    rows: Array<{ agendaId: string; startTime: string; endTime: string }>
    closureRows?: Array<{ agendaId: string; startTime: string; endTime: string }>
  },
) {
  const response = await fetch(`/api/meeting/${meetingId}/agenda-segmentation/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ meetingId, ...input }),
  })

  const result = await readMeetingGenerationApiResult<ApiResultShape & ConfirmSegmentationResult>(response)
  if (!response.ok || !result.ok || typeof result.savedSegmentCount !== 'number') {
    const safeMessage = result.message?.includes('Invalid timecode (HH:MM:SS)')
      ? 'Some timeline rows still have invalid time format. Please review the rows that still use transcription.'
      : result.message
    throw new Error(safeMessage || 'Failed to confirm transcript timeline')
  }

  return {
    savedSegmentCount: result.savedSegmentCount,
  } satisfies ConfirmSegmentationResult
}

export async function generateAgendaMinutesRequest(
  meetingId: string,
  agendaId: string,
  generationConfig?: Partial<GenerationConfig>,
) {
  const effectiveConfig = buildDefaultGenerationConfig(generationConfig)

  const response = await fetch(`/api/meeting/${meetingId}/agenda-generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agendaId, generationConfig: effectiveConfig }),
  })

  const result = await readMeetingGenerationApiResult<ApiResultShape & {
    content?: string
    markers?: Array<{
      offset: number
      length: number
      original: string
      score: number
      reason: string
    }>
    minuteId?: string | null
    resolvedOutcomeMode?: ResolvedOutcomeMode | null
    resolutionVariantKey?: ResolutionVariantMetadata['resolutionVariantKey']
    resolutionVariantLabel?: ResolutionVariantMetadata['resolutionVariantLabel']
    resolutionVariantSource?: ResolutionVariantMetadata['resolutionVariantSource']
    resolutionExactRenderEnforced?: ResolutionVariantMetadata['resolutionExactRenderEnforced']
  }>(response)

  if (!response.ok || !result.ok || typeof result.content !== 'string' || !Array.isArray(result.markers)) {
    throw new Error(result.message || 'Failed to generate minutes')
  }

  return {
    content: result.content,
    markers: result.markers,
    minuteId: result.minuteId ?? null,
    resolvedOutcomeMode: result.resolvedOutcomeMode ?? null,
    resolutionVariantKey: result.resolutionVariantKey ?? null,
    resolutionVariantLabel: result.resolutionVariantLabel ?? null,
    resolutionVariantSource: result.resolutionVariantSource ?? null,
    resolutionExactRenderEnforced: Boolean(result.resolutionExactRenderEnforced),
  }
}

export async function startMomDraftBatchRequest(
  meetingId: string,
  agendaIds: string[],
  generationConfig: GenerationConfig,
) {
  const response = await fetch(`/api/meeting/${meetingId}/mom-drafts/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agendaIds, generationConfig }),
  })

  const result = await readMeetingGenerationApiResult<ApiResultShape & {
    batch?: MomDraftBatchWithRows
  }>(response)

  if (!response.ok || !result.ok || !result.batch) {
    throw new Error(result.message || 'Failed to prepare MoM draft batch')
  }

  return result.batch
}

export async function getActiveMomDraftBatchRequest(meetingId: string) {
  const response = await fetch(`/api/meeting/${meetingId}/mom-drafts/batch`, {
    method: 'GET',
    cache: 'no-store',
  })

  const result = await readMeetingGenerationApiResult<ApiResultShape & {
    batch?: MomDraftBatchWithRows | null
  }>(response)

  if (!response.ok || !result.ok) {
    throw new Error(result.message || 'Failed to load MoM draft batch')
  }

  return result.batch ?? null
}

export async function generateAgendaDraftRequest(
  meetingId: string,
  batchId: string,
  agendaId: string,
  generationConfig?: Partial<GenerationConfig>,
  signal?: AbortSignal,
) {
  const effectiveConfig = buildDefaultGenerationConfig(generationConfig)

  const response = await fetch(`/api/meeting/${meetingId}/agenda-generate-draft`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      agendaId,
      batchId,
      generationConfig: effectiveConfig,
    }),
  })

  const result = await readMeetingGenerationApiResult<ApiResultShape & {
    status?: MomDraftRow['status']
    content?: string
    markers?: MomDraftRow['markers']
    resolvedOutcomeMode?: ResolvedOutcomeMode | null
    resolutionVariantKey?: ResolutionVariantMetadata['resolutionVariantKey']
    resolutionVariantLabel?: ResolutionVariantMetadata['resolutionVariantLabel']
    resolutionVariantSource?: ResolutionVariantMetadata['resolutionVariantSource']
    resolutionExactRenderEnforced?: ResolutionVariantMetadata['resolutionExactRenderEnforced']
  }>(response)

  if (!response.ok || !result.ok || !result.status) {
    throw new Error(result.message || 'Failed to generate draft minutes')
  }

  if (result.status === 'skipped') {
    return {
      status: 'skipped' as const,
      message: result.message || 'No transcript segments assigned to this agenda',
    }
  }

  if (typeof result.content !== 'string' || !Array.isArray(result.markers)) {
    throw new Error(result.message || 'Failed to generate draft minutes')
  }

  return {
    status: 'done' as const,
    content: result.content,
    markers: result.markers,
    resolvedOutcomeMode: result.resolvedOutcomeMode ?? null,
    resolutionVariantKey: result.resolutionVariantKey ?? null,
    resolutionVariantLabel: result.resolutionVariantLabel ?? null,
    resolutionVariantSource: result.resolutionVariantSource ?? null,
    resolutionExactRenderEnforced: Boolean(result.resolutionExactRenderEnforced),
  }
}

export async function commitAgendaDraftRequest(
  meetingId: string,
  batchId: string,
  agendaId: string,
) {
  const response = await fetch(`/api/meeting/${meetingId}/mom-drafts/commit-agenda`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ batchId, agendaId }),
  })

  const result = await readMeetingGenerationApiResult<ApiResultShape & {
    minuteId?: string | null
    batchDeactivated?: boolean
  }>(response)

  if (!response.ok || !result.ok || typeof result.minuteId !== 'string' || result.minuteId.length === 0) {
    throw new Error(result.message || 'Failed to commit draft minutes')
  }

  return {
    minuteId: result.minuteId,
    batchDeactivated: Boolean(result.batchDeactivated),
  }
}

export async function updateAgendaDraftContentRequest(
  meetingId: string,
  batchId: string,
  agendaId: string,
  content: string,
) {
  const response = await fetch(`/api/meeting/${meetingId}/mom-drafts/update-agenda`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ batchId, agendaId, content }),
  })

  const result = await readMeetingGenerationApiResult<ApiResultShape & {
    draft?: MomDraftRow | null
  }>(response)

  if (!response.ok || !result.ok || !result.draft) {
    throw new Error(result.message || 'Failed to update draft minutes')
  }

  return result.draft
}

export async function switchResolvedOutcomeRequest(
  meetingId: string,
  input: {
    agendaId: string
    nextMode: ResolvedOutcomeMode
    minuteContent?: string
    source: 'agent' | 'manual_toggle'
  },
) {
  const response = await fetch(`/api/meeting/${meetingId}/resolved-outcome`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })

  const result = await readMeetingGenerationApiResult<ApiResultShape & {
    minuteId?: string | null
    content?: string
    resolvedOutcomeMode?: ResolvedOutcomeMode | null
    resolutionVariantKey?: ResolutionVariantMetadata['resolutionVariantKey']
    resolutionVariantLabel?: ResolutionVariantMetadata['resolutionVariantLabel']
    resolutionVariantSource?: ResolutionVariantMetadata['resolutionVariantSource']
    resolutionExactRenderEnforced?: ResolutionVariantMetadata['resolutionExactRenderEnforced']
  }>(response)

  if (
    !response.ok
    || !result.ok
    || typeof result.content !== 'string'
    || typeof result.minuteId !== 'string'
    || !result.resolvedOutcomeMode
  ) {
    throw new Error(result.message || 'Failed to switch RESOLVED outcome')
  }

  return {
    minuteId: result.minuteId,
    content: result.content,
    resolvedOutcomeMode: result.resolvedOutcomeMode,
    resolutionVariantKey: result.resolutionVariantKey ?? null,
    resolutionVariantLabel: result.resolutionVariantLabel ?? null,
    resolutionVariantSource: result.resolutionVariantSource ?? null,
    resolutionExactRenderEnforced: Boolean(result.resolutionExactRenderEnforced),
  }
}

export async function failMomDraftRequest(
  meetingId: string,
  batchId: string,
  agendaId: string,
  reason: string,
  stage?: string,
) {
  const response = await fetch(`/api/meeting/${meetingId}/mom-drafts/fail`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ batchId, agendaId, reason, stage }),
  })

  const result = await readMeetingGenerationApiResult<ApiResultShape>(response)
  if (!response.ok || !result.ok) {
    throw new Error(result.message || 'Failed to mark the draft as failed')
  }
}

export async function importMomDraftBatchRequest(
  meetingId: string,
  batchId: string,
) {
  const response = await fetch(`/api/meeting/${meetingId}/mom-drafts/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ batchId }),
  })

  const result = await readMeetingGenerationApiResult<ApiResultShape & {
    importedCount?: number
    importedAgendaIds?: string[]
  }>(response)

  if (!response.ok || !result.ok || typeof result.importedCount !== 'number') {
    throw new Error(result.message || 'Failed to import MoM drafts')
  }

  return {
    importedCount: result.importedCount,
    importedAgendaIds: Array.isArray(result.importedAgendaIds) ? result.importedAgendaIds : [],
  }
}

export async function updateAgendaStatusesRequest(
  meetingId: string,
  agendaIds: string[],
  status: AgendaMinuteStatus,
) {
  const response = await fetch(`/api/meeting/${meetingId}/agenda-status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agendaIds, status }),
  })

  const result = await readMeetingGenerationApiResult<ApiResultShape>(response)
  if (!response.ok || !result.ok) {
    throw new Error(result.message || 'Failed to update agenda status')
  }
}
