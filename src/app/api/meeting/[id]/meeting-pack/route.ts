import { createClient } from '@/lib/supabase/server'
import { uuidSchema } from '@/lib/validation'
import type { Agenda } from '@/lib/supabase/types'
import { buildMeetingPackPdf } from '@/app/meeting/[id]/setup/meeting-pack-pdf'
import { normalizeMeetingPackConfig } from '@/app/meeting/[id]/setup/meeting-pack-model'

function sanitizeFilename(input: string) {
  return input.replace(/[^a-zA-Z0-9-_]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  uuidSchema.parse(id)

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const { data: meeting, error: meetingError } = await supabase
    .from('meetings')
    .select('id, title, meeting_date, meeting_pack_config')
    .eq('id', id)
    .single()

  if (meetingError || !meeting) {
    return new Response(meetingError?.message ?? 'Meeting not found', { status: 404 })
  }

  const { data: agendas } = await supabase
    .from('agendas')
    .select('*')
    .eq('meeting_id', id)
    .order('sort_order')

  const agendaRows = (agendas ?? []) as Agenda[]

  let bodyConfig: unknown = null
  try {
    const payload = await request.json() as { config?: unknown }
    bodyConfig = payload?.config ?? null
  } catch {
    bodyConfig = null
  }

  const config = normalizeMeetingPackConfig(bodyConfig ?? meeting.meeting_pack_config, agendaRows)

  try {
    const { bytes, warnings } = await buildMeetingPackPdf({
      supabase,
      meetingTitle: meeting.title,
      meetingDate: new Date(meeting.meeting_date).toLocaleDateString('en-MY', { day: 'numeric', month: 'long', year: 'numeric' }),
      agendas: agendaRows,
      config,
    })

    const filename = sanitizeFilename(`${meeting.title}_meeting_pack`) || 'meeting_pack'
    const warningSummary = warnings.slice(0, 6).join(' | ')
    const body = new Uint8Array(bytes.length)
    body.set(bytes)

    return new Response(body, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}.pdf"`,
        'X-Meeting-Pack-Warning-Count': String(warnings.length),
        'X-Meeting-Pack-Warnings': encodeURIComponent(warningSummary),
      },
    })
  } catch (e) {
    return new Response(e instanceof Error ? e.message : 'Failed to build Meeting Pack', { status: 400 })
  }
}
