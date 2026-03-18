import { redirect } from 'next/navigation'

import { AppShell } from '@/components/app-shell'
import { CreationCards } from '@/components/creation-cards'
import { DashboardOverview } from '@/components/dashboard-overview'
import { MeetingTable } from '@/components/meeting-table'
import SecretariatLandingPage from '@/components/ui/fin-tech-landing-page'
import { ensureUserProvisioned } from '@/lib/auth/provision'
import {
  canViewOrganizationScope,
  normalizeDashboardScope,
} from '@/lib/secretariat-access'
import { createClient } from '@/lib/supabase/server'
import type { MeetingStatus } from '@/lib/supabase/types'

const meetingStatusPriority: Record<MeetingStatus, number> = {
  in_progress: 6,
  generating: 5,
  mapping: 4,
  pending_setup: 3,
  draft: 2,
  finalized: 1,
}

function normalizeMeetingTitle(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

function pickPreferredMeeting<
  T extends { status: MeetingStatus; created_at: string }
>(a: T, b: T) {
  const priorityA = meetingStatusPriority[a.status]
  const priorityB = meetingStatusPriority[b.status]
  if (priorityA !== priorityB) return priorityA > priorityB ? a : b
  return new Date(a.created_at).getTime() >= new Date(b.created_at).getTime()
    ? a
    : b
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    committee?: string
    secretariat?: string
    createdSecretariat?: string
    scope?: string
  }>
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return <SecretariatLandingPage />

  const {
    committee: committeeParam,
    secretariat: secretariatParam,
    scope,
  } = await searchParams

  let { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile) {
    await ensureUserProvisioned(user)
    const retry = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()
    profile = retry.data
  }

  if (!profile) {
    redirect('/login?error=Profile+setup+failed.+Please+try+signing+up+again.')
  }

  const { data: committees } = await supabase
    .from('committees')
    .select('*')
    .order('name')

  const allCommittees = committees ?? []

  const { data: myMemberships } = await supabase
    .from('committee_memberships')
    .select('committee_id')
    .eq('user_id', user.id)

  const myCommitteeIds = new Set(
    [
      ...(myMemberships ?? []).map(membership => membership.committee_id),
      ...allCommittees
        .filter(committeeRow => committeeRow.created_by === user.id)
        .map(committeeRow => committeeRow.id),
    ].filter(Boolean)
  )

  const myCommittees = allCommittees.filter(committeeRow =>
    myCommitteeIds.has(committeeRow.id)
  )

  const dashboardScope = normalizeDashboardScope(scope, profile.role)
  const scopedCommittees =
    dashboardScope === 'org' && canViewOrganizationScope(profile.role)
      ? allCommittees
      : myCommittees

  const highlightedCommitteeId =
    secretariatParam ?? committeeParam ?? null
  const activeCommittee =
    highlightedCommitteeId && allCommittees.some(item => item.id === highlightedCommitteeId)
      ? allCommittees.find(item => item.id === highlightedCommitteeId) ?? null
      : null

  if (scopedCommittees.length === 0) {
    return (
      <AppShell
        profile={profile}
        committees={allCommittees}
        dashboardScope={dashboardScope}
        canViewOrgScope={canViewOrganizationScope(profile.role)}
        eyebrow="Workspace"
        title="Create your first secretariat"
        description="Secretariats come first in this workflow. Once a secretariat exists, the dashboard calendar, meeting creation, and operational insights become available."
        containerClassName="max-w-[1100px]"
      >
        <CreationCards committees={[]} />
      </AppShell>
    )
  }

  const { data: meetingsRaw } = await supabase
    .from('meetings')
    .select(
      'id, title, meeting_date, status, created_at, committee_id, committees(name)'
    )
    .order('meeting_date', { ascending: true })

  type MeetingListRow = NonNullable<typeof meetingsRaw>[number]

  const filteredMeetings = (meetingsRaw ?? []).filter(meetingRow => {
    if (dashboardScope === 'org' && canViewOrganizationScope(profile.role)) {
      return true
    }

    return Boolean(meetingRow.committee_id && myCommitteeIds.has(meetingRow.committee_id))
  })

  const dedupeMap = new Map<string, MeetingListRow>()
  for (const meeting of filteredMeetings) {
    const dedupeKey = [
      meeting.committee_id ?? 'no-committee',
      meeting.meeting_date,
      normalizeMeetingTitle(meeting.title).toLowerCase(),
    ].join('|')
    const existing = dedupeMap.get(dedupeKey)
    if (!existing) {
      dedupeMap.set(dedupeKey, meeting)
      continue
    }
    dedupeMap.set(dedupeKey, pickPreferredMeeting(meeting, existing))
  }

  const dedupedMeetings = Array.from(dedupeMap.values()).sort(
    (left, right) =>
      new Date(left.meeting_date).getTime() -
      new Date(right.meeting_date).getTime()
  )

  const meetings = dedupedMeetings.map(meeting => ({
    id: meeting.id,
    title: meeting.title,
    meeting_date: meeting.meeting_date,
    status: meeting.status,
    committee_id: meeting.committee_id,
    committee_name:
      (meeting.committees as unknown as { name: string } | null)?.name ?? null,
  }))

  const scopedMeetingIds = meetings.map(meeting => meeting.id)
  const { data: agendas } =
    scopedMeetingIds.length > 0
      ? await supabase
          .from('agendas')
          .select('id, meeting_id')
          .in('meeting_id', scopedMeetingIds)
      : { data: [] }
  const { data: transcripts } =
    scopedMeetingIds.length > 0
      ? await supabase
          .from('transcripts')
          .select('id, meeting_id')
          .in('meeting_id', scopedMeetingIds)
      : { data: [] }

  const agendaIds = (agendas ?? []).map(agenda => agenda.id)
  const { data: minutes } =
    agendaIds.length > 0
      ? await supabase
          .from('minutes')
          .select('agenda_id, is_current')
          .in('agenda_id', agendaIds)
      : { data: [] }

  const agendaCountByMeeting = new Map<string, number>()
  for (const agenda of agendas ?? []) {
    agendaCountByMeeting.set(
      agenda.meeting_id,
      (agendaCountByMeeting.get(agenda.meeting_id) ?? 0) + 1
    )
  }

  const transcriptCountByMeeting = new Map<string, number>()
  for (const transcript of transcripts ?? []) {
    transcriptCountByMeeting.set(
      transcript.meeting_id,
      (transcriptCountByMeeting.get(transcript.meeting_id) ?? 0) + 1
    )
  }

  const currentMinuteAgendaIds = new Set(
    (minutes ?? [])
      .filter(minute => minute.is_current)
      .map(minute => minute.agenda_id)
  )

  const minuteCountByMeeting = new Map<string, number>()
  for (const agenda of agendas ?? []) {
    if (!currentMinuteAgendaIds.has(agenda.id)) continue
    minuteCountByMeeting.set(
      agenda.meeting_id,
      (minuteCountByMeeting.get(agenda.meeting_id) ?? 0) + 1
    )
  }

  const pendingJobs = [
    {
      label: 'No agenda uploaded',
      count: meetings.filter(
        meeting => (agendaCountByMeeting.get(meeting.id) ?? 0) === 0
      ).length,
      helper: 'Meetings waiting for agenda structure or agenda import.',
    },
    {
      label: 'No transcript uploaded',
      count: meetings.filter(meeting => {
        const agendaCount = agendaCountByMeeting.get(meeting.id) ?? 0
        const transcriptCount = transcriptCountByMeeting.get(meeting.id) ?? 0
        return agendaCount > 0 && transcriptCount === 0
      }).length,
      helper: 'Agenda exists, but transcript material is still missing.',
    },
    {
      label: 'Mapping needed',
      count: meetings.filter(meeting => {
        const agendaCount = agendaCountByMeeting.get(meeting.id) ?? 0
        const transcriptCount = transcriptCountByMeeting.get(meeting.id) ?? 0
        const minuteCount = minuteCountByMeeting.get(meeting.id) ?? 0
        return (
          agendaCount > 0 &&
          transcriptCount > 0 &&
          minuteCount === 0 &&
          meeting.status !== 'finalized'
        )
      }).length,
      helper: 'Transcripts are in, but agenda mapping has not completed yet.',
    },
    {
      label: 'Generation pending',
      count: meetings.filter(meeting => {
        const agendaCount = agendaCountByMeeting.get(meeting.id) ?? 0
        const minuteCount = minuteCountByMeeting.get(meeting.id) ?? 0
        return (
          agendaCount > 0 &&
          minuteCount > 0 &&
          minuteCount < agendaCount &&
          meeting.status !== 'finalized'
        )
      }).length,
      helper: 'Some agenda minutes exist, but the meeting package is still incomplete.',
    },
    {
      label: 'Ready to finalize',
      count: meetings.filter(meeting => {
        const agendaCount = agendaCountByMeeting.get(meeting.id) ?? 0
        const minuteCount = minuteCountByMeeting.get(meeting.id) ?? 0
        return (
          agendaCount > 0 &&
          minuteCount >= agendaCount &&
          meeting.status !== 'finalized'
        )
      }).length,
      helper: 'All agenda minutes are present and the record is ready for final review.',
    },
  ]

  const currentYear = new Date().getFullYear()
  const yearlyTrend = Array.from({ length: 12 }, (_, monthIndex) => {
    const label = new Date(currentYear, monthIndex, 1).toLocaleDateString(
      'en-MY',
      { month: 'short' }
    )
    const monthMeetings = meetings.filter(meeting => {
      const date = new Date(meeting.meeting_date)
      return (
        date.getFullYear() === currentYear &&
        date.getMonth() === monthIndex
      )
    })

    return {
      label,
      done: monthMeetings.filter(meeting => meeting.status === 'finalized').length,
      pending: monthMeetings.filter(meeting => meeting.status !== 'finalized').length,
    }
  })

  const today = new Date()
  const overdueCount = meetings.filter(meeting => {
    const meetingDate = new Date(meeting.meeting_date)
    return meetingDate.getTime() < today.getTime() && meeting.status !== 'finalized'
  }).length

  const tableCommittees =
    dashboardScope === 'org' && canViewOrganizationScope(profile.role)
      ? allCommittees
      : myCommittees

  return (
    <AppShell
      profile={profile}
      committees={allCommittees}
      activeCommitteeId={activeCommittee?.id}
      dashboardScope={dashboardScope}
      canViewOrgScope={canViewOrganizationScope(profile.role)}
      containerClassName="max-w-[1500px]"
    >
      <DashboardOverview
        meetings={meetings}
        activeCommitteeId={activeCommittee?.id ?? null}
        activeCommitteeName={activeCommittee?.name ?? null}
        committeeCount={scopedCommittees.length}
        currentDate={new Date().toISOString()}
        dashboardScope={dashboardScope}
        pendingJobs={pendingJobs}
        yearlyTrend={yearlyTrend}
        overdueCount={overdueCount}
      />
      <MeetingTable
        meetings={[...meetings].sort(
          (left, right) =>
            new Date(right.meeting_date).getTime() -
            new Date(left.meeting_date).getTime()
        )}
        committees={tableCommittees}
        activeCommitteeId={activeCommittee?.id}
      />
    </AppShell>
  )
}
