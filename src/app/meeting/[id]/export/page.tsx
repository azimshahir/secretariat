import { redirect } from 'next/navigation'

import { AppShell } from '@/components/app-shell'
import { ExportDocument } from '@/components/export-document'
import { Button } from '@/components/ui/button'
import { requireAuthedAppContext } from '@/lib/authenticated-app'
import { getActiveBuildId } from '@/lib/app-build'
import { FinalizeMeetingButton } from './finalize-meeting-button'

export default async function ExportPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const { supabase, profile, committees, activeSecretariats } =
    await requireAuthedAppContext()

  const { data: meeting } = await supabase
    .from('meetings')
    .select('id, title, meeting_date, status, finalized_at, purge_at, committees(name), committee_id')
    .eq('id', id)
    .single()
  if (!meeting) redirect('/')

  const { data: agendas } = await supabase
    .from('agendas')
    .select('id, agenda_no, title, sort_order')
    .eq('meeting_id', id)
    .order('sort_order')

  const agendaIds = (agendas ?? []).map(agenda => agenda.id)
  const { data: minutes } =
    agendaIds.length > 0
      ? await supabase
          .from('minutes')
          .select('agenda_id, content')
          .in('agenda_id', agendaIds)
          .eq('is_current', true)
      : { data: [] }
  const minuteMap = new Map(
    (minutes ?? []).map(minute => [minute.agenda_id, minute.content])
  )

  const { data: actionItems } = await supabase
    .from('action_items')
    .select('agenda_id, description, pic, sort_order')
    .eq('meeting_id', id)
    .order('sort_order')

  const agendaNoMap = new Map((agendas ?? []).map(agenda => [agenda.id, agenda.agenda_no]))
  const documentAgendas = (agendas ?? []).map(agenda => ({
    agendaNo: agenda.agenda_no,
    title: agenda.title,
    content: minuteMap.get(agenda.id) ?? '',
  }))
  const actionSummary = (actionItems ?? []).map(item => ({
    agendaNo: agendaNoMap.get(item.agenda_id) ?? '-',
    description: item.description,
    pic: item.pic,
  }))

  const committeeName =
    (meeting.committees as unknown as { name: string } | null)?.name ?? 'General'
  const purgeDate = meeting.purge_at
    ? new Date(meeting.purge_at).toLocaleDateString('en-MY')
    : null

  return (
    <AppShell
      profile={profile}
      committees={activeSecretariats.length > 0 ? activeSecretariats : committees}
      activeCommitteeId={meeting.committee_id ?? undefined}
      eyebrow="Distribution"
      title="Export and finalization"
      description="Review the final document package, send it to print or Word, and finalize the meeting record once governance review is complete."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <a
              href={`/meeting/${id}/export/print`}
              target="_blank"
              rel="noreferrer"
            >
              Export PDF
            </a>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href={`/api/meeting/${id}/export/docx`}>Export Word (.docx)</a>
          </Button>
          {meeting.status === 'finalized' ? (
            <span className="rounded-full bg-emerald-100 px-3 py-2 text-xs font-medium text-emerald-700">
              Finalized{purgeDate ? ` - Purge on ${purgeDate}` : ''}
            </span>
          ) : (
            <FinalizeMeetingButton meetingId={id} />
          )}
        </div>
      }
      containerClassName="max-w-[1400px]"
      initialBuildId={getActiveBuildId()}
    >
      <ExportDocument
        title={meeting.title}
        meetingDate={meeting.meeting_date}
        committeeName={committeeName}
        agendas={documentAgendas}
        actionItems={actionSummary}
      />
    </AppShell>
  )
}
