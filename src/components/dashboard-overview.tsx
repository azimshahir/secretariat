'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Clock3,
  FolderKanban,
  LayoutDashboard,
  Settings2,
  Sparkles,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { CreateActionMenu } from '@/components/create-action-menu'
import {
  DashboardPill,
  DashboardSectionIntro,
  DashboardStatCard,
  DashboardSurface,
} from '@/components/dashboard-primitives'
import { Button } from '@/components/ui/button'
import { normalizeMeetingStatus } from '@/lib/meeting-links'
import type { DashboardScope } from '@/lib/secretariat-access'
import type { MeetingStatus } from '@/lib/supabase/types'
import { cn } from '@/lib/utils'

interface MeetingRow {
  id: string
  title: string
  meeting_date: string
  status: MeetingStatus
  committee_id: string | null
  committee_name: string | null
}

interface PendingJobSummary {
  label: string
  count: number
  helper: string
}

interface YearlyTrendPoint {
  label: string
  done: number
  pending: number
}

interface DashboardOverviewProps {
  meetings: MeetingRow[]
  activeCommitteeId?: string | null
  activeCommitteeName?: string | null
  committeeCount: number
  currentDate: string
  dashboardScope: DashboardScope
  pendingJobs: PendingJobSummary[]
  yearlyTrend: YearlyTrendPoint[]
  overdueCount: number
}

const statusTone: Record<MeetingStatus, string> = {
  draft: 'border-zinc-200 bg-zinc-50 text-zinc-700',
  pending_setup: 'border-amber-200 bg-amber-50 text-amber-700',
  mapping: 'border-cyan-200 bg-cyan-50 text-cyan-700',
  generating: 'border-violet-200 bg-violet-50 text-violet-700',
  in_progress: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  finalized: 'border-teal-200 bg-teal-50 text-teal-700',
}

function startOfMonth(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), 1)
}

function addMonths(value: Date, delta: number) {
  return new Date(value.getFullYear(), value.getMonth() + delta, 1)
}

function isSameDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  )
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('en-MY', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function formatStatusLabel(value: MeetingStatus) {
  return normalizeMeetingStatus(value).replace('_', ' ')
}

function getMeetingHref(meeting: MeetingRow) {
  switch (normalizeMeetingStatus(meeting.status)) {
    case 'draft':
    case 'pending_setup':
    case 'mapping':
    case 'generating':
    case 'in_progress':
      return `/meeting/${meeting.id}/setup`
    case 'finalized':
      return `/meeting/${meeting.id}/view`
  }
}

function getPendingCount(items: PendingJobSummary[], label: string) {
  return items.find(item => item.label === label)?.count ?? 0
}

export function DashboardOverview({
  meetings,
  activeCommitteeId,
  activeCommitteeName,
  committeeCount,
  currentDate,
  dashboardScope,
  pendingJobs,
  yearlyTrend,
  overdueCount,
}: DashboardOverviewProps) {
  const reduceMotion = useReducedMotion()
  const [displayMonth, setDisplayMonth] = useState(() =>
    startOfMonth(new Date(currentDate))
  )
  const {
    calendarDays,
    monthMeetings,
    upcomingMeetings,
    doneThisYear,
    pendingThisYear,
    liveWorkspaces,
    operationsQueue,
  } = useMemo(() => {
    const today = new Date(currentDate)
    const sortedMeetings = [...meetings].sort(
      (left, right) =>
        new Date(left.meeting_date).getTime() -
        new Date(right.meeting_date).getTime()
    )

    const monthStart = startOfMonth(displayMonth)
    const monthEnd = addMonths(monthStart, 1)
    const firstGridDate = new Date(monthStart)
    firstGridDate.setDate(firstGridDate.getDate() - firstGridDate.getDay())

    const days = Array.from({ length: 42 }, (_, index) => {
      const date = new Date(firstGridDate)
      date.setDate(firstGridDate.getDate() + index)

      const items = sortedMeetings.filter(meeting =>
        isSameDay(new Date(meeting.meeting_date), date)
      )

      return {
        date,
        inMonth:
          date.getMonth() === monthStart.getMonth() &&
          date.getFullYear() === monthStart.getFullYear(),
        isToday: isSameDay(date, today),
        meetings: items,
      }
    })

    const visibleMonthMeetings = sortedMeetings.filter(meeting => {
      const meetingDate = new Date(meeting.meeting_date)
      return meetingDate >= monthStart && meetingDate < monthEnd
    })

    const futureMeetings = sortedMeetings.filter(
      meeting => new Date(meeting.meeting_date).getTime() >= today.getTime()
    )

    const currentYear = today.getFullYear()
    const thisYearMeetings = sortedMeetings.filter(
      meeting => new Date(meeting.meeting_date).getFullYear() === currentYear
    )

    return {
      calendarDays: days,
      monthMeetings: visibleMonthMeetings,
      upcomingMeetings: futureMeetings.slice(0, 5),
      doneThisYear: thisYearMeetings.filter(
        meeting => meeting.status === 'finalized'
      ).length,
      pendingThisYear: thisYearMeetings.filter(
        meeting => meeting.status !== 'finalized'
      ).length,
      liveWorkspaces: sortedMeetings.filter(meeting => meeting.status !== 'finalized')
        .length,
      operationsQueue: pendingJobs
        .filter(item => item.count > 0)
        .sort((left, right) => right.count - left.count)
        .slice(0, 4),
    }
  }, [currentDate, displayMonth, meetings, pendingJobs])

  const nextMeeting = upcomingMeetings[0] ?? null
  const meetingHref = activeCommitteeId
    ? `/meeting/new?committee=${activeCommitteeId}`
    : '/meeting/new'
  const readyToFinalizeCount = getPendingCount(pendingJobs, 'Ready to finalize')
  const mappingNeededCount = getPendingCount(pendingJobs, 'Mapping needed')
  const transcriptMissingCount = getPendingCount(pendingJobs, 'No transcript uploaded')

  return (
    <div className="grid gap-4">
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 14 }}
        animate={reduceMotion ? {} : { opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"
      >
        <DashboardStatCard
          label="Next Meeting"
          value={nextMeeting ? formatDate(nextMeeting.meeting_date) : 'No hold'}
          description={nextMeeting?.title ?? 'No meeting is on the calendar yet.'}
          icon={CalendarClock}
          tone="primary"
        />
        <DashboardStatCard
          label="Live Workspaces"
          value={liveWorkspaces}
          description="Meetings still moving through setup, generation, or review."
          icon={LayoutDashboard}
          tone="default"
        />
        <DashboardStatCard
          label="Overdue"
          value={overdueCount}
          description="Past-date meetings that still need to be finalized."
          icon={AlertTriangle}
          tone="warning"
        />
        <DashboardStatCard
          label="Ready To Finalize"
          value={readyToFinalizeCount}
          description="Meetings with enough minute coverage for final review."
          icon={CheckCircle2}
          tone="success"
        />
      </motion.div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.48fr)_360px]">
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 16 }}
          animate={reduceMotion ? {} : { opacity: 1, y: 0 }}
          transition={{ duration: 0.32, delay: 0.04 }}
        >
          <DashboardSurface tone="muted" padding="lg">
            <DashboardSectionIntro
              eyebrow={
                dashboardScope === 'org' ? 'Organization planning surface' : 'Secretariat planning surface'
              }
              title="Calendar Overview"
              description="Track what is scheduled this month, scan busy days quickly, and jump straight into the next active workspace."
              actions={(
                <>
                  <CreateActionMenu
                    meetingHref={meetingHref}
                    canCreateMeeting={committeeCount > 0}
                    className="h-9 rounded-[12px] px-3.5 text-[0.82rem]"
                  />
                  <Button
                    asChild
                    variant="outline"
                    size="sm"
                    className="h-9 rounded-[12px] px-3.5 text-[0.82rem]"
                  >
                    <Link href="/settings">
                      <Settings2 className="h-3.5 w-3.5" />
                      Settings
                    </Link>
                  </Button>
                </>
              )}
            />

            <div className="mt-4 flex flex-col gap-3 border-t border-border/70 pt-4 md:flex-row md:items-center md:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <DashboardPill tone="primary">
                  {displayMonth.toLocaleDateString('en-MY', {
                    month: 'long',
                    year: 'numeric',
                  })}
                </DashboardPill>
                {activeCommitteeName ? (
                  <DashboardPill>{activeCommitteeName}</DashboardPill>
                ) : (
                  <DashboardPill>{committeeCount} secretariat{committeeCount === 1 ? '' : 's'} in scope</DashboardPill>
                )}
                <DashboardPill>{monthMeetings.length} scheduled this month</DashboardPill>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setDisplayMonth(previous => addMonths(previous, -1))}
                  className="h-8 w-8 rounded-[11px]"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setDisplayMonth(previous => addMonths(previous, 1))}
                  className="h-8 w-8 rounded-[11px]"
                >
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-7 gap-2 text-center text-[0.63rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground/85">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                <div key={day} className="py-1">
                  {day}
                </div>
              ))}
            </div>

            <div className="mt-2 grid grid-cols-7 gap-2">
              {calendarDays.map(day => (
                <div
                  key={day.date.toISOString()}
                  className={cn(
                    'min-h-[96px] rounded-[18px] border px-2.5 py-2 transition-colors',
                    day.inMonth
                      ? 'border-border/70 bg-white/92'
                      : 'border-border/55 bg-secondary/25 text-muted-foreground/70',
                    day.isToday && 'border-primary/25 bg-primary/5'
                  )}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span
                      className={cn(
                        'text-[11px] font-semibold',
                        day.isToday &&
                          'flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground'
                      )}
                    >
                      {day.date.getDate()}
                    </span>
                    {day.meetings.length > 0 ? (
                      <span className="text-[10px] text-muted-foreground">
                        {day.meetings.length}
                      </span>
                    ) : null}
                  </div>
                  <div className="space-y-1.5">
                    {day.meetings.slice(0, 2).map(meeting => (
                      <Link
                        key={meeting.id}
                        href={getMeetingHref(meeting)}
                        className={cn(
                          'block rounded-[12px] border px-2 py-1 text-left text-[10.5px] leading-4 transition-colors hover:opacity-90',
                          statusTone[normalizeMeetingStatus(meeting.status)]
                        )}
                      >
                        <p className="truncate font-medium">{meeting.title}</p>
                        {meeting.committee_name ? (
                          <p className="truncate opacity-75">
                            {meeting.committee_name}
                          </p>
                        ) : null}
                      </Link>
                    ))}
                    {day.meetings.length > 2 ? (
                      <p className="px-1 text-[10.5px] text-muted-foreground">
                        +{day.meetings.length - 2} more
                      </p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </DashboardSurface>
        </motion.div>

        <div className="grid content-start gap-3.5">
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 16 }}
            animate={reduceMotion ? {} : { opacity: 1, y: 0 }}
            transition={{ duration: 0.28, delay: 0.08 }}
          >
            <DashboardSurface tone="accent" padding="md">
              <DashboardSectionIntro
                eyebrow="Operational focus"
                title="What Needs Attention"
                description="Highest-friction backlog across agenda setup, transcript readiness, mapping, and review."
                compact
              />
              <div className="mt-4 space-y-2.5">
                {operationsQueue.length > 0 ? operationsQueue.map(item => (
                  <div
                    key={item.label}
                    className="rounded-[18px] border border-white/70 bg-white/84 px-3.5 py-3 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">
                          {item.label}
                        </p>
                        <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                          {item.helper}
                        </p>
                      </div>
                      <span className="rounded-full border border-primary/15 bg-primary/8 px-2.5 py-1 text-[11px] font-semibold text-primary">
                        {item.count}
                      </span>
                    </div>
                  </div>
                )) : (
                  <div className="rounded-[18px] border border-white/70 bg-white/84 px-4 py-4 text-sm text-muted-foreground shadow-sm">
                    No urgent backlog right now.
                  </div>
                )}
              </div>
            </DashboardSurface>
          </motion.div>

          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 16 }}
            animate={reduceMotion ? {} : { opacity: 1, y: 0 }}
            transition={{ duration: 0.28, delay: 0.12 }}
          >
            <DashboardSurface padding="md">
              <DashboardSectionIntro
                eyebrow="Next calendar hold"
                title={nextMeeting ? nextMeeting.title : 'No upcoming meeting'}
                description={nextMeeting
                  ? `${formatDate(nextMeeting.meeting_date)}${nextMeeting.committee_name ? ` • ${nextMeeting.committee_name}` : ''}`
                  : 'Create a new meeting to start populating the planning surface.'}
                compact
                actions={nextMeeting ? (
                  <Button asChild size="sm" className="h-8 rounded-[11px] px-3">
                    <Link href={getMeetingHref(nextMeeting)}>
                      Open Workspace
                    </Link>
                  </Button>
                ) : null}
              />
            </DashboardSurface>
          </motion.div>

          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 16 }}
            animate={reduceMotion ? {} : { opacity: 1, y: 0 }}
            transition={{ duration: 0.28, delay: 0.16 }}
          >
            <DashboardSurface padding="md">
              <DashboardSectionIntro
                eyebrow="Delivery posture"
                title="Scope Snapshot"
                description="Useful signals for how healthy this operating window looks."
                compact
              />
              <div className="mt-4 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-1">
                <div className="rounded-[18px] border border-border/70 bg-secondary/25 px-3.5 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Finalized This Year
                  </p>
                  <p className="mt-1.5 text-[1.2rem] font-semibold tracking-[-0.04em] text-foreground">
                    {doneThisYear}
                  </p>
                </div>
                <div className="rounded-[18px] border border-border/70 bg-secondary/25 px-3.5 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Still In Motion
                  </p>
                  <p className="mt-1.5 text-[1.2rem] font-semibold tracking-[-0.04em] text-foreground">
                    {pendingThisYear}
                  </p>
                </div>
                <div className="rounded-[18px] border border-border/70 bg-secondary/25 px-3.5 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Transcript Backlog
                  </p>
                  <p className="mt-1.5 text-[1.2rem] font-semibold tracking-[-0.04em] text-foreground">
                    {transcriptMissingCount}
                  </p>
                </div>
                <div className="rounded-[18px] border border-border/70 bg-secondary/25 px-3.5 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Mapping Queue
                  </p>
                  <p className="mt-1.5 text-[1.2rem] font-semibold tracking-[-0.04em] text-foreground">
                    {mappingNeededCount}
                  </p>
                </div>
              </div>
            </DashboardSurface>
          </motion.div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_360px]">
        <DashboardSurface padding="lg">
          <DashboardSectionIntro
            eyebrow="Delivery rhythm"
            title="Yearly Delivery Trend"
            description="Completed versus still-active meetings across the year so you can see when operational load starts to stack."
          />
          <div className="mt-4 h-[276px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={yearlyTrend}>
                <CartesianGrid vertical={false} stroke="rgba(15,23,42,0.08)" />
                <XAxis
                  dataKey="label"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: 'rgba(71,85,105,0.82)', fontSize: 12 }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                  tick={{ fill: 'rgba(71,85,105,0.82)', fontSize: 12 }}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(15,118,110,0.06)' }}
                  contentStyle={{
                    borderRadius: 16,
                    border: '1px solid rgba(148, 163, 184, 0.18)',
                    boxShadow: '0 18px 50px -30px rgba(15, 23, 42, 0.32)',
                    background: 'rgba(255,255,255,0.96)',
                  }}
                />
                <Bar
                  dataKey="done"
                  name="Done"
                  fill="rgba(13, 148, 136, 0.92)"
                  radius={[9, 9, 4, 4]}
                  isAnimationActive={!reduceMotion}
                />
                <Bar
                  dataKey="pending"
                  name="Not done"
                  fill="rgba(15, 23, 42, 0.22)"
                  radius={[9, 9, 4, 4]}
                  isAnimationActive={!reduceMotion}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </DashboardSurface>

        <DashboardSurface padding="md">
          <DashboardSectionIntro
            eyebrow="Queue"
            title="Upcoming Workspaces"
            description="Fast path into the next meetings that will likely need setup or review attention."
            compact
          />
          <div className="mt-4 space-y-2.5">
            {upcomingMeetings.length > 0 ? (
              upcomingMeetings.map(meeting => (
                <Link
                  key={meeting.id}
                  href={getMeetingHref(meeting)}
                  className="block rounded-[18px] border border-border/70 bg-secondary/20 px-3.5 py-3 transition-colors hover:border-primary/18 hover:bg-primary/5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {meeting.title}
                      </p>
                      <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                        {formatDate(meeting.meeting_date)}
                        {meeting.committee_name ? ` • ${meeting.committee_name}` : ''}
                      </p>
                    </div>
                    <span
                      className={cn(
                        'shrink-0 rounded-full border px-2 py-1 text-[10px] font-medium capitalize',
                        statusTone[normalizeMeetingStatus(meeting.status)]
                      )}
                    >
                      {formatStatusLabel(meeting.status)}
                    </span>
                  </div>
                </Link>
              ))
            ) : (
              <div className="rounded-[18px] border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
                No upcoming meetings yet.
              </div>
            )}

            <div className="rounded-[18px] border border-border/70 bg-secondary/20 px-3.5 py-3 text-[12px] text-muted-foreground">
              <div className="flex items-center gap-2">
                <Clock3 className="h-3.5 w-3.5 text-primary" />
                <span>Pending jobs combine agenda, transcript, and minute coverage signals.</span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                <span>Open a workspace to continue setup, generation, or final review.</span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <FolderKanban className="h-3.5 w-3.5 text-primary" />
                <span>Use the calendar above for planning, and this queue for execution.</span>
              </div>
            </div>
          </div>
        </DashboardSurface>
      </div>
    </div>
  )
}
