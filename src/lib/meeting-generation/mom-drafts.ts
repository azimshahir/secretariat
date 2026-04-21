import { uuidSchema } from '@/lib/validation'
import type {
  MomGenerationBatch as MomGenerationBatchRecord,
  MomGenerationDraft as MomGenerationDraftRecord,
} from '@/lib/supabase/types'
import { getCanonicalCurrentMinuteForAgendaId } from './current-minute'
import { listAgendasMissingExactFormattingWithClient } from './generate-minutes'
import { updateAgendaStatusWithClient } from './agenda-status'
import type {
  AppliedMinuteMemoryTraceItem,
  ConfidenceMarker,
  GenerationConfig,
  GenerateMinuteDraftPayload,
  MomDraftBatchSummary,
  MomDraftCheckpointPayload,
  MomDraftBatchWithRows,
  MomDraftCompletedStage,
  MomDraftRow,
  MomDraftStatus,
} from './types'
import type { DatabaseClient } from './shared'
import { inferResolvedOutcomeMode } from './resolved-outcome'

function normalizeMarkers(value: unknown): ConfidenceMarker[] {
  if (!Array.isArray(value)) return []

  return value.flatMap(marker => {
    if (!marker || typeof marker !== 'object') return []
    const candidate = marker as Partial<ConfidenceMarker>
    if (
      typeof candidate.offset !== 'number'
      || typeof candidate.length !== 'number'
      || typeof candidate.score !== 'number'
      || typeof candidate.reason !== 'string'
    ) {
      return []
    }

    return [{
      offset: candidate.offset,
      length: candidate.length,
      original: typeof candidate.original === 'string' ? candidate.original : '',
      score: candidate.score,
      reason: candidate.reason,
    }]
  })
}

function normalizeAppliedMemoryTrace(value: unknown): AppliedMinuteMemoryTraceItem[] {
  if (!Array.isArray(value)) return []

  return value.flatMap(entry => {
    if (!entry || typeof entry !== 'object') return []
    const candidate = entry as Partial<AppliedMinuteMemoryTraceItem>
    if (
      typeof candidate.entryId !== 'string'
      || typeof candidate.scopeType !== 'string'
      || typeof candidate.entryType !== 'string'
      || typeof candidate.title !== 'string'
    ) {
      return []
    }

    const matchedKeywords = Array.isArray(candidate.matchedKeywords)
      ? candidate.matchedKeywords.filter((item): item is string => typeof item === 'string')
      : []
    const matchedSectionHints = Array.isArray(candidate.matchedSectionHints)
      ? candidate.matchedSectionHints.filter((item): item is string => typeof item === 'string')
      : []
    const appliedAs = Array.isArray(candidate.appliedAs)
      ? candidate.appliedAs.filter((item): item is AppliedMinuteMemoryTraceItem['appliedAs'][number] => typeof item === 'string')
      : []

    return [{
      entryId: candidate.entryId,
      scopeType: candidate.scopeType as AppliedMinuteMemoryTraceItem['scopeType'],
      entryType: candidate.entryType as AppliedMinuteMemoryTraceItem['entryType'],
      title: candidate.title,
      matchedKeywords,
      matchedSectionHints,
      openingOnly: Boolean(candidate.openingOnly),
      appliedAs,
    }]
  })
}

function mapBatchRecord(record: MomGenerationBatchRecord): MomDraftBatchSummary {
  return {
    id: record.id,
    meetingId: record.meeting_id,
    isActive: Boolean(record.is_active),
    importedAt: record.imported_at ?? null,
    generationConfig: record.generation_config && typeof record.generation_config === 'object'
      ? record.generation_config as GenerationConfig
      : null,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  }
}

function mapDraftRecord(record: MomGenerationDraftRecord): MomDraftRow {
  return {
    id: record.id,
    batchId: record.batch_id,
    meetingId: record.meeting_id,
    agendaId: record.agenda_id,
    sourceAgendaRevision: record.source_agenda_revision ?? null,
    status: record.status as MomDraftStatus,
    content: record.content ?? null,
    markers: normalizeMarkers(record.confidence_data),
    appliedMemoryTrace: normalizeAppliedMemoryTrace(record.applied_memory_trace),
    prompt1Output: record.prompt_1_output ?? null,
    prompt2Output: record.prompt_2_output ?? null,
    summaryPaper: record.summary_paper ?? null,
    summaryDiscussion: record.summary_discussion ?? null,
    summaryHeated: record.summary_heated ?? null,
    resolvedOutcomeMode: inferResolvedOutcomeMode({
      resolvedOutcomeMode: record.resolved_outcome_mode,
      resolutionVariantKey: null,
      content: record.content ?? null,
    }),
    attemptCount: record.attempt_count ?? 0,
    lastCompletedStage: (record.last_completed_stage as MomDraftCompletedStage | null) ?? null,
    lastErrorStage: record.last_error_stage ?? null,
    lastAttemptStartedAt: record.last_attempt_started_at ?? null,
    lastAttemptFinishedAt: record.last_attempt_finished_at ?? null,
    errorMessage: record.error_message ?? null,
    generatedAt: record.generated_at ?? null,
    importedAt: record.imported_at ?? null,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  }
}

