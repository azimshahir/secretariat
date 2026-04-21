import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Plus } from 'lucide-react'
import { AppShell } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { deriveWorkflowAutoStatuses } from '@/app/meeting/[id]/setup/setup-workflow'
import { getActiveBuildId } from '@/lib/app-build'
import { requireAuthedAppContext } from '@/lib/authenticated-app'
import { parseCommitteeFormattingDefaultSnapshot } from '@/lib/committee-formatting-defaults'
import { normalizeMeetingStatus } from '@/lib/meeting-links'
import { CommitteeWorkspaceShell } from './committee-workspace-shell'
import {
  hydrateTemplateGroups,
  type LegacyItineraryTemplate,
} from '@/app/meeting/[id]/setup/settings-template-model'
import { COMMITTEE_SPEAKER_SELECT, type CommitteeSpeaker } from '@/lib/committee-speakers'
import type { CommitteeRagDocumentSummary } from '@/app/meeting/[id]/setup/rag-types'
import type { Agenda, MeetingStatus } from '@/lib/supabase/types'

type SearchParams = Promise<{ tab?: string }>
type CommitteeWorkspaceTab = 'meetings' | 'chatbot' | 'settings'

function normalizeCommitteeWorkspaceTab(value: string | null | undefined): CommitteeWorkspaceTab {
  return value === 'chatbot' || value === 'settings' ? value : 'meetings'
}

function deriveRegisterStatus(params: {
  meetingId: string
  meetingStatus: string | null | undefined
  agendaLocked: boolean
  agendas: Agenda[]
  hasExistingTranscript: boolean
}): MeetingStatus | 'done' {
  const normalizedMeetingStatus = normalizeMeetingStatus(params.meetingStatus)

  try {
    const workflowStatuses = deriveWorkflowAutoStatuses({
      agendas: params.agendas,
      agendaLocked: params.agendaLocked,
      hasExistingTranscript: params.hasExistingTranscript,
    })
    const allWorkflowStepsDone = Object.values(workflowStatuses).every(
      status => status === 'done'
    )

    return normalizedMeetingStatus === 'finalized'
      ? 'finalized'
      : (allWorkflowStepsDone ? 'done' : normalizedMeetingStatus)
  } catch (error) {
    console.error('Failed to derive committee workspace workflow status', {
      meetingId: params.meetingId,
      error,
    })
    return normalizedMeetingStatus
  }
}

