'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import {
  ArrowUpRight,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FolderKanban,
  Plus,
} from 'lucide-react'

import {
  DashboardPill,
  DashboardSectionIntro,
  DashboardSurface,
} from '@/components/dashboard-primitives'
import { CreationCards } from '@/components/creation-cards'
import { NormalMeetingDialog } from '@/components/normal-meeting-dialog'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getMeetingLink } from '@/lib/meeting-links'
import type { Committee, MeetingStatus } from '@/lib/supabase/types'
import { cn } from '@/lib/utils'

type MeetingRegisterStatus = MeetingStatus | 'done'

interface MeetingRow {
  id: string
  title: string
  meeting_date: string
  status: MeetingStatus
  registerStatus: MeetingRegisterStatus
  committee_name: string | null
}

interface Props {
  meetings: MeetingRow[]
  committees: Committee[]
  activeCommitteeId?: string
}

const statusConfig: Record<
  MeetingRegisterStatus,
  {
    label: string
    className: string
    helper: string
  }
> = {
  draft: {
    label: 'Draft',
    className: 'border-zinc-200 bg-zinc-50 text-zinc-700',
    helper: 'Agenda structure still being shaped.',
  },
  pending_setup: {
    label: 'Pending Setup',
    className: 'border-amber-200 bg-amber-50 text-amber-700',
    helper: 'Needs setup inputs before analysis can proceed.',
  },
  mapping: {
    label: 'Mapping',
    className: 'border-cyan-200 bg-cyan-50 text-cyan-700',
    helper: 'Transcript and agenda alignment is still underway.',
  },
  generating: {
    label: 'Generating',
    className: 'border-violet-200 bg-violet-50 text-violet-700',
    helper: 'Minutes or supporting outputs are being generated.',
  },
  in_progress: {
    label: 'In Progress',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    helper: 'Ready for active working and review.',
  },
  done: {
    label: 'Done',
    className: 'border-emerald-200 bg-emerald-100 text-emerald-700',
    helper: 'All three workflow steps are complete and ready for final handling.',
  },
  finalized: {
    label: 'Finalized',
    className: 'border-teal-200 bg-teal-50 text-teal-700',
    helper: 'Record is complete and ready for viewing.',
  },
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('en-MY', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function MeetingStatusPill({ status }: { status: MeetingRegisterStatus }) {
  const config = statusConfig[status] ?? statusConfig.in_progress

  return (
    <span
      className={cn(
        'inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]',
        config.className,
      )}
    >
      {config.label}
    </span>
  )
}

export function MeetingTable({ meetings, committees, activeCommitteeId }: Props) {
  const [showCreate, setShowCreate] = useState(false)
  const activeCommittee = activeCommitteeId
    ? committees.find(c => c.id === activeCommitteeId)
    : null

  const registerStats = useMemo(() => {
    return {
      active: meetings.filter(meeting => meeting.status !== 'finalized').length,
      finalized: meetings.filter(meeting => meeting.status === 'finalized').length,
    }
  }, [meetings])

  if (meetings.length === 0 && activeCommittee) {
    return (
      <>
        <DashboardSurface tone="muted" padding="lg" className="text-center">
          <div className="mx-auto flex max-w-lg flex-col items-center gap-4 py-10">
            <div className="flex h-14 w-14 items-center justify-center rounded-[20px] border border-border/70 bg-white text-primary shadow-sm">
              <Building2 className="h-6 w-6" />
            </div>
            <div className="space-y-2">
              <h2 className="font-display text-[1.45rem] font-semibold tracking-[-0.04em] text-foreground">
                Create your first meeting
              </h2>
              <p className="text-sm leading-6 text-muted-foreground">
                Start the operational register for {activeCommittee.name} and the dashboard surfaces will light up from there.
              </p>
            </div>
            <Button onClick={() => setShowCreate(true)} className="gap-2 rounded-[12px]">
              <Plus className="h-4 w-4" />
              Create a new meeting
            </Button>
          </div>
        </DashboardSurface>
        <NormalMeetingDialog
          open={showCreate}
          onOpenChange={setShowCreate}
          committeeId={activeCommittee.id}
          committeeName={activeCommittee.name}
        />
      </>
    )
  }

  if (meetings.length === 0) {
    return <CreationCards committees={committees} />
  }

  return (
    <DashboardSurface padding="lg">
      <DashboardSectionIntro
        eyebrow="Operational register"
        title="Meeting Register"
        description="A denser working list for upcoming sessions, active workspaces, and finalized records across the secretariats you can access."
        actions={(
          <>
            <DashboardPill tone="primary">
              <FolderKanban className="h-3.5 w-3.5" />
              {meetings.length} total
            </DashboardPill>
            <DashboardPill>
              <Clock3 className="h-3.5 w-3.5" />
              {registerStats.active} active
            </DashboardPill>
            <DashboardPill tone="success">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {registerStats.finalized} finalized
            </DashboardPill>
          </>
        )}
      />

      <div className="mt-4 overflow-hidden rounded-[22px] border border-border/70 bg-white/94">
        <Table>
          <TableHeader>
            <TableRow className="border-border/70 bg-secondary/20 hover:bg-secondary/20">
              <TableHead className="h-10 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Meeting
              </TableHead>
              <TableHead className="h-10 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Date
              </TableHead>
              <TableHead className="h-10 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Committee
              </TableHead>
              <TableHead className="h-10 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Status
              </TableHead>
              <TableHead className="h-10 text-right text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Next Step
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {meetings.map(meeting => {
              const config = statusConfig[meeting.registerStatus] ?? statusConfig.in_progress
              const href = getMeetingLink(meeting.id, meeting.status)

              return (
                <TableRow
                  key={meeting.id}
                  className="border-border/60 transition-colors hover:bg-primary/5"
                >
                  <TableCell className="py-3.5">
                    <div className="min-w-[250px] space-y-1">
                      <Link
                        href={href}
                        className="block text-sm font-semibold text-foreground transition-colors hover:text-primary"
                      >
                        {meeting.title}
                      </Link>
                      <p className="text-[12px] leading-5 text-muted-foreground">
                        {config.helper}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className="py-3.5 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-2">
                      <CalendarDays className="h-3.5 w-3.5 text-primary" />
                      {formatDate(meeting.meeting_date)}
                    </span>
                  </TableCell>
                  <TableCell className="py-3.5 text-sm text-foreground">
                    {meeting.committee_name ?? 'General'}
                  </TableCell>
                  <TableCell className="py-3.5">
                    <MeetingStatusPill status={meeting.registerStatus} />
                  </TableCell>
                  <TableCell className="py-3.5 text-right">
                    <Button
                      asChild
                      size="sm"
                      variant="outline"
                      className="h-8 rounded-full px-3 text-[12px]"
                    >
                      <Link href={href}>
                        Open
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-[12px] text-muted-foreground">
        <DashboardPill>
          <CalendarDays className="h-3.5 w-3.5" />
          {registerStats.active} open workspace{registerStats.active === 1 ? '' : 's'}
        </DashboardPill>
        <DashboardPill>
          Rows stay compact so the register works like an operational queue, not a gallery.
        </DashboardPill>
      </div>
    </DashboardSurface>
  )
}
