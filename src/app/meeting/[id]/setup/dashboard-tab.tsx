'use client'

import { useState } from 'react'
import {
  ArrowRight,
  Ban,
  CircleAlert,
  CircleCheck,
  ClipboardList,
  Clock3,
  FileBox,
  Loader2,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Agenda } from '@/lib/supabase/types'
import type { CommitteeSpeaker } from '@/actions/committee-speakers'
import type { AgendaRunState, MomGenerationState, StartMomGenerationOptions } from './use-mom-generation-queue'
import type { MinuteEntry } from './minute-entry'
import type { AgendaTimelineRow } from './agenda-timeline-row'
import { DashboardChatbotSection } from './dashboard-chatbot-section'
import { MeetingIntelligenceDashboard } from './meeting-intelligence-dashboard'
import { TranscriptTimelineDashboard } from './transcript-timeline-dashboard'
import { MeetingGenerationWorkflow } from './meeting-generation-workflow'
import { GenerateDialog } from './generate-dialog'
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
  timelineRows: AgendaTimelineRow[]
  onTimelineRowsChange: (rows: AgendaTimelineRow[]) => void
  generationState: MomGenerationState
  onStartGeneration: (options: StartMomGenerationOptions) => Promise<boolean>
  onCancelGeneration: () => void
  activeStep: SetupWorkflowStepId
  onStepChange: (stepId: SetupWorkflowStepId) => void
  onOpenAgendaTab: () => void
  onOpenMeetingPackTab: () => void
  agendaAnalytics: AgendaStepAnalytics
  meetingPackAnalytics: MeetingPackStepAnalytics
  autoStepStatuses: Record<SetupWorkflowStepId, StepStatus>
  stepStatuses: Record<SetupWorkflowStepId, StepStatus>
  onStepStatusChange: (stepId: SetupWorkflowStepId, status: StepStatus) => void
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
    description: 'Review the agenda structure and the titles that have already been entered.',
    icon: ClipboardList,
  },
  {
    id: 'meeting-pack',
    title: 'Generate Meeting Pack',
    description: 'Review the attached PDFs before building the meeting pack.',
    icon: FileBox,
  },
  {
    id: 'recording',
    title: 'Meeting Recording / Analysis',
    description: 'Attach the transcript or recording, then continue with analysis and generation.',
    icon: Sparkles,
  },
] as const

function getNextStepId(stepId: SetupWorkflowStepId): SetupWorkflowStepId {
  if (stepId === 'agenda') return 'meeting-pack'
  if (stepId === 'meeting-pack') return 'recording'
  return 'recording'
}

const QUEUE_BADGE_STYLES: Record<AgendaRunState, string> = {
  pending: 'border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  running: 'border-blue-200 bg-blue-100 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300',
  done: 'border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  failed: 'border-red-200 bg-red-100 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300',
  skipped: 'border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
}

