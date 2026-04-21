import { redirect } from 'next/navigation'

import { AppShell } from '@/components/app-shell'
import { getEffectiveAiConfigForUserPlan } from '@/lib/ai/model-config'
import { requireAuthedAppContext } from '@/lib/authenticated-app'
import { getActiveBuildId } from '@/lib/app-build'
import { getCanonicalCurrentMinuteForAgendaId } from '@/lib/meeting-generation/current-minute'
import { getActiveMomDraftBatchForMeeting } from '@/lib/meeting-generation/mom-drafts'
import { getAllowedAiModelOptionsForPlan } from '@/lib/subscription/catalog'
import type { MomDraftBatchWithRows } from '@/lib/meeting-generation/types'
import type { Minute } from '@/lib/supabase/types'
import { AgenticEditor } from './agentic-editor'

export default async function EditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ agenda?: string; returnTab?: string }>
}) {
  const { id } = await params
  const { agenda: agendaParam, returnTab: returnTabParam } = await searchParams
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
  const returnTab = returnTabParam === 'dashboard'
    || returnTabParam === 'agenda'
    || returnTabParam === 'generate'
    || returnTabParam === 'itineraries'
    || returnTabParam === 'settings'
    ? returnTabParam
    : null

  const minute = await getCanonicalCurrentMinuteForAgendaId<Minute>({
    supabase,
    agendaId: activeAgendaId,
    extraColumns: '*',
  })

  let initialMomDraftBatch: MomDraftBatchWithRows | null = null
  try {
    initialMomDraftBatch = await getActiveMomDraftBatchForMeeting(supabase, id)
  } catch (error) {
    console.error('[editor/page] Active draft batch query error:', error)
  }

  const askModelOptions = getAllowedAiModelOptionsForPlan(profile.plan)
  const defaultAskModelConfig = await getEffectiveAiConfigForUserPlan(
    meeting.organization_id,
    profile.plan,
    'go_deeper_ask',
  )

  return (
    <AppShell
      profile={profile}
      committees={activeSecretariats.length > 0 ? activeSecretariats : committees}
      activeCommitteeId={meeting.committee_id ?? undefined}
      containerClassName="h-full min-h-0 max-w-[1700px] flex-1 gap-4"
      mainClassName="flex min-h-0 flex-1 flex-col !overflow-hidden px-3 py-3 md:px-4 md:py-4 xl:px-5 xl:py-5"
      initialBuildId={getActiveBuildId()}
    >
      <div className="flex h-full min-h-0 flex-1 overflow-hidden rounded-[32px] border border-border/70 bg-white/94 shadow-[0_28px_80px_-44px_rgba(15,23,42,0.45)] backdrop-blur">
        <AgenticEditor
          key={`${activeAgendaId}:${minute?.id ?? 'new'}`}
          meetingId={id}
          agendas={agendas}
        activeAgendaId={activeAgendaId}
        minute={minute}
        initialMomDraftBatch={initialMomDraftBatch}
        returnTab={returnTab}
        askModelOptions={askModelOptions}
        defaultAskModelId={defaultAskModelConfig.model}
      />
      </div>
    </AppShell>
  )
}
