'use client'

import { useMemo, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import {
  ArrowRight,
  Bot,
  ClipboardList,
  FileBox,
  Sparkles,
} from 'lucide-react'
import {
  DashboardPill,
  DashboardSectionIntro,
  DashboardSurface,
} from '@/components/dashboard-primitives'
import { Button } from '@/components/ui/button'
import type { Agenda } from '@/lib/supabase/types'
import type { CommitteeSpeaker } from '@/lib/committee-speakers'
import type { AgendaLinkedDataState } from './agenda-linked-data'
import type { MomGenerationState, StartMomGenerationOptions } from './use-mom-generation-queue'
import type { MinuteEntry } from './minute-entry'
import type { AgendaTimelineRow } from './agenda-timeline-row'
import { MeetingMomChatbot } from './meeting-mom-chatbot'
import { MeetingIntelligenceDashboard } from './meeting-intelligence-dashboard'
import { TranscriptTimelineDashboard } from './transcript-timeline-dashboard'
import { MeetingGenerationWorkflow } from './meeting-generation-workflow'
import { GenerateDialog } from './generate-dialog'
import { buildAgendaPreviewRows } from './agenda-structure'
import type { AiModelOption } from '@/lib/ai/catalog'
import type {
  AgendaStepAnalytics,
  MeetingPackStepAnalytics,
  SetupWorkflowStepId,
  StepStatus,
} from './setup-workflow'

interface DashboardTabProps {
  meetingId: string
  meetingTitle: string
  meetingDate: string
  committeeName: string | null
  existingAgendas: Agenda[]
  committeeSpeakers: CommitteeSpeaker[]
  hasExistingTranscript: boolean
  initialMeetingRules: string
  currentMinutesByAgenda: Record<string, MinuteEntry>
  linkedDataByAgendaId: Record<string, AgendaLinkedDataState>
  timelineRows: AgendaTimelineRow[]
  onTimelineRowsChange: (rows: AgendaTimelineRow[]) => void
  generationState: MomGenerationState
  onStartGeneration: (options: StartMomGenerationOptions) => Promise<boolean>
  activeStep: SetupWorkflowStepId
  onStepChange: (stepId: SetupWorkflowStepId) => void
  skippedAgendaIds: string[]
  hasDraftProgress: boolean
  onOpenDraftProgress: () => void
  onOpenAgendaTab: () => void
  onOpenMeetingPackTab: () => void
  agendaAnalytics: AgendaStepAnalytics
  meetingPackAnalytics: MeetingPackStepAnalytics
  autoStepStatuses: Record<SetupWorkflowStepId, StepStatus>
  stepStatuses: Record<SetupWorkflowStepId, StepStatus>
  onStepStatusChange: (stepId: SetupWorkflowStepId, status: StepStatus) => void
  isAgendaLockPending: boolean
  onLockAgenda: () => void
  onUnlockAgenda: () => void
  askModelOptions: AiModelOption[]
  defaultAskModelId: string
}

const STEPS: Array<{
  id: SetupWorkflowStepId
  title: string
  description: string
  icon: typeof ClipboardList
}> = [
  {
    id: 'agenda',
    title: 'Edit Agenda',
    description: 'Review structure, planned timing, and section titles.',
    icon: ClipboardList,
  },
  {
    id: 'meeting-pack',
    title: 'Generate Meeting Pack',
    description: 'Check supporting PDFs before building the pack.',
    icon: FileBox,
  },
  {
    id: 'recording',
    title: 'Meeting Recording / Analysis',
    description: 'Attach transcript input, then run analysis and generation.',
    icon: Sparkles,
  },
] as const

function getNextStepId(stepId: SetupWorkflowStepId): SetupWorkflowStepId {
  if (stepId === 'agenda') return 'meeting-pack'
  if (stepId === 'meeting-pack') return 'recording'
  return 'recording'
}

function SummaryMetric({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: number | string
  tone?: 'default' | 'success' | 'warning'
}) {
  const toneClass = tone === 'success'
    ? 'border-emerald-200 bg-emerald-50/80'
    : tone === 'warning'
      ? 'border-amber-200 bg-amber-50/80'
      : 'border-border/70 bg-secondary/25'

  return (
    <div className={`rounded-[16px] border px-3 py-2.5 ${toneClass}`}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-[1.08rem] font-semibold tracking-[-0.04em] text-foreground">{value}</p>
    </div>
  )
}

function StepStatusPane({
  stepId,
  value,
  autoValue,
  isActive,
  onChange,
}: {
  stepId: SetupWorkflowStepId
  value: StepStatus
  autoValue: StepStatus
  isActive: boolean
  onChange: (stepId: SetupWorkflowStepId, status: StepStatus) => void
}) {
  const isManual = value !== autoValue

  return (
    <div className="space-y-1.5" onClick={event => event.stopPropagation()}>
      <div className={`inline-flex rounded-full border p-0.5 shadow-sm ${
        isActive
          ? 'border-primary/15 bg-white/85'
          : 'border-border/70 bg-white'
      }`}>
        {(['pending', 'done'] as const).map(option => (
          <button
            key={option}
            type="button"
            onClick={() => onChange(stepId, option)}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
              value === option
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
            }`}
          >
            {option === 'done' ? 'Done' : 'Pending'}
          </button>
        ))}
      </div>
      <p className="text-[9px] text-muted-foreground">
        {isManual ? 'Saved locally' : 'Auto status'}
      </p>
    </div>
  )
}

function AgendaStepStatusPane({
  value,
  isPending,
  disableDone,
  onChange,
}: {
  value: StepStatus
  isPending: boolean
  disableDone: boolean
  onChange: (status: StepStatus) => void
}) {
  return (
    <div className="space-y-1.5" onClick={event => event.stopPropagation()}>
      <div className="inline-flex rounded-full border border-border/70 bg-white p-0.5 shadow-sm">
        {(['pending', 'done'] as const).map(option => {
          const isSelected = value === option
          const isDisabled = isPending || (option === 'done' && disableDone)

          return (
            <button
              key={option}
              type="button"
              onClick={() => {
                if (isDisabled) return
                onChange(option)
              }}
              disabled={isDisabled}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                isSelected
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
              }`}
            >
              {option === 'done' ? 'Done' : 'Pending'}
            </button>
          )
        })}
      </div>
      <p className="text-[9px] text-muted-foreground">
        {isPending ? 'Updating...' : 'Shared status'}
      </p>
    </div>
  )
}

