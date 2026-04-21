import { NextResponse } from 'next/server'
import { updatePassword } from '@/app/settings/actions'

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    await updatePassword(formData)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : 'Failed to update password',
      },
      { status: 500 },
    )
  }
}
