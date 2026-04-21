import { redirect } from 'next/navigation'

import { formatMomForDownload } from '@/actions/download-mom'
import { AppShell } from '@/components/app-shell'
import { requireAuthedAppContext } from '@/lib/authenticated-app'
import { getActiveBuildId } from '@/lib/app-build'
import { FinalizeEditor } from './finalize-editor'

export default async function FinalizePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const { supabase, profile, committees, activeSecretariats } =
    await requireAuthedAppContext()

  const { data: meeting } = await supabase
    .from('meetings')
    .select('id, title, meeting_date, committee_id, status, finalized_content')
    .eq('id', id)
    .single()
  if (!meeting) redirect('/')

  let momText = ''
  let templateUrl: string | null = null

  if (meeting.finalized_content) {
    momText = meeting.finalized_content
  } else {
    try {
      const result = await formatMomForDownload(id)
      momText = result.text
      templateUrl = result.templateUrl
    } catch (error) {
      console.error('Failed to generate MoM:', error)
      momText = ''
    }
  }

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
      <FinalizeEditor
        meetingId={id}
        meetingTitle={meeting.title}
        meetingDate={formattedDate}
        initialContent={momText}
        templateUrl={templateUrl}
        isFinalized={meeting.status === 'finalized'}
      />
    </AppShell>
  )
}
