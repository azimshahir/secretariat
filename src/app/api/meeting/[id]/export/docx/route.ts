import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, WidthType } from 'docx'
import { createClient } from '@/lib/supabase/server'
import { uuidSchema } from '@/lib/validation'

function sanitizeFilename(input: string) {
  return input.replace(/[^a-zA-Z0-9-_]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  uuidSchema.parse(id)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const { data: meeting } = await supabase
    .from('meetings')
    .select('id, title, meeting_date, committees(name)')
    .eq('id', id)
    .single()
  if (!meeting) return new Response('Meeting not found', { status: 404 })

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
  const committeeName = (meeting.committees as unknown as { name: string } | null)?.name ?? 'General'

  const children: (Paragraph | Table)[] = [
    new Paragraph({ text: meeting.title, heading: HeadingLevel.TITLE }),
    new Paragraph({
      text: `${committeeName} - ${new Date(meeting.meeting_date).toLocaleDateString('en-MY', { day: 'numeric', month: 'long', year: 'numeric' })}`,
    }),
    new Paragraph({ text: '' }),
  ]

  for (const agenda of agendas ?? []) {
    children.push(new Paragraph({
      text: `Agenda ${agenda.agenda_no}: ${agenda.title}`,
      heading: HeadingLevel.HEADING_2,
    }))
    const content = minuteMap.get(agenda.id) ?? 'No minutes generated for this agenda yet.'
    for (const line of content.split('\n')) {
      children.push(new Paragraph({ text: line || ' ' }))
    }
    children.push(new Paragraph({ text: '' }))
  }

  children.push(new Paragraph({ text: 'Action Item Summary', heading: HeadingLevel.HEADING_2 }))

  const tableRows = [
    new TableRow({
      children: [
        new TableCell({ children: [new Paragraph('No. Agenda')] }),
        new TableCell({ children: [new Paragraph('Tugasan')] }),
        new TableCell({ children: [new Paragraph('PIC')] }),
      ],
    }),
    ...((actionItems ?? []).map(item => new TableRow({
      children: [
        new TableCell({ children: [new Paragraph(agendaNoMap.get(item.agenda_id) ?? '—')] }),
        new TableCell({ children: [new Paragraph(item.description)] }),
        new TableCell({ children: [new Paragraph(item.pic ?? '—')] }),
      ],
    }))),
  ]

  children.push(new Table({
    rows: tableRows,
    width: { size: 100, type: WidthType.PERCENTAGE },
  }))

  const doc = new Document({
    sections: [{ children }],
  })

  const buffer = await Packer.toBuffer(doc)
  const body = new Uint8Array(buffer)
  const filename = sanitizeFilename(`${meeting.title}_${meeting.meeting_date}`)

  return new Response(body, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${filename || 'minutes'}.docx"`,
    },
  })
}
