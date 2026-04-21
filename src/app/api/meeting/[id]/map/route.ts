import { NextResponse } from 'next/server'
import { z } from 'zod'
import { meetingStatusSchema, uuidSchema } from '@/lib/validation'
import {
  requireWritableMeetingContext,
  serializeCommitteeGenerationApiError,
} from '../../../committee-generation/_lib/write-access'

export const runtime = 'nodejs'

type AdminSupabase = Awaited<ReturnType<typeof requireWritableMeetingContext>>['adminSupabase']

const postSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('assign_segment'),
    transcriptId: uuidSchema,
    agendaId: uuidSchema,
    content: z.string().min(1),
    speaker: z.string().nullable(),
    startOffset: z.number().int().nonnegative(),
    endOffset: z.number().int().nonnegative(),
  }),
  z.object({
    action: z.literal('split_segment'),
    segmentId: uuidSchema,
    splitIndex: z.number().int(),
  }),
  z.object({
    action: z.literal('merge_segments'),
    firstSegmentId: uuidSchema,
    secondSegmentId: uuidSchema,
  }),
  z.object({
    action: z.literal('apply_speaker_map'),
    transcriptId: uuidSchema,
    speakerMap: z.record(z.string(), z.string()),
  }),
  z.object({
    action: z.literal('set_meeting_status'),
    status: meetingStatusSchema,
  }),
])

const deleteSchema = z.object({
  segmentId: uuidSchema,
})

async function assertAgendaBelongsToMeeting(
  adminSupabase: AdminSupabase,
  agendaId: string,
  meetingId: string,
) {
  const { data, error } = await adminSupabase
    .from('agendas')
    .select('id')
    .eq('id', agendaId)
    .eq('meeting_id', meetingId)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }
  if (!data) {
    throw new Error('Agenda not found in this meeting')
  }
}

async function assertTranscriptBelongsToMeeting(
  adminSupabase: AdminSupabase,
  transcriptId: string,
  meetingId: string,
) {
  const { data, error } = await adminSupabase
    .from('transcripts')
    .select('id')
    .eq('id', transcriptId)
    .eq('meeting_id', meetingId)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }
  if (!data) {
    throw new Error('Transcript not found in this meeting')
  }
}