function stripAppliedMemoryTraceColumn(row: Record<string, unknown>) {
  if (!Object.prototype.hasOwnProperty.call(row, 'applied_memory_trace')) {
    return row
  }

  const nextRow = { ...row }
  delete nextRow.applied_memory_trace
  return nextRow
}

function isMissingAppliedMemoryTraceColumnMessage(
  message: string,
  table: 'mom_generation_drafts' | 'minutes',
) {
  return message.includes(`'applied_memory_trace' column of '${table}'`)
}

async function listDraftRowsForBatch(
  supabase: DatabaseClient,
  batchId: string,
): Promise<MomDraftRow[]> {
  const { data, error } = await supabase
    .from('mom_generation_drafts')
    .select('*')
    .eq('batch_id', batchId)
    .order('created_at', { ascending: true })

  if (error) {
    throw new Error(error.message)
  }

  return (data ?? []).map(mapDraftRecord)
}

async function upsertDraftRow(
  supabase: DatabaseClient,
  row: Record<string, unknown>,
) {
  const { error } = await supabase
    .from('mom_generation_drafts')
    .upsert(row, {
      onConflict: 'batch_id,agenda_id',
    })

  if (error) {
    throw new Error(error.message)
  }
}

async function getDraftRowRecord(
  supabase: DatabaseClient,
  identifiers: {
    batchId: string
    meetingId: string
    agendaId: string
  },
) {
  const { data, error } = await supabase
    .from('mom_generation_drafts')
    .select('*')
    .eq('batch_id', uuidSchema.parse(identifiers.batchId))
    .eq('meeting_id', uuidSchema.parse(identifiers.meetingId))
    .eq('agenda_id', uuidSchema.parse(identifiers.agendaId))
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return data ? mapDraftRecord(data) : null
}

async function updateDraftRowWithExpectedStatuses(
  supabase: DatabaseClient,
  identifiers: {
    batchId: string
    meetingId: string
    agendaId: string
  },
  row: Record<string, unknown>,
  expectedStatuses: MomDraftStatus[],
) {
  const runUpdate = async (payload: Record<string, unknown>) => {
    let query = supabase
      .from('mom_generation_drafts')
      .update(payload)
      .eq('batch_id', uuidSchema.parse(identifiers.batchId))
      .eq('meeting_id', uuidSchema.parse(identifiers.meetingId))
      .eq('agenda_id', uuidSchema.parse(identifiers.agendaId))

    if (expectedStatuses.length === 1) {
      query = query.eq('status', expectedStatuses[0])
    } else if (expectedStatuses.length > 1) {
      query = query.in('status', expectedStatuses)
    }

    return await query
      .select('id')
      .maybeSingle()
  }

  let { data, error } = await runUpdate(row)

  if (error && isMissingAppliedMemoryTraceColumnMessage(error.message, 'mom_generation_drafts')) {
    ;({ data, error } = await runUpdate(stripAppliedMemoryTraceColumn(row)))
  }

  if (error) {
    throw new Error(error.message)
  }

  return Boolean(data?.id)
}

async function updateDraftRowWithExpectedStatusesReturningRecord(
  supabase: DatabaseClient,
  identifiers: {
    batchId: string
    meetingId: string
    agendaId: string
  },
  row: Record<string, unknown>,
  expectedStatuses: MomDraftStatus[],
) {
  const runUpdate = async (payload: Record<string, unknown>) => {
    let query = supabase
      .from('mom_generation_drafts')
      .update(payload)
      .eq('batch_id', uuidSchema.parse(identifiers.batchId))
      .eq('meeting_id', uuidSchema.parse(identifiers.meetingId))
      .eq('agenda_id', uuidSchema.parse(identifiers.agendaId))

    if (expectedStatuses.length === 1) {
      query = query.eq('status', expectedStatuses[0])
    } else if (expectedStatuses.length > 1) {
      query = query.in('status', expectedStatuses)
    }

    return await query
      .select('*')
      .maybeSingle()
  }

  let { data, error } = await runUpdate(row)

  if (error && isMissingAppliedMemoryTraceColumnMessage(error.message, 'mom_generation_drafts')) {
    ;({ data, error } = await runUpdate(stripAppliedMemoryTraceColumn(row)))
  }

  if (error) {
    throw new Error(error.message)
  }

  return data ? mapDraftRecord(data) : null
}

