'use client'

import { startTransition, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  buildMomDraftTimeoutMessage,
  isMomDraftRowStale,
  isMomDraftTimeoutMessage as isSharedMomDraftTimeoutMessage,
  MOM_DRAFT_CLIENT_TIMEOUT_MS,
  MOM_DRAFT_CLIENT_TIMEOUT_SECONDS,
} from '@/lib/meeting-generation/draft-timeout'
import type { GenerationConfig, MomDraftBatchWithRows, MomDraftRow } from '@/lib/meeting-generation/types'
import type { Agenda } from '@/lib/supabase/types'
import type { MinuteEntry } from './minute-entry'
import {
  failMomDraftRequest,
  getActiveMomDraftBatchRequest,
  generateAgendaDraftRequest,
  importMomDraftBatchRequest,
  startMomDraftBatchRequest,
} from './meeting-generation-api'

export type AgendaRunState = 'pending' | 'queued' | 'running' | 'done' | 'failed' | 'skipped'

export type DraftMinuteEntry = MinuteEntry

export interface AgendaQueueItem {
  id: string
  agendaNo: string
  title: string
}

export interface MomGenerationState {
  isGenerating: boolean
  cancelRequested: boolean
  currentAgendaId: string | null
  completedCount: number
  totalCount: number
  queueItems: AgendaQueueItem[]
  runStateByAgendaId: Record<string, AgendaRunState>
  errorByAgendaId: Record<string, string>
  draftMinutesByAgenda: Record<string, DraftMinuteEntry>
  draftRowsByAgendaId: Record<string, MomDraftRow>
  activeBatch: MomDraftBatchWithRows['batch'] | null
  lastGenerationConfig: GenerationConfig | null
  remainingAgendaIds: string[]
  resumableAgendaIds: string[]
  interruptedAgendaIds: string[]
  hasResumableAgendas: boolean
}

export interface StartMomGenerationOptions {
  agendas: Agenda[]
  generationConfig: GenerationConfig
  reuseActiveBatch?: boolean
}

const MOM_DRAFT_TIMEOUT_MESSAGE = buildMomDraftTimeoutMessage(MOM_DRAFT_CLIENT_TIMEOUT_SECONDS)
const ACTIVE_BATCH_POLL_INTERVAL_MS = 5000

export function isMomDraftTimeoutMessage(message?: string | null) {
  return isSharedMomDraftTimeoutMessage(message)
}

function buildMomGenerationState(
  base: Omit<MomGenerationState, 'remainingAgendaIds' | 'resumableAgendaIds' | 'hasResumableAgendas'>,
): MomGenerationState {
  const remainingAgendaIds: string[] = []
  const resumableAgendaIds: string[] = []

  for (const [agendaId, runState] of Object.entries(base.runStateByAgendaId)) {
    if (runState === 'pending' || runState === 'queued' || runState === 'running') {
      remainingAgendaIds.push(agendaId)
    }
    if (runState === 'pending') {
      resumableAgendaIds.push(agendaId)
    }
  }

  const resumableAgendaIdSet = new Set(resumableAgendaIds)

  return {
    ...base,
    remainingAgendaIds,
    resumableAgendaIds,
    interruptedAgendaIds: base.interruptedAgendaIds.filter(agendaId => resumableAgendaIdSet.has(agendaId)),
    hasResumableAgendas: resumableAgendaIds.length > 0,
  }
}

const EMPTY_STATE: MomGenerationState = buildMomGenerationState({
  isGenerating: false,
  cancelRequested: false,
  currentAgendaId: null,
  completedCount: 0,
  totalCount: 0,
  queueItems: [],
  runStateByAgendaId: {},
  errorByAgendaId: {},
  draftMinutesByAgenda: {},
  draftRowsByAgendaId: {},
  activeBatch: null,
  lastGenerationConfig: null,
  interruptedAgendaIds: [],
})

function summarizeRun(generated: number, skipped: number, failed: number) {
  return `${generated} done, ${skipped} skipped, ${failed} failed`
}

function createMomDraftTimeoutError() {
  return new Error(MOM_DRAFT_TIMEOUT_MESSAGE)
}

function updateDraftRowState(
  row: MomDraftRow | undefined,
  updates: Partial<MomDraftRow>,
): MomDraftRow | undefined {
  if (!row) return undefined
  return {
    ...row,
    ...updates,
  }
}

