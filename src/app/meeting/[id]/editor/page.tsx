import { redirect } from 'next/navigation'

import { AppShell } from '@/components/app-shell'
import { requireAuthedAppContext } from '@/lib/authenticated-app'
import { AgenticEditor } from './agentic-editor'

export default async function EditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ agenda?: string }>
}) {
  const { id } = await params
  const { agenda: agendaParam } = await searchParams
  const { supabase, profile, committees, activeSecretariats } =
    await requireAuthedAppContext()

  const { data: meeting } = await supabase
    .from('meetings')
    .select('*, committees(id, name, slug)')
    .eq('id', id)
    .single()
  if (!meeting) redirect('/')

  const { data: agendas } = await supabase
    .from('agendas')
    .select('*')
    .eq('meeting_id', id)
    .order('sort_order')

  if (!agendas || agendas.length === 0) redirect(`/meeting/${id}/setup`)

  const activeAgendaId = agendaParam || agendas[0].id

  const { data: minute } = await supabase
    .from('minutes')
    .select('*')
    .eq('agenda_id', activeAgendaId)
    .eq('is_current', true)
    .single()

  return (
    <AppShell
      profile={profile}
      committees={activeSecretariats.length > 0 ? activeSecretariats : committees}
      activeCommitteeId={meeting.committee_id ?? undefined}
      containerClassName="max-w-[1700px] gap-4"
      mainClassName="px-3 py-3 md:px-4 md:py-4 xl:px-5 xl:py-5"
    >
      <div className="min-h-[calc(100vh-8.75rem)] overflow-hidden rounded-[32px] border border-border/70 bg-white/94 shadow-[0_28px_80px_-44px_rgba(15,23,42,0.45)] backdrop-blur">
        <AgenticEditor
          key={`${activeAgendaId}:${minute?.id ?? 'new'}`}
          meetingId={id}
          agendas={agendas}
          activeAgendaId={activeAgendaId}
          minute={minute}
        />
      </div>
    </AppShell>
  )
}
