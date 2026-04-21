import { redirect } from 'next/navigation'

import { AppShell } from '@/components/app-shell'
import { requireAuthedAppContext } from '@/lib/authenticated-app'
import { getActiveBuildId } from '@/lib/app-build'
import { MomViewer } from './mom-viewer'

export default async function ViewMomPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const { supabase, profile, committees, activeSecretariats } =
    await requireAuthedAppContext()

  const { data: meeting } = await supabase
    .from('meetings')
    .select('id, title, meeting_date, committee_id, finalized_content, status')
    .eq('id', id)
    .single()
  if (!meeting) redirect('/')

  if (!meeting.finalized_content) redirect(`/meeting/${id}/setup`)

  const formattedDate = new Date(meeting.meeting_date).toLocaleDateString(
    'en-MY',
    {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }
  )

  return (
    <AppShell
      profile={profile}
      committees={activeSecretariats.length > 0 ? activeSecretariats : committees}
      activeCommitteeId={meeting.committee_id ?? undefined}
      containerClassName="max-w-6xl"
      initialBuildId={getActiveBuildId()}
    >
      <MomViewer
        meetingId={id}
        meetingTitle={meeting.title}
        meetingDate={formattedDate}
        content={meeting.finalized_content}
      />
    </AppShell>
  )
}
