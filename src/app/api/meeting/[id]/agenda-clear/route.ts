import { NextResponse } from 'next/server'
import { z } from 'zod'
import { uuidSchema } from '@/lib/validation'
import {
  assertMeetingAgendaEditable,
  requireWritableMeetingContext,
  serializeCommitteeGenerationApiError,
} from '../../../committee-generation/_lib/write-access'

export const runtime = 'nodejs'

const agendaClearBodySchema = z.object({
  mode: z.enum(['items', 'all']),
})

function isHeadingAgendaNo(agendaNo: string) {
  const normalized = agendaNo.trim()
  return normalized.endsWith('.0') || /^\d+$/.test(normalized)
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const meetingId = uuidSchema.parse(id)
    const body = agendaClearBodySchema.parse(await request.json())
    const context = await requireWritableMeetingContext(meetingId)
    await assertMeetingAgendaEditable(context.adminSupabase, meetingId)

    if (body.mode === 'items') {
      const { data: agendas, error: fetchError } = await context.adminSupabase
        .from('agendas')
        .select('id, agenda_no')
        .eq('meeting_id', meetingId)
      if (fetchError) {
        throw new Error(fetchError.message)
      }

      const itemIds = (agendas ?? [])
        .filter(agenda => !isHeadingAgendaNo(agenda.agenda_no))
        .map(agenda => agenda.id)

      if (itemIds.length === 0) {
        return NextResponse.json({
          ok: true,
          status: 'no_items_cleared',
          deletedCount: 0,
        })
      }

      const { data: deletedRows, error: deleteError } = await context.adminSupabase
        .from('agendas')
        .delete()
        .in('id', itemIds)
        .select('id')
      if (deleteError) {
        throw new Error(deleteError.message)
      }

      return NextResponse.json({
        ok: true,
        status: (deletedRows?.length ?? 0) > 0 ? 'cleared' : 'no_items_cleared',
        deletedCount: deletedRows?.length ?? 0,
      })
    }

    const { data: beforeRows, error: beforeError } = await context.adminSupabase
      .from('agendas')
      .select('id')
      .eq('meeting_id', meetingId)
    if (beforeError) {
      throw new Error(beforeError.message)
    }

    const beforeCount = beforeRows?.length ?? 0

    const { error: deleteError } = await context.adminSupabase
      .from('agendas')
      .delete()
      .eq('meeting_id', meetingId)
    if (deleteError) {
      throw new Error(deleteError.message)
    }

    const { data: afterRows, error: afterError } = await context.adminSupabase
      .from('agendas')
      .select('id')
      .eq('meeting_id', meetingId)
    if (afterError) {
      throw new Error(afterError.message)
    }

    const afterCount = afterRows?.length ?? 0
    const deletedCount = Math.max(beforeCount - afterCount, 0)

    return NextResponse.json({
      ok: true,
      status: deletedCount === 0 && beforeCount > 0 ? 'no_rows_cleared' : 'cleared',
      deletedCount,
      beforeCount,
      afterCount,
    })
  } catch (error) {
    const { status, message } = serializeCommitteeGenerationApiError(error, 'Failed to clear agenda')
    console.error('[api/meeting/[id]/agenda-clear] failed:', message)
    return NextResponse.json({ ok: false, message }, { status })
  }
}
