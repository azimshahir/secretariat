'use client'

import { useMemo, useState } from 'react'
import {
  Ban,
  CircleAlert,
  CircleCheck,
  Clock3,
  Loader2,
  RefreshCcw,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { parseMomDraftTimeoutSeconds } from '@/lib/meeting-generation/draft-timeout'
import type { Agenda } from '@/lib/supabase/types'
import {
  isMomDraftTimeoutMessage,
  type AgendaRunState,
  type MomGenerationState,
  type StartMomGenerationOptions,
} from './use-mom-generation-queue'

interface DraftMomProgressDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  existingAgendas: Agenda[]
  skippedAgendaIds: string[]
  generationState: MomGenerationState
  onStartGeneration: (options: StartMomGenerationOptions) => Promise<boolean>
  onCancelGeneration: () => void
  onImportDraftBatch: () => Promise<boolean>
}

const BADGE_STYLES: Record<AgendaRunState, string> = {
  pending: 'border-zinc-200 bg-zinc-100 text-zinc-600',
  queued: 'border-violet-200 bg-violet-100 text-violet-700',
  running: 'border-blue-200 bg-blue-100 text-blue-700',
  done: 'border-emerald-200 bg-emerald-100 text-emerald-700',
  failed: 'border-red-200 bg-red-100 text-red-700',
  skipped: 'border-amber-200 bg-amber-100 text-amber-700',
}

function normalizeDraftErrorMessage(message: string) {
  return message.replace(/\s+/g, ' ').trim()
}

function formatDraftErrorMessage(message?: string | null) {
  const normalized = normalizeDraftErrorMessage(message ?? '')
  if (!normalized) return null

  const timeoutSeconds = parseMomDraftTimeoutSeconds(normalized)
  if (timeoutSeconds) {
    return {
      summary: `Generation timed out after ${timeoutSeconds} seconds for this agenda.`,
      details: normalized,
    }
  }

  if (normalized.startsWith('Format not complete:')) {
    return {
      summary: 'Exact formatting is missing or incomplete for this agenda.',
      details: normalized,
    }
  }

  if (normalized.startsWith('Format fidelity check failed:')) {
    return {
      summary: 'Exact-format fidelity check failed for this agenda.',
      details: normalized,
    }
  }

  if (normalized.startsWith('Exact RESOLVED branch could not be rendered:')) {
    return {
      summary: 'Exact RESOLVED branch rendering failed for this agenda.',
      details: normalized,
    }
  }

  if (normalized.startsWith('Resolution path "')) {
    return {
      summary: 'The selected RESOLVED branch is not configured for this playbook.',
      details: normalized,
    }
  }

  if (normalized.startsWith('Exact playbook template could not be rendered')) {
    return {
      summary: 'Exact playbook rendering failed for this agenda.',
      details: normalized,
    }
  }

  if (normalized.toLowerCase().includes('no transcript segments assigned to this agenda')) {
    return {
      summary: 'No transcript segment is mapped to this agenda.',
      details: normalized,
    }
  }

  if (normalized.includes("Invalid schema for response_format 'response'")) {
    if (normalized.startsWith('Playbook variant selection failed')) {
      return {
        summary: 'AI could not validate the playbook selection schema for this agenda.',
        details: normalized,
      }
    }

    if (normalized.startsWith('Prompt 3 template extraction failed')) {
      return {
        summary: 'AI could not validate the exact-template extraction schema for this agenda.',
        details: normalized,
      }
    }

    return {
      summary: 'AI rejected the structured response schema before generation started.',
      details: normalized,
    }
  }

  if (normalized.startsWith('Prompt 1 generation failed')) {
    return {
      summary: 'Transcript cleaning failed for this agenda.',
      details: normalized,
    }
  }

  if (normalized.startsWith('Transcript grounding failed')) {
    return {
      summary: 'Agenda PDF or committee RAG grounding failed for this agenda.',
      details: normalized,
    }
  }

  if (normalized.startsWith('Failed to resolve transcript intelligence preset')) {
    return {
      summary: 'Transcript intelligence preset could not be loaded for this agenda.',
      details: normalized,
    }
  }

  if (normalized.startsWith('Prompt 2 generation failed')) {
    return {
      summary: 'Cross-reference analysis failed for this agenda.',
      details: normalized,
    }
  }

  if (normalized.startsWith('Prompt 3 template extraction failed')) {
    return {
      summary: 'Exact-template extraction failed for this agenda.',
      details: normalized,
    }
  }

  if (normalized.startsWith('Prompt 3 generation failed')) {
    return {
      summary: 'Minute drafting failed for this agenda.',
      details: normalized,
    }
  }

  if (normalized.startsWith('Playbook variant selection failed')) {
    return {
      summary: 'Playbook variant selection failed for this agenda.',
      details: normalized,
    }
  }

  if (normalized.startsWith('Transcript upload failed while')) {
    return {
      summary: 'Transcript upload failed before generation could continue.',
      details: normalized,
    }
  }

  return {
    summary: normalized,
    details: undefined,
  }
}

