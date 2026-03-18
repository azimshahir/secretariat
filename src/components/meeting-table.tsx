'use client'

import { useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { ArrowUpRight, Building2, CalendarDays, Clock3, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CreationCards } from '@/components/creation-cards'
import { NormalMeetingDialog } from '@/components/normal-meeting-dialog'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import type { MeetingStatus, Committee } from '@/lib/supabase/types'

interface MeetingRow {
  id: string
  title: string
  meeting_date: string
  status: MeetingStatus
  committee_name: string | null
}

interface Props {
  meetings: MeetingRow[]
  committees: Committee[]
  activeCommitteeId?: string
}

const statusConfig: Record<MeetingStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  draft: { label: 'Draft', variant: 'outline' },
  pending_setup: { label: 'Pending Setup', variant: 'secondary' },
  mapping: { label: 'Mapping', variant: 'secondary' },
  generating: { label: 'Generating', variant: 'default' },
  in_progress: { label: 'In Progress', variant: 'default' },
  finalized: { label: 'Finalized', variant: 'destructive' },
}

function getMeetingLink(id: string, status: MeetingStatus) {
  switch (status) {
    case 'draft':
    case 'pending_setup':
      return `/meeting/${id}/setup`
    case 'mapping':
      return `/meeting/${id}/map`
    case 'generating':
    case 'in_progress':
      return `/meeting/${id}/setup`
    case 'finalized':
      return `/meeting/${id}/view`
  }
}

export function MeetingTable({ meetings, committees, activeCommitteeId }: Props) {
  const [showCreate, setShowCreate] = useState(false)
  const activeCommittee = activeCommitteeId
    ? committees.find(c => c.id === activeCommitteeId)
    : null

  // Secretariat empty state — committee selected but no meetings yet
  if (meetings.length === 0 && activeCommittee) {
    return (
      <>
        <div className="flex flex-col items-center justify-center gap-4 py-20">
          <Building2 className="h-10 w-10 text-zinc-300" />
          <div className="text-center space-y-1">
            <h2 className="text-lg font-semibold">Create your first meeting</h2>
            <p className="text-sm text-zinc-500">
              Get started by creating a meeting for {activeCommittee.name}
            </p>
          </div>
          <Button onClick={() => setShowCreate(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Create a new meeting
          </Button>
        </div>
        <NormalMeetingDialog
          open={showCreate}
          onOpenChange={setShowCreate}
          committeeId={activeCommittee.id}
          committeeName={activeCommittee.name}
        />
      </>
    )
  }

  // Global empty state — no committee, no meetings
  if (meetings.length === 0) {
    return <CreationCards committees={committees} />
  }

  return (
    <div className="rounded-[30px] border border-border/70 bg-white/92 p-4 shadow-[0_24px_70px_-42px_rgba(15,23,42,0.42)] backdrop-blur md:p-5">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-primary/65">
            Active workspaces
          </p>
          <h3 className="font-display text-2xl font-semibold tracking-[-0.04em] text-foreground">
            Meeting register
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Review upcoming and active meetings across the secretariats you can
            access.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-3 py-1.5">
            <Clock3 className="h-3.5 w-3.5 text-primary" />
            {meetings.length} total records
          </span>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Meeting Title</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Committee</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {meetings.map((meeting, index) => {
            const config = statusConfig[meeting.status]
            return (
              <motion.tr
                key={meeting.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: index * 0.04 }}
                className="group border-b border-border/60 transition-colors hover:bg-secondary/45"
              >
                <TableCell className="min-w-[240px]">
                  <div className="space-y-1">
                    <Link
                      href={getMeetingLink(meeting.id, meeting.status)}
                      className="font-medium text-foreground transition-colors hover:text-primary"
                    >
                      {meeting.title}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      Workspace ready for setup, generation, or final review.
                    </p>
                  </div>
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-2 text-sm text-muted-foreground">
                    <CalendarDays className="h-3.5 w-3.5 text-primary" />
                    {new Date(meeting.meeting_date).toLocaleDateString('en-MY', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </span>
                </TableCell>
                <TableCell className="text-sm text-foreground">
                  {meeting.committee_name ?? 'General'}
                </TableCell>
                <TableCell>
                  <Badge variant={config.variant}>{config.label}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    asChild
                    size="sm"
                    variant="outline"
                    className="h-9 rounded-full px-3"
                  >
                    <Link href={getMeetingLink(meeting.id, meeting.status)}>
                      Open
                      <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  </Button>
                </TableCell>
              </motion.tr>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
