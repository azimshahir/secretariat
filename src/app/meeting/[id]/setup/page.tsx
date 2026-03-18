import { redirect } from 'next/navigation'

import { getCommitteeSpeakers } from '@/actions/committee-speakers'
import { getItineraryTemplates } from '@/actions/itinerary-template'
import { AppShell } from '@/components/app-shell'
import { requireAuthedAppContext } from '@/lib/authenticated-app'
import { formatSecondsToTimecode } from '@/lib/transcript-timeline'
import { getCommitteeGenerationSettings } from './committee-generation-actions'
import type { AgendaTimelineRow } from './agenda-timeline-row'
import { MeetingDashboard } from './meeting-dashboard'
import type { MinuteEntry } from './minute-entry'

export default async function MeetingSetupPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const { supabase, profile, committees, activeSecretariats } =
    await requireAuthedAppContext()

  const { data: meeting } = await supabase
    .from('meetings')
    .select('*, committees(name), organizations(name)')
    .eq('id', id)
    .single()

  if (!meeting) redirect('/')

  const { data: agendas } = await supabase
    .from('agendas')
    .select('*')
    .eq('meeting_id', id)
    .order('sort_order')

  const agendaRows = agendas ?? []
  const agendaIds = agendaRows.map(agenda => agenda.id)
  const currentMinutesByAgenda: Record<string, MinuteEntry> = {}

  if (agendaIds.length > 0) {
    const { data: minutes } = await supabase
      .from('minutes')
      .select('id, agenda_id, content, updated_at')
      .eq('is_current', true)
      .in('agenda_id', agendaIds)

    ;(minutes ?? []).forEach(minute => {
      currentMinutesByAgenda[minute.agenda_id] = {
        content: minute.content,
        updatedAt: minute.updated_at,
        minuteId: minute.id,
      }
    })
  }

  const templateIds = [
    ...new Set(
      agendaRows
        .map(agenda => agenda.format_template_id)
        .filter((value): value is string => Boolean(value))
    ),
  ]
  const templatePromptById = new Map<string, string>()
  if (templateIds.length > 0) {
    const { data: templates } = await supabase
      .from('format_templates')
      .select('id, prompt_text')
      .in('id', templateIds)

    ;(templates ?? []).forEach(template => {
      templatePromptById.set(template.id, template.prompt_text)
    })
  }

  const agendaFormatPrompts = Object.fromEntries(
    agendaRows
      .map(agenda => {
        const templateId = agenda.format_template_id
        if (!templateId) return null
        const promptText = templatePromptById.get(templateId)
        if (!promptText) return null
        return [agenda.id, promptText] as const
      })
      .filter((entry): entry is readonly [string, string] => Boolean(entry))
  )

  const { data: transcripts } = await supabase
    .from('transcripts')
    .select('id')
    .eq('meeting_id', id)
    .order('created_at', { ascending: false })
    .limit(1)

  const latestTranscriptId = transcripts?.[0]?.id ?? null
  const initialTimelineRows: AgendaTimelineRow[] = []

  if (latestTranscriptId && agendaIds.length > 0) {
    const { data: segmentRows } = await supabase
      .from('transcript_segments')
      .select('agenda_id, start_offset, end_offset')
      .eq('transcript_id', latestTranscriptId)
      .order('start_offset')

    const groupedByAgenda = new Map<string, { startSec: number; endSec: number }>()

    for (const segment of segmentRows ?? []) {
      if (
        !segment.agenda_id ||
        segment.start_offset == null ||
        segment.end_offset == null
      ) {
        continue
      }

      const current = groupedByAgenda.get(segment.agenda_id)
      if (!current) {
        groupedByAgenda.set(segment.agenda_id, {
          startSec: segment.start_offset,
          endSec: segment.end_offset,
        })
        continue
      }

      current.startSec = Math.min(current.startSec, segment.start_offset)
      current.endSec = Math.max(current.endSec, segment.end_offset)
    }

    for (const agenda of agendaRows) {
      const row = groupedByAgenda.get(agenda.id)
      if (!row) continue
      initialTimelineRows.push({
        agendaId: agenda.id,
        agendaNo: agenda.agenda_no,
        agendaTitle: agenda.title,
        startTime: formatSecondsToTimecode(row.startSec),
        endTime: formatSecondsToTimecode(row.endSec),
      })
    }
  }

  const committeeName =
    (meeting.committees as unknown as { name: string } | null)?.name ?? null
  const orgName =
    (meeting.organizations as unknown as { name: string } | null)?.name ?? ''
  const committeeGenerationSettings = meeting.committee_id
    ? await getCommitteeGenerationSettings(meeting.committee_id)
    : null

  let itineraryTemplates: Array<{
    section_key: string
    storage_path: string
    file_name: string
  }> = []

  if (meeting.committee_id) {
    try {
      itineraryTemplates = await getItineraryTemplates(meeting.committee_id)
    } catch (error) {
      console.error('Failed to load itinerary templates:', error)
      itineraryTemplates = []
    }
  }

  const committeeSpeakers = meeting.committee_id
    ? await getCommitteeSpeakers(meeting.committee_id).catch(() => [])
    : []

  return (
    <AppShell
      profile={profile}
      committees={activeSecretariats.length > 0 ? activeSecretariats : committees}
      activeCommitteeId={meeting.committee_id ?? undefined}
      containerClassName="max-w-[1600px]"
    >
      <MeetingDashboard
        meetingId={id}
        meetingTitle={meeting.title}
        meetingDate={meeting.meeting_date}
        committeeName={committeeName}
        committeeId={meeting.committee_id ?? null}
        organizationName={orgName}
        existingAgendas={agendaRows}
        agendaFormatPrompts={agendaFormatPrompts}
        hasExistingTranscript={(transcripts ?? []).length > 0}
        initialMeetingRules={
          typeof meeting.meeting_rules === 'string' ? meeting.meeting_rules : ''
        }
        committeeGenerationSettings={committeeGenerationSettings}
        itineraryTemplates={itineraryTemplates}
        committeeSpeakers={committeeSpeakers}
        currentMinutesByAgenda={currentMinutesByAgenda}
        initialTimelineRows={initialTimelineRows}
        meetingStatus={meeting.status}
      />
    </AppShell>
  )
}