function getQueueStateLabel(state: AgendaRunState, errorMessage?: string, attemptCount?: number) {
  if (state === 'queued') return 'Queued retry'
  if (state === 'running') return attemptCount && attemptCount > 1 ? 'Running retry' : 'Running'
  if (state === 'done') return 'Done'
  if (state === 'failed') return isMomDraftTimeoutMessage(errorMessage) ? 'Timed Out' : 'Failed'
  if (state === 'skipped') return 'Skipped'
  return 'Pending'
}

function QueueStateBadge({ state, errorMessage, attemptCount }: {
  state: AgendaRunState
  errorMessage?: string
  attemptCount?: number
}) {
  if (state === 'running') {
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${BADGE_STYLES[state]}`}>
        <Loader2 className="h-3 w-3 animate-spin" />
        {getQueueStateLabel(state, errorMessage, attemptCount)}
      </span>
    )
  }

  const Icon = state === 'done'
    ? CircleCheck
    : state === 'failed'
      ? CircleAlert
      : state === 'queued'
        ? RefreshCcw
      : state === 'skipped'
        ? Ban
        : Clock3

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${BADGE_STYLES[state]}`}>
      <Icon className="h-3 w-3" />
      {getQueueStateLabel(state, errorMessage, attemptCount)}
    </span>
  )
}

