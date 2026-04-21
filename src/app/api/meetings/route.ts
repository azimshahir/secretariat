import { NextResponse } from 'next/server'
import { createMeetingWithAgendas } from '@/actions/meeting'

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      title?: string
      meetingDate?: string
      committeeId?: string
      agendaItems?: string[]
    }

    const result = await createMeetingWithAgendas({
      title: String(body.title ?? ''),
      meetingDate: String(body.meetingDate ?? ''),
      committeeId: String(body.committeeId ?? ''),
      agendaItems: Array.isArray(body.agendaItems) ? body.agendaItems : [],
    })

    return NextResponse.json({
      ok: true,
      meetingId: result.meetingId,
      redirectPath: result.redirectPath,
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : 'Failed to create meeting',
      },
      { status: 500 },
    )
  }
}
