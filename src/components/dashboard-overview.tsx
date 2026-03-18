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
  ListTodo,
  Settings2,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { CreateActionMenu } from '@/components/create-action-menu'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
  draft: 'bg-slate-100 text-slate-700',
  pending_setup: 'bg-amber-100 text-amber-700',
  mapping: 'bg-cyan-100 text-cyan-700',
  generating: 'bg-violet-100 text-violet-700',
  in_progress: 'bg-emerald-100 text-emerald-700',
  finalized: 'bg-teal-100 text-teal-700',
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

function getMeetingHref(meeting: MeetingRow) {
  switch (meeting.status) {
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
      upcomingMeetings: futureMeetings.slice(0, 4),
      doneThisYear: thisYearMeetings.filter(
        meeting => meeting.status === 'finalized'
      ).length,
      pendingThisYear: thisYearMeetings.filter(
        meeting => meeting.status !== 'finalized'
      ).length,
    }
  }, [currentDate, displayMonth, meetings])

  const nextMeeting = upcomingMeetings[0] ?? null
  const meetingHref = activeCommitteeId
    ? `/meeting/new?committee=${activeCommitteeId}`
    : '/meeting/new'

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_320px]">
        <motion.section
          initial={reduceMotion ? false : { opacity: 0, y: 18 }}
          animate={reduceMotion ? {} : { opacity: 1, y: 0 }}
          transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
          className="rounded-[22px] border border-border/70 bg-white/92 p-4 shadow-[0_18px_60px_-38px_rgba(15,23,42,0.28)] backdrop-blur md:p-5"
        >
          <div className="flex flex-col gap-3 border-b border-border/70 pb-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="rounded-full bg-primary/10 px-3 py-1 text-primary">
                  {dashboardScope === 'org' ? 'Organization view' : 'My secretariats'}
                </Badge>
                {activeCommitteeName ? (
                  <Badge
                    variant="secondary"
                    className="rounded-full px-3 py-1 text-foreground"
                  >
                    {activeCommitteeName}
                  </Badge>
                ) : null}
              </div>
              <div>
                <h2 className="font-display text-[1.9rem] font-semibold tracking-[-0.05em] text-foreground">
                  Calendar overview
                </h2>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                  See every scheduled meeting this month, then work down the
                  workflow backlog across your accessible secretariats.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <CreateActionMenu
                meetingHref={meetingHref}
                canCreateMeeting={committeeCount > 0}
                className="h-9 rounded-[12px] px-3.5 text-[0.84rem]"
              />
              <Button
                asChild
                variant="outline"
                size="sm"
                className="h-9 rounded-[12px] px-3.5 text-[0.84rem]"
              >
                <Link href="/settings">
                  <Settings2 className="h-3.5 w-3.5" />
                  Settings
                </Link>
              </Button>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-primary/65">
                {displayMonth.toLocaleDateString('en-MY', {
                  month: 'long',
                  year: 'numeric',
                })}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {monthMeetings.length} scheduled meeting
                {monthMeetings.length === 1 ? '' : 's'} in this month
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setDisplayMonth(previous => addMonths(previous, -1))}
                className="h-8 w-8 rounded-[12px]"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setDisplayMonth(previous => addMonths(previous, 1))}
                className="h-8 w-8 rounded-[12px]"
              >
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-7 gap-2 text-center text-[0.68rem] font-medium uppercase tracking-[0.18em] text-muted-foreground/90">
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
                  'min-h-[106px] rounded-[16px] border p-2.5 transition-colors',
                  day.inMonth
                    ? 'border-border/70 bg-white'
                    : 'border-border/50 bg-secondary/25 text-muted-foreground/70',
                  day.isToday && 'border-primary/30 bg-primary/5'
                )}
              >
                <div className="mb-2 flex items-center justify-between">
                  <span
                    className={cn(
                      'text-xs font-medium',
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
                        'block rounded-[10px] px-2 py-1 text-left text-[11px] leading-4 transition-colors hover:opacity-85',
                        statusTone[meeting.status]
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
                    <p className="px-1 text-[11px] text-muted-foreground">
                      +{day.meetings.length - 2} more
                    </p>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </motion.section>

        <div className="grid gap-3">
          <motion.section
            initial={reduceMotion ? false : { opacity: 0, y: 18 }}
            animate={reduceMotion ? {} : { opacity: 1, y: 0 }}
            transition={{ duration: 0.28, delay: 0.04 }}
            className="rounded-[20px] border border-border/70 bg-white/92 p-4 shadow-[0_18px_52px_-34px_rgba(15,23,42,0.24)]"
          >
            <div className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-primary" />
              <p className="text-xs uppercase tracking-[0.2em] text-primary/65">
                Upcoming meeting
              </p>
            </div>
            <div className="mt-3 space-y-1">
              <p className="text-[1.55rem] font-semibold tracking-[-0.04em] text-foreground">
                {nextMeeting ? formatDate(nextMeeting.meeting_date) : 'None scheduled'}
              </p>
              <p className="text-sm font-medium text-foreground">
                {nextMeeting?.title ?? 'Create a new secretariat or meeting to begin.'}
              </p>
              <p className="text-sm text-muted-foreground">
                {nextMeeting?.committee_name ?? 'No upcoming items yet.'}
              </p>
            </div>
          </motion.section>

          <motion.section
            initial={reduceMotion ? false : { opacity: 0, y: 18 }}
            animate={reduceMotion ? {} : { opacity: 1, y: 0 }}
            transition={{ duration: 0.28, delay: 0.08 }}
            className="rounded-[20px] border border-border/70 bg-white/92 p-4 shadow-[0_18px_52px_-34px_rgba(15,23,42,0.24)]"
          >
            <div className="flex items-center gap-2">
              <ListTodo className="h-4 w-4 text-primary" />
              <p className="text-xs uppercase tracking-[0.2em] text-primary/65">
                Pending jobs
              </p>
            </div>
            <div className="mt-3 space-y-2.5">
              {pendingJobs.map(item => (
                <div
                  key={item.label}
                  className="rounded-[14px] border border-border/60 bg-secondary/25 px-3 py-2.5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-foreground">
                      {item.label}
                    </p>
                    <Badge variant="secondary">{item.count}</Badge>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {item.helper}
                  </p>
                </div>
              ))}
            </div>
          </motion.section>

          <motion.section
            initial={reduceMotion ? false : { opacity: 0, y: 18 }}
            animate={reduceMotion ? {} : { opacity: 1, y: 0 }}
            transition={{ duration: 0.28, delay: 0.12 }}
            className="rounded-[20px] border border-border/70 bg-white/92 p-4 shadow-[0_18px_52px_-34px_rgba(15,23,42,0.24)]"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-primary" />
              <p className="text-xs uppercase tracking-[0.2em] text-primary/65">
                Important watchlist
              </p>
            </div>
            <div className="mt-3 grid gap-2.5">
              <div className="rounded-[14px] border border-border/60 bg-secondary/25 px-3 py-3">
                <p className="text-[1.45rem] font-semibold tracking-[-0.04em] text-foreground">
                  {overdueCount}
                </p>
                <p className="text-sm text-muted-foreground">
                  Overdue meetings still not finalized.
                </p>
              </div>
              <div className="rounded-[14px] border border-border/60 bg-secondary/25 px-3 py-3">
                <p className="text-[1.45rem] font-semibold tracking-[-0.04em] text-foreground">
                  {doneThisYear}
                </p>
                <p className="text-sm text-muted-foreground">
                  Finalized this year across {committeeCount} secretariat
                  {committeeCount === 1 ? '' : 's'}.
                </p>
              </div>
              <div className="rounded-[14px] border border-border/60 bg-secondary/25 px-3 py-3">
                <p className="text-[1.45rem] font-semibold tracking-[-0.04em] text-foreground">
                  {pendingThisYear}
                </p>
                <p className="text-sm text-muted-foreground">
                  Not yet finalized this year.
                </p>
              </div>
            </div>
          </motion.section>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_320px]">
        <section className="rounded-[20px] border border-border/70 bg-white/92 p-4 shadow-[0_18px_60px_-40px_rgba(15,23,42,0.26)]">
          <div className="flex flex-col gap-2 border-b border-border/70 pb-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-primary/65">
                Your meeting operations at a glance
              </p>
              <h3 className="font-display text-[1.65rem] font-semibold tracking-[-0.04em] text-foreground">
                Yearly delivery trend
              </h3>
            </div>
            <p className="max-w-md text-sm leading-6 text-muted-foreground">
              Track how many meetings are completed versus still moving through
              setup, mapping, generation, and finalization each month.
            </p>
          </div>
          <div className="mt-4 h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={yearlyTrend}>
                <CartesianGrid vertical={false} stroke="rgba(15,23,42,0.08)" />
                <XAxis
                  dataKey="label"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: 'rgba(71,85,105,0.8)', fontSize: 12 }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                  tick={{ fill: 'rgba(71,85,105,0.8)', fontSize: 12 }}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(15,118,110,0.06)' }}
                  contentStyle={{
                    borderRadius: 18,
                    border: '1px solid rgba(148, 163, 184, 0.2)',
                    boxShadow: '0 18px 50px -28px rgba(15, 23, 42, 0.35)',
                    background: 'rgba(255,255,255,0.96)',
                  }}
                />
                <Legend />
                <Bar
                  dataKey="done"
                  name="Done"
                  fill="rgba(13, 148, 136, 0.92)"
                  radius={[10, 10, 4, 4]}
                  isAnimationActive={!reduceMotion}
                />
                <Bar
                  dataKey="pending"
                  name="Not done"
                  fill="rgba(15, 23, 42, 0.24)"
                  radius={[10, 10, 4, 4]}
                  isAnimationActive={!reduceMotion}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="rounded-[20px] border border-border/70 bg-white/92 p-4 shadow-[0_18px_60px_-40px_rgba(15,23,42,0.26)]">
          <div className="flex items-center gap-2">
            <FolderKanban className="h-4 w-4 text-primary" />
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-primary/65">
                Upcoming queue
              </p>
              <h3 className="font-display text-[1.4rem] font-semibold tracking-[-0.04em] text-foreground">
                What needs attention next
              </h3>
            </div>
          </div>
          <div className="mt-4 space-y-2.5">
            {upcomingMeetings.length > 0 ? (
              upcomingMeetings.map(meeting => (
                <Link
                  key={meeting.id}
                  href={getMeetingHref(meeting)}
                  className="block rounded-[16px] border border-border/70 bg-secondary/25 px-3 py-3 transition-colors hover:border-primary/20 hover:bg-primary/5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {meeting.title}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatDate(meeting.meeting_date)}
                        {meeting.committee_name
                          ? ` • ${meeting.committee_name}`
                          : ''}
                      </p>
                    </div>
                    <span
                      className={cn(
                        'rounded-full px-2.5 py-1 text-[10px] font-medium',
                        statusTone[meeting.status]
                      )}
                    >
                      {meeting.status.replace('_', ' ')}
                    </span>
                  </div>
                </Link>
              ))
            ) : (
              <div className="rounded-[16px] border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                No upcoming meetings yet.
              </div>
            )}
            <div className="rounded-[16px] border border-border/60 bg-secondary/20 px-3 py-3 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                <span>Done this month flows straight to export and review.</span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Clock3 className="h-4 w-4 text-primary" />
                <span>Pending jobs are derived from agenda, transcript, and minute state.</span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
