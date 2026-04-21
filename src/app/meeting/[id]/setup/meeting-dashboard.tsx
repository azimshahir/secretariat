'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import {
  Building2,
  CalendarDays,
  LayoutPanelTop,
  Sparkles,
  Waves,
} from 'lucide-react'
import { toast } from 'sonner'

import {
  DashboardPill,
  DashboardSurface,
} from '@/components/dashboard-primitives'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { AgendaSyncPayload } from '@/lib/agenda-columns'
import type { CommitteeSpeaker } from '@/lib/committee-speakers'
import type { MomDraftBatchWithRows } from '@/lib/meeting-generation/types'
import type { Agenda } from '@/lib/supabase/types'
import { AgendaEditor, type AgendaEditorHandle } from './agenda-editor'
import type { AgendaLinkedDataState } from './agenda-linked-data'
import type { AgendaTimelineRow } from './agenda-timeline-row'
import { DashboardTab } from './dashboard-tab'
import { DraftMomProgressDialog } from './draft-mom-progress-dialog'
import { ItinerariesTab } from './itineraries-tab'
import type { MeetingPackConfig } from './meeting-pack-model'
import { MomGenerator } from './mom-generator'
import type { MinuteEntry } from './minute-entry'
import { RagTab } from './rag-tab'
import type { CommitteeRagDocumentSummary } from './rag-types'
import { MatchSpeakerSection } from './match-speaker-section'
import { RulesSection } from './rules-section'
import { SettingsTemplateTab } from './settings-template-tab'
import type { TemplateGroup } from './settings-template-model'
import { SetupBuildGuard } from './setup-build-guard'
import type { AiModelOption } from '@/lib/ai/catalog'
import {
  buildAgendaStepAnalytics,
  buildMeetingPackStepAnalytics,
  deriveWorkspaceStatus,
  deriveWorkflowAutoStatuses,
  getWorkflowActiveStepStorageKey,
  getWorkflowStatusStorageKey,
  isSetupWorkflowStepId,
  type SetupTabValue,
  type SetupWorkflowStepId,
  type StepStatus,
  type StepStatusOverrides,
} from './setup-workflow'
import { useMomGenerationQueue } from './use-mom-generation-queue'

interface Props {
  meetingId: string
  meetingTitle: string
  meetingDate: string
  committeeName: string | null
  committeeId: string | null
  committeeSlug: string | null
  organizationName: string
  existingAgendas: Agenda[]
  agendaFormatPrompts: Record<string, string>
  hasExistingTranscript: boolean
  initialMeetingRules: string
  initialTemplateGroups: TemplateGroup[]
  committeeSpeakers: CommitteeSpeaker[]
  currentMinutesByAgenda: Record<string, MinuteEntry>
  linkedDataByAgendaId: Record<string, AgendaLinkedDataState>
  initialMomDraftBatch: MomDraftBatchWithRows | null
  initialTimelineRows: AgendaTimelineRow[]
  meetingStatus: string
  agendaColumnConfig: Record<string, unknown>[]
  agendaLockedAt: string | null
  initialMeetingPackConfig: MeetingPackConfig
  initialRagDocuments: CommitteeRagDocumentSummary[]
  askModelOptions: AiModelOption[]
  defaultAskModelId: string
  initialBuildId: string | null
  initialTab: SetupTabValue
}

const ACTIVE_STEP_LABELS: Record<SetupWorkflowStepId, string> = {
  agenda: 'Agenda Preparation',
  'meeting-pack': 'Meeting Pack',
  recording: 'Recording And MoM',
}

