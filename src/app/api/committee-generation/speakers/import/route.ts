import { NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { assertFileSize } from '@/actions/file-upload/validation'
import {
  COMMITTEE_SPEAKER_SELECT,
  normalizeSpeakerHeader,
  type CommitteeSpeaker,
} from '@/lib/committee-speakers'
import { uuidSchema } from '@/lib/validation'
import {
  requireWritableCommitteeContext,
  serializeCommitteeGenerationApiError,
} from '../../_lib/write-access'

export const runtime = 'nodejs'

async function getNextSortOrder(
  adminSupabase: Awaited<ReturnType<typeof requireWritableCommitteeContext>>['adminSupabase'],
  committeeId: string,
) {
  const { data, error } = await adminSupabase
    .from('committee_speakers')
    .select('sort_order')
    .eq('committee_id', committeeId)
    .order('sort_order', { ascending: false })
    .limit(1)

  if (error) throw new Error(error.message)
  return (data?.[0]?.sort_order ?? -1) + 1
}

async function listCommitteeSpeakers(
  adminSupabase: Awaited<ReturnType<typeof requireWritableCommitteeContext>>['adminSupabase'],
  committeeId: string,
) {
  const { data, error } = await adminSupabase
    .from('committee_speakers')
    .select(COMMITTEE_SPEAKER_SELECT)
    .eq('committee_id', committeeId)
    .order('sort_order')

  if (error) throw new Error(error.message)
  return (data ?? []) as CommitteeSpeaker[]
}

function extractSpeakerValue(row: Record<string, unknown>, keywords: string[]) {
  for (const [key, value] of Object.entries(row)) {
    const normalizedKey = normalizeSpeakerHeader(key)
    if (keywords.some(keyword => normalizedKey.includes(keyword))) {
      return String(value ?? '').trim()
    }
  }

  return ''
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const committeeId = uuidSchema.parse(String(formData.get('committeeId') ?? ''))
    const file = formData.get('file')

    if (!(file instanceof File)) {
      throw new Error('Excel or CSV file is required')
    }

    assertFileSize(file)
    const context = await requireWritableCommitteeContext(committeeId)

    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    const firstSheetName = workbook.SheetNames[0]
    if (!firstSheetName) {
      throw new Error('The uploaded file does not contain any worksheet data')
    }

    const sheet = workbook.Sheets[firstSheetName]
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })

    let importedCount = 0
    let nextSortOrder = await getNextSortOrder(context.adminSupabase, committeeId)

    for (const row of rows) {
      const speakerName = extractSpeakerValue(row, ['speaker', 'name', 'nama'])
      const position = extractSpeakerValue(row, ['position', 'role', 'jawatan', 'title'])
      if (!speakerName) continue

      const { error } = await context.adminSupabase
        .from('committee_speakers')
        .upsert(
          {
            committee_id: committeeId,
            speaker_name: speakerName,
            position,
            sort_order: nextSortOrder,
          },
          { onConflict: 'committee_id,speaker_name' },
        )
      if (error) {
        throw new Error(error.message)
      }

      importedCount += 1
      nextSortOrder += 1
    }

    if (importedCount === 0) {
      throw new Error('No speaker rows found. Ensure columns include Speaker/Name and Position/Role.')
    }

    const speakers = await listCommitteeSpeakers(context.adminSupabase, committeeId)

    return NextResponse.json({
      ok: true,
      importedCount,
      speakers,
    })
  } catch (error) {
    const { status, message } = serializeCommitteeGenerationApiError(error, 'Failed to import speakers')
    console.error('[api/committee-generation/speakers/import] failed:', message)
    return NextResponse.json({ ok: false, message }, { status })
  }
}
