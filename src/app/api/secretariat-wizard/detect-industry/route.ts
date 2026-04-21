import { NextResponse } from 'next/server'
import { detectIndustry } from '@/actions/secretariat-wizard'

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { customName?: string }
    const industry = await detectIndustry(String(body.customName ?? ''))
    return NextResponse.json({ ok: true, industry })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : 'Failed to detect industry',
      },
      { status: 500 },
    )
  }
}