async function generateAgendaDraftWithWatchdog(
  batchId: string,
  agenda: Agenda,
  generationConfig: GenerationConfig,
) {
  const controller = new AbortController()
  let timedOut = false
  const timeoutId = globalThis.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, MOM_DRAFT_CLIENT_TIMEOUT_MS)

  try {
    return await generateAgendaDraftRequest(
      agenda.meeting_id,
      batchId,
      agenda.id,
      generationConfig,
      controller.signal,
    )
  } catch (error) {
    if (timedOut) {
      try {
        await failMomDraftRequest(
          agenda.meeting_id,
          batchId,
          agenda.id,
          MOM_DRAFT_TIMEOUT_MESSAGE,
          'request_timeout',
        )
      } catch (timeoutFailureError) {
        if (process.env.NODE_ENV !== 'production') {
          console.error('[useMomGenerationQueue] failed to persist timed out draft', timeoutFailureError)
        }
      }

      throw createMomDraftTimeoutError()
    }

    throw error
  } finally {
    globalThis.clearTimeout(timeoutId)
  }
}

function stateFromBatch(
  batch: MomDraftBatchWithRows | null,
  agendas: Agenda[],
  previousState?: MomGenerationState | null,
): MomGenerationState {
  if (!batch) return EMPTY_STATE

  const rowsByAgendaId = new Map(batch.rows.map(row => [row.agendaId, row]))
  const agendaRevisionById = new Map(agendas.map(agenda => [agenda.id, agenda.content_revision ?? 1]))
  const queueItems = agendas
    .filter(agenda => rowsByAgendaId.has(agenda.id))
    .map(agenda => ({
      id: agenda.id,
      agendaNo: agenda.agenda_no,
      title: agenda.title,
    }))

  const runStateByAgendaId: Record<string, AgendaRunState> = {}
  const errorByAgendaId: Record<string, string> = {}
  const draftMinutesByAgenda: Record<string, DraftMinuteEntry> = {}
  const draftRowsByAgendaId: Record<string, MomDraftRow> = {}
  const interruptedAgendaIds: string[] = []

  for (const row of batch.rows) {
    const isInterruptedRunning = row.status === 'running' && isMomDraftRowStale(row.lastAttemptStartedAt)
    const state = row.status === 'imported'
      ? 'done'
      : isInterruptedRunning
        ? 'pending'
        : row.status
    runStateByAgendaId[row.agendaId] = state
    draftRowsByAgendaId[row.agendaId] = row
    if (isInterruptedRunning) {
      interruptedAgendaIds.push(row.agendaId)
    }
    if (row.errorMessage) {
      errorByAgendaId[row.agendaId] = row.errorMessage
    }
    if (row.content?.trim()) {
      const agendaContentRevision = agendaRevisionById.get(row.agendaId) ?? 1
      const previousMinute = previousState?.draftMinutesByAgenda[row.agendaId]
      const previousRow = previousState?.draftRowsByAgendaId[row.agendaId]
      draftRowsByAgendaId[row.agendaId] = {
        ...row,
        resolutionVariantKey: row.resolutionVariantKey ?? previousRow?.resolutionVariantKey ?? null,
        resolutionVariantLabel: row.resolutionVariantLabel ?? previousRow?.resolutionVariantLabel ?? null,
        resolutionVariantSource: row.resolutionVariantSource ?? previousRow?.resolutionVariantSource ?? null,
        resolutionExactRenderEnforced: row.resolutionExactRenderEnforced ?? previousRow?.resolutionExactRenderEnforced ?? false,
      }
      draftMinutesByAgenda[row.agendaId] = {
        content: row.content,
        updatedAt: row.updatedAt,
        sourceAgendaRevision: row.sourceAgendaRevision ?? null,
        agendaContentRevision,
        isStale: row.sourceAgendaRevision == null || row.sourceAgendaRevision < agendaContentRevision,
        resolvedOutcomeMode: row.resolvedOutcomeMode ?? previousMinute?.resolvedOutcomeMode ?? null,
        resolutionVariantKey: previousMinute?.resolutionVariantKey ?? previousRow?.resolutionVariantKey ?? null,
        resolutionVariantLabel: previousMinute?.resolutionVariantLabel ?? previousRow?.resolutionVariantLabel ?? null,
        resolutionVariantSource: previousMinute?.resolutionVariantSource ?? previousRow?.resolutionVariantSource ?? null,
        resolutionExactRenderEnforced: previousMinute?.resolutionExactRenderEnforced ?? previousRow?.resolutionExactRenderEnforced ?? false,
      }
    }
  }

  const completedCount = batch.rows.filter(row => !['pending', 'running'].includes(row.status)).length

  return buildMomGenerationState({
    isGenerating: false,
    cancelRequested: false,
    currentAgendaId: null,
    completedCount,
    totalCount: batch.rows.length,
    queueItems,
    runStateByAgendaId,
    errorByAgendaId,
    draftMinutesByAgenda,
    draftRowsByAgendaId,
    activeBatch: batch.batch,
    lastGenerationConfig: batch.batch.generationConfig,
    interruptedAgendaIds,
  })
}

