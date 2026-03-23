'use client'

import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Building2, CalendarDays, LayoutPanelTop } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { AgendaEditor } from './agenda-editor'
import { DashboardTab } from './dashboard-tab'
import { ItinerariesTab } from './itineraries-tab'
import { MomGenerator } from './mom-generator'
import { RagTab } from './rag-tab'
import { MatchSpeakerSection } from './match-speaker-section'
import { SettingsTemplateTab } from './settings-template-tab'
import { RulesSection } from './rules-section'
import { useMomGenerationQueue } from './use-mom-generation-queue'
import { createInitialTemplateGroups, type TemplateGroup } from './settings-template-model'
import type { CommitteeGenerationSettingsResult } from './committee-generation-model'
import type { CommitteeSpeaker } from '@/actions/committee-speakers'
import type { Agenda } from '@/lib/supabase/types'
import type { MinuteEntry } from './minute-entry'
import type { AgendaTimelineRow } from './agenda-timeline-row'
import type { MeetingPackConfig } from './meeting-pack-model'
import {
  buildAgendaStepAnalytics,
  buildMeetingPackStepAnalytics,
  deriveWorkspaceStatus,
  deriveWorkflowAutoStatuses,
  getWorkflowStatusStorageKey,
  type SetupTabValue,
  type SetupWorkflowStepId,
  type StepStatus,
  type StepStatusOverrides,
} from './setup-workflow'

interface ItineraryTemplate {
  section_key: string
  storage_path: string
  file_name: string
}

interface Props {
  meetingId: string
  meetingTitle: string
  meetingDate: string
  committeeName: string | null
  committeeId: string | null
  organizationName: string
  existingAgendas: Agenda[]
  agendaFormatPrompts: Record<string, string>
  hasExistingTranscript: boolean
  initialMeetingRules: string
  committeeGenerationSettings: CommitteeGenerationSettingsResult | null
  itineraryTemplates: ItineraryTemplate[]
  committeeSpeakers: CommitteeSpeaker[]
  currentMinutesByAgenda: Record<string, MinuteEntry>
  initialTimelineRows: AgendaTimelineRow[]
  meetingStatus: string
  initialMeetingPackConfig: MeetingPackConfig
}

