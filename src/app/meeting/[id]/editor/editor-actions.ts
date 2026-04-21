'use server'

import { createClient } from '@/lib/supabase/server'
import { uuidSchema } from '@/lib/validation'

async function getAgendaContentRevisionForMinute(minuteId: string) {
  const supabase = await createClient()
  const { data: minute } = await supabase
    .from('minutes')
    .select('agenda_id')
    .eq('id', minuteId)
    .single()

  if (!minute?.agenda_id) return { supabase, contentRevision: null as number | null }

  const { data: agenda } = await supabase
    .from('agendas')
    .select('content_revision')
    .eq('id', minute.agenda_id)
    .single()

  return {
    supabase,
    contentRevision: agenda?.content_revision ?? null,
  }
}

export async function saveMinuteContent(minuteId: string, content: string) {
  uuidSchema.parse(minuteId)
  const { supabase, contentRevision } = await getAgendaContentRevisionForMinute(minuteId)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  // Save current version before updating
  const { data: current } = await supabase
    .from('minutes').select('content, version').eq('id', minuteId).single()

  if (current) {
    await supabase.from('minute_versions').insert({
      minute_id: minuteId,
      content: current.content,
      version: current.version,
      change_summary: 'Manual edit by CoSec',
      changed_by: user.id,
    })

    await supabase.from('minutes').update({
      content,
      source_agenda_revision: contentRevision,
      version: current.version + 1,
    }).eq('id', minuteId)
  }
}

export async function applyAiChange(minuteId: string, newContent: string) {
  uuidSchema.parse(minuteId)
  const { supabase, contentRevision } = await getAgendaContentRevisionForMinute(minuteId)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { data: current } = await supabase
    .from('minutes').select('content, version').eq('id', minuteId).single()

  if (current) {
    await supabase.from('minute_versions').insert({
      minute_id: minuteId,
      content: current.content,
      version: current.version,
      change_summary: 'AI-assisted edit via Agent',
      changed_by: user.id,
    })

    await supabase.from('minutes').update({
      content: newContent,
      source_agenda_revision: contentRevision,
      version: current.version + 1,
    }).eq('id', minuteId)
  }
}

export async function setAgendaFormatTemplate(
  agendaId: string,
  formatTemplateId: string | null,
) {
  uuidSchema.parse(agendaId)
  if (formatTemplateId) uuidSchema.parse(formatTemplateId)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  await supabase
    .from('agendas')
    .update({ format_template_id: formatTemplateId })
    .eq('id', agendaId)
}
