'use client'

import type { Agenda } from '@/lib/supabase/types'

export const NO_PDF_MARKER = '__no_pdf__'

export type SetupTabValue = 'dashboard' | 'agenda' | 'generate' | 'itineraries' | 'settings'
export type SetupWorkflowStepId = 'agenda' | 'meeting-pack' | 'recording'
export type StepStatus = 'done' | 'pending'
export type StepStatusOverrides = Partial<Record<SetupWorkflowStepId, StepStatus>>

export interface AgendaStepSection {
  id: string
  title: string
  itemCount: number
}

export interface AgendaStepAnalytics {
  totalAgendaHeaders: number
  totalTitles: number
  headersWithTitles: number
  sections: AgendaStepSection[]
}

export interface MeetingPackMissingItem {
  id: string
  label: string
}

export interface MeetingPackStepAnalytics {
  totalRows: number
  attachedPdfCount: number
  missingPdfCount: number
  explicitNoPdfCount: number
  missingItems: MeetingPackMissingItem[]
}

export interface WorkspaceStatusInfo {
  label: string
  tone: 'pending' | 'done'
}

export function isAgendaHeading(agendaNo: string) {
  const normalized = agendaNo.trim()
  return normalized.endsWith('.0') || /^\d+$/.test(normalized)
}

export function getWorkflowStatusStorageKey(meetingId: string) {
  return `meeting-setup-workflow:${meetingId}`
}

export function buildAgendaStepAnalytics(agendas: Agenda[]): AgendaStepAnalytics {
  const sections: AgendaStepSection[] = []
  let current: AgendaStepSection | null = null

  for (const agenda of agendas) {
    if (isAgendaHeading(agenda.agenda_no)) {
      current = {
        id: agenda.id,
        title: agenda.title || `Agenda ${agenda.agenda_no}`,
        itemCount: 0,
      }
      sections.push(current)
      continue
    }

    if (!current) {
      current = {
        id: 'ungrouped',
        title: 'Agenda Items',
        itemCount: 0,
      }
      sections.push(current)
    }

    current.itemCount += 1
  }

  const totalAgendaHeaders = sections.length
  const totalTitles = sections.reduce((sum, section) => sum + section.itemCount, 0)
  const headersWithTitles = sections.filter(section => section.itemCount > 0).length

  return {
    totalAgendaHeaders,
    totalTitles,
    headersWithTitles,
    sections,
  }
}

export function buildMeetingPackStepAnalytics(agendas: Agenda[]): MeetingPackStepAnalytics {
  let attachedPdfCount = 0
  let missingPdfCount = 0
  let explicitNoPdfCount = 0
  const missingItems: MeetingPackMissingItem[] = []

  for (const agenda of agendas) {
    const slidePath = agenda.slide_pages?.trim() ?? ''

    if (!slidePath) {
      missingPdfCount += 1
      missingItems.push({
        id: agenda.id,
        label: `${agenda.agenda_no} - ${agenda.title}`,
      })
      continue
    }

    if (slidePath === NO_PDF_MARKER) {
      explicitNoPdfCount += 1
      continue
    }

    attachedPdfCount += 1
  }

  return {
    totalRows: agendas.length,
    attachedPdfCount,
    missingPdfCount,
    explicitNoPdfCount,
    missingItems,
  }
}

export function deriveWorkflowAutoStatuses({
  agendas,
  hasExistingTranscript,
}: {
  agendas: Agenda[]
  hasExistingTranscript: boolean
}): Record<SetupWorkflowStepId, StepStatus> {
  const agendaAnalytics = buildAgendaStepAnalytics(agendas)
  const meetingPackAnalytics = buildMeetingPackStepAnalytics(agendas)

  return {
    agenda: agendaAnalytics.totalAgendaHeaders > 0 || agendaAnalytics.totalTitles > 0 ? 'done' : 'pending',
    'meeting-pack': meetingPackAnalytics.totalRows > 0 && meetingPackAnalytics.missingPdfCount === 0 ? 'done' : 'pending',
    recording: hasExistingTranscript ? 'done' : 'pending',
  }
}

export function deriveWorkspaceStatus({
  stepStatuses,
  meetingStatus,
}: {
  stepStatuses: Record<SetupWorkflowStepId, StepStatus>
  meetingStatus?: string | null
}): WorkspaceStatusInfo {
  if (meetingStatus === 'finalized') {
    return { label: 'Meeting Done', tone: 'done' }
  }

  if (stepStatuses.agenda === 'pending') {
    return { label: 'Pending Agenda', tone: 'pending' }
  }

  if (stepStatuses['meeting-pack'] === 'pending') {
    return { label: 'Pending Finalize Meeting Pack', tone: 'pending' }
  }

  if (stepStatuses.recording === 'pending') {
    return { label: 'Pending MoM Generation', tone: 'pending' }
  }

  return { label: 'Meeting Done', tone: 'done' }
}
