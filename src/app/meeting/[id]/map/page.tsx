import { redirect } from 'next/navigation'

import { AppShell } from '@/components/app-shell'
import { requireAuthedAppContext } from '@/lib/authenticated-app'
import { SemanticMapper } from './semantic-mapper'

export default async function MapPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const { supabase, profile, committees, activeSecretariats } =
    await requireAuthedAppContext()

  const { data: meeting } = await supabase
    .from('meetings')
    .select('*')
    .eq('id', id)
    .single()
  if (!meeting) redirect('/')

  const { data: agendas } = await supabase
    .from('agendas')
    .select('*')
    .eq('meeting_id', id)
    .order('sort_order')

  const { data: transcript } = await supabase
    .from('transcripts')
    .select('*')
    .eq('meeting_id', id)
    .limit(1)
    .single()

  const { data: segments } = await supabase
    .from('transcript_segments')
    .select('*')
    .eq('transcript_id', transcript?.id ?? '')
    .order('sort_order')

  return (
    <AppShell
      profile={profile}
      committees={activeSecretariats.length > 0 ? activeSecretariats : committees}
      activeCommitteeId={meeting.committee_id ?? undefined}
      containerClassName="max-w-[1700px] gap-4"
      mainClassName="px-3 py-3 md:px-4 md:py-4 xl:px-5 xl:py-5"
    >
      <div className="min-h-[calc(100vh-8.75rem)] overflow-hidden rounded-[32px] border border-border/70 bg-white/94 shadow-[0_28px_80px_-44px_rgba(15,23,42,0.45)] backdrop-blur">
        <SemanticMapper
          meetingId={id}
          transcript={transcript}
          agendas={agendas ?? []}
          existingSegments={segments ?? []}
        />
      </div>
    </AppShell>
  )
}
