import { NextResponse } from 'next/server'
import { suggestMeetingTypes } from '@/actions/secretariat-wizard'

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { industry?: string }
    const suggestions = await suggestMeetingTypes(String(body.industry ?? ''))
    return NextResponse.json({ ok: true, suggestions })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to suggest meeting types',
      },
      { status: 500 },
    )
  }
}