export default async function SecretariatDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: SearchParams
}) {
  const { slug } = await params
  const { tab } = await searchParams
  const initialTab = normalizeCommitteeWorkspaceTab(tab)
  const { profile, committees, canViewOrgScope, supabase } = await requireAuthedAppContext()
  const committee = committees.find(item => item.slug === slug)

  if (!committee) {
    notFound()
  }
  const [
    meetingsResult,
    settingsResult,
    legacyTemplatesResult,
    speakersResult,
    ragDocumentsResult,
  ] = await Promise.all([
    supabase
      .from('meetings')
      .select('id, title, meeting_date, status, committee_id, agenda_locked_at, committees(name)')
      .eq('committee_id', committee.id)
      .order('meeting_date', { ascending: false }),
    supabase
      .from('committee_generation_settings')
      .select('minute_instruction, template_sections, formatting_default_snapshot')
      .eq('committee_id', committee.id)
      .maybeSingle(),
    supabase
      .from('itinerary_templates')
      .select('section_key, storage_path, file_name')
      .eq('committee_id', committee.id),
    supabase
      .from('committee_speakers')
      .select(COMMITTEE_SPEAKER_SELECT)
      .eq('committee_id', committee.id)
      .order('sort_order'),
    supabase
      .from('committee_rag_documents')
      .select('id, category, document_name, file_name, created_at')
      .eq('committee_id', committee.id)
      .order('created_at', { ascending: false }),
  ])

  const baseMeetings = (meetingsResult.data ?? []).map(meeting => ({
    id: meeting.id,
    title: meeting.title,
    meeting_date: meeting.meeting_date,
    status: normalizeMeetingStatus(meeting.status),
    agenda_locked_at: meeting.agenda_locked_at,
    committee_name: (meeting.committees as unknown as { name: string } | null)?.name ?? committee.name,
  }))

  const meetingIds = baseMeetings.map(meeting => meeting.id)
  const [{ data: agendas }, { data: transcripts }] = meetingIds.length > 0
    ? await Promise.all([
        supabase
          .from('agendas')
          .select('id, meeting_id, agenda_no, title, slide_pages, sort_order')
          .in('meeting_id', meetingIds),
        supabase
          .from('transcripts')
          .select('id, meeting_id')
          .in('meeting_id', meetingIds),
      ])
    : [{ data: [] }, { data: [] }]

  const agendasByMeeting = new Map<string, Agenda[]>()
  for (const agenda of agendas ?? []) {
    const current = agendasByMeeting.get(agenda.meeting_id) ?? []
    current.push(agenda as Agenda)
    agendasByMeeting.set(agenda.meeting_id, current)
  }

  const transcriptCountByMeeting = new Map<string, number>()
  for (const transcript of transcripts ?? []) {
    transcriptCountByMeeting.set(
      transcript.meeting_id,
      (transcriptCountByMeeting.get(transcript.meeting_id) ?? 0) + 1,
    )
  }

  const meetings = baseMeetings.map(meeting => {
    return {
      id: meeting.id,
      title: meeting.title,
      meeting_date: meeting.meeting_date,
      status: meeting.status,
      registerStatus: deriveRegisterStatus({
        meetingId: meeting.id,
        meetingStatus: meeting.status,
        agendaLocked: Boolean(meeting.agenda_locked_at),
        agendas: agendasByMeeting.get(meeting.id) ?? [],
        hasExistingTranscript: (transcriptCountByMeeting.get(meeting.id) ?? 0) > 0,
      }),
      committee_name: meeting.committee_name,
    }
  })

  const formattingSnapshot = parseCommitteeFormattingDefaultSnapshot(
    settingsResult.data?.formatting_default_snapshot ?? null,
  )

  let latestFormattingUpdate: {
    savedAt: string
    sourceMeetingId: string | null
    sourceMeetingTitle: string | null
    sourceMeetingDate: string | null
  } | null = null

  if (formattingSnapshot) {
    let sourceMeetingTitle: string | null = null
    let sourceMeetingDate: string | null = null

    if (formattingSnapshot.sourceMeetingId) {
      const { data: sourceMeeting } = await supabase
        .from('meetings')
        .select('id, title, meeting_date')
        .eq('id', formattingSnapshot.sourceMeetingId)
        .maybeSingle()

      sourceMeetingTitle = sourceMeeting?.title ?? null
      sourceMeetingDate = sourceMeeting?.meeting_date ?? null
    }

    latestFormattingUpdate = {
      savedAt: formattingSnapshot.savedAt,
      sourceMeetingId: formattingSnapshot.sourceMeetingId ?? null,
      sourceMeetingTitle,
      sourceMeetingDate,
    }
  }

  const initialTemplateGroups = hydrateTemplateGroups({
    minuteInstruction: settingsResult.data?.minute_instruction ?? '',
    persistedGroups: settingsResult.data?.template_sections ?? [],
    itineraryTemplates: (legacyTemplatesResult.data ?? []) as LegacyItineraryTemplate[],
  })

  const initialSpeakers = ((speakersResult.data ?? []) as CommitteeSpeaker[]).map(speaker => ({
    ...speaker,
    committee_id: speaker.committee_id ?? committee.id,
  }))

  const initialRagDocuments: CommitteeRagDocumentSummary[] = (ragDocumentsResult.data ?? []).map(document => ({
    id: document.id,
    category: document.category,
    documentName: document.document_name,
    fileName: document.file_name,
    createdAt: document.created_at,
  }))

  return (
    <AppShell
      profile={profile}
      committees={committees}
      activeCommitteeId={committee.id}
      eyebrow={committee.category}
      title={committee.name}
      description={`${meetings.length} meeting${meetings.length === 1 ? '' : 's'} on record`}
      canViewOrgScope={canViewOrgScope}
      initialBuildId={getActiveBuildId()}
      actions={(
        <Button asChild className="gap-2 rounded-[14px]">
          <Link href={`/meeting/new?committee=${committee.id}`}>
            <Plus className="h-4 w-4" />
            New Meeting
          </Link>
        </Button>
      )}
    >
      <CommitteeWorkspaceShell
        key={`${committee.id}:${initialTab}`}
        committeeId={committee.id}
        committeeName={committee.name}
        committeeSlug={committee.slug}
        committees={committees}
        initialTab={initialTab}
        meetings={meetings}
        initialMinuteInstruction={settingsResult.data?.minute_instruction ?? ''}
        initialTemplateGroups={initialTemplateGroups}
        initialSpeakers={initialSpeakers}
        initialRagDocuments={initialRagDocuments}
        latestFormattingUpdate={latestFormattingUpdate}
      />
    </AppShell>
  )
}
