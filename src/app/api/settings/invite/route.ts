import { NextResponse } from 'next/server'
import { inviteSecretariatMember } from '@/actions/secretariat'

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    await inviteSecretariatMember(formData)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : 'Failed to send invite',
      },
      { status: 500 },
    )
  }
}
