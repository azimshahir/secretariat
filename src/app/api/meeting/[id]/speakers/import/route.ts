import { NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { assertFileSize } from '@/actions/file-upload/validation'
import { normalizeSpeakerHeader } from '@/lib/committee-speakers'
import { serializeMeetingSpeakerOverrides } from '@/lib/meeting-settings-overrides'
import { uuidSchema } from '@/lib/validation'
import {
  requireWritableMeetingContext,
  serializeCommitteeGenerationApiError,
} from '../../../../committee-generation/_lib/write-access'

export const runtime = 'nodejs'

function extractSpeakerValue(row: Record<string, unknown>, keywords: string[]) {
  for (const [key, value] of Object.entries(row)) {
    const normalizedKey = normalizeSpeakerHeader(key)
    if (keywords.some(keyword => normalizedKey.includes(keyword))) {
      return String(value ?? '').trim()
    }
  }

  return ''
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const meetingId = uuidSchema.parse(id)
    const formData = await request.formData()
    const file = formData.get('file')

    if (!(file instanceof File)) {
      throw new Error('Excel or CSV file is required')
    }

    assertFileSize(file)
    const context = await requireWritableMeetingContext(meetingId)

    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    const firstSheetName = workbook.SheetNames[0]
    if (!firstSheetName) {
      throw new Error('The uploaded file does not contain any worksheet data')
    }

    const sheet = workbook.Sheets[firstSheetName]
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })

    const speakers = rows.flatMap((row, index) => {
      const speakerName = extractSpeakerValue(row, ['speaker', 'name', 'nama'])
      const position = extractSpeakerValue(row, ['position', 'role', 'jawatan', 'title'])
      if (!speakerName) return []

      return [{
        id: `${meetingId}-speaker-${index + 1}`,
        committee_id: '',
        speaker_name: speakerName,
        position,
        sort_order: index,
      }]
    })

    if (speakers.length === 0) {
      throw new Error('No speaker rows found. Ensure columns include Speaker/Name and Position/Role.')
    }

    const payload = serializeMeetingSpeakerOverrides(speakers)
    const { error } = await context.adminSupabase
      .from('meetings')
      .update({ speaker_overrides: payload })
      .eq('id', meetingId)

    if (error) {
      throw new Error(error.message)
    }

    return NextResponse.json({
      ok: true,
      importedCount: speakers.length,
      speakers: payload,
    })
  } catch (error) {
    const { status, message } = serializeCommitteeGenerationApiError(error, 'Failed to import meeting speakers')
    console.error('[api/meeting/[id]/speakers/import] failed:', message)
    return NextResponse.json({ ok: false, message }, { status })
  }
}