export async function getActiveMomDraftBatchForMeeting(
  supabase: DatabaseClient,
  meetingId: string,
): Promise<MomDraftBatchWithRows | null> {
  const safeMeetingId = uuidSchema.parse(meetingId)
  const { data: batch, error } = await supabase
    .from('mom_generation_batches')
    .select('*')
    .eq('meeting_id', safeMeetingId)
    .eq('is_active', true)
    .is('imported_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }
  if (!batch) return null

  return {
    batch: mapBatchRecord(batch),
    rows: await listDraftRowsForBatch(supabase, batch.id),
  }
}

export async function createOrResetMomDraftBatchWithClient(params: {
  supabase: DatabaseClient
  meetingId: string
  userId: string
  agendaIds: string[]
  generationConfig: GenerationConfig
}) {
  const meetingId = uuidSchema.parse(params.meetingId)
  const agendaIds = Array.from(new Set(params.agendaIds.map(id => uuidSchema.parse(id))))

  if (params.generationConfig.requireCompleteFormatting && agendaIds.length > 0) {
    const { data: agendas, error: agendaError } = await params.supabase
      .from('agendas')
      .select('id, agenda_no, title, format_template_id, minute_playbook_id')
      .eq('meeting_id', meetingId)
      .in('id', agendaIds)

    if (agendaError) {
      throw new Error(agendaError.message)
    }

    const missingFormatting = await listAgendasMissingExactFormattingWithClient({
      supabase: params.supabase,
      agendas: agendas ?? [],
    })
    if (missingFormatting.length > 0) {
      const list = missingFormatting
        .slice(0, 8)
        .map(agenda => `${agenda.agenda_no} ${agenda.title}`)
        .join(', ')
      throw new Error(`Format not complete: ${list}`)
    }
  }

  const { error: deactivateError } = await params.supabase
    .from('mom_generation_batches')
    .update({ is_active: false })
    .eq('meeting_id', meetingId)
    .eq('is_active', true)
    .is('imported_at', null)

  if (deactivateError) {
    throw new Error(deactivateError.message)
  }

  const { data: insertedBatch, error: batchError } = await params.supabase
    .from('mom_generation_batches')
    .insert({
      meeting_id: meetingId,
      created_by: params.userId,
      is_active: true,
      generation_config: params.generationConfig,
    })
    .select('*')
    .single()

  if (batchError || !insertedBatch) {
    throw new Error(batchError?.message ?? 'Failed to create MoM draft batch')
  }

  if (agendaIds.length > 0) {
    const { error: draftsError } = await params.supabase
      .from('mom_generation_drafts')
      .insert(
        agendaIds.map(agendaId => ({
          batch_id: insertedBatch.id,
          meeting_id: meetingId,
          agenda_id: agendaId,
          status: 'pending',
        })),
      )

    if (draftsError) {
      throw new Error(draftsError.message)
    }
  }

  const { error: meetingStatusError } = await params.supabase
    .from('meetings')
    .update({ status: 'generating' })
    .eq('id', meetingId)

  if (meetingStatusError) {
    throw new Error(meetingStatusError.message)
  }

  return {
    batch: mapBatchRecord(insertedBatch),
    rows: await listDraftRowsForBatch(params.supabase, insertedBatch.id),
  } satisfies MomDraftBatchWithRows
}

export async function markMomDraftRunningWithClient(params: {
  supabase: DatabaseClient
  meetingId: string
  batchId: string
  agendaId: string
}) {
  const existingRow = await getDraftRowRecord(params.supabase, {
    batchId: params.batchId,
    meetingId: params.meetingId,
    agendaId: params.agendaId,
  })
  const now = new Date().toISOString()
  const nextAttemptCount = (existingRow?.attemptCount ?? 0) + 1

  if (existingRow) {
    const updatedRow = await updateDraftRowWithExpectedStatusesReturningRecord(
      params.supabase,
      {
        batchId: params.batchId,
        meetingId: params.meetingId,
        agendaId: params.agendaId,
      },
      {
        status: 'running',
        error_message: null,
        last_error_stage: null,
        last_attempt_started_at: now,
        last_attempt_finished_at: null,
        attempt_count: nextAttemptCount,
      },
      ['pending', 'failed', 'running', 'done', 'skipped', 'imported'],
    )

    if (updatedRow) {
      return updatedRow
    }

    throw new Error('MoM draft row is no longer retryable')
  }

  await upsertDraftRow(params.supabase, {
    batch_id: uuidSchema.parse(params.batchId),
    meeting_id: uuidSchema.parse(params.meetingId),
    agenda_id: uuidSchema.parse(params.agendaId),
    status: 'running',
    error_message: null,
    last_error_stage: null,
    last_attempt_started_at: now,
    last_attempt_finished_at: null,
    attempt_count: nextAttemptCount,
  })

  return await getDraftRowRecord(params.supabase, {
    batchId: params.batchId,
    meetingId: params.meetingId,
    agendaId: params.agendaId,
  })
}

export async function importMomDraftAgendaWithClient(params: {
  supabase: DatabaseClient
  meetingId: string
  batchId: string
  agendaId: string
  userId: string
  organizationId?: string | null
}) {
  const meetingId = uuidSchema.parse(params.meetingId)
  const batchId = uuidSchema.parse(params.batchId)
  const agendaId = uuidSchema.parse(params.agendaId)

  const { data: batch, error: batchError } = await params.supabase
    .from('mom_generation_batches')
    .select('*')
    .eq('id', batchId)
    .eq('meeting_id', meetingId)
    .maybeSingle()

  if (batchError) {
    throw new Error(batchError.message)
  }
  if (!batch) {
    throw new Error('MoM draft batch not found')
  }
  if (!batch.is_active || batch.imported_at) {
    throw new Error('This MoM draft batch is no longer active')
  }

  const { data: draftRecord, error: draftError } = await params.supabase
    .from('mom_generation_drafts')
    .select('*')
    .eq('batch_id', batchId)
    .eq('meeting_id', meetingId)
    .eq('agenda_id', agendaId)
    .maybeSingle()

  if (draftError) {
    throw new Error(draftError.message)
  }
  if (!draftRecord) {
    throw new Error('Draft minutes are not available for this agenda yet')
  }

  const draft = mapDraftRecord(draftRecord)
  if (draft.status === 'imported') {
    const existingMinute = await getCanonicalCurrentMinuteForAgendaId<{ id: string; agenda_id: string }>({
      supabase: params.supabase,
      agendaId,
    })

    if (!existingMinute?.id) {
      throw new Error('This draft was already committed, but the current minute could not be found')
    }

    return {
      minuteId: existingMinute.id,
      draft,
      batchDeactivated: false,
    }
  }

  if (draft.status !== 'done') {
    throw new Error('Draft minutes are not ready to commit yet')
  }

  const { commitMinuteDraftToCurrentMinutesWithClient } = await import('./generate-minutes')
  const minuteId = await commitMinuteDraftToCurrentMinutesWithClient({
    supabase: params.supabase,
    agendaId,
    userId: params.userId,
    organizationId: params.organizationId,
    draft: {
      content: draft.content ?? '',
      markers: draft.markers,
      appliedMemoryTrace: draft.appliedMemoryTrace ?? null,
      sourceAgendaRevision: draft.sourceAgendaRevision,
      prompt1Output: draft.prompt1Output ?? '',
      prompt2Output: draft.prompt2Output ?? '',
      summaryPaper: draft.summaryPaper,
      summaryDiscussion: draft.summaryDiscussion,
      summaryHeated: draft.summaryHeated,
      resolvedOutcomeMode: draft.resolvedOutcomeMode ?? null,
      resolutionVariantKey: draft.resolutionVariantKey ?? null,
      resolutionVariantLabel: draft.resolutionVariantLabel ?? null,
      resolutionVariantSource: draft.resolutionVariantSource ?? null,
      resolutionExactRenderEnforced: draft.resolutionExactRenderEnforced ?? false,
    },
  })

  const importedAt = new Date().toISOString()
  const didMarkImported = await updateDraftRowWithExpectedStatuses(
    params.supabase,
    {
      batchId,
      meetingId,
      agendaId,
    },
    {
      status: 'imported',
      imported_at: importedAt,
    },
    ['done'],
  )

  if (!didMarkImported) {
    throw new Error('Draft minutes changed before they could be committed')
  }

  const { count: remainingCount, error: remainingError } = await params.supabase
    .from('mom_generation_drafts')
    .select('id', { count: 'exact', head: true })
    .eq('batch_id', batchId)
    .eq('meeting_id', meetingId)
    .neq('status', 'imported')

  if (remainingError) {
    throw new Error(remainingError.message)
  }

  const batchDeactivated = (remainingCount ?? 0) === 0
  if (batchDeactivated) {
    const { error: batchUpdateError } = await params.supabase
      .from('mom_generation_batches')
      .update({
        is_active: false,
        imported_at: importedAt,
      })
      .eq('id', batchId)

    if (batchUpdateError) {
      throw new Error(batchUpdateError.message)
    }

    const { error: meetingUpdateError } = await params.supabase
      .from('meetings')
      .update({ status: 'in_progress' })
      .eq('id', meetingId)

    if (meetingUpdateError) {
      throw new Error(meetingUpdateError.message)
    }
  }

  return {
    minuteId,
    draft,
    batchDeactivated,
  }
}

export async function updateMomDraftContentWithClient(params: {
  supabase: DatabaseClient
  meetingId: string
  batchId: string
  agendaId: string
  content: string
}) {
  const updatedDraft = await updateDraftRowWithExpectedStatusesReturningRecord(
    params.supabase,
    {
      batchId: params.batchId,
      meetingId: params.meetingId,
      agendaId: params.agendaId,
    },
    {
      content: params.content,
      error_message: null,
      updated_at: new Date().toISOString(),
    },
    ['done'],
  )

  if (!updatedDraft) {
    throw new Error('Draft minutes are not ready to edit')
  }

  return updatedDraft
}

export async function saveMomDraftCheckpointWithClient(params: {
  supabase: DatabaseClient
  meetingId: string
  batchId: string
  agendaId: string
  checkpoint: MomDraftCheckpointPayload
}) {
  return await updateDraftRowWithExpectedStatuses(
    params.supabase,
    {
      batchId: params.batchId,
      meetingId: params.meetingId,
      agendaId: params.agendaId,
    },
    {
      source_agenda_revision: params.checkpoint.sourceAgendaRevision,
      prompt_1_output: params.checkpoint.prompt1Output,
      prompt_2_output: params.checkpoint.prompt2Output,
      summary_paper: params.checkpoint.summaryPaper,
      summary_discussion: params.checkpoint.summaryDiscussion,
      summary_heated: params.checkpoint.summaryHeated,
      last_completed_stage: params.checkpoint.lastCompletedStage,
      last_error_stage: null,
    },
    ['running'],
  )
}

export async function saveMomDraftSuccessWithClient(params: {
  supabase: DatabaseClient
  meetingId: string
  batchId: string
  agendaId: string
  draft: GenerateMinuteDraftPayload
}) {
  const finishedAt = new Date().toISOString()

  return await updateDraftRowWithExpectedStatuses(
    params.supabase,
    {
      batchId: params.batchId,
      meetingId: params.meetingId,
      agendaId: params.agendaId,
    },
    {
      status: 'done',
      content: params.draft.content,
      source_agenda_revision: params.draft.sourceAgendaRevision,
      confidence_data: params.draft.markers,
      applied_memory_trace: params.draft.appliedMemoryTrace ?? null,
      prompt_1_output: params.draft.prompt1Output,
      prompt_2_output: params.draft.prompt2Output,
      summary_paper: params.draft.summaryPaper,
      summary_discussion: params.draft.summaryDiscussion,
      summary_heated: params.draft.summaryHeated,
      resolved_outcome_mode: params.draft.resolvedOutcomeMode ?? null,
      error_message: null,
      last_completed_stage: 'final',
      last_error_stage: null,
      generated_at: finishedAt,
      last_attempt_finished_at: finishedAt,
    },
    ['running'],
  )
}

export async function saveMomDraftFailureWithClient(params: {
  supabase: DatabaseClient
  meetingId: string
  batchId: string
  agendaId: string
  status: Extract<MomDraftStatus, 'failed' | 'skipped'>
  message: string
  stage?: string | null
}) {
  const finishedAt = new Date().toISOString()

  return await updateDraftRowWithExpectedStatuses(
    params.supabase,
    {
      batchId: params.batchId,
      meetingId: params.meetingId,
      agendaId: params.agendaId,
    },
    {
      status: params.status,
      error_message: params.message,
      last_error_stage: params.stage ?? null,
      last_attempt_finished_at: finishedAt,
    },
    ['pending', 'running'],
  )
}

export async function importMomDraftBatchWithClient(params: {
  supabase: DatabaseClient
  meetingId: string
  batchId: string
  userId: string
  organizationId?: string | null
}) {
  const meetingId = uuidSchema.parse(params.meetingId)
  const batchId = uuidSchema.parse(params.batchId)

  const { data: batch, error: batchError } = await params.supabase
    .from('mom_generation_batches')
    .select('*')
    .eq('id', batchId)
    .eq('meeting_id', meetingId)
    .maybeSingle()

  if (batchError) {
    throw new Error(batchError.message)
  }
  if (!batch) {
    throw new Error('MoM draft batch not found')
  }
  if (!batch.is_active || batch.imported_at) {
    throw new Error('This MoM draft batch has already been imported')
  }

  const { data: draftRows, error: draftError } = await params.supabase
    .from('mom_generation_drafts')
    .select('*')
    .eq('batch_id', batchId)
    .eq('meeting_id', meetingId)
    .eq('status', 'done')

  if (draftError) {
    throw new Error(draftError.message)
  }

  const draftAgendaIds = (draftRows ?? []).map(draft => draft.agenda_id)
  const { data: agendaRows, error: agendaError } = draftAgendaIds.length > 0
    ? await params.supabase
      .from('agendas')
      .select('id, is_skipped')
      .in('id', draftAgendaIds)
    : { data: [], error: null }

  if (agendaError) {
    throw new Error(agendaError.message)
  }

  const skippedAgendaIds = new Set(
    (agendaRows ?? [])
      .filter(agenda => agenda.is_skipped)
      .map(agenda => agenda.id),
  )
  const drafts = (draftRows ?? [])
    .map(mapDraftRecord)
    .filter(draft => !skippedAgendaIds.has(draft.agendaId))

  if (drafts.length === 0) {
    throw new Error('No successful draft MoM is ready to import')
  }

  const importedAgendaIds: string[] = []
  const { commitMinuteDraftToCurrentMinutesWithClient } = await import('./generate-minutes')
  for (const draft of drafts) {
    await commitMinuteDraftToCurrentMinutesWithClient({
      supabase: params.supabase,
      agendaId: draft.agendaId,
      userId: params.userId,
      organizationId: params.organizationId,
      draft: {
        content: draft.content ?? '',
        markers: draft.markers,
        appliedMemoryTrace: draft.appliedMemoryTrace ?? null,
        sourceAgendaRevision: draft.sourceAgendaRevision,
        prompt1Output: draft.prompt1Output ?? '',
        prompt2Output: draft.prompt2Output ?? '',
        summaryPaper: draft.summaryPaper,
        summaryDiscussion: draft.summaryDiscussion,
        summaryHeated: draft.summaryHeated,
        resolvedOutcomeMode: draft.resolvedOutcomeMode ?? null,
        resolutionVariantKey: null,
        resolutionVariantLabel: null,
        resolutionVariantSource: null,
        resolutionExactRenderEnforced: false,
      },
    })
    importedAgendaIds.push(draft.agendaId)
  }

  if (importedAgendaIds.length > 0) {
    await updateAgendaStatusWithClient({
      supabase: params.supabase,
      meetingId,
      agendaIds: importedAgendaIds,
      status: 'pending',
    })
  }

  const importedAt = new Date().toISOString()

  const { error: draftUpdateError } = await params.supabase
    .from('mom_generation_drafts')
    .update({
      status: 'imported',
      imported_at: importedAt,
    })
    .eq('batch_id', batchId)
    .eq('meeting_id', meetingId)
    .in('agenda_id', importedAgendaIds)

  if (draftUpdateError) {
    throw new Error(draftUpdateError.message)
  }

  const { error: batchUpdateError } = await params.supabase
    .from('mom_generation_batches')
    .update({
      is_active: false,
      imported_at: importedAt,
    })
    .eq('id', batchId)

  if (batchUpdateError) {
    throw new Error(batchUpdateError.message)
  }

  const { error: meetingUpdateError } = await params.supabase
    .from('meetings')
    .update({ status: 'in_progress' })
    .eq('id', meetingId)

  if (meetingUpdateError) {
    throw new Error(meetingUpdateError.message)
  }

  return {
    importedCount: importedAgendaIds.length,
    importedAgendaIds,
  }
}
