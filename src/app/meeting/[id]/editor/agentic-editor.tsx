'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  ArrowLeft, ChevronLeft, ChevronRight,
  AlertTriangle, FileText, Loader2, Save, Sparkles,
} from 'lucide-react'
import { useNavigationTransition } from '@/components/navigation-transition-provider'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { DualChatbot } from '@/components/dual-chatbot'
import type { AiModelOption } from '@/lib/ai/catalog'
import { MinuteEditor } from '@/components/minute-editor'
import { patchJson } from '@/lib/api/client'
import { EMPTY_TEMPLATE_SLOT_VALUE } from '@/lib/meeting-generation/minute-template'
import {
  getResolvedOutcomeLabel,
  inferResolvedOutcomeMode,
  type ResolvedOutcomeMode,
} from '@/lib/meeting-generation/resolved-outcome'
import type { MomDraftBatchWithRows } from '@/lib/meeting-generation/types'
import type { Agenda, Minute } from '@/lib/supabase/types'
import {
  buildDefaultGenerationConfig,
  commitAgendaDraftRequest,
  switchResolvedOutcomeRequest,
} from '../setup/meeting-generation-api'
import { useMomGenerationQueue } from '../setup/use-mom-generation-queue'

interface Props {
  meetingId: string
  agendas: Agenda[]
  activeAgendaId: string
  minute: Minute | null
  initialMomDraftBatch: MomDraftBatchWithRows | null
  returnTab: 'dashboard' | 'agenda' | 'generate' | 'itineraries' | 'settings' | null
  askModelOptions: AiModelOption[]
  defaultAskModelId: string
}

const NORMALIZED_EMPTY_TEMPLATE_SLOT_VALUE = EMPTY_TEMPLATE_SLOT_VALUE.toLowerCase().replace(/\.+$/g, '')

function isNilPlaceholderMinute(value: string) {
  const normalizedLines = value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)

  return normalizedLines.length > 0 && normalizedLines.every(line => (
    line.toLowerCase().replace(/\.+$/g, '') === NORMALIZED_EMPTY_TEMPLATE_SLOT_VALUE
  ))
}

function getQueueBadgeClasses(kind: 'queued' | 'running' | 'ready' | 'retry' | 'failed') {
  if (kind === 'running') return 'border-blue-200 bg-blue-100 text-blue-700'
  if (kind === 'queued') return 'border-violet-200 bg-violet-100 text-violet-700'
  if (kind === 'ready') return 'border-emerald-200 bg-emerald-100 text-emerald-700'
  if (kind === 'retry') return 'border-amber-200 bg-amber-100 text-amber-700'
  return 'border-red-200 bg-red-100 text-red-700'
}

