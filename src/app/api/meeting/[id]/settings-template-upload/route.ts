import { NextResponse } from 'next/server'
import { uuidSchema } from '@/lib/validation'
import {
  getCanonicalTemplateStorageSectionKey,
  isMinuteOfMeetingSectionTitle,
  TEMPLATE_SECTION_IDS,
} from '@/app/meeting/[id]/setup/settings-template-model'
import { MOM_TEMPLATE_VALIDATION_VERSION } from '@/lib/mom-template-types'
import { validateMomTemplateBuffer } from '@/lib/mom-template-validator'
import {
  requireWritableMeetingContext,
  serializeCommitteeGenerationApiError,
} from '../../../committee-generation/_lib/write-access'

export const runtime = 'nodejs'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const meetingId = uuidSchema.parse(id)
    const formData = await request.formData()
    const sectionTitle = String(formData.get('sectionTitle') ?? '').trim()
    const file = formData.get('file')

    if (!sectionTitle) {
      throw new Error('Section title is required')
    }
    if (!(file instanceof File)) {
      throw new Error('Template file is required')
    }

    const context = await requireWritableMeetingContext(meetingId)
    const sectionKey = getCanonicalTemplateStorageSectionKey(sectionTitle)
    const ext = file.name.split('.').pop()?.trim().toLowerCase() ?? 'docx'
    if (sectionKey === TEMPLATE_SECTION_IDS.extractMinute && ext !== 'docx') {
      throw new Error('Extract Minute requires a DOCX template')
    }
    const momTemplateValidation = isMinuteOfMeetingSectionTitle(sectionTitle)
      ? ext === 'docx'
        ? await validateMomTemplateBuffer(await file.arrayBuffer(), file.name)
        : {
            version: MOM_TEMPLATE_VALIDATION_VERSION,
            status: 'unsupported' as const,
            reasons: ['Exact Word rendering requires a DOCX template.'],
            validatedAt: new Date().toISOString(),
            fingerprint: file.name,
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
      : null
    const path = `meeting-templates/${meetingId}/${sectionKey}.${ext}`

    const { error: uploadError } = await context.adminSupabase.storage
      .from('meeting-files')
      .upload(path, file, { upsert: true })
    if (uploadError) {
      throw new Error(uploadError.message)
    }

    return NextResponse.json({
      ok: true,
      storagePath: path,
      fileName: file.name,
      momTemplateValidation,
    })
  } catch (error) {
    const { status, message } = serializeCommitteeGenerationApiError(error, 'Failed to upload meeting template')
    console.error('[api/meeting/[id]/settings-template-upload] failed:', message)
    return NextResponse.json({ ok: false, message }, { status })
  }
}