function QueueStateBadge({ state }: { state: AgendaRunState }) {
  if (state === 'running') {
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${QUEUE_BADGE_STYLES[state]}`}>
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading...
      </span>
    )
  }

  const Icon = state === 'done'
    ? CircleCheck
    : state === 'failed'
      ? CircleAlert
      : state === 'skipped'
        ? Ban
        : Clock3

  const label = state === 'done'
    ? 'Done'
    : state === 'failed'
      ? 'Failed'
      : state === 'skipped'
        ? 'Skipped'
        : 'Pending'

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${QUEUE_BADGE_STYLES[state]}`}>
      <Icon className="h-3 w-3" />
      {label}
    </span>
  )
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
      : 'border-zinc-200 bg-zinc-50/80'

  return (
    <div className={`rounded-2xl border px-4 py-4 ${toneClass}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950">{value}</p>
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
    <div className="space-y-2" onClick={event => event.stopPropagation()}>
      <div className={`inline-flex rounded-full border p-1 shadow-sm ${
        isActive
          ? 'border-white/20 bg-white/12'
          : 'border-zinc-200 bg-white'
      }`}>
        {(['pending', 'done'] as const).map(option => (
          <button
            key={option}
            type="button"
            onClick={() => onChange(stepId, option)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              value === option
                ? 'bg-primary text-primary-foreground shadow-sm'
                : isActive
                  ? 'text-white/78 hover:bg-white/12 hover:text-white'
                  : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700'
            }`}
          >
            {option === 'done' ? 'Done' : 'Pending'}
          </button>
        ))}
      </div>
      <p className={`text-[11px] ${isActive ? 'text-white/60' : 'text-zinc-400'}`}>
        {isManual ? 'Saved locally' : 'Auto status'}
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
}: {
  step: typeof STEPS[number]
  index: number
  isActive: boolean
  status: StepStatus
  autoStatus: StepStatus
  onStepSelect: (stepId: SetupWorkflowStepId) => void
  onStatusChange: (stepId: SetupWorkflowStepId, status: StepStatus) => void
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
      className={`rounded-[24px] border p-5 text-left transition-all ${
        isActive
          ? 'border-primary/40 bg-[linear-gradient(135deg,rgba(8,98,98,1),rgba(11,127,117,1)_58%,rgba(20,184,166,0.92))] text-white shadow-[0_24px_48px_-32px_rgba(8,98,98,0.48)]'
          : 'border-zinc-200 bg-white hover:border-zinc-300 hover:shadow-sm'
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-4">
          <div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${
            isActive ? 'bg-white/14 text-white' : 'bg-zinc-100 text-zinc-700'
          }`}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="space-y-2">
            <p className={`text-xs font-semibold uppercase tracking-[0.18em] ${
              isActive ? 'text-white/60' : 'text-zinc-500'
            }`}>
              Step {index + 1}
            </p>
            <h3 className="text-lg font-semibold tracking-tight">{step.title}</h3>
            <p className={`text-sm leading-6 ${
              isActive ? 'text-white/75' : 'text-zinc-500'
            }`}>
              {step.description}
            </p>
          </div>
        </div>

        <StepStatusPane
          stepId={step.id}
          value={status}
          autoValue={autoStatus}
          isActive={isActive}
          onChange={onStatusChange}
        />
      </div>
    </article>
  )
}