export function MeetingDashboard({
  meetingId, meetingTitle, meetingDate, committeeName,
  committeeId, organizationName, existingAgendas, agendaFormatPrompts, hasExistingTranscript,
  initialMeetingRules,
  committeeGenerationSettings, itineraryTemplates, committeeSpeakers,
  currentMinutesByAgenda,
  initialTimelineRows,
  meetingStatus,
  initialMeetingPackConfig,
}: Props) {
  const [templateGroups, setTemplateGroups] = useState<TemplateGroup[]>(() => {
    const groups = createInitialTemplateGroups({
      minuteInstruction: committeeGenerationSettings?.minuteInstruction ?? null,
      minuteTemplateFileName: committeeGenerationSettings?.defaultFormatSourceName ?? null,
    })
    // Hydrate stored itinerary templates
    if (itineraryTemplates.length > 0) {
      const itineraryGroup = groups.find(g => g.id === 'itineraries')
      if (itineraryGroup) {
        for (const tmpl of itineraryTemplates) {
          const section = itineraryGroup.sections.find(
            s => s.title.trim().toLowerCase().replace(/\s+/g, '-') === tmpl.section_key,
          )
          if (section) {
            section.templateFileName = tmpl.file_name
            section.templateStoragePath = tmpl.storage_path
          }
        }
      }
    }
    return groups
  })
  const generationQueue = useMomGenerationQueue()
  const [timelineRows, setTimelineRows] = useState<AgendaTimelineRow[]>(initialTimelineRows)
  const [activeTab, setActiveTab] = useState<SetupTabValue>('dashboard')
  const [activeStep, setActiveStep] = useState<SetupWorkflowStepId>('agenda')
  const [stepStatusOverrides, setStepStatusOverrides] = useState<StepStatusOverrides>({})
  const [loadedStatusMeetingId, setLoadedStatusMeetingId] = useState<string | null>(null)

  const formattedDate = new Date(meetingDate).toLocaleDateString('en-MY', {
    day: 'numeric', month: 'long', year: 'numeric',
  })

  const agendaAnalytics = useMemo(
    () => buildAgendaStepAnalytics(existingAgendas),
    [existingAgendas],
  )
  const meetingPackAnalytics = useMemo(
    () => buildMeetingPackStepAnalytics(existingAgendas),
    [existingAgendas],
  )
  const autoStepStatuses = useMemo(
    () => deriveWorkflowAutoStatuses({ agendas: existingAgendas, hasExistingTranscript }),
    [existingAgendas, hasExistingTranscript],
  )
  const resolvedStepStatuses = useMemo<Record<SetupWorkflowStepId, StepStatus>>(() => ({
    agenda: stepStatusOverrides.agenda ?? autoStepStatuses.agenda,
    'meeting-pack': stepStatusOverrides['meeting-pack'] ?? autoStepStatuses['meeting-pack'],
    recording: stepStatusOverrides.recording ?? autoStepStatuses.recording,
  }), [autoStepStatuses, stepStatusOverrides])
  const workspaceStatus = useMemo(
    () => deriveWorkspaceStatus({ stepStatuses: resolvedStepStatuses, meetingStatus }),
    [meetingStatus, resolvedStepStatuses],
  )

  useEffect(() => {
    setActiveTab('dashboard')
    setActiveStep('agenda')
  }, [meetingId])

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

  function handleStepStatusChange(stepId: SetupWorkflowStepId, nextStatus: StepStatus) {
    setStepStatusOverrides(prev => {
      const next = { ...prev }
      if (nextStatus === autoStepStatuses[stepId]) delete next[stepId]
      else next[stepId] = nextStatus
      return next
    })
  }

  return (
    <div className="space-y-6">
      <motion.section
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28 }}
        className="rounded-[28px] border border-zinc-200 bg-white px-5 py-5 shadow-sm sm:px-6"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-3">
            <Badge className="border-zinc-200 bg-zinc-100 px-3 py-1 text-[0.68rem] uppercase tracking-[0.28em] text-zinc-600">
              Meeting workspace
            </Badge>
            <div>
              <h1 className="font-display text-2xl font-semibold tracking-[-0.05em] text-zinc-950 sm:text-[2rem]">
                {meetingTitle}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-zinc-500">
                <span className="flex items-center gap-1.5">
                  <CalendarDays className="h-3.5 w-3.5" />
                  {formattedDate}
                </span>
                {committeeName ? (
                  <span className="flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5" />
                    {committeeName}
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <div className="rounded-[22px] border border-zinc-200 bg-zinc-50 px-4 py-3">
            <div className="flex items-center gap-2 text-sm text-zinc-500">
              <LayoutPanelTop className="h-4 w-4" />
              <span>Workspace status</span>
            </div>
            <div className="mt-2">
              <Badge className={workspaceStatus.tone === 'done'
                ? 'bg-emerald-50 text-emerald-700 shadow-sm'
                : 'bg-white text-zinc-700 shadow-sm'}
              >
                {workspaceStatus.label}
              </Badge>
            </div>
          </div>
        </div>
      </motion.section>

      <Tabs value={activeTab} onValueChange={value => setActiveTab(value as SetupTabValue)}>
        <div className="w-full overflow-x-auto overflow-y-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          <TabsList className="inline-flex w-max gap-1 rounded-full bg-white/92 p-1.5 shadow-[0_18px_42px_-28px_rgba(15,23,42,0.4)]">
            <TabsTrigger value="dashboard" className="h-8 flex-none px-3 text-xs sm:text-sm">Dashboard</TabsTrigger>
            <TabsTrigger value="agenda" className="h-8 flex-none px-3 text-xs sm:text-sm">Agenda</TabsTrigger>
            <TabsTrigger value="generate" className="h-8 flex-none px-3 text-xs sm:text-sm">Generate MoM</TabsTrigger>
            <TabsTrigger value="itineraries" className="h-8 flex-none px-3 text-xs sm:text-sm">Itineraries</TabsTrigger>
            <TabsTrigger value="settings" className="h-8 flex-none px-3 text-xs sm:text-sm">Settings</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="dashboard" forceMount className="mt-6 data-[state=inactive]:hidden">
          <DashboardTab
            meetingId={meetingId}
            meetingTitle={meetingTitle}
            meetingDate={meetingDate}
            committeeName={committeeName}
            existingAgendas={existingAgendas}
            committeeSpeakers={committeeSpeakers}
            hasExistingTranscript={hasExistingTranscript}
            initialMeetingRules={initialMeetingRules}
            currentMinutesByAgenda={currentMinutesByAgenda}
            timelineRows={timelineRows}
            onTimelineRowsChange={setTimelineRows}
            generationState={generationQueue.state}
            onStartGeneration={generationQueue.startGeneration}
            onCancelGeneration={generationQueue.cancelGeneration}
            activeStep={activeStep}
            onStepChange={setActiveStep}
            onOpenAgendaTab={() => setActiveTab('agenda')}
            onOpenMeetingPackTab={() => setActiveTab('itineraries')}
            agendaAnalytics={agendaAnalytics}
            meetingPackAnalytics={meetingPackAnalytics}
            autoStepStatuses={autoStepStatuses}
            stepStatuses={resolvedStepStatuses}
            onStepStatusChange={handleStepStatusChange}
          />
        </TabsContent>

        <TabsContent value="agenda" forceMount className="mt-6 data-[state=inactive]:hidden">
          <AgendaEditor
            meetingId={meetingId}
            meetingTitle={meetingTitle}
            meetingDate={meetingDate}
            committeeName={committeeName}
            committeeId={committeeId}
            organizationName={organizationName}
            existingAgendas={existingAgendas}
          />
        </TabsContent>

        <TabsContent value="generate" forceMount className="mt-6 data-[state=inactive]:hidden">
          <MomGenerator
            meetingId={meetingId}
            committeeId={committeeId}
            existingAgendas={existingAgendas}
            agendaFormatPrompts={agendaFormatPrompts}
            hasExistingTranscript={hasExistingTranscript}
            initialMeetingRules={initialMeetingRules}
            currentMinutesByAgenda={currentMinutesByAgenda}
            onTimelineRowsChange={setTimelineRows}
            generationState={generationQueue.state}
            onStartGeneration={generationQueue.startGeneration}
            onCancelGeneration={generationQueue.cancelGeneration}
            onResetGenerationState={generationQueue.resetGenerationState}
            onClearLiveMinutes={generationQueue.clearLiveMinutes}
          />
        </TabsContent>

        <TabsContent value="itineraries" forceMount className="mt-6 data-[state=inactive]:hidden">
          <ItinerariesTab
            groups={templateGroups}
            meetingId={meetingId}
            meetingTitle={meetingTitle}
            meetingDate={meetingDate}
            existingAgendas={existingAgendas}
            committeeId={committeeId}
            meetingStatus={meetingStatus}
            initialMeetingPackConfig={initialMeetingPackConfig}
          />
        </TabsContent>

        <TabsContent value="settings" forceMount className="mt-6 data-[state=inactive]:hidden">
          <div className="space-y-6">
            <RulesSection
              committeeId={committeeId}
              initialInstruction={committeeGenerationSettings?.minuteInstruction ?? ''}
            />
            <SettingsTemplateTab
              meetingId={meetingId}
              committeeId={committeeId}
              groups={templateGroups}
              onGroupsChange={setTemplateGroups}
            />
            <MatchSpeakerSection committeeId={committeeId} initialSpeakers={committeeSpeakers} />
            <RagTab committeeId={committeeId} />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
