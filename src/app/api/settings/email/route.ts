import { NextResponse } from 'next/server'
import { updateEmail } from '@/app/settings/actions'

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    await updateEmail(formData)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : 'Failed to update email',
      },
      { status: 500 },
    )
  }
}
