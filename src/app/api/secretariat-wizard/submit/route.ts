import { NextResponse } from 'next/server'
import type { WizardState } from '@/components/secretariat-wizard/wizard-types'
import { submitWizardOnServer } from '@/lib/secretariat-wizard/submit'

type WizardPayload = Omit<WizardState, 'ragFiles'> & {
  ragFiles: Array<{
    id: string
    category: 'TOR' | 'Policy' | 'Framework' | 'Manual' | 'Books' | 'Others'
    customName: string
  }>
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const rawState = String(formData.get('state') ?? '')
    if (!rawState) {
      return NextResponse.json(
        { ok: false, message: 'Wizard state is required' },
        { status: 400 },
      )
    }

    const payload = JSON.parse(rawState) as WizardPayload
    const state: WizardState = {
      ...payload,
      ragFiles: (payload.ragFiles ?? []).map(fileDraft => {
        const file = formData.get(`rag-file:${fileDraft.id}`)
        return {
          ...fileDraft,
          file: file instanceof File ? file : null,
        }
      }),
    }

    const result = await submitWizardOnServer(state)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to create secretariat',
      },
      { status: 500 },
    )
  }
}
