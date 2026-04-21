import { NextResponse } from 'next/server'
import { saveFormatTemplate } from '@/app/settings/actions'

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    await saveFormatTemplate(formData)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to save format template',
      },
      { status: 500 },
    )
  }
}