export function MeetingDashboard({
  meetingId,
  meetingTitle,
  meetingDate,
  committeeName,
  committeeId,
  committeeSlug,
  organizationName,
  existingAgendas,
  agendaFormatPrompts,
  hasExistingTranscript,
  initialMeetingRules,
  initialTemplateGroups,
  committeeSpeakers,
  currentMinutesByAgenda,
  linkedDataByAgendaId,
  initialMomDraftBatch,
  initialTimelineRows,
  meetingStatus,
  agendaColumnConfig,
  agendaLockedAt,
  initialMeetingPackConfig,
  initialRagDocuments,
  askModelOptions,
  defaultAskModelId,
  initialBuildId,
  initialTab,
}: Props) {
  const router = useRouter()
  const [templateGroups, setTemplateGroups] = useState<TemplateGroup[]>(
    () => initialTemplateGroups
  )
  const [speakerRoster, setSpeakerRoster] =
    useState<CommitteeSpeaker[]>(committeeSpeakers)
  const [skippedAgendaIds, setSkippedAgendaIds] = useState<string[]>(
    () => existingAgendas.filter(agenda => agenda.is_skipped).map(agenda => agenda.id)
  )
  const [agendaStatuses, setAgendaStatuses] = useState<Map<string, 'done' | 'ongoing' | 'pending'>>(
    () => new Map(existingAgendas.map(agenda => [agenda.id, agenda.minute_status ?? 'pending'])),
  )
  const generationQueue = useMomGenerationQueue(existingAgendas, initialMomDraftBatch)
  const [isDraftProgressOpen, setIsDraftProgressOpen] = useState(false)
  const [timelineRows, setTimelineRows] =
    useState<AgendaTimelineRow[]>(initialTimelineRows)
  const [activeTab, setActiveTab] = useState<SetupTabValue>(initialTab)
  const [activeStep, setActiveStep] =
    useState<SetupWorkflowStepId>('agenda')
  const [loadedStepMeetingId, setLoadedStepMeetingId] = useState<string | null>(
    null
  )
  const [stepStatusOverrides, setStepStatusOverrides] =
    useState<StepStatusOverrides>({})
  const [loadedStatusMeetingId, setLoadedStatusMeetingId] = useState<
    string | null
  >(null)
  const [isAgendaLockPending, startAgendaLockTransition] = useTransition()
  const agendaEditorRef = useRef<AgendaEditorHandle>(null)
  const isAgendaLocked = Boolean(agendaLockedAt)
  const committeeSettingsHref = committeeSlug
    ? `/secretariat/${committeeSlug}?tab=settings`
    : null

  const formattedDate = new Date(meetingDate).toLocaleDateString('en-MY', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  useEffect(() => {
    setTemplateGroups(initialTemplateGroups)
  }, [initialTemplateGroups, meetingId])

  useEffect(() => {
    setSpeakerRoster(committeeSpeakers)
  }, [committeeSpeakers, meetingId])

  useEffect(() => {
    setAgendaStatuses(new Map(existingAgendas.map(
      agenda => [agenda.id, agenda.minute_status ?? 'pending'],
    )))
  }, [existingAgendas, meetingId])

  const existingAgendasWithLiveStatuses = useMemo(
    () => existingAgendas.map(agenda => ({
      ...agenda,
      minute_status: agendaStatuses.get(agenda.id) ?? agenda.minute_status ?? 'pending',
    })),
    [agendaStatuses, existingAgendas],
  )

  const agendaAnalytics = useMemo(
    () => buildAgendaStepAnalytics(existingAgendas),
    [existingAgendas]
  )
  const meetingPackAnalytics = useMemo(
    () => buildMeetingPackStepAnalytics(existingAgendas),
    [existingAgendas]
  )
  const autoStepStatuses = useMemo(
    () =>
      deriveWorkflowAutoStatuses({
        agendas: existingAgendas,
        agendaLocked: isAgendaLocked,
        hasExistingTranscript,
      }),
    [existingAgendas, hasExistingTranscript, isAgendaLocked]
  )
  const resolvedStepStatuses = useMemo<
    Record<SetupWorkflowStepId, StepStatus>
  >(
    () => ({
      agenda: autoStepStatuses.agenda,
      'meeting-pack':
        stepStatusOverrides['meeting-pack'] ??
        autoStepStatuses['meeting-pack'],
      recording: stepStatusOverrides.recording ?? autoStepStatuses.recording,
    }),
    [autoStepStatuses, stepStatusOverrides]
  )
  const workspaceStatus = useMemo(
    () =>
      deriveWorkspaceStatus({
        stepStatuses: resolvedStepStatuses,
        meetingStatus,
      }),
    [meetingStatus, resolvedStepStatuses]
  )

  useEffect(() => {
    setActiveTab(initialTab)
  }, [initialTab, meetingId])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const url = new URL(window.location.href)
    if (activeTab === 'dashboard') {
      url.searchParams.delete('tab')
    } else {
      url.searchParams.set('tab', activeTab)
    }

    const nextHref = `${url.pathname}${url.search}${url.hash}`
    const currentHref = `${window.location.pathname}${window.location.search}${window.location.hash}`
    if (nextHref !== currentHref) {
      window.history.replaceState(window.history.state, '', nextHref)
    }
  }, [activeTab, meetingId])

  useEffect(() => {
    setSkippedAgendaIds(
      existingAgendas.filter(agenda => agenda.is_skipped).map(agenda => agenda.id)
    )
  }, [existingAgendas, meetingId])

  useEffect(() => {
    const storageKey = getWorkflowActiveStepStorageKey(meetingId)
    try {
      const storedStep = window.localStorage.getItem(storageKey)
      if (storedStep && isSetupWorkflowStepId(storedStep)) {
        setActiveStep(storedStep)
        return
      }

      setActiveStep('agenda')
    } finally {
      setLoadedStepMeetingId(meetingId)
    }
  }, [meetingId])

  useEffect(() => {
    if (loadedStepMeetingId !== meetingId) return
    const storageKey = getWorkflowActiveStepStorageKey(meetingId)
    window.localStorage.setItem(storageKey, activeStep)
  }, [activeStep, loadedStepMeetingId, meetingId])

  useEffect(() => {
    const storageKey = getWorkflowStatusStorageKey(meetingId)
    try {
      const raw = window.localStorage.getItem(storageKey)
      if (!raw) {
        setStepStatusOverrides({})
        setLoadedStatusMeetingId(meetingId)
        return
      }
      const parsed = JSON.parse(raw) as StepStatusOverrides
      setStepStatusOverrides(parsed ?? {})
    } catch {
      setStepStatusOverrides({})
    } finally {
      setLoadedStatusMeetingId(meetingId)
    }
  }, [meetingId])

  useEffect(() => {
    if (loadedStatusMeetingId !== meetingId) return
    const storageKey = getWorkflowStatusStorageKey(meetingId)
    window.localStorage.setItem(storageKey, JSON.stringify(stepStatusOverrides))
  }, [loadedStatusMeetingId, meetingId, stepStatusOverrides])

  useEffect(() => {
    if (generationQueue.state.isGenerating || generationQueue.state.activeBatch?.id) {
      setIsDraftProgressOpen(true)
    }
  }, [generationQueue.state.activeBatch?.id, generationQueue.state.isGenerating])

  useEffect(() => {
    if (!generationQueue.state.isGenerating && !generationQueue.state.activeBatch) {
      setIsDraftProgressOpen(false)
    }
  }, [generationQueue.state.activeBatch, generationQueue.state.isGenerating])

  function handleStepStatusChange(stepId: SetupWorkflowStepId, nextStatus: StepStatus) {
    if (stepId === 'agenda') return
    setStepStatusOverrides(prev => {
      const next = { ...prev }
      if (nextStatus === autoStepStatuses[stepId]) delete next[stepId]
      else next[stepId] = nextStatus
      return next
    })
  }

  async function handleStartGeneration(
    options: Parameters<typeof generationQueue.startGeneration>[0]
  ) {
    const started = await generationQueue.startGeneration(options)
    if (started) {
      setIsDraftProgressOpen(true)
    }
    return started
  }

  async function handleImportDraftBatch() {
    const imported = await generationQueue.importDraftBatch()
    if (imported) {
      setIsDraftProgressOpen(false)
    }
    return imported
  }

  function handleAgendaLock(
    action: 'lock' | 'unlock',
    draft?: AgendaSyncPayload
  ) {
    startAgendaLockTransition(async () => {
      try {
        if (action === 'lock' && draft) {
          const syncResponse = await fetch(
            `/api/meeting/${meetingId}/agenda-sync`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(draft),
            }
          )
          const syncResult = await syncResponse
            .json()
            .catch(() => ({
              ok: false,
              message: 'Failed to save agenda before locking',
            }))

          if (!syncResponse.ok || !syncResult.ok) {
            throw new Error(
              syncResult.message || 'Failed to save agenda before locking'
            )
          }
        }

        const response = await fetch(`/api/meeting/${meetingId}/agenda-lock`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        })
        const result = await response
          .json()
          .catch(() => ({ ok: false, message: 'Failed to update agenda lock state' }))

        if (!response.ok || !result.ok) {
          throw new Error(result.message || 'Failed to update agenda lock state')
        }

        if (action === 'lock') {
          setActiveStep('meeting-pack')
          toast.success('Step 1 marked done for this meeting.')
        } else {
          setActiveStep('agenda')
          toast.success('Step 1 reversed to pending.')
        }
        router.refresh()
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : 'Failed to update agenda lock state'
        )
      }
    })
  }

  const completedStepCount = Object.values(resolvedStepStatuses).filter(
    status => status === 'done'
  ).length
  const workspaceToneClass =
    workspaceStatus.tone === 'done'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : 'border-amber-200 bg-amber-50 text-amber-700'
  const hasDraftFlow =
    generationQueue.state.isGenerating || Boolean(generationQueue.state.activeBatch)
  const currentTabLabel =
    activeTab === 'dashboard'
      ? 'Operational cockpit'
      : activeTab === 'agenda'
        ? 'Agenda editor'
        : activeTab === 'generate'
          ? 'Generate MoM'
          : activeTab === 'itineraries'
            ? 'Meeting pack'
            : 'Settings'

  return (
    <div className="space-y-4">
      <SetupBuildGuard initialBuildId={initialBuildId} />
      <DraftMomProgressDialog
        open={isDraftProgressOpen}
        onOpenChange={setIsDraftProgressOpen}
        existingAgendas={existingAgendas}
        skippedAgendaIds={skippedAgendaIds}
        generationState={generationQueue.state}
        onStartGeneration={handleStartGeneration}
        onCancelGeneration={generationQueue.cancelGeneration}
        onImportDraftBatch={handleImportDraftBatch}
      />

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28 }}
      >
        <DashboardSurface tone="accent" padding="sm">
          <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1fr)_300px]">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <DashboardPill tone="primary" className="px-2 py-0.5 text-[10px]">Meeting workspace</DashboardPill>
                <DashboardPill className="px-2 py-0.5 text-[10px]">{currentTabLabel}</DashboardPill>
                <DashboardPill className="px-2 py-0.5 text-[10px]">{ACTIVE_STEP_LABELS[activeStep]}</DashboardPill>
              </div>

              <div>
                <h1 className="font-display text-[1.45rem] font-semibold tracking-[-0.05em] text-foreground sm:text-[1.72rem]">
                  {meetingTitle}
                </h1>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5 rounded-[14px] border border-white/70 bg-white/84 px-2.5 py-1 shadow-sm">
                    <CalendarDays className="h-3.5 w-3.5 text-primary" />
                    {formattedDate}
                  </span>
                  {committeeName ? (
                    <span className="inline-flex items-center gap-1.5 rounded-[14px] border border-white/70 bg-white/84 px-2.5 py-1 shadow-sm">
                      <Building2 className="h-3.5 w-3.5 text-primary" />
                      {committeeName}
                    </span>
                  ) : null}
                  <span className="inline-flex items-center gap-1.5 rounded-[14px] border border-white/70 bg-white/84 px-2.5 py-1 shadow-sm">
                    <LayoutPanelTop className="h-3.5 w-3.5 text-primary" />
                    {organizationName}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <DashboardPill tone={hasExistingTranscript ? 'success' : 'warning'} className="px-2 py-0.5 text-[10px]">
                  <Waves className="h-3.5 w-3.5" />
                  Transcript {hasExistingTranscript ? 'ready' : 'missing'}
                </DashboardPill>
                <DashboardPill tone={hasDraftFlow ? 'primary' : 'default'} className="px-2 py-0.5 text-[10px]">
                  <Sparkles className="h-3.5 w-3.5" />
                  {hasDraftFlow ? 'Draft batch active' : 'No draft batch active'}
                </DashboardPill>
                <DashboardPill className="px-2 py-0.5 text-[10px]">{existingAgendas.length} agenda row{existingAgendas.length === 1 ? '' : 's'}</DashboardPill>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-1">
              <div className="rounded-[16px] border border-white/70 bg-white/88 px-3 py-2.5 shadow-sm">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Workspace Status
                </p>
                <div className="mt-1.5">
                  <span
                    className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${workspaceToneClass}`}
                  >
                    {workspaceStatus.label}
                  </span>
                </div>
              </div>
              <div className="rounded-[16px] border border-white/70 bg-white/88 px-3 py-2.5 shadow-sm">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Workflow Progress
                </p>
                <p className="mt-1 text-[1.05rem] font-semibold tracking-[-0.04em] text-foreground">
                  {completedStepCount}/3 done
                </p>
                <p className="mt-1 text-[11px] leading-[1.05rem] text-muted-foreground">
                  Current focus: {ACTIVE_STEP_LABELS[activeStep]}
                </p>
              </div>
              <div className="rounded-[16px] border border-white/70 bg-white/88 px-3 py-2.5 shadow-sm">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Generation Queue
                </p>
                <p className="mt-1 text-[1.05rem] font-semibold tracking-[-0.04em] text-foreground">
                  {hasDraftFlow ? 'Running' : 'Idle'}
                </p>
                <p className="mt-1 text-[11px] leading-[1.05rem] text-muted-foreground">
                  {generationQueue.state.activeBatch
                    ? 'Resume, monitor, or import from Draft Progress.'
                    : 'Open Generate MoM when the transcript and timeline are ready.'}
                </p>
              </div>
            </div>
          </div>
        </DashboardSurface>
      </motion.div>

      <Tabs
        value={activeTab}
        onValueChange={value => setActiveTab(value as SetupTabValue)}
        className="gap-5"
      >
        <DashboardSurface tone="muted" padding="sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary/70">
                Workspace lanes
              </p>
              <p className="text-sm text-muted-foreground">
                Switch between cockpit, agenda editing, generation, itineraries, and meeting-level settings.
              </p>
            </div>

            <div className="w-full overflow-x-auto overflow-y-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden lg:w-auto">
              <TabsList className="inline-flex w-max gap-1 rounded-full bg-white/95 p-1 shadow-[0_18px_42px_-28px_rgba(15,23,42,0.24)]">
                <TabsTrigger value="dashboard" className="h-8 flex-none px-3 text-xs sm:text-sm">
                  Dashboard
                </TabsTrigger>
                <TabsTrigger value="agenda" className="h-8 flex-none px-3 text-xs sm:text-sm">
                  Agenda
                </TabsTrigger>
                <TabsTrigger value="generate" className="h-8 flex-none px-3 text-xs sm:text-sm">
                  Generate MoM
                </TabsTrigger>
                <TabsTrigger value="itineraries" className="h-8 flex-none px-3 text-xs sm:text-sm">
                  Itineraries
                </TabsTrigger>
                <TabsTrigger value="settings" className="h-8 flex-none px-3 text-xs sm:text-sm">
                  Settings
                </TabsTrigger>
              </TabsList>
            </div>
          </div>
        </DashboardSurface>

        <TabsContent
          value="dashboard"
          forceMount
          className="mt-0 data-[state=inactive]:hidden"
        >
          <DashboardTab
            meetingId={meetingId}
            meetingTitle={meetingTitle}
            meetingDate={meetingDate}
            committeeName={committeeName}
            existingAgendas={existingAgendas}
            committeeSpeakers={speakerRoster}
            hasExistingTranscript={hasExistingTranscript}
            initialMeetingRules={initialMeetingRules}
            currentMinutesByAgenda={currentMinutesByAgenda}
            linkedDataByAgendaId={linkedDataByAgendaId}
            timelineRows={timelineRows}
            onTimelineRowsChange={setTimelineRows}
            generationState={generationQueue.state}
            onStartGeneration={handleStartGeneration}
            activeStep={activeStep}
            onStepChange={setActiveStep}
            skippedAgendaIds={skippedAgendaIds}
            hasDraftProgress={
              Boolean(generationQueue.state.activeBatch) ||
              generationQueue.state.isGenerating
            }
            onOpenDraftProgress={() => setIsDraftProgressOpen(true)}
            onOpenAgendaTab={() => setActiveTab('agenda')}
            onOpenMeetingPackTab={() => setActiveTab('itineraries')}
            agendaAnalytics={agendaAnalytics}
            meetingPackAnalytics={meetingPackAnalytics}
            autoStepStatuses={autoStepStatuses}
            stepStatuses={resolvedStepStatuses}
            onStepStatusChange={handleStepStatusChange}
            isAgendaLockPending={isAgendaLockPending}
            onLockAgenda={() => handleAgendaLock('lock', agendaEditorRef.current?.getDraft())}
            onUnlockAgenda={() => handleAgendaLock('unlock')}
            askModelOptions={askModelOptions}
            defaultAskModelId={defaultAskModelId}
          />
        </TabsContent>

        <TabsContent
          value="agenda"
          forceMount
          className="mt-0 data-[state=inactive]:hidden"
        >
          <AgendaEditor
            ref={agendaEditorRef}
            meetingId={meetingId}
            meetingTitle={meetingTitle}
            meetingDate={meetingDate}
            committeeName={committeeName}
            committeeId={committeeId}
            organizationName={organizationName}
            existingAgendas={existingAgendas}
            linkedDataByAgendaId={linkedDataByAgendaId}
            agendaColumnConfig={agendaColumnConfig}
            agendaLockedAt={agendaLockedAt}
            isLockActionPending={isAgendaLockPending}
            onUnlockAgenda={() => handleAgendaLock('unlock')}
          />
        </TabsContent>

        <TabsContent
          value="generate"
          forceMount
          className="mt-0 data-[state=inactive]:hidden"
        >
          <MomGenerator
            meetingId={meetingId}
            committeeId={committeeId}
            existingAgendas={existingAgendasWithLiveStatuses}
            agendaFormatPrompts={agendaFormatPrompts}
            hasExistingTranscript={hasExistingTranscript}
            hasSavedTimeline={timelineRows.length > 0}
            initialMeetingRules={initialMeetingRules}
            currentMinutesByAgenda={currentMinutesByAgenda}
            timelineRows={timelineRows}
            onTimelineRowsChange={setTimelineRows}
            agendaStatuses={agendaStatuses}
            onAgendaStatusesChange={setAgendaStatuses}
            generationState={generationQueue.state}
            onStartGeneration={handleStartGeneration}
            skippedAgendaIds={skippedAgendaIds}
            onSkippedAgendaIdsChange={setSkippedAgendaIds}
            hasDraftProgress={
              Boolean(generationQueue.state.activeBatch) ||
              generationQueue.state.isGenerating
            }
            onOpenDraftProgress={() => setIsDraftProgressOpen(true)}
          />
        </TabsContent>

        <TabsContent
          value="itineraries"
          forceMount
          className="mt-0 data-[state=inactive]:hidden"
        >
          <ItinerariesTab
            groups={templateGroups}
            meetingId={meetingId}
            meetingTitle={meetingTitle}
            meetingDate={meetingDate}
            existingAgendas={existingAgendasWithLiveStatuses}
            initialMeetingPackConfig={initialMeetingPackConfig}
          />
        </TabsContent>

        <TabsContent
          value="settings"
          forceMount
          className="mt-0 data-[state=inactive]:hidden"
        >
          <div className="space-y-6">
            <RulesSection
              mode="meeting"
              committeeId={committeeId}
              meetingId={meetingId}
              initialInstruction={initialMeetingRules}
              committeeSettingsHref={committeeSettingsHref}
            />
            <SettingsTemplateTab
              scope="meeting"
              meetingId={meetingId}
              committeeId={committeeId}
              groups={templateGroups}
              linkedDataByAgendaId={linkedDataByAgendaId}
              onGroupsChange={setTemplateGroups}
              onImportCompleted={() => setActiveTab('agenda')}
              committeeSettingsHref={committeeSettingsHref}
            />
            <MatchSpeakerSection
              key={`${meetingId}:${committeeId ?? 'none'}`}
              scope="meeting"
              committeeId={committeeId}
              meetingId={meetingId}
              initialSpeakers={speakerRoster}
              committeeSettingsHref={committeeSettingsHref}
              onSpeakersChange={setSpeakerRoster}
            />
            <RagTab
              committeeId={committeeId}
              initialDocuments={initialRagDocuments}
              readOnly
              settingsHref={committeeSettingsHref}
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
