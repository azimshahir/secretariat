import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  createMinuteMindEntry,
  deleteMinuteMindEntry,
  listMinuteMindEntriesForScope,
} from '@/lib/meeting-generation/minute-mind'
import { minuteMindEntrySchema, uuidSchema } from '@/lib/validation'
import {
  requireWritableMeetingContext,
} from '../../../committee-generation/_lib/write-access'

const postSchema = minuteMindEntrySchema.extend({
  scopeType: z.enum(['agenda', 'meeting', 'committee']),
  agendaId: uuidSchema.optional().nullable(),
})

const deleteSchema = z.object({
  entryId: uuidSchema,
})

export const runtime = 'nodejs'

async function assertAgendaBelongsToMeeting(
  adminSupabase: Awaited<ReturnType<typeof requireWritableMeetingContext>>['adminSupabase'],
  meetingId: string,
  agendaId: string,
) {
  const { data, error } = await adminSupabase
    .from('agendas')
    .select('id')
    .eq('id', agendaId)
    .eq('meeting_id', meetingId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) throw new Error('Agenda not found in this meeting')
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const meetingId = uuidSchema.parse(id)
    const agendaId = new URL(request.url).searchParams.get('agendaId')
    const context = await requireWritableMeetingContext(meetingId)

    if (agendaId) {
      await assertAgendaBelongsToMeeting(context.adminSupabase, meetingId, uuidSchema.parse(agendaId))
    }

    const { data: meeting, error: meetingError } = await context.adminSupabase
      .from('meetings')
      .select('committee_id')
      .eq('id', meetingId)
      .single()

    if (meetingError) throw new Error(meetingError.message)

    const entries = await listMinuteMindEntriesForScope({
      supabase: context.adminSupabase,
      organizationId: context.organizationId,
      committeeId: meeting?.committee_id ?? null,
      meetingId,
      agendaId: agendaId ? uuidSchema.parse(agendaId) : null,
    })

    return NextResponse.json({ ok: true, entries })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : 'Failed to load backend memory entries',
      },
      { status: 500 },
    )
  }
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

    const { data: meeting, error: meetingError } = await context.adminSupabase
      .from('meetings')
      .select('committee_id')
      .eq('id', meetingId)
      .single()

    if (meetingError) throw new Error(meetingError.message)

    if (body.scopeType === 'agenda') {
      if (!body.agendaId) throw new Error('Agenda scope requires agendaId')
      await assertAgendaBelongsToMeeting(context.adminSupabase, meetingId, body.agendaId)
    }

    if (body.scopeType === 'committee' && !meeting?.committee_id) {
      throw new Error('This meeting has no committee to store shared backend memory')
    }

    const entry = await createMinuteMindEntry({
      supabase: context.adminSupabase,
      organizationId: context.organizationId,
      committeeId: meeting?.committee_id ?? null,
      meetingId: body.scopeType === 'committee' ? null : meetingId,
      agendaId: body.scopeType === 'agenda' ? body.agendaId ?? null : null,
      scopeType: body.scopeType,
      source: 'chat',
      entryType: body.entryType,
      title: body.title,
      content: body.content,
      appliesToGeneration: body.appliesToGeneration,
      appliesToChat: body.appliesToChat,
      isActive: body.isActive,
      createdBy: context.userId,
    })

    return NextResponse.json({ ok: true, entry })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : 'Failed to save backend memory entry',
      },
      { status: 500 },
    )
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const meetingId = uuidSchema.parse(id)
    const { entryId } = deleteSchema.parse(await request.json())
    const context = await requireWritableMeetingContext(meetingId)

    await deleteMinuteMindEntry({
      supabase: context.adminSupabase,
      entryId,
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : 'Failed to delete backend memory entry',
      },
      { status: 500 },
    )
  }
}
