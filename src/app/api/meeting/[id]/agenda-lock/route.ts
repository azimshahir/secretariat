import { NextResponse } from 'next/server'
import { z } from 'zod'
import { uuidSchema } from '@/lib/validation'
import {
  requireSetupMeetingContext,
  serializeCommitteeGenerationApiError,
} from '../../../committee-generation/_lib/write-access'

export const runtime = 'nodejs'

const bodySchema = z.object({
  action: z.enum(['lock', 'unlock']),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const meetingId = uuidSchema.parse(id)
    const { action } = bodySchema.parse(await request.json())
    const context = await requireSetupMeetingContext(meetingId)

    const payload = action === 'lock'
      ? {
          agenda_locked_at: new Date().toISOString(),
          agenda_locked_by: context.userId,
        }
      : {
          agenda_locked_at: null,
          agenda_locked_by: null,
        }

    const { error } = await context.adminSupabase
      .from('meetings')
      .update(payload)
      .eq('id', meetingId)

    if (error) {
      throw new Error(error.message)
    }

    return NextResponse.json({
      ok: true,
      agendaLockedAt: payload.agenda_locked_at,
    })
  } catch (error) {
    const { status, message } = serializeCommitteeGenerationApiError(error, 'Failed to update agenda lock state')
    console.error('[api/meeting/[id]/agenda-lock] failed:', message)
    return NextResponse.json({ ok: false, message }, { status })
  }
}
