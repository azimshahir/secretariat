import { notFound } from 'next/navigation'

import { AppShell } from '@/components/app-shell'
import { MeetingTable } from '@/components/meeting-table'
import { requireAuthedAppContext } from '@/lib/authenticated-app'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
import Link from 'next/link'

export default async function SecretariatDashboardPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const { profile, committees } = await requireAuthedAppContext()
  const supabase = await createClient()

  const committee = committees.find(c => c.slug === slug)
  if (!committee) notFound()

  const { data: meetingsRaw } = await supabase
    .from('meetings')
    .select('id, title, meeting_date, status, committee_id, committees(name)')
    .eq('committee_id', committee.id)
    .order('meeting_date', { ascending: false })

  const meetings = (meetingsRaw ?? []).map(m => ({
    id: m.id,
    title: m.title,
    meeting_date: m.meeting_date,
    status: m.status,
    committee_name: (m.committees as unknown as { name: string } | null)?.name ?? null,
  }))

  return (
    <AppShell
      profile={profile}
      committees={committees}
      activeCommitteeId={committee.id}
      eyebrow={committee.category}
      title={committee.name}
      description={`${meetings.length} meeting${meetings.length === 1 ? '' : 's'} on record`}
      actions={
        <Button asChild className="gap-2 rounded-[14px]">
          <Link href={`/meeting/new?committee=${committee.id}`}>
            <Plus className="h-4 w-4" /> New Meeting
          </Link>
        </Button>
      }
    >
      <MeetingTable
        meetings={meetings}
        committees={committees}
        activeCommitteeId={committee.id}
      />
    </AppShell>
  )
}