export function useMomGenerationQueue(
  agendas: Agenda[],
  initialBatch: MomDraftBatchWithRows | null,
) {
  const router = useRouter()
  const [state, setState] = useState<MomGenerationState>(() => stateFromBatch(initialBatch, agendas))
  const cancelRef = useRef(false)
  const runningRef = useRef(false)
  const queuedRetryAgendasRef = useRef<Map<string, Agenda>>(new Map())
  const queuedRetryConfigRef = useRef<GenerationConfig | null>(null)
  const activeBatchId = state.activeBatch?.id
  const activeBatchMeetingId = state.activeBatch?.meetingId

  useEffect(() => {
    if (runningRef.current) return
    startTransition(() => {
      setState(prev => stateFromBatch(initialBatch, agendas, prev))
    })
  }, [agendas, initialBatch])

  useEffect(() => {
    const meetingId = agendas[0]?.meeting_id ?? activeBatchMeetingId
    if (!meetingId || !activeBatchId) return

    let cancelled = false

    const pollActiveBatch = async () => {
      if (runningRef.current) return

      try {
        const latestBatch = await getActiveMomDraftBatchRequest(meetingId)
        if (cancelled || runningRef.current) return

        startTransition(() => {
          setState(prev => stateFromBatch(latestBatch, agendas, prev))
        })
      } catch (error) {
        if (process.env.NODE_ENV !== 'production') {
          console.error('[useMomGenerationQueue] failed to poll active draft batch', error)
        }
      }
    }

    void pollActiveBatch()
    const intervalId = globalThis.setInterval(pollActiveBatch, ACTIVE_BATCH_POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      globalThis.clearInterval(intervalId)
    }
  }, [activeBatchId, activeBatchMeetingId, agendas])

  function cancelGeneration() {
    if (!runningRef.current) return
    cancelRef.current = true
    setState(prev => ({ ...prev, cancelRequested: true }))
  }

  function resetGenerationState() {
    if (runningRef.current) return
    setState(prev => buildMomGenerationState({
      ...EMPTY_STATE,
      activeBatch: prev.activeBatch,
      queueItems: prev.queueItems,
      runStateByAgendaId: prev.runStateByAgendaId,
      errorByAgendaId: prev.errorByAgendaId,
      draftMinutesByAgenda: prev.draftMinutesByAgenda,
      draftRowsByAgendaId: prev.draftRowsByAgendaId,
      completedCount: prev.completedCount,
      totalCount: prev.totalCount,
      lastGenerationConfig: prev.lastGenerationConfig,
      interruptedAgendaIds: prev.interruptedAgendaIds,
    }))
  }

  function clearDraftMinutes() {
    queuedRetryAgendasRef.current.clear()
    queuedRetryConfigRef.current = null
    setState(prev => buildMomGenerationState({
      ...prev,
      draftMinutesByAgenda: {},
      draftRowsByAgendaId: {},
      queueItems: [],
      runStateByAgendaId: {},
      errorByAgendaId: {},
      currentAgendaId: null,
      completedCount: 0,
      totalCount: 0,
      cancelRequested: false,
      activeBatch: null,
      lastGenerationConfig: prev.lastGenerationConfig,
      interruptedAgendaIds: [],
    }))
  }

  async function importDraftBatch() {
    if (runningRef.current) {
      toast.info('Wait for generation to finish first')
      return false
    }
    if (!state.activeBatch?.id) {
      toast.info('No draft MoM is ready to import')
      return false
    }

    const doneAgendaIds = Object.entries(state.runStateByAgendaId)
      .filter(([, runState]) => runState === 'done')
      .map(([agendaId]) => agendaId)

    if (doneAgendaIds.length === 0) {
      toast.info('No successful draft MoM is ready to import')
      return false
    }

    const result = await importMomDraftBatchRequest(
      agendas[0]?.meeting_id ?? state.activeBatch.meetingId,
      state.activeBatch.id,
    )

    setState(EMPTY_STATE)
    router.refresh()
    toast.success(`Imported ${result.importedCount} draft MoM ${result.importedCount === 1 ? 'agenda' : 'agendas'}`)
    return true
  }

  async function runQueue(runAgendas: Agenda[], generationConfig: GenerationConfig, batchId: string) {
    let processed = 0
    let generated = 0
    let skipped = 0
    let failed = 0

    let currentBatchAgendas = runAgendas
    let currentBatchConfig = generationConfig

    while (currentBatchAgendas.length > 0) {
      for (const agenda of currentBatchAgendas) {
        if (cancelRef.current) break

        queuedRetryAgendasRef.current.delete(agenda.id)

        setState(prev => buildMomGenerationState({
          ...prev,
          currentAgendaId: agenda.id,
          runStateByAgendaId: { ...prev.runStateByAgendaId, [agenda.id]: 'running' },
          errorByAgendaId: { ...prev.errorByAgendaId, [agenda.id]: '' },
          draftRowsByAgendaId: {
            ...prev.draftRowsByAgendaId,
            ...(updateDraftRowState(prev.draftRowsByAgendaId[agenda.id], {
              status: 'running',
              attemptCount: (prev.draftRowsByAgendaId[agenda.id]?.attemptCount ?? 0) + 1,
              errorMessage: null,
              lastErrorStage: null,
              lastAttemptStartedAt: new Date().toISOString(),
              lastAttemptFinishedAt: null,
            }) ? {
              [agenda.id]: updateDraftRowState(prev.draftRowsByAgendaId[agenda.id], {
                status: 'running',
                attemptCount: (prev.draftRowsByAgendaId[agenda.id]?.attemptCount ?? 0) + 1,
                errorMessage: null,
                lastErrorStage: null,
                lastAttemptStartedAt: new Date().toISOString(),
                lastAttemptFinishedAt: null,
              })!,
            } : {}),
          },
        }))

        try {
          const result = await generateAgendaDraftWithWatchdog(batchId, agenda, currentBatchConfig)

          processed += 1

          if (result.status === 'skipped') {
            skipped += 1
            setState(prev => buildMomGenerationState({
              ...prev,
              completedCount: processed,
              runStateByAgendaId: { ...prev.runStateByAgendaId, [agenda.id]: 'skipped' },
              errorByAgendaId: {
                ...prev.errorByAgendaId,
                [agenda.id]: result.message,
              },
              draftRowsByAgendaId: {
                ...prev.draftRowsByAgendaId,
                ...(updateDraftRowState(prev.draftRowsByAgendaId[agenda.id], {
                  status: 'skipped',
                  errorMessage: result.message,
                  lastErrorStage: 'transcript_segment_lookup',
                  lastAttemptFinishedAt: new Date().toISOString(),
                }) ? {
                  [agenda.id]: updateDraftRowState(prev.draftRowsByAgendaId[agenda.id], {
                    status: 'skipped',
                    errorMessage: result.message,
                    lastErrorStage: 'transcript_segment_lookup',
                    lastAttemptFinishedAt: new Date().toISOString(),
                  })!,
                } : {}),
              },
            }))
            continue
          }

          generated += 1
          setState(prev => buildMomGenerationState({
            ...prev,
            completedCount: processed,
            runStateByAgendaId: { ...prev.runStateByAgendaId, [agenda.id]: 'done' },
            draftMinutesByAgenda: {
              ...prev.draftMinutesByAgenda,
              [agenda.id]: {
                content: result.content,
                updatedAt: new Date().toISOString(),
                sourceAgendaRevision: agenda.content_revision ?? 1,
                agendaContentRevision: agenda.content_revision ?? 1,
                isStale: false,
                resolvedOutcomeMode: result.resolvedOutcomeMode ?? null,
                resolutionVariantKey: result.resolutionVariantKey,
                resolutionVariantLabel: result.resolutionVariantLabel,
                resolutionVariantSource: result.resolutionVariantSource,
                resolutionExactRenderEnforced: result.resolutionExactRenderEnforced,
              },
            },
            draftRowsByAgendaId: {
              ...prev.draftRowsByAgendaId,
              ...(updateDraftRowState(prev.draftRowsByAgendaId[agenda.id], {
                status: 'done',
                content: result.content,
                markers: result.markers,
                errorMessage: null,
                  lastCompletedStage: 'final',
                  lastErrorStage: null,
                  lastAttemptFinishedAt: new Date().toISOString(),
                  resolvedOutcomeMode: result.resolvedOutcomeMode ?? null,
                  resolutionVariantKey: result.resolutionVariantKey,
                  resolutionVariantLabel: result.resolutionVariantLabel,
                  resolutionVariantSource: result.resolutionVariantSource,
                  resolutionExactRenderEnforced: result.resolutionExactRenderEnforced,
                }) ? {
                [agenda.id]: updateDraftRowState(prev.draftRowsByAgendaId[agenda.id], {
                  status: 'done',
                  content: result.content,
                  markers: result.markers,
                  errorMessage: null,
                    lastCompletedStage: 'final',
                    lastErrorStage: null,
                    lastAttemptFinishedAt: new Date().toISOString(),
                    resolvedOutcomeMode: result.resolvedOutcomeMode ?? null,
                    resolutionVariantKey: result.resolutionVariantKey,
                    resolutionVariantLabel: result.resolutionVariantLabel,
                    resolutionVariantSource: result.resolutionVariantSource,
                    resolutionExactRenderEnforced: result.resolutionExactRenderEnforced,
                })!,
              } : {}),
            },
          }))
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          processed += 1
          failed += 1
          setState(prev => buildMomGenerationState({
            ...prev,
            completedCount: processed,
            runStateByAgendaId: { ...prev.runStateByAgendaId, [agenda.id]: 'failed' },
            errorByAgendaId: { ...prev.errorByAgendaId, [agenda.id]: message },
            draftRowsByAgendaId: {
              ...prev.draftRowsByAgendaId,
              ...(updateDraftRowState(prev.draftRowsByAgendaId[agenda.id], {
                status: 'failed',
                errorMessage: message,
                lastAttemptFinishedAt: new Date().toISOString(),
              }) ? {
                [agenda.id]: updateDraftRowState(prev.draftRowsByAgendaId[agenda.id], {
                  status: 'failed',
                  errorMessage: message,
                  lastAttemptFinishedAt: new Date().toISOString(),
                })!,
              } : {}),
            },
          }))
        }
      }

      if (cancelRef.current) break

      const queuedRetryAgendas = Array.from(queuedRetryAgendasRef.current.values())
      if (queuedRetryAgendas.length === 0) {
        currentBatchAgendas = []
        continue
      }

      currentBatchAgendas = queuedRetryAgendas
      currentBatchConfig = queuedRetryConfigRef.current ?? currentBatchConfig
      queuedRetryAgendasRef.current.clear()
      queuedRetryConfigRef.current = null
      toast.info(`Retrying ${queuedRetryAgendas.length} queued draft${queuedRetryAgendas.length === 1 ? '' : 's'} now`)
    }

    const wasCancelled = cancelRef.current
    cancelRef.current = false
    runningRef.current = false
    queuedRetryAgendasRef.current.clear()
    queuedRetryConfigRef.current = null

    setState(prev => ({
      ...prev,
      isGenerating: false,
      cancelRequested: false,
      currentAgendaId: null,
    }))

    router.refresh()

    const summary = summarizeRun(generated, skipped, failed)
    if (wasCancelled) {
      toast.info(`Draft generation stopped after current agenda (${summary})`)
      return
    }

    if (failed > 0) {
      toast.error(`Draft generation finished with errors (${summary})`)
      return
    }

    toast.success(`Draft generation finished (${summary})`)
  }

  async function startGeneration({ agendas: runAgendas, generationConfig, reuseActiveBatch = false }: StartMomGenerationOptions) {
    if (runningRef.current) {
      if (!reuseActiveBatch) {
        toast.info('Generation is already running')
        return false
      }

      if (!state.activeBatch) {
        toast.error('No active draft MoM batch is available')
        return false
      }

      if (cancelRef.current || state.cancelRequested) {
        toast.info('Wait for cancellation to finish before queueing another retry')
        return false
      }

      const queuedAgendaIds: string[] = []
      for (const agenda of runAgendas) {
        if (queuedRetryAgendasRef.current.has(agenda.id)) continue
        if (agenda.id === state.currentAgendaId) continue
        queuedRetryAgendasRef.current.set(agenda.id, agenda)
        queuedAgendaIds.push(agenda.id)
      }

      if (queuedAgendaIds.length === 0) {
        toast.info('These agendas are already queued to regenerate')
        return false
      }

        queuedRetryConfigRef.current = {
        ...generationConfig,
        skippedAgendaIds: generationConfig.skippedAgendaIds ?? [],
      }

      setState(prev => buildMomGenerationState({
        ...prev,
        totalCount: prev.totalCount + queuedAgendaIds.length,
        runStateByAgendaId: {
          ...prev.runStateByAgendaId,
          ...Object.fromEntries(queuedAgendaIds.map(agendaId => [agendaId, 'queued' as const])),
        },
        errorByAgendaId: Object.fromEntries(
          Object.entries(prev.errorByAgendaId).filter(([agendaId]) => !queuedAgendaIds.includes(agendaId)),
        ),
        draftRowsByAgendaId: {
          ...prev.draftRowsByAgendaId,
          ...Object.fromEntries(
            queuedAgendaIds.flatMap(agendaId => {
              const updatedRow = updateDraftRowState(prev.draftRowsByAgendaId[agendaId], {
                errorMessage: null,
                lastErrorStage: null,
              })
              return updatedRow ? [[agendaId, updatedRow]] : []
            }),
          ),
        },
        lastGenerationConfig: queuedRetryConfigRef.current,
      }))

      return true
    }

    const effectiveConfig: GenerationConfig = {
      ...generationConfig,
      skippedAgendaIds: generationConfig.skippedAgendaIds ?? [],
    }
    const skippedAgendaIdSet = new Set(effectiveConfig.skippedAgendaIds)
    const filteredRunAgendas = runAgendas.filter(agenda => !skippedAgendaIdSet.has(agenda.id))

    if (filteredRunAgendas.length === 0) {
      toast.info('No agendas to generate')
      return false
    }

    let batch = state.activeBatch
    if (!reuseActiveBatch) {
      const createdBatch = await startMomDraftBatchRequest(
        filteredRunAgendas[0].meeting_id,
        filteredRunAgendas.map(agenda => agenda.id),
        effectiveConfig,
      )
      batch = createdBatch.batch
      setState(buildMomGenerationState({
        ...stateFromBatch(createdBatch, agendas),
        isGenerating: true,
        totalCount: filteredRunAgendas.length,
        completedCount: 0,
        currentAgendaId: filteredRunAgendas[0]?.id ?? null,
        lastGenerationConfig: effectiveConfig,
        interruptedAgendaIds: [],
      }))
    } else {
      if (!batch) {
        toast.error('No active draft MoM batch was found to regenerate')
        return false
      }

      setState(prev => {
        const nextRunStateByAgendaId = { ...prev.runStateByAgendaId }
        const nextErrorByAgendaId = { ...prev.errorByAgendaId }
        const nextDraftRowsByAgendaId = { ...prev.draftRowsByAgendaId }
        const resumedAgendaIdSet = new Set(filteredRunAgendas.map(agenda => agenda.id))
        for (const agenda of filteredRunAgendas) {
          nextRunStateByAgendaId[agenda.id] = 'pending'
          delete nextErrorByAgendaId[agenda.id]
          const updatedRow = updateDraftRowState(nextDraftRowsByAgendaId[agenda.id], {
            errorMessage: null,
            lastErrorStage: null,
          })
          if (updatedRow) {
            nextDraftRowsByAgendaId[agenda.id] = updatedRow
          }
        }
        return buildMomGenerationState({
          ...prev,
          isGenerating: true,
          cancelRequested: false,
          currentAgendaId: filteredRunAgendas[0]?.id ?? null,
          completedCount: 0,
          totalCount: filteredRunAgendas.length,
          runStateByAgendaId: nextRunStateByAgendaId,
          errorByAgendaId: nextErrorByAgendaId,
          draftRowsByAgendaId: nextDraftRowsByAgendaId,
          lastGenerationConfig: effectiveConfig,
          interruptedAgendaIds: prev.interruptedAgendaIds.filter(agendaId => !resumedAgendaIdSet.has(agendaId)),
        })
      })
    }

    if (!batch) {
      toast.error('No active draft MoM batch is available')
      return false
    }

    runningRef.current = true
    cancelRef.current = false
    void runQueue(filteredRunAgendas, effectiveConfig, batch.id)
    return true
  }

  return {
    state,
    startGeneration,
    cancelGeneration,
    resetGenerationState,
    clearDraftMinutes,
    importDraftBatch,
  }
}