async function getSegmentForMeeting(
  adminSupabase: AdminSupabase,
  segmentId: string,
  meetingId: string,
) {
  const { data: segment, error: segmentError } = await adminSupabase
    .from('transcript_segments')
    .select('id, transcript_id, agenda_id, content, speaker, start_offset, end_offset, sort_order, created_at')
    .eq('id', segmentId)
    .maybeSingle()

  if (segmentError) {
    throw new Error(segmentError.message)
  }
  if (!segment) {
    throw new Error('Segment not found')
  }

  if (segment.agenda_id) {
    await assertAgendaBelongsToMeeting(adminSupabase, segment.agenda_id, meetingId)
    return segment
  }

  await assertTranscriptBelongsToMeeting(adminSupabase, segment.transcript_id, meetingId)
  return segment
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const meetingId = uuidSchema.parse(id)
    const body = postSchema.parse(await request.json())
    const context = await requireWritableMeetingContext(meetingId)

    if (body.action === 'assign_segment') {
      await assertTranscriptBelongsToMeeting(context.adminSupabase, body.transcriptId, meetingId)
      await assertAgendaBelongsToMeeting(context.adminSupabase, body.agendaId, meetingId)

      const { data: existing, error: existingError } = await context.adminSupabase
        .from('transcript_segments')
        .select('sort_order')
        .eq('agenda_id', body.agendaId)
        .order('sort_order', { ascending: false })
        .limit(1)

      if (existingError) {
        throw new Error(existingError.message)
      }

      const nextOrder = (existing?.[0]?.sort_order ?? -1) + 1
      const { data: segment, error } = await context.adminSupabase
        .from('transcript_segments')
        .insert({
          transcript_id: body.transcriptId,
          agenda_id: body.agendaId,
          content: body.content,
          speaker: body.speaker,
          start_offset: body.startOffset,
          end_offset: body.endOffset,
          sort_order: nextOrder,
        })
        .select('id, transcript_id, agenda_id, content, speaker, start_offset, end_offset, sort_order, created_at')
        .single()

      if (error || !segment) {
        throw new Error(error?.message ?? 'Failed to assign segment')
      }

      return NextResponse.json({ ok: true, segment })
    }

    if (body.action === 'split_segment') {
      const segment = await getSegmentForMeeting(context.adminSupabase, body.segmentId, meetingId)
      if (body.splitIndex <= 0 || body.splitIndex >= segment.content.length) {
        throw new Error('Invalid split index')
      }

      const first = segment.content.slice(0, body.splitIndex).trim()
      const second = segment.content.slice(body.splitIndex).trim()
      if (!first || !second) {
        throw new Error('Split result cannot be empty')
      }

      const { error: updateError } = await context.adminSupabase
        .from('transcript_segments')
        .update({ content: first })
        .eq('id', segment.id)
      if (updateError) {
        throw new Error(updateError.message)
      }

      const { data: inserted, error: insertError } = await context.adminSupabase
        .from('transcript_segments')
        .insert({
          transcript_id: segment.transcript_id,
          agenda_id: segment.agenda_id,
          content: second,
          speaker: segment.speaker,
          start_offset: segment.start_offset,
          end_offset: segment.end_offset,
          sort_order: (segment.sort_order ?? 0) + 1,
        })
        .select('id, transcript_id, agenda_id, content, speaker, start_offset, end_offset, sort_order, created_at')
        .single()

      if (insertError || !inserted) {
        throw new Error(insertError?.message ?? 'Failed to split segment')
      }

      return NextResponse.json({
        ok: true,
        updatedSegment: { ...segment, content: first },
        insertedSegment: inserted,
      })
    }

    if (body.action === 'merge_segments') {
      const firstSegment = await getSegmentForMeeting(context.adminSupabase, body.firstSegmentId, meetingId)
      const secondSegment = await getSegmentForMeeting(context.adminSupabase, body.secondSegmentId, meetingId)
      const [a, b] = [firstSegment, secondSegment].sort(
        (left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0),
      )

      if (a.agenda_id !== b.agenda_id) {
        throw new Error('Segments must be in same agenda')
      }

      const mergedContent = `${a.content.trim()}\n${b.content.trim()}`.trim()
      const { error: updateError } = await context.adminSupabase
        .from('transcript_segments')
        .update({ content: mergedContent })
        .eq('id', a.id)
      if (updateError) {
        throw new Error(updateError.message)
      }

      const { error: deleteError } = await context.adminSupabase
        .from('transcript_segments')
        .delete()
        .eq('id', b.id)
      if (deleteError) {
        throw new Error(deleteError.message)
      }

      return NextResponse.json({
        ok: true,
        mergedSegment: { ...a, content: mergedContent },
        removedSegmentId: b.id,
      })
    }

    if (body.action === 'apply_speaker_map') {
      await assertTranscriptBelongsToMeeting(context.adminSupabase, body.transcriptId, meetingId)
      const { data: transcript, error: transcriptError } = await context.adminSupabase
        .from('transcripts')
        .select('content')
        .eq('id', body.transcriptId)
        .single()
      if (transcriptError || !transcript) {
        throw new Error(transcriptError?.message ?? 'Transcript not found')
      }

      let updatedContent = transcript.content
      for (const [from, to] of Object.entries(body.speakerMap)) {
        if (!to?.trim() || from === to) continue
        const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        updatedContent = updatedContent.replace(new RegExp(`(^|\\n)${escaped}:`, 'g'), `$1${to.trim()}:`)
        const { error } = await context.adminSupabase
          .from('transcript_segments')
          .update({ speaker: to.trim() })
          .eq('transcript_id', body.transcriptId)
          .eq('speaker', from)
        if (error) {
          throw new Error(error.message)
        }
      }

      const { error: updateError } = await context.adminSupabase
        .from('transcripts')
        .update({ content: updatedContent, speaker_map: body.speakerMap })
        .eq('id', body.transcriptId)
      if (updateError) {
        throw new Error(updateError.message)
      }

      return NextResponse.json({ ok: true, content: updatedContent })
    }

    const { error } = await context.adminSupabase
      .from('meetings')
      .update({ status: body.status })
      .eq('id', meetingId)
    if (error) {
      throw new Error(error.message)
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    const { status, message } = serializeCommitteeGenerationApiError(error, 'Failed to update transcript mapping')
    return NextResponse.json({ ok: false, message }, { status })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const meetingId = uuidSchema.parse(id)
    const { segmentId } = deleteSchema.parse(await request.json())
    const context = await requireWritableMeetingContext(meetingId)

    await getSegmentForMeeting(context.adminSupabase, segmentId, meetingId)
    const { error } = await context.adminSupabase
      .from('transcript_segments')
      .delete()
      .eq('id', segmentId)

    if (error) {
      throw new Error(error.message)
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    const { status, message } = serializeCommitteeGenerationApiError(error, 'Failed to remove transcript segment')
    return NextResponse.json({ ok: false, message }, { status })
  }
}
