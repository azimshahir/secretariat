import { NextResponse } from 'next/server'
import { z } from 'zod'
import { MOM_TEMPLATE_VALIDATION_VERSION } from '@/lib/mom-template-types'
import { validateMomTemplateBuffer } from '@/lib/mom-template-validator'
import { uuidSchema } from '@/lib/validation'
import {
  requireWritableMeetingContext,
  serializeCommitteeGenerationApiError,
} from '../../../committee-generation/_lib/write-access'

export const runtime = 'nodejs'

const bodySchema = z.object({
  storagePath: z.string().min(1),
  fileName: z.string().optional(),
})

function buildUnsupportedValidation(fileName?: string) {
  return {
    version: MOM_TEMPLATE_VALIDATION_VERSION,
    status: 'unsupported' as const,
    reasons: ['Exact Word rendering requires a DOCX template.'],
    validatedAt: new Date().toISOString(),
    fingerprint: fileName ?? '',
    profileSummary: {
      templateMode: 'paragraph' as const,
      contentZoneDetected: false,
      contentParagraphCount: 0,
      numberingParagraphCount: 0,
      headerReplaceable: false,
      footerReplaceable: false,
      paragraphKinds: [],
      unsupportedConstructs: [],
    },
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const meetingId = uuidSchema.parse(id)
    const { storagePath, fileName } = bodySchema.parse(await request.json())
    const context = await requireWritableMeetingContext(meetingId)

    if (!storagePath.toLowerCase().endsWith('.docx')) {
      return NextResponse.json({
        ok: true,
        validation: buildUnsupportedValidation(fileName),
      })
    }

    const { data, error } = await context.adminSupabase.storage
      .from('meeting-files')
      .download(storagePath)
    if (error || !data) {
      throw new Error(error?.message ?? 'Failed to download template for validation')
    }

    const validation = await validateMomTemplateBuffer(await data.arrayBuffer(), fileName ?? storagePath)
    return NextResponse.json({ ok: true, validation })
  } catch (error) {
    const { status, message } = serializeCommitteeGenerationApiError(error, 'Failed to validate meeting template')
    return NextResponse.json({ ok: false, message }, { status })
  }
}
