import { NextResponse } from 'next/server'
import { saveCommittee } from '@/app/settings/actions'

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    await saveCommittee(formData)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : 'Failed to save secretariat',
      },
      { status: 500 },
    )
  }
}