function AgendaStepPanel({
  analytics,
  onOpenAgendaTab,
}: {
  analytics: AgendaStepAnalytics
  onOpenAgendaTab: () => void
}) {
  return (
    <section className="space-y-6 rounded-[28px] border border-zinc-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Step 1</p>
          <div>
            <h3 className="text-2xl font-semibold tracking-tight text-zinc-950">Edit Agenda</h3>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
              This dashboard shows how many agenda headers have been created and how many titles/subitems have been entered so far.
            </p>
          </div>
        </div>

        <Button onClick={onOpenAgendaTab} className="gap-2 self-start">
          Edit Agenda
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryMetric label="Agenda" value={analytics.totalAgendaHeaders} />
        <SummaryMetric label="Titles So Far" value={analytics.totalTitles} />
        <SummaryMetric label="Headers With Titles" value={analytics.headersWithTitles} />
      </div>

        <div className="rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-zinc-950">Agenda breakdown</h4>
              <p className="mt-1 text-sm text-zinc-500">Number of titles under each agenda header.</p>
            </div>
          </div>

        {analytics.sections.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-zinc-300 bg-white px-4 py-6 text-sm text-zinc-500">
            No agenda structure has been created yet. Open the Agenda tab to start adding headers and titles.
          </div>
        ) : (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {analytics.sections.map(section => (
              <div key={section.id} className="rounded-2xl border border-zinc-200 bg-white px-4 py-4">
                <p className="text-base font-semibold text-zinc-950">{section.title}</p>
                <p className="mt-2 text-sm text-zinc-500">
                  {section.itemCount} {section.itemCount === 1 ? 'item' : 'items'}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
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
    <section className="space-y-6 rounded-[28px] border border-zinc-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Step 2</p>
          <div>
            <h3 className="text-2xl font-semibold tracking-tight text-zinc-950">Generate Meeting Pack</h3>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
              Review the current PDF attachment coverage from your agendas before opening the meeting pack builder.
            </p>
          </div>
        </div>

        <Button onClick={onOpenMeetingPackTab} className="gap-2 self-start">
          Generate Meeting Pack
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryMetric label="Attached PDF" value={analytics.attachedPdfCount} tone="success" />
        <SummaryMetric label="Missing PDF" value={analytics.missingPdfCount} tone={analytics.missingPdfCount > 0 ? 'warning' : 'default'} />
        <SummaryMetric label="Marked No PDF" value={analytics.explicitNoPdfCount} />
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4">
        <h4 className="text-sm font-semibold text-zinc-950">Missing attachments</h4>
        <p className="mt-1 text-sm text-zinc-500">
          Based on the current agenda rows. The full meeting pack builder is still available under the Itineraries tab.
        </p>

        {analytics.totalRows === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-zinc-300 bg-white px-4 py-6 text-sm text-zinc-500">
            There are no agenda rows yet, so there are no attachments to review.
          </div>
        ) : analytics.missingItems.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-6 text-sm text-emerald-700">
            All agenda rows already have a PDF attachment or have been marked as &quot;No PDF&quot;.
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {analytics.missingItems.map(item => (
              <div key={item.id} className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-700">
                {item.label}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
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
  onCancelGeneration,
  meetingTitle,
  meetingDate,
  committeeName,
  currentMinutesByAgenda,
  committeeSpeakers,
}: {
  meetingId: string
  existingAgendas: Agenda[]
  hasExistingTranscript: boolean
  initialMeetingRules: string
  timelineRows: AgendaTimelineRow[]
  onTimelineRowsChange: (rows: AgendaTimelineRow[]) => void
  generationState: MomGenerationState
  onStartGeneration: (options: StartMomGenerationOptions) => Promise<boolean>
  onCancelGeneration: () => void
  meetingTitle: string
  meetingDate: string
  committeeName: string | null
  currentMinutesByAgenda: Record<string, MinuteEntry>
  committeeSpeakers: CommitteeSpeaker[]
}) {
  const [isRearrangeDialogOpen, setIsRearrangeDialogOpen] = useState(false)
  const skippedAgendaIds = existingAgendas.filter(a => a.is_skipped).map(a => a.id)
  const hasGeneratedMom =
    Object.keys(currentMinutesByAgenda).length > 0
    || Object.keys(generationState.liveMinutesByAgenda).length > 0

  return (
    <div className="space-y-6">
      <section className="space-y-6 rounded-[28px] border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Step 3</p>
          <div>
            <h3 className="text-2xl font-semibold tracking-tight text-zinc-950">Meeting Recording / Analysis</h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-500">
              Attach the transcript or recording, review the timeline analysis, then run the generation flow as usual.
            </p>
          </div>
        </div>

        {timelineRows.length > 0 ? (
          <TranscriptTimelineDashboard
            rows={timelineRows}
            onRearrange={() => setIsRearrangeDialogOpen(true)}
            disabled={generationState.isGenerating}
          />
        ) : (
          <MeetingGenerationWorkflow
            meetingId={meetingId}
            existingAgendas={existingAgendas}
            hasExistingTranscript={hasExistingTranscript}
            initialMeetingRules={initialMeetingRules}
            skippedAgendaIds={skippedAgendaIds}
            generationState={generationState}
            onStartGeneration={onStartGeneration}
            onTimelineSaved={onTimelineRowsChange}
          />
        )}

        {generationState.queueItems.length > 0 && (
          <div className="space-y-4 rounded-2xl border border-zinc-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold">Agenda Generation Progress</h4>
                <p className="text-xs text-zinc-500">
                  {generationState.isGenerating
                    ? generationState.cancelRequested
                      ? 'Cancelling after the current agenda finishes.'
                      : `Generating ${Math.min(generationState.completedCount + 1, generationState.totalCount)} of ${generationState.totalCount}`
                    : `Processed ${generationState.completedCount} of ${generationState.totalCount} agenda${generationState.totalCount === 1 ? '' : 's'}.`}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={onCancelGeneration}
                disabled={!generationState.isGenerating}
                className="gap-1.5 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-800 dark:text-red-400"
              >
                {generationState.cancelRequested && generationState.isGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
                {generationState.cancelRequested && generationState.isGenerating ? 'Cancelling...' : 'Cancel generation'}
              </Button>
            </div>

            <div className="space-y-2">
              {generationState.queueItems.map(agenda => {
                const state = generationState.runStateByAgendaId[agenda.id] ?? 'pending'
                const error = generationState.errorByAgendaId[agenda.id]
                return (
                  <div key={agenda.id} className="rounded-md border border-zinc-200 bg-zinc-50/70 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900/50">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                          {agenda.agendaNo} - {agenda.title}
                        </p>
                      </div>
                      <QueueStateBadge state={state} />
                    </div>
                    {error ? (
                      <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </section>

      {hasGeneratedMom ? (
        <>
          <MeetingIntelligenceDashboard
            meetingId={meetingId}
            meetingTitle={meetingTitle}
            meetingDate={meetingDate}
            committeeName={committeeName}
            existingAgendas={existingAgendas}
            timelineRows={timelineRows}
            currentMinutesByAgenda={currentMinutesByAgenda}
            committeeSpeakers={committeeSpeakers}
            isUnlocked
          />

          <DashboardChatbotSection
            meetingId={meetingId}
            agendas={existingAgendas}
            currentMinutesByAgenda={currentMinutesByAgenda}
            liveMinutesByAgenda={generationState.liveMinutesByAgenda}
            isGenerating={generationState.isGenerating}
          />
        </>
      ) : (
        <section className="rounded-[28px] border border-dashed border-zinc-300 bg-white/80 px-6 py-8 text-center shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Step 3</p>
          <h4 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-950">MoM dashboard locked until generation starts</h4>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-zinc-500">
            The dashboard under Step 3 will only appear after the MoM has been generated. If you want to run it again, you can regenerate it from the
            {' '}
            <span className="font-medium text-zinc-700">Generate MoM</span>
            {' '}tab.
          </p>
        </section>
      )}

      <GenerateDialog
        open={isRearrangeDialogOpen}
        onOpenChange={setIsRearrangeDialogOpen}
        meetingId={meetingId}
        existingAgendas={existingAgendas}
        hasExistingTranscript={hasExistingTranscript}
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
  timelineRows,
  onTimelineRowsChange,
  generationState,
  onStartGeneration,
  onCancelGeneration,
  activeStep,
  onStepChange,
  onOpenAgendaTab,
  onOpenMeetingPackTab,
  agendaAnalytics,
  meetingPackAnalytics,
  autoStepStatuses,
  stepStatuses,
  onStepStatusChange,
}: DashboardTabProps) {
  function handleWorkflowStatusChange(stepId: SetupWorkflowStepId, status: StepStatus) {
    onStepStatusChange(stepId, status)

    if (status === 'done') {
      onStepChange(getNextStepId(stepId))
      return
    }

    onStepChange(stepId)
  }

  return (
    <div className="space-y-8">
      <div className="grid gap-4 xl:grid-cols-3">
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
          />
        ))}
      </div>

      {activeStep === 'agenda' ? (
        <AgendaStepPanel
          analytics={agendaAnalytics}
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
        <RecordingStepPanel
          meetingId={meetingId}
          existingAgendas={existingAgendas}
          hasExistingTranscript={hasExistingTranscript}
          initialMeetingRules={initialMeetingRules}
          timelineRows={timelineRows}
          onTimelineRowsChange={onTimelineRowsChange}
          generationState={generationState}
          onStartGeneration={onStartGeneration}
          onCancelGeneration={onCancelGeneration}
          meetingTitle={meetingTitle}
          meetingDate={meetingDate}
          committeeName={committeeName}
          currentMinutesByAgenda={currentMinutesByAgenda}
          committeeSpeakers={committeeSpeakers}
        />
      ) : null}
    </div>
  )
}
