import { redirect } from 'next/navigation'
import { ExportDocument } from '@/components/export-document'
import { createClient } from '@/lib/supabase/server'
import { PrintControls } from './print-controls'

export default async function ExportPrintPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: meeting } = await supabase
    .from('meetings')
    .select('id, title, meeting_date, committees(name)')
    .eq('id', id)
    .single()
  if (!meeting) redirect('/')

  const { data: agendas } = await supabase
    .from('agendas')
    .select('id, agenda_no, title, sort_order')
    .eq('meeting_id', id)
    .order('sort_order')

  const agendaIds = (agendas ?? []).map(agenda => agenda.id)
  const { data: minutes } = agendaIds.length > 0
    ? await supabase.from('minutes').select('agenda_id, content').in('agenda_id', agendaIds).eq('is_current', true)
    : { data: [] }
  const minuteMap = new Map((minutes ?? []).map(minute => [minute.agenda_id, minute.content]))

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
    agendaNo: agendaNoMap.get(item.agenda_id) ?? '—',
    description: item.description,
    pic: item.pic,
  }))
  const committeeName = (meeting.committees as unknown as { name: string } | null)?.name ?? 'General'

  return (
    <main className="mx-auto max-w-4xl space-y-4 bg-white px-6 py-6 text-zinc-900">
      <div className="print:hidden">
        <PrintControls />
      </div>
      <ExportDocument
        title={meeting.title}
        meetingDate={meeting.meeting_date}
        committeeName={committeeName}
        agendas={documentAgendas}
        actionItems={actionSummary}
      />
    </main>
  )
}