export function AgenticEditor({
  meetingId,
  agendas,
  activeAgendaId,
  minute,
  initialMomDraftBatch,
  returnTab,
  askModelOptions,
  defaultAskModelId,
}: Props) {
  const router = useRouter()
  const { push } = useNavigationTransition()
  const activeIndex = agendas.findIndex(a => a.id === activeAgendaId)
  const activeAgenda = agendas[activeIndex]
  const hasPrev = activeIndex > 0
  const hasNext = activeIndex < agendas.length - 1

  const backHref = returnTab
    ? `/meeting/${meetingId}/setup?tab=${returnTab}`
    : `/meeting/${meetingId}/setup`

  const [content, setContent] = useState(minute?.content ?? '')
  const [confidenceData, setConfidenceData] = useState(minute?.confidence_data ?? [])
  const [minuteId, setMinuteId] = useState<string | null>(minute?.id ?? null)
  const [selectedText, setSelectedText] = useState('')
  const [hasTranscript, setHasTranscript] = useState(Boolean(minute?.prompt_1_output))
  const [resolvedOutcomeMode, setResolvedOutcomeMode] = useState<ResolvedOutcomeMode | null>(
    () => inferResolvedOutcomeMode({
      resolvedOutcomeMode: minute?.resolved_outcome_mode ?? null,
      content: minute?.content ?? '',
    }),
  )
  const [saving, setSaving] = useState(false)
  const [switchingResolvedOutcome, setSwitchingResolvedOutcome] = useState(false)
  const [pendingResolvedOutcomeMode, setPendingResolvedOutcomeMode] = useState<ResolvedOutcomeMode | null>(null)
  const [committingDraft, setCommittingDraft] = useState(false)
  const generationQueue = useMomGenerationQueue(agendas, initialMomDraftBatch)
  const {
    state: generationState,
    startGeneration,
    clearDraftMinutes,
  } = generationQueue
  const autoCommitAgendaIdRef = useRef<string | null>(null)
  const autoCommitAttemptKeyRef = useRef<string | null>(null)
  const hasGeneratedContent = content.trim().length > 0
  const showNilPlaceholderWarning = isNilPlaceholderMinute(content)
  const activeRunState = generationState.runStateByAgendaId[activeAgendaId] ?? 'pending'
  const activeDraftMinute = generationState.draftMinutesByAgenda[activeAgendaId]
  const activeDraftRow = generationState.draftRowsByAgendaId[activeAgendaId]
  const activeErrorMessage = generationState.errorByAgendaId[activeAgendaId] ?? ''
  const activeDraftCommitKey = generationState.activeBatch?.id && activeDraftRow?.id
    ? `${generationState.activeBatch.id}:${activeDraftRow.id}:${activeDraftRow.updatedAt}`
    : null
  const canResumeCurrentAgenda = generationState.resumableAgendaIds.includes(activeAgendaId)
    && Boolean(generationState.lastGenerationConfig)
  const isCurrentAgendaQueued = activeRunState === 'queued'
  const isCurrentAgendaRunning = activeRunState === 'running'
  const isCurrentAgendaFailed = activeRunState === 'failed'
  const isAnotherAgendaRunning = generationState.isGenerating
    && generationState.currentAgendaId !== null
    && generationState.currentAgendaId !== activeAgendaId
  const hasQueueResult = Boolean(activeDraftMinute?.content?.trim())
  const showQueueStatusBadge = isCurrentAgendaQueued
    || isCurrentAgendaRunning
    || committingDraft
    || canResumeCurrentAgenda
    || isCurrentAgendaFailed
    || (activeRunState === 'done' && hasQueueResult)

  // Cleaned transcript available?
  function openTranscriptWindow() {
    window.open(
      `/meeting/${meetingId}/editor/transcript?agenda=${activeAgendaId}`,
      '_blank',
      'width=720,height=800,scrollbars=yes',
    )
  }

  function openSummaryWindow() {
    window.open(
      `/meeting/${meetingId}/editor/summary?agenda=${activeAgendaId}`,
      '_blank',
      'width=720,height=800,scrollbars=yes',
    )
  }

  const navigateAgenda = useCallback((direction: 'prev' | 'next') => {
    const newIndex = direction === 'prev' ? activeIndex - 1 : activeIndex + 1
    const newAgenda = agendas[newIndex]
    if (newAgenda) {
      const href = returnTab
        ? `/meeting/${meetingId}/editor?agenda=${newAgenda.id}&returnTab=${returnTab}`
        : `/meeting/${meetingId}/editor?agenda=${newAgenda.id}`
      push(href)
    }
  }, [activeIndex, agendas, meetingId, push, returnTab])

  const handleGenerate = useCallback(async () => {
    const generationConfig = buildDefaultGenerationConfig(
      generationState.activeBatch?.generationConfig
      ?? generationState.lastGenerationConfig
      ?? undefined,
    )

    const started = await startGeneration({
      agendas: [activeAgenda],
      generationConfig,
      reuseActiveBatch: Boolean(generationState.activeBatch),
    })

    if (!started) return

    autoCommitAgendaIdRef.current = activeAgendaId
    toast.success(
      isAnotherAgendaRunning
        ? `Queued generation for ${activeAgenda.agenda_no}`
        : `Generating minutes for ${activeAgenda.agenda_no}`,
    )
  }, [
    activeAgenda,
    activeAgendaId,
    generationState.activeBatch,
    generationState.lastGenerationConfig,
    isAnotherAgendaRunning,
    startGeneration,
  ])

  const handleSave = useCallback(async () => {
    if (!minuteId) return
    setSaving(true)
    try {
      await patchJson<{ ok: true }>(`/api/meeting/${meetingId}/minute`, {
        minuteId,
        content,
        mode: 'manual',
      })
      toast.success('Minutes saved')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save')
    }
    setSaving(false)
  }, [meetingId, minuteId, content])

  async function handleAiChange(newContent: string) {
    if (!minuteId) {
      const error = new Error('This minute is not ready for chatbot edits yet.')
      toast.error(error.message)
      throw error
    }

    const previousContent = content
    setContent(newContent)

    try {
      await patchJson<{ ok: true }>(`/api/meeting/${meetingId}/minute`, {
        minuteId,
        content: newContent,
        mode: 'ai',
      })
      toast.success('AI change applied')
    } catch (error) {
      setContent(previousContent)
      toast.error(error instanceof Error ? error.message : 'Failed to apply AI change')
      throw error
    }
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const isCmdOrCtrl = event.metaKey || event.ctrlKey
      if (isCmdOrCtrl && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (content && minuteId && !saving && !isCurrentAgendaQueued && !isCurrentAgendaRunning && !committingDraft) handleSave()
      }
      if (isCmdOrCtrl && event.key === 'Enter') {
        event.preventDefault()
        if (!isCurrentAgendaQueued && !isCurrentAgendaRunning && !committingDraft) handleGenerate()
      }
      if (event.altKey && event.key === 'ArrowLeft' && hasPrev) {
        event.preventDefault()
        navigateAgenda('prev')
      }
      if (event.altKey && event.key === 'ArrowRight' && hasNext) {
        event.preventDefault()
        navigateAgenda('next')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    committingDraft,
    content,
    handleGenerate,
    handleSave,
    hasNext,
    hasPrev,
    isCurrentAgendaQueued,
    isCurrentAgendaRunning,
    minuteId,
    navigateAgenda,
    saving,
  ])

  useEffect(() => {
    if (autoCommitAgendaIdRef.current !== activeAgendaId) return
    if (activeRunState !== 'done') return
    if (!activeDraftMinute?.content?.trim()) return
    if (!generationState.activeBatch?.id) return
    if (committingDraft) return

    setCommittingDraft(true)
    void (async () => {
      try {
        const result = await commitAgendaDraftRequest(
          meetingId,
          generationState.activeBatch!.id,
          activeAgendaId,
        )
        setContent(activeDraftMinute.content)
        setConfidenceData(activeDraftRow?.markers ?? [])
        setMinuteId(result.minuteId)
        setHasTranscript(Boolean(activeDraftRow?.prompt1Output?.trim()))
        setResolvedOutcomeMode(activeDraftMinute.resolvedOutcomeMode ?? null)
        if (result.batchDeactivated) {
          clearDraftMinutes()
        }
        toast.success('Minutes generated')
        router.refresh()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to finalize generated minutes')
      } finally {
        autoCommitAgendaIdRef.current = null
        setCommittingDraft(false)
      }
    })()
  }, [
    activeAgendaId,
    activeDraftMinute?.content,
    activeDraftMinute?.resolvedOutcomeMode,
    activeDraftRow?.markers,
    activeDraftRow?.prompt1Output,
    activeRunState,
    clearDraftMinutes,
    committingDraft,
    generationState.activeBatch,
    meetingId,
    router,
  ])

  useEffect(() => {
    if (content.trim()) return
    if (activeRunState !== 'done') return
    if (!activeDraftMinute?.content?.trim()) return

    setContent(activeDraftMinute.content)
    if ((activeDraftRow?.markers?.length ?? 0) > 0) {
      setConfidenceData(activeDraftRow?.markers ?? [])
    }
    if (activeDraftRow?.prompt1Output?.trim()) {
      setHasTranscript(true)
    }
    setResolvedOutcomeMode(activeDraftMinute.resolvedOutcomeMode ?? null)
  }, [
    activeDraftMinute?.content,
    activeDraftMinute?.resolvedOutcomeMode,
    activeDraftRow?.markers,
    activeDraftRow?.prompt1Output,
    activeRunState,
    content,
  ])

  useEffect(() => {
    const shouldRecoverAutoCommit = !minuteId && !committingDraft && activeRunState === 'done'
      && Boolean(activeDraftMinute?.content?.trim())
      && Boolean(generationState.activeBatch?.id)
      && Boolean(activeDraftCommitKey)

    if (!shouldRecoverAutoCommit) return
    if (autoCommitAgendaIdRef.current === activeAgendaId) return
    if (autoCommitAttemptKeyRef.current === activeDraftCommitKey) return

    autoCommitAgendaIdRef.current = activeAgendaId
    autoCommitAttemptKeyRef.current = activeDraftCommitKey
  }, [
    activeAgendaId,
    activeDraftCommitKey,
    activeDraftMinute?.content,
    activeRunState,
    committingDraft,
    generationState.activeBatch?.id,
    minuteId,
  ])

  let queueStatusLabel: string | null = null
  let queueStatusKind: 'queued' | 'running' | 'ready' | 'retry' | 'failed' | null = null
  if (committingDraft) {
    queueStatusLabel = 'Finalizing'
    queueStatusKind = 'running'
  } else if (isCurrentAgendaRunning) {
    queueStatusLabel = 'Generating'
    queueStatusKind = 'running'
  } else if (isCurrentAgendaQueued) {
    queueStatusLabel = 'Queued'
    queueStatusKind = 'queued'
  } else if (canResumeCurrentAgenda) {
    queueStatusLabel = 'Retry available'
    queueStatusKind = 'retry'
  } else if (isCurrentAgendaFailed) {
    queueStatusLabel = 'Failed'
    queueStatusKind = 'failed'
  } else if (activeRunState === 'done' && hasQueueResult) {
    queueStatusLabel = 'Draft ready'
    queueStatusKind = 'ready'
  }

  const generateButtonLabel = committingDraft
    ? 'Finalizing...'
    : isCurrentAgendaQueued
      ? 'Queued'
      : isCurrentAgendaRunning
        ? 'Generating...'
        : canResumeCurrentAgenda
          ? 'Resume Generate'
          : isAnotherAgendaRunning
            ? hasGeneratedContent ? 'Queue Regenerate' : 'Queue Generate'
            : hasGeneratedContent
              ? 'Regenerate Minutes'
              : 'Generate Minutes'

  const handleSwitchResolvedOutcome = useCallback(async (
    nextMode: ResolvedOutcomeMode,
    minuteContentOverride?: string,
  ) => {
    const nextContent = minuteContentOverride?.trim() || content.trim()
    if (!nextContent) {
      throw new Error('No minute content is available to switch yet.')
    }

    setSwitchingResolvedOutcome(true)
    setPendingResolvedOutcomeMode(nextMode)
    try {
      const result = await switchResolvedOutcomeRequest(meetingId, {
        agendaId: activeAgendaId,
        nextMode,
        minuteContent: nextContent,
        source: minuteContentOverride ? 'agent' : 'manual_toggle',
      })
      setContent(result.content)
      setMinuteId(result.minuteId)
      setResolvedOutcomeMode(result.resolvedOutcomeMode)
      toast.success(`Agenda outcome switched to ${getResolvedOutcomeLabel(result.resolvedOutcomeMode)}`)
      router.refresh()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to switch agenda outcome'
      toast.error(message)
      throw error instanceof Error ? error : new Error(message)
    } finally {
      setSwitchingResolvedOutcome(false)
      setPendingResolvedOutcomeMode(null)
    }
  }, [activeAgendaId, content, meetingId, router])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(244,250,249,0.9))] px-5 py-4">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            variant="ghost" size="icon"
            onClick={() => { push(backHref) }}
            title={returnTab === 'generate' ? 'Back to Generate MoM' : 'Back to Setup'}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="mx-1 h-5 w-px bg-border" />
          <Button
            variant="ghost" size="icon"
            disabled={!hasPrev}
            onClick={() => navigateAgenda('prev')}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
              {returnTab === 'generate' ? 'Generate MoM Workspace' : 'Agenda Workspace'}
            </p>
            <div className="truncate text-sm">
              <span className="font-semibold text-primary">{activeAgenda.agenda_no}:</span>{' '}
              <span className="truncate">{activeAgenda.title}</span>
              <span className="ml-2 text-xs text-zinc-400">
                ({activeIndex + 1} of {agendas.length})
              </span>
            </div>
          </div>
          <Button
            variant="ghost" size="icon"
            disabled={!hasNext}
            onClick={() => navigateAgenda('next')}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => { void handleGenerate() }}
            disabled={isCurrentAgendaQueued || isCurrentAgendaRunning || committingDraft || switchingResolvedOutcome}
            className="gap-1.5"
          >
            {isCurrentAgendaQueued || isCurrentAgendaRunning || committingDraft
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Sparkles className="h-3.5 w-3.5" />}
            {generateButtonLabel}
          </Button>
          {hasGeneratedContent && minuteId && (
            <div className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white/90 p-1">
              {(['closed', 'follow_up'] as const).map(mode => {
                const isActive = resolvedOutcomeMode === mode
                return (
                  <Button
                    key={mode}
                    size="sm"
                    variant={isActive ? 'default' : 'ghost'}
                    onClick={() => {
                      if (!switchingResolvedOutcome && !isActive) {
                        void handleSwitchResolvedOutcome(mode)
                      }
                    }}
                    disabled={isActive || saving || switchingResolvedOutcome || isCurrentAgendaQueued || isCurrentAgendaRunning || committingDraft}
                    className="h-7 rounded-full px-3 text-xs"
                  >
                    {switchingResolvedOutcome && pendingResolvedOutcomeMode === mode ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        {getResolvedOutcomeLabel(mode)}
                      </span>
                    ) : (
                      getResolvedOutcomeLabel(mode)
                    )}
                  </Button>
                )
              })}
            </div>
          )}
          {hasGeneratedContent && minuteId && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleSave}
              disabled={saving || switchingResolvedOutcome || isCurrentAgendaQueued || isCurrentAgendaRunning || committingDraft}
              className="gap-1.5"
            >
              <Save className="h-3.5 w-3.5" />
              {saving ? 'Saving...' : 'Save'}
            </Button>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden bg-[linear-gradient(180deg,rgba(255,255,255,0.9),rgba(246,251,250,0.74))] xl:flex-row">
        <div className="flex min-h-0 w-full flex-col border-b border-border/70 xl:w-1/2 xl:border-r xl:border-b-0">
        <div className="flex items-center gap-2 border-b border-border/70 bg-white/72 px-4 py-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Generated Minutes
            </h2>
            {showQueueStatusBadge && queueStatusLabel && queueStatusKind ? (
              <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${getQueueBadgeClasses(queueStatusKind)}`}>
                {queueStatusLabel}
              </span>
            ) : null}
            {resolvedOutcomeMode ? (
              <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                resolvedOutcomeMode === 'follow_up'
                  ? 'border-violet-200 bg-violet-100 text-violet-700'
                  : 'border-sky-200 bg-sky-100 text-sky-700'
              }`}>
                {getResolvedOutcomeLabel(resolvedOutcomeMode)}
              </span>
            ) : null}
            {switchingResolvedOutcome ? (
              <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-100 px-2.5 py-1 text-[11px] font-medium text-blue-700">
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Updating outcome
              </span>
            ) : null}
            <div className="ml-auto flex items-center gap-1.5">
              {hasTranscript && (
                <Button
                  size="sm" variant="outline"
                  onClick={openTranscriptWindow}
                  className="gap-1.5 text-xs"
                >
                  <FileText className="h-3.5 w-3.5" />
                  Show Transcript
                </Button>
              )}
              {content && (
                <Button
                  size="sm" variant="outline"
                  onClick={openSummaryWindow}
                  className="gap-1.5 text-xs"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Show Summary
                </Button>
              )}
            </div>
          </div>

          <ScrollArea className="flex-1 bg-white/72">
            {content ? (
              <div className="flex min-h-full flex-col">
                {(canResumeCurrentAgenda || isCurrentAgendaFailed) && activeErrorMessage ? (
                  <div className="mx-4 mt-4 rounded-[18px] border border-amber-200 bg-amber-50/95 px-4 py-3 text-amber-900 shadow-[0_10px_30px_rgba(161,98,7,0.08)]">
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/80 text-amber-600">
                        <AlertTriangle className="h-4 w-4" />
                      </span>
                      <div className="space-y-1">
                        <p className="text-sm font-semibold">
                          {canResumeCurrentAgenda ? 'This draft can resume from its last checkpoint' : 'Draft generation failed'}
                        </p>
                        <p className="text-xs leading-5 text-amber-800/90">
                          {activeErrorMessage}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : null}
                {showNilPlaceholderWarning && (
                  <div className="mx-4 mt-4 rounded-[18px] border border-red-200 bg-red-50/95 px-4 py-3 text-red-900 shadow-[0_10px_30px_rgba(185,28,28,0.08)]">
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/80 text-red-600">
                        <AlertTriangle className="h-4 w-4" />
                      </span>
                      <div className="space-y-1">
                        <p className="text-sm font-semibold">This draft is placeholder-only</p>
                        <p className="text-xs leading-5 text-red-800/90">
                          Every exact-format slot resolved to <span className="rounded bg-white/85 px-1 py-0.5 font-medium text-red-700">{EMPTY_TEMPLATE_SLOT_VALUE}</span>, which usually means the transcript, paper summary, or discussion summary did not yield usable content for this agenda yet. Review the transcript or summary, then click <span className="font-medium">Regenerate Minutes</span>, or edit the minute manually if this agenda truly has nothing to record.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
                <MinuteEditor
                  content={content}
                  confidenceData={confidenceData}
                  onChange={setContent}
                  onSelectionChange={setSelectedText}
                />
              </div>
            ) : isCurrentAgendaQueued || isCurrentAgendaRunning || committingDraft ? (
              <div className="flex min-h-full flex-col items-center justify-center gap-3 px-6 py-16 text-zinc-400">
                <Loader2 className="h-8 w-8 animate-spin" />
                <p className="text-sm">
                  {committingDraft
                    ? 'Finalizing current minute...'
                    : isCurrentAgendaQueued
                      ? 'Queued to generate after the active draft finishes'
                      : 'Generating checkpointed draft...'}
                </p>
                <p className="text-xs">
                  {committingDraft
                    ? 'Committing the finished draft into the live minute editor'
                    : 'Context Cleaning → Cross-Reference → Synthesis'}
                </p>
              </div>
            ) : canResumeCurrentAgenda || isCurrentAgendaFailed ? (
              <div className="flex min-h-full flex-col items-center justify-center gap-3 px-6 py-16 text-zinc-400">
                <AlertTriangle className="h-8 w-8 text-amber-500" />
                <p className="text-sm">
                  {canResumeCurrentAgenda ? 'This agenda can resume from its last checkpoint' : 'The last draft attempt failed'}
                </p>
                {activeErrorMessage ? (
                  <p className="max-w-xl text-center text-xs leading-5 text-zinc-500">
                    {activeErrorMessage}
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="flex min-h-full flex-col items-center justify-center gap-3 px-6 py-16 text-zinc-400">
                <Sparkles className="h-8 w-8" />
                <p className="text-sm">Click Generate Minutes to start</p>
              </div>
            )}
          </ScrollArea>
        </div>

        <div className="flex min-h-0 w-full flex-col bg-white/68 xl:w-1/2">
          <DualChatbot
            meetingId={meetingId}
            agendaId={activeAgendaId}
            minuteContent={content}
            askModelOptions={askModelOptions}
            defaultAskModelId={defaultAskModelId}
            selectedText={selectedText}
            onClearSelection={() => setSelectedText('')}
            onContentChange={handleAiChange}
            onSwitchResolvedOutcome={handleSwitchResolvedOutcome}
          />
        </div>
      </div>
    </div>
  )
}
