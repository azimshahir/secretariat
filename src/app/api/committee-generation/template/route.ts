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
  requireWritableCommitteeContext,
  serializeCommitteeGenerationApiError,
} from '../_lib/write-access'

const MISSING_ITINERARY_TABLE_HINT = 'Database migration missing: public.itinerary_templates'

function isMissingItineraryTemplatesTableError(
  error: { code?: string | null; message?: string | null } | null | undefined,
) {
  if (!error) return false
  if (error.code === 'PGRST205') return true
  const message = (error.message ?? '').toLowerCase()
  return message.includes('itinerary_templates') && message.includes('schema cache')
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const committeeId = uuidSchema.parse(String(formData.get('committeeId') ?? ''))
    const sectionTitle = String(formData.get('sectionTitle') ?? '').trim()
    const file = formData.get('file')

    if (!sectionTitle) {
      throw new Error('Section title is required')
    }
    if (!(file instanceof File)) {
      throw new Error('Template file is required')
    }

    const context = await requireWritableCommitteeContext(committeeId)

    const { error: preflightError } = await context.adminSupabase
      .from('itinerary_templates')
      .select('id')
      .limit(1)
    if (preflightError) {
      if (isMissingItineraryTemplatesTableError(preflightError)) {
        throw new Error(MISSING_ITINERARY_TABLE_HINT)
      }
      throw new Error(preflightError.message)
    }

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
    const path = `committee-templates/${committeeId}/${sectionKey}.${ext}`

    const { error: uploadError } = await context.adminSupabase.storage
      .from('meeting-files')
      .upload(path, file, { upsert: true })
    if (uploadError) {
      throw new Error(uploadError.message)
    }

    const { error: dbError } = await context.adminSupabase
      .from('itinerary_templates')
      .upsert(
        {
          committee_id: committeeId,
          section_key: sectionKey,
          storage_path: path,
          file_name: file.name,
        },
        { onConflict: 'committee_id,section_key' },
      )
    if (dbError) {
      if (isMissingItineraryTemplatesTableError(dbError)) {
        throw new Error(MISSING_ITINERARY_TABLE_HINT)
      }
      throw new Error(dbError.message)
    }

    return NextResponse.json({
      ok: true,
      storagePath: path,
      fileName: file.name,
      momTemplateValidation,
    })
  } catch (error) {
    const { status, message } = serializeCommitteeGenerationApiError(error, 'Failed to upload template')
    console.error('[api/committee-generation/template] failed:', message)
    return NextResponse.json({ ok: false, message }, { status })
  }
}
