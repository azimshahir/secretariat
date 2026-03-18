'use server'

import { createClient } from '@/lib/supabase/server'
import { extractTranscript } from '@/lib/file-processing'
import { uuidSchema } from '@/lib/validation'
import { uploadFileToStorage } from './shared'
import { assertFileSize } from './validation'

export async function uploadTranscript(meetingId: string, file: File) {
  uuidSchema.parse(meetingId)
  assertFileSize(file)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { data: existingTranscripts } = await supabase
    .from('transcripts')
    .select('id')
    .eq('meeting_id', meetingId)

  const parsed = await extractTranscript(file)
  const isMediaInput = file.type.startsWith('audio/') || file.type.startsWith('video/')
  const source = isMediaInput
    ? 'whisper_stt'
    : file.name.toLowerCase().endsWith('.vtt')
      ? 'upload_vtt'
      : 'upload_docx'

  const upload = !isMediaInput
    ? await uploadFileToStorage(meetingId, file, 'transcript_docx')
    : null

  const { data: inserted, error } = await supabase
    .from('transcripts')
    .insert({
      meeting_id: meetingId,
      content: parsed.content,
      source,
      speaker_map: parsed.speakerMap,
      storage_path: upload?.path ?? null,
    })
    .select('id, source, storage_path')
    .single()
  if (error || !inserted) throw new Error(error?.message ?? 'Failed to save transcript')

  const oldTranscriptIds = (existingTranscripts ?? [])
    .map(row => row.id)
    .filter(id => id !== inserted.id)
  if (oldTranscriptIds.length > 0) {
    await supabase.from('transcripts').delete().in('id', oldTranscriptIds)
  }

  if (isMediaInput) {
    const { data: profile } = await supabase.from('profiles').select('organization_id').eq('id', user.id).single()
    if (profile) {
      await supabase.from('audit_logs').insert({
        organization_id: profile.organization_id,
        meeting_id: meetingId,
        user_id: user.id,
        action: 'raw_media_processed_ephemeral',
        details: {
          file_name: file.name,
          policy: 'immediate_purge_after_transcription',
          diarization_applied: parsed.diarizationApplied,
        },
      })
    }
  }

  return {
    transcriptId: inserted.id,
    source: inserted.source as 'upload_docx' | 'upload_vtt' | 'whisper_stt',
    storagePath: inserted.storage_path,
  }
}