export function DraftMomProgressDialog({
  open,
  onOpenChange,
  existingAgendas,
  skippedAgendaIds,
  generationState,
  onStartGeneration,
  onCancelGeneration,
  onImportDraftBatch,
}: DraftMomProgressDialogProps) {
  const [isImporting, setIsImporting] = useState(false)
  const skippedAgendaIdSet = useMemo(() => new Set(skippedAgendaIds), [skippedAgendaIds])
  const remainingAgendaIdSet = useMemo(() => new Set(generationState.remainingAgendaIds), [generationState.remainingAgendaIds])
  const resumableAgendaIdSet = useMemo(() => new Set(generationState.resumableAgendaIds), [generationState.resumableAgendaIds])
  const hasDraftBatch = Boolean(generationState.activeBatch)
  const doneDraftCount = Object.entries(generationState.runStateByAgendaId)
    .filter(([agendaId, state]) => state === 'done' && !skippedAgendaIdSet.has(agendaId))
    .length
  const queueSkippedCount = generationState.queueItems.filter(agenda => skippedAgendaIdSet.has(agenda.id)).length
  const queueActiveCount = generationState.queueItems.length - queueSkippedCount
  const idleCompletedCount = generationState.queueItems.filter(agenda => {
    if (skippedAgendaIdSet.has(agenda.id)) return false
    const runState = generationState.runStateByAgendaId[agenda.id] ?? 'pending'
    return runState !== 'pending' && runState !== 'running' && runState !== 'queued'
  }).length
  const failedAgendas = existingAgendas.filter(
    agenda => !skippedAgendaIdSet.has(agenda.id) && generationState.runStateByAgendaId[agenda.id] === 'failed',
  )
  const resumableAgendas = existingAgendas.filter(
    agenda => !skippedAgendaIdSet.has(agenda.id) && resumableAgendaIdSet.has(agenda.id),
  )
  const queuedRetryCount = Object.values(generationState.runStateByAgendaId)
    .filter(state => state === 'queued')
    .length
  const remainingCount = generationState.queueItems.filter(
    agenda => !skippedAgendaIdSet.has(agenda.id) && remainingAgendaIdSet.has(agenda.id),
  ).length
  const interruptedCount = generationState.interruptedAgendaIds.filter(agendaId => !skippedAgendaIdSet.has(agendaId)).length
  const canImportDrafts = !generationState.isGenerating && doneDraftCount > 0 && hasDraftBatch
  const canResumeRemaining = !generationState.isGenerating
    && resumableAgendas.length > 0
    && hasDraftBatch
    && Boolean(generationState.lastGenerationConfig)

  async function handleRegenerateFailed(agendaIds?: string[]) {
    if (!generationState.lastGenerationConfig) {
      return
    }

    const retryAgendas = existingAgendas.filter(agenda =>
      (agendaIds ?? failedAgendas.map(item => item.id)).includes(agenda.id),
    )

    if (retryAgendas.length === 0) {
      return
    }

    await onStartGeneration({
      agendas: retryAgendas,
      generationConfig: {
        ...generationState.lastGenerationConfig,
        skippedAgendaIds,
      },
      reuseActiveBatch: true,
    })
  }

  async function handleResumeRemaining(agendaIds?: string[]) {
    if (!generationState.lastGenerationConfig) {
      return
    }

    const resumeAgendas = existingAgendas.filter(agenda =>
      (agendaIds ?? resumableAgendas.map(item => item.id)).includes(agenda.id),
    )

    if (resumeAgendas.length === 0) {
      return
    }

    await onStartGeneration({
      agendas: resumeAgendas,
      generationConfig: {
        ...generationState.lastGenerationConfig,
        skippedAgendaIds,
      },
      reuseActiveBatch: true,
    })
  }

  async function handleImportDrafts() {
    if (isImporting) return

    setIsImporting(true)
    try {
      await onImportDraftBatch()
    } finally {
      setIsImporting(false)
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[92vh] max-h-[92vh] flex-col overflow-hidden sm:max-w-4xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>Draft MoM Progress</DialogTitle>
          <DialogDescription>
            Watch the batch, resume unfinished agendas, retry failed ones, and import successful drafts from here.
          </DialogDescription>
        </DialogHeader>

        {generationState.queueItems.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-8 text-center text-sm text-zinc-500">
            No active draft batch right now.
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            <div className="shrink-0 rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h4 className="text-sm font-semibold text-zinc-950">Draft queue</h4>
                  <p className="mt-1 text-xs text-zinc-500">
                    {generationState.isGenerating
                      ? generationState.cancelRequested
                        ? 'Cancelling after the current agenda finishes.'
                        : `Generating ${Math.min(generationState.completedCount + 1, generationState.totalCount)} of ${generationState.totalCount}${queuedRetryCount > 0 ? ` (${queuedRetryCount} queued for retry)` : ''}`
                      : queueActiveCount === 0 && queueSkippedCount > 0
                        ? `All ${queueSkippedCount} queued agenda${queueSkippedCount === 1 ? '' : 's'} are marked as Not Minuted.`
                        : canResumeRemaining
                          ? `${interruptedCount > 0 ? 'Generation paused after the batch was interrupted.' : 'Generation paused.'} ${idleCompletedCount} completed, ${remainingCount} remaining${failedAgendas.length > 0 ? `, ${failedAgendas.length} failed` : ''}.`
                          : `Processed ${idleCompletedCount} of ${queueActiveCount} draft agenda${queueActiveCount === 1 ? '' : 's'}.`}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {canResumeRemaining ? (
                    <Button
                      size="sm"
                      onClick={() => { void handleResumeRemaining() }}
                      disabled={isImporting}
                      className="gap-1.5"
                    >
                      <RefreshCcw className="h-3.5 w-3.5" />
                      Resume Remaining ({resumableAgendas.length})
                    </Button>
                  ) : null}

                  {failedAgendas.length > 0 && generationState.lastGenerationConfig ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { void handleRegenerateFailed() }}
                      disabled={isImporting}
                      className="gap-1.5"
                    >
                      <RefreshCcw className="h-3.5 w-3.5" />
                      {generationState.isGenerating ? 'Queue Failed Retry' : 'Regenerate Failed'}
                    </Button>
                  ) : null}

                  {canImportDrafts ? (
                    <Button
                      size="sm"
                      onClick={() => { void handleImportDrafts() }}
                      disabled={generationState.isGenerating || isImporting}
                      className="gap-1.5"
                    >
                      {isImporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                      {isImporting ? 'Importing MoM...' : 'Import MoM'}
                    </Button>
                  ) : null}

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onCancelGeneration}
                    disabled={!generationState.isGenerating || isImporting}
                    className="gap-1.5 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                  >
                    {generationState.cancelRequested && generationState.isGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
                    {generationState.cancelRequested && generationState.isGenerating ? 'Cancelling...' : 'Cancel'}
                  </Button>
                </div>
              </div>

              {generationState.totalCount > 0 ? (
                <div className="mt-4">
                  <div className="h-2 w-full rounded-full bg-blue-100">
                    <div
                      className="h-2 rounded-full bg-blue-600 transition-all duration-500"
                      style={{ width: `${generationState.totalCount === 0 ? 0 : (generationState.completedCount / generationState.totalCount) * 100}%` }}
                    />
                  </div>
                </div>
              ) : null}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto pr-2">
              <div className="space-y-2 pb-1">
                {generationState.queueItems.map(agenda => {
                  const isSkipped = skippedAgendaIdSet.has(agenda.id)
                  const state = isSkipped ? 'skipped' : (generationState.runStateByAgendaId[agenda.id] ?? 'pending')
                  const error = isSkipped ? '' : generationState.errorByAgendaId[agenda.id]
                  const attemptCount = generationState.draftRowsByAgendaId[agenda.id]?.attemptCount
                  const resolutionVariantLabel = generationState.draftRowsByAgendaId[agenda.id]?.resolutionVariantLabel
                  const resolutionVariantSource = generationState.draftRowsByAgendaId[agenda.id]?.resolutionVariantSource
                  const formattedError = formatDraftErrorMessage(error)

                  return (
                    <div key={agenda.id} className="rounded-xl border border-zinc-200 bg-white px-3 py-3">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-zinc-900 break-words">
                            {agenda.agendaNo} - {agenda.title}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                          {resolutionVariantLabel ? (
                            <span className="inline-flex items-center rounded-full border border-teal-200 bg-teal-100 px-2.5 py-1 text-[11px] font-medium text-teal-700">
                              {resolutionVariantLabel}
                            </span>
                          ) : null}
                          {resolutionVariantSource ? (
                            <span className="inline-flex items-center rounded-full border border-zinc-200 bg-zinc-100 px-2.5 py-1 text-[11px] font-medium text-zinc-600">
                              {resolutionVariantSource === 'manual' ? 'Manual override' : 'Auto selected'}
                            </span>
                          ) : null}
                          {state === 'failed' && generationState.lastGenerationConfig ? (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 gap-1.5 px-2 text-xs"
                              onClick={() => { void handleRegenerateFailed([agenda.id]) }}
                              disabled={isImporting}
                            >
                              <RefreshCcw className="h-3 w-3" />
                              {generationState.isGenerating ? 'Queue Regenerate' : 'Regenerate'}
                            </Button>
                          ) : null}

                          <QueueStateBadge state={state} errorMessage={error} attemptCount={attemptCount} />
                        </div>
                      </div>

                      {formattedError ? (
                        <div className="mt-2 space-y-2">
                          <p className="text-xs leading-5 text-red-600">{formattedError.summary}</p>
                          {formattedError.details ? (
                            <details className="rounded-lg border border-red-100 bg-red-50/60 px-3 py-2 text-xs text-zinc-700">
                              <summary className="cursor-pointer font-medium text-red-700">
                                Technical details
                              </summary>
                              <p className="mt-2 whitespace-pre-wrap break-words leading-5 text-red-700">
                                {formattedError.details}
                              </p>
                            </details>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