function WorkflowStepCard({
  step,
  index,
  isActive,
  status,
  autoStatus,
  onStepSelect,
  onStatusChange,
  isAgendaLockPending,
  onAgendaStatusChange,
  disableAgendaDone,
}: {
  step: typeof STEPS[number]
  index: number
  isActive: boolean
  status: StepStatus
  autoStatus: StepStatus
  onStepSelect: (stepId: SetupWorkflowStepId) => void
  onStatusChange: (stepId: SetupWorkflowStepId, status: StepStatus) => void
  isAgendaLockPending?: boolean
  onAgendaStatusChange?: (status: StepStatus) => void
  disableAgendaDone?: boolean
}) {
  const Icon = step.icon

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={() => onStepSelect(step.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onStepSelect(step.id)
        }
      }}
      className={`rounded-[20px] border p-3.5 text-left transition-all ${
        isActive
          ? 'border-primary/24 bg-[linear-gradient(135deg,rgba(255,255,255,0.98),rgba(235,255,252,0.96)_58%,rgba(220,252,231,0.88))] shadow-[0_18px_46px_-34px_rgba(8,98,98,0.26)]'
          : 'border-border/70 bg-white/94 hover:border-primary/18 hover:bg-primary/5'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2.5">
          <div className={`flex h-8 w-8 items-center justify-center rounded-[14px] ${
            isActive ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground'
          }`}>
            <Icon className="h-4 w-4" />
          </div>
          <div className="space-y-1">
            <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Step {index + 1}
            </p>
            <h3 className="text-[15px] font-semibold tracking-[-0.03em] text-foreground">{step.title}</h3>
            <p className="text-[12px] leading-[1.15rem] text-muted-foreground">
              {step.description}
            </p>
          </div>
        </div>

        {step.id === 'agenda' ? (
          <AgendaStepStatusPane
            value={status}
            isPending={Boolean(isAgendaLockPending)}
            disableDone={Boolean(disableAgendaDone)}
            onChange={nextStatus => onAgendaStatusChange?.(nextStatus)}
          />
        ) : (
          <StepStatusPane
            stepId={step.id}
            value={status}
            autoValue={autoStatus}
            isActive={isActive}
            onChange={onStatusChange}
          />
        )}
      </div>
    </article>
  )
}

function LockedDashboardPanel({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string
  title: string
  description: string
}) {
  return (
    <DashboardSurface tone="muted" padding="sm" className="text-center">
      <div className="mx-auto max-w-2xl space-y-2.5 py-1">
        <DashboardPill>{eyebrow}</DashboardPill>
        <div>
          <h4 className="font-display text-[1.08rem] font-semibold tracking-[-0.04em] text-foreground">{title}</h4>
          <p className="mx-auto mt-1.5 text-[13px] leading-5 text-muted-foreground">{description}</p>
        </div>
      </div>
    </DashboardSurface>
  )
}

function assignRef<T>(ref: React.Ref<T> | undefined, value: T | null) {
  if (!ref) return
  if (typeof ref === 'function') {
    ref(value)
    return
  }
  ;(ref as React.MutableRefObject<T | null>).current = value
}

function StepThreeReveal({
  children,
  delay = 0,
  sectionRef,
}: {
  children: React.ReactNode
  delay?: number
  sectionRef?: React.Ref<HTMLDivElement>
}) {
  const prefersReducedMotion = useReducedMotion()

  return (
    <motion.section
      ref={(node) => assignRef(sectionRef, node)}
      initial={prefersReducedMotion ? false : { opacity: 0, y: 18 }}
      animate={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
      transition={{
        duration: prefersReducedMotion ? 0 : 0.22,
        delay: prefersReducedMotion ? 0 : delay,
        ease: [0.22, 1, 0.36, 1],
      }}
      className="space-y-0"
    >
      {children}
    </motion.section>
  )
}

function ChatbotPeekCard({
  isUnlocked,
  minutesCount,
  hasTranscript,
  onOpen,
}: {
  isUnlocked: boolean
  minutesCount: number
  hasTranscript: boolean
  onOpen: () => void
}) {
  if (!isUnlocked) {
    return (
      <DashboardSurface tone="muted" padding="sm">
        <DashboardSectionIntro
          eyebrow="MoM chatbot"
          title="Chatbot preview unlocks after MoM generation"
          description="Once minutes are generated, this dashboard reveals a meeting-wide chatbot teaser before the full chat lane below."
          compact
          actions={(
            <>
              <DashboardPill tone={hasTranscript ? 'success' : 'warning'}>
                Transcript {hasTranscript ? 'ready' : 'missing'}
              </DashboardPill>
              <DashboardPill>{minutesCount} minute{minutesCount === 1 ? '' : 's'}</DashboardPill>
            </>
          )}
        />
      </DashboardSurface>
    )
  }

  return (
      <DashboardSurface tone="accent" padding="sm">
      <DashboardSectionIntro
        eyebrow="MoM chatbot"
        title="Your meeting-wide chatbot is ready"
        description="Ask about decisions, action items, disagreements, or anything across the full transcript and all generated minutes."
        compact
        actions={(
          <Button onClick={onOpen} className="gap-2 rounded-full px-4">
            <Bot className="h-4 w-4" />
            Open MoM Chatbot
          </Button>
        )}
      />

      <div className="mt-3 flex flex-wrap gap-1.5">
        <DashboardPill tone="success">
          {hasTranscript ? 'Whole transcript attached' : 'Transcript unavailable'}
        </DashboardPill>
        <DashboardPill>{minutesCount} generated minute{minutesCount === 1 ? '' : 's'}</DashboardPill>
        <DashboardPill>Ask-only mode</DashboardPill>
      </div>
    </DashboardSurface>
  )
}

function AgendaStepPanel({
  analytics,
  agendas,
  onOpenAgendaTab,
}: {
  analytics: AgendaStepAnalytics
  agendas: Agenda[]
  onOpenAgendaTab: () => void
}) {
  const previewRows = useMemo(() => buildAgendaPreviewRows(agendas), [agendas])
  const rowsWithPlannedTime = previewRows.filter(row => row.plannedTime.trim().length > 0).length
  const rowsWithPresenter = previewRows.filter(row => row.presenter.trim().length > 0).length

  return (
    <DashboardSurface padding="md">
      <DashboardSectionIntro
        eyebrow="Step 1"
        title="Edit Agenda"
        description="Review the current agenda structure here, then open the Agenda tab to edit rows before using the shared Pending / Done control above."
        actions={(
          <Button variant="outline" onClick={onOpenAgendaTab} className="gap-2 rounded-[12px] self-start">
            Open Agenda Tab
            <ArrowRight className="h-4 w-4" />
          </Button>
        )}
      />

      <div className="mt-3 grid gap-2.5 sm:grid-cols-3">
        <SummaryMetric label="Agenda Headers" value={analytics.totalAgendaHeaders} />
        <SummaryMetric label="Rows With Time" value={rowsWithPlannedTime} tone={rowsWithPlannedTime > 0 ? 'success' : 'default'} />
        <SummaryMetric label="Rows With Presenter" value={rowsWithPresenter} tone={rowsWithPresenter > 0 ? 'success' : 'default'} />
      </div>

      <div className="mt-3 rounded-[18px] border border-border/70 bg-secondary/20 p-3.5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 className="text-[13px] font-semibold text-foreground">Agenda preview</h4>
            <p className="mt-0.5 text-[12px] text-muted-foreground">Read-only view of the current agenda order, planned time, and presenter fields.</p>
          </div>
        </div>

        {previewRows.length === 0 ? (
          <div className="mt-3 rounded-[16px] border border-dashed border-border bg-white px-3.5 py-5 text-[12px] text-muted-foreground">
            No agenda structure has been created yet. Open the Agenda tab to start adding headers and titles.
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-[16px] border border-border/70 bg-white">
            <div className="grid grid-cols-[78px_118px_minmax(0,1fr)_160px] gap-2.5 border-b border-border/70 bg-secondary/20 px-3.5 py-2 text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              <span>No.</span>
              <span>Time</span>
              <span>Agenda Item</span>
              <span>Presenter</span>
            </div>
            <div className="divide-y divide-border/60">
              {previewRows.map(row => (
                <div
                  key={row.id}
                  className={`grid grid-cols-[78px_118px_minmax(0,1fr)_160px] gap-2.5 px-3.5 py-2.5 text-[12px] ${
                    row.level === 'section' ? 'bg-secondary/20' : 'bg-white'
                  }`}
                >
                  <span className={`tabular-nums ${row.level === 'section' ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
                    {row.agendaNo}
                  </span>
                  <span className={row.plannedTime ? 'text-foreground' : 'text-muted-foreground'}>
                    {row.plannedTime || 'TBC'}
                  </span>
                  <span className={`${row.level === 'section' ? 'font-semibold text-foreground' : 'pl-4 text-foreground'}`}>
                    {row.title}
                  </span>
                  <span className={row.presenter ? 'text-foreground' : 'text-muted-foreground'}>
                    {row.presenter || 'Not assigned'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </DashboardSurface>
  )
}

function MeetingPackStepPanel({
  analytics,
  onOpenMeetingPackTab,
}: {
  analytics: MeetingPackStepAnalytics
  onOpenMeetingPackTab: () => void
}) {
  return (
    <DashboardSurface padding="md">
      <DashboardSectionIntro
        eyebrow="Step 2"
        title="Generate Meeting Pack"
        description="Review the current PDF attachment coverage from your agendas before opening the meeting pack builder."
        actions={(
          <Button onClick={onOpenMeetingPackTab} className="gap-2 rounded-[12px] self-start">
            Generate Meeting Pack
            <ArrowRight className="h-4 w-4" />
          </Button>
        )}
      />

      <div className="mt-3 grid gap-2.5 sm:grid-cols-3">
        <SummaryMetric label="Attached PDF" value={analytics.attachedPdfCount} tone="success" />
        <SummaryMetric label="Missing PDF" value={analytics.missingPdfCount} tone={analytics.missingPdfCount > 0 ? 'warning' : 'default'} />
        <SummaryMetric label="Marked No PDF" value={analytics.explicitNoPdfCount} />
      </div>

      <div className="mt-3 rounded-[18px] border border-border/70 bg-secondary/20 p-3.5">
        <h4 className="text-[13px] font-semibold text-foreground">Missing attachments</h4>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          Based on the current agenda rows. The full meeting pack builder is still available under the Itineraries tab.
        </p>

        {analytics.totalRows === 0 ? (
          <div className="mt-3 rounded-[16px] border border-dashed border-border bg-white px-3.5 py-5 text-[12px] text-muted-foreground">
            There are no agenda rows yet, so there are no attachments to review.
          </div>
        ) : analytics.missingItems.length === 0 ? (
          <div className="mt-3 rounded-[16px] border border-emerald-200 bg-emerald-50 px-3.5 py-5 text-[12px] text-emerald-700">
            All agenda rows already have a PDF attachment or have been marked as &quot;No PDF&quot;.
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {analytics.missingItems.map(item => (
              <div key={item.id} className="rounded-[16px] border border-border/70 bg-white px-3.5 py-2.5 text-[12px] text-foreground">
                {item.label}
              </div>
            ))}
          </div>
        )}
      </div>
    </DashboardSurface>
  )
}

function RecordingStepPanel({
  meetingId,
  existingAgendas,
  hasExistingTranscript,
  initialMeetingRules,
  timelineRows,
  onTimelineRowsChange,
  generationState,
  onStartGeneration,
  currentMinutesByAgenda,
  skippedAgendaIds,
  hasDraftProgress,
  onOpenDraftProgress,
  onOpenChatbot,
}: {
  meetingId: string
  existingAgendas: Agenda[]
  hasExistingTranscript: boolean
  initialMeetingRules: string
  timelineRows: AgendaTimelineRow[]
  onTimelineRowsChange: (rows: AgendaTimelineRow[]) => void
  generationState: MomGenerationState
  onStartGeneration: (options: StartMomGenerationOptions) => Promise<boolean>
  currentMinutesByAgenda: Record<string, MinuteEntry>
  skippedAgendaIds: string[]
  hasDraftProgress: boolean
  onOpenDraftProgress: () => void
  onOpenChatbot?: () => void
}) {
  const [isRearrangeDialogOpen, setIsRearrangeDialogOpen] = useState(false)
  const [dialogMode, setDialogMode] = useState<'generate' | 'rearrange'>('generate')
  const hasImportedMom = Object.keys(currentMinutesByAgenda).length > 0
  const hasDraftBatch = Boolean(generationState.activeBatch)
  const timelineActionLabel = hasDraftBatch || hasImportedMom ? 'Regenerate Draft MoM' : 'Generate Draft MoM'

  return (
    <div className="space-y-6">
      <DashboardSurface padding="md">
        <DashboardSectionIntro
          eyebrow="Step 3"
          title="Meeting Recording / Analysis"
          description="Attach the transcript or recording, review the timeline analysis, then run the generation flow as usual."
          actions={
            hasDraftProgress ? (
              <Button variant="outline" onClick={onOpenDraftProgress} className="gap-2 rounded-[12px] self-start">
                <Sparkles className="h-4 w-4" />
                Draft Progress
              </Button>
            ) : null
          }
        />

        <div className="mt-3">
          {timelineRows.length > 0 ? (
            <TranscriptTimelineDashboard
              rows={timelineRows}
              onRearrange={() => {
                setDialogMode('rearrange')
                setIsRearrangeDialogOpen(true)
              }}
              onGenerate={() => {
                setDialogMode('generate')
                setIsRearrangeDialogOpen(true)
              }}
              onOpenChatbot={hasImportedMom ? onOpenChatbot : undefined}
              generateLabel={timelineActionLabel}
              disabled={generationState.isGenerating}
            />
          ) : (
            <MeetingGenerationWorkflow
              meetingId={meetingId}
              existingAgendas={existingAgendas}
              hasExistingTranscript={hasExistingTranscript}
              initialMeetingRules={initialMeetingRules}
              existingTimelineRows={timelineRows}
              skippedAgendaIds={skippedAgendaIds}
              generationState={generationState}
              onStartGeneration={onStartGeneration}
              onTimelineSaved={onTimelineRowsChange}
            />
          )}
        </div>
      </DashboardSurface>

      <GenerateDialog
        open={isRearrangeDialogOpen}
        onOpenChange={setIsRearrangeDialogOpen}
        mode={dialogMode}
        meetingId={meetingId}
        existingAgendas={existingAgendas}
        hasExistingTranscript={hasExistingTranscript}
        hasSavedTimeline={timelineRows.length > 0}
        existingTimelineRows={timelineRows}
        initialMeetingRules={initialMeetingRules}
        skippedAgendaIds={skippedAgendaIds}
        generationState={generationState}
        onStartGeneration={onStartGeneration}
        onTimelineSaved={onTimelineRowsChange}
      />
    </div>
  )
}

export function DashboardTab({
  meetingId,
  meetingTitle,
  meetingDate,
  committeeName,
  existingAgendas,
  committeeSpeakers,
  hasExistingTranscript,
  initialMeetingRules,
  currentMinutesByAgenda,
  linkedDataByAgendaId,
  timelineRows,
  onTimelineRowsChange,
  generationState,
  onStartGeneration,
  activeStep,
  onStepChange,
  skippedAgendaIds,
  hasDraftProgress,
  onOpenDraftProgress,
  onOpenAgendaTab,
  onOpenMeetingPackTab,
  agendaAnalytics,
  meetingPackAnalytics,
  autoStepStatuses,
  stepStatuses,
  onStepStatusChange,
  isAgendaLockPending,
  onLockAgenda,
  onUnlockAgenda,
  askModelOptions,
  defaultAskModelId,
}: DashboardTabProps) {
  const chatbotSceneRef = useRef<HTMLDivElement | null>(null)
  const [recordingView, setRecordingView] = useState<'dashboard' | 'chatbot'>('dashboard')
  const skippedAgendaIdSet = useMemo(() => new Set(skippedAgendaIds), [skippedAgendaIds])
  const visibleCurrentMinutesByAgenda = useMemo(
    () => Object.fromEntries(
      Object.entries(currentMinutesByAgenda).filter(([agendaId]) => !skippedAgendaIdSet.has(agendaId)),
    ),
    [currentMinutesByAgenda, skippedAgendaIdSet],
  )
  const visibleLinkedDataByAgendaId = useMemo(
    () => Object.fromEntries(
      Object.entries(linkedDataByAgendaId).filter(([agendaId]) => !skippedAgendaIdSet.has(agendaId)),
    ),
    [linkedDataByAgendaId, skippedAgendaIdSet],
  )
  const minuteAgendaIds = new Set<string>()

  Object.entries(visibleCurrentMinutesByAgenda).forEach(([agendaId, minute]) => {
    if (minute.content.trim()) {
      minuteAgendaIds.add(agendaId)
    }
  })

  const hasGeneratedMom = minuteAgendaIds.size > 0

  function handleWorkflowStatusChange(stepId: SetupWorkflowStepId, status: StepStatus) {
    if (stepId === 'agenda') {
      if (status === stepStatuses.agenda) {
        if (status === 'pending') {
          onStepChange('agenda')
        }
        return
      }

      if (status === 'done') {
        onLockAgenda()
        return
      }

      onUnlockAgenda()
      return
    }

    onStepStatusChange(stepId, status)

    if (status === 'done') {
      onStepChange(getNextStepId(stepId))
      return
    }

    onStepChange(stepId)
  }

  function openChatbotSection() {
    setRecordingView('chatbot')
    chatbotSceneRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    })
  }

  return (
    <div className="space-y-6">
      <DashboardSurface tone="muted" padding="sm" className="border-primary/10">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <DashboardPill tone="primary" className="px-2 py-0.5 text-[10px]">Workflow strip</DashboardPill>
            <DashboardPill className="px-2 py-0.5 text-[10px]">
              {stepStatuses.agenda === 'done' &&
              stepStatuses['meeting-pack'] === 'done' &&
              stepStatuses.recording === 'done'
                ? 'All stages complete'
                : 'Continue the next active stage'}
            </DashboardPill>
          </div>

          <div className="grid gap-2.5 xl:grid-cols-3">
            {STEPS.map((step, index) => (
              <WorkflowStepCard
                key={step.id}
                step={step}
                index={index}
                isActive={activeStep === step.id}
                status={stepStatuses[step.id]}
                autoStatus={autoStepStatuses[step.id]}
                onStepSelect={onStepChange}
                onStatusChange={handleWorkflowStatusChange}
                isAgendaLockPending={isAgendaLockPending}
                onAgendaStatusChange={status => handleWorkflowStatusChange('agenda', status)}
                disableAgendaDone={step.id === 'agenda' && existingAgendas.length === 0}
              />
            ))}
          </div>
        </div>
      </DashboardSurface>

      <div className="space-y-4 pb-2">
        {activeStep === 'agenda' ? (
          <AgendaStepPanel
            analytics={agendaAnalytics}
            agendas={existingAgendas}
            onOpenAgendaTab={onOpenAgendaTab}
          />
        ) : null}

        {activeStep === 'meeting-pack' ? (
          <MeetingPackStepPanel
            analytics={meetingPackAnalytics}
            onOpenMeetingPackTab={onOpenMeetingPackTab}
          />
        ) : null}

        {activeStep === 'recording' ? (
          <StepThreeReveal delay={0.02}>
            <RecordingStepPanel
              meetingId={meetingId}
              existingAgendas={existingAgendas}
              hasExistingTranscript={hasExistingTranscript}
              initialMeetingRules={initialMeetingRules}
              timelineRows={timelineRows}
              onTimelineRowsChange={onTimelineRowsChange}
              generationState={generationState}
              onStartGeneration={onStartGeneration}
              currentMinutesByAgenda={visibleCurrentMinutesByAgenda}
              skippedAgendaIds={skippedAgendaIds}
              hasDraftProgress={hasDraftProgress}
              onOpenDraftProgress={onOpenDraftProgress}
              onOpenChatbot={openChatbotSection}
            />
          </StepThreeReveal>
        ) : null}

        {activeStep === 'recording' ? (
          <>
            <DashboardSurface tone="muted" padding="sm" className="border-primary/10">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="inline-flex rounded-full border border-border/70 bg-white p-0.5 shadow-sm">
                  {(['dashboard', 'chatbot'] as const).map(view => (
                    <button
                      key={view}
                      type="button"
                      onClick={() => setRecordingView(view)}
                      className={`rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${
                        recordingView === view
                          ? 'bg-primary text-primary-foreground shadow-sm'
                          : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                      }`}
                    >
                      {view === 'dashboard' ? 'Dashboard' : 'Chatbot'}
                    </button>
                  ))}
                </div>

                {hasDraftProgress ? (
                  <Button variant="outline" onClick={onOpenDraftProgress} className="gap-2 rounded-[12px]">
                    <Sparkles className="h-4 w-4" />
                    Draft Progress
                  </Button>
                ) : null}
              </div>
            </DashboardSurface>

            <StepThreeReveal delay={0.08}>
              {recordingView === 'dashboard' ? (
                hasGeneratedMom ? (
                  <MeetingIntelligenceDashboard
                    key={`${meetingId}:${timelineRows.length > 0 ? 'timeline' : 'no-timeline'}:${minuteAgendaIds.size}`}
                    meetingId={meetingId}
                    meetingTitle={meetingTitle}
                    meetingDate={meetingDate}
                    committeeName={committeeName}
                    existingAgendas={existingAgendas}
                    timelineRows={timelineRows}
                    currentMinutesByAgenda={visibleCurrentMinutesByAgenda}
                    linkedDataByAgendaId={visibleLinkedDataByAgendaId}
                    committeeSpeakers={committeeSpeakers}
                    isUnlocked
                  />
                ) : (
                  <LockedDashboardPanel
                    eyebrow="Insights"
                    title="Meeting intelligence unlocks after minutes are generated"
                    description="Generate the MoM first to open the discussion insights, action-item analytics, and meeting health cards for this workspace."
                  />
                )
              ) : hasGeneratedMom ? (
                <MeetingMomChatbot
                  meetingId={meetingId}
                  meetingTitle={meetingTitle}
                  hasTranscript={hasExistingTranscript}
                  minutesCount={minuteAgendaIds.size}
                  isGenerating={generationState.isGenerating}
                  askModelOptions={askModelOptions}
                  defaultAskModelId={defaultAskModelId}
                />
              ) : (
                <LockedDashboardPanel
                  eyebrow="MoM Chatbot"
                  title="Meeting-wide chat opens after the MoM exists"
                  description="Once minutes have been generated, this dashboard will unlock a single meeting-wide chatbot that answers using the full transcript and all generated minutes."
                />
              )}
            </StepThreeReveal>

            {recordingView === 'dashboard' ? (
              <StepThreeReveal delay={0.12} sectionRef={chatbotSceneRef}>
                <ChatbotPeekCard
                  isUnlocked={hasGeneratedMom}
                  minutesCount={minuteAgendaIds.size}
                  hasTranscript={hasExistingTranscript}
                  onOpen={openChatbotSection}
                />
              </StepThreeReveal>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  )
}
