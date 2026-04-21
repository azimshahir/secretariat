import { NextResponse } from 'next/server'
import { updateProfile } from '@/app/settings/actions'

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    await updateProfile(formData)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : 'Failed to update profile',
      },
      { status: 500 },
    )
  }
}
