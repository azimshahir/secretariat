import { NextResponse } from 'next/server'
import { suggestMeeting } from '@/actions/meeting'

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      description?: string
      committees?: { id: string; name: string }[]
    }

    const suggestion = await suggestMeeting(
      String(body.description ?? ''),
      Array.isArray(body.committees) ? body.committees : [],
    )

    return NextResponse.json({ ok: true, suggestion })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : 'Failed to suggest meeting',
      },
      { status: 500 },
    )
  }
}
