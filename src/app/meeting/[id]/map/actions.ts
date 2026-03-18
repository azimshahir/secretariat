'use server'

import { createClient } from '@/lib/supabase/server'
import { meetingStatusSchema, uuidSchema } from '@/lib/validation'

async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')
  return supabase
}

export async function assignSegment(
  transcriptId: string,
  agendaId: string,
  content: string,
  speaker: string | null,
  startOffset: number,
  endOffset: number,
) {
  uuidSchema.parse(transcriptId)
  uuidSchema.parse(agendaId)
  const supabase = await requireUser()

  // Get current max sort_order for this agenda
  const { data: existing } = await supabase
    .from('transcript_segments')
    .select('sort_order')
    .eq('agenda_id', agendaId)
    .order('sort_order', { ascending: false })
    .limit(1)

  const nextOrder = (existing?.[0]?.sort_order ?? -1) + 1

  const { error } = await supabase.from('transcript_segments').insert({
    transcript_id: transcriptId,
    agenda_id: agendaId,
    content,
    speaker,
    start_offset: startOffset,
    end_offset: endOffset,
    sort_order: nextOrder,
  })

  if (error) throw new Error(error.message)
}

export async function removeSegment(segmentId: string) {
  uuidSchema.parse(segmentId)
  const supabase = await requireUser()
  const { error } = await supabase
    .from('transcript_segments')
    .delete()
    .eq('id', segmentId)

  if (error) throw new Error(error.message)
}

export async function updateMeetingToGenerating(meetingId: string) {
  uuidSchema.parse(meetingId)
  meetingStatusSchema.parse('generating')
  const supabase = await requireUser()
  const { error } = await supabase
    .from('meetings')
    .update({ status: 'generating' })
    .eq('id', meetingId)

  if (error) throw new Error(error.message)
}

export async function splitSegment(segmentId: string, splitIndex: number) {
  uuidSchema.parse(segmentId)
  const supabase = await requireUser()

  const { data: segment } = await supabase
    .from('transcript_segments')
    .select('*')
    .eq('id', segmentId)
    .single()
  if (!segment) throw new Error('Segment not found')
  if (splitIndex <= 0 || splitIndex >= segment.content.length) throw new Error('Invalid split index')

  const first = segment.content.slice(0, splitIndex).trim()
  const second = segment.content.slice(splitIndex).trim()
  if (!first || !second) throw new Error('Split result cannot be empty')

  await supabase.from('transcript_segments').update({ content: first }).eq('id', segmentId)
  await supabase.from('transcript_segments').insert({
    transcript_id: segment.transcript_id,
    agenda_id: segment.agenda_id,
    content: second,
    speaker: segment.speaker,
    start_offset: segment.start_offset,
    end_offset: segment.end_offset,
    sort_order: (segment.sort_order ?? 0) + 1,
  })
}

export async function mergeSegments(firstSegmentId: string, secondSegmentId: string) {
  uuidSchema.parse(firstSegmentId)
  uuidSchema.parse(secondSegmentId)
  const supabase = await requireUser()

  const { data: rows } = await supabase
    .from('transcript_segments')
    .select('*')
    .in('id', [firstSegmentId, secondSegmentId])

  if (!rows || rows.length !== 2) throw new Error('Segments not found')
  const [a, b] = rows.sort((x, y) => (x.sort_order ?? 0) - (y.sort_order ?? 0))
  if (a.agenda_id !== b.agenda_id) throw new Error('Segments must be in same agenda')

  await supabase
    .from('transcript_segments')
    .update({ content: `${a.content.trim()}\n${b.content.trim()}`.trim() })
    .eq('id', a.id)

  await supabase.from('transcript_segments').delete().eq('id', b.id)
}

export async function applySpeakerMap(transcriptId: string, speakerMap: Record<string, string>) {
  uuidSchema.parse(transcriptId)
  const supabase = await requireUser()

  const { data: transcript } = await supabase
    .from('transcripts')
    .select('content')
    .eq('id', transcriptId)
    .single()
  if (!transcript) throw new Error('Transcript not found')

  let updatedContent = transcript.content
  for (const [from, to] of Object.entries(speakerMap)) {
    if (!to?.trim() || from === to) continue
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    updatedContent = updatedContent.replace(new RegExp(`(^|\\n)${escaped}:`, 'g'), `$1${to.trim()}:`)
    await supabase.from('transcript_segments').update({ speaker: to.trim() }).eq('speaker', from)
  }

  await supabase
    .from('transcripts')
    .update({ content: updatedContent, speaker_map: speakerMap })
    .eq('id', transcriptId)

  return updatedContent
}
