'use server'

import { createClient } from '@/lib/supabase/server'
import type { FileType } from '@/lib/supabase/types'
import { uuidSchema } from '@/lib/validation'
import { assertFileSize } from './validation'

async function createSignedDownloadUrl(path: string) {
  const supabase = await createClient()
  const { data, error } = await supabase.storage.from('meeting-files').createSignedUrl(path, 3600)
  if (error) throw new Error(error.message)
  return data.signedUrl
}

export async function uploadFileToStorage(meetingId: string, file: File, fileType: FileType) {
  uuidSchema.parse(meetingId)
  assertFileSize(file)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const ext = file.name.split('.').pop()
  const path = `${meetingId}/${fileType}/${Date.now()}.${ext}`
  const { data: signedUpload, error: signedError } = await supabase.storage
    .from('meeting-files')
    .createSignedUploadUrl(path)
  if (signedError || !signedUpload?.token) throw new Error(signedError?.message ?? 'Failed to sign upload URL')

  const { error: uploadError } = await supabase.storage
    .from('meeting-files')
    .uploadToSignedUrl(path, signedUpload.token, file)
  if (uploadError) throw new Error(uploadError.message)

  const { data: media, error: mediaError } = await supabase
    .from('media_files')
    .insert({
      meeting_id: meetingId,
      file_type: fileType,
      storage_path: path,
      original_name: file.name,
      size_bytes: file.size,
    })
    .select('id')
    .single()
  if (mediaError) throw new Error(mediaError.message)

  return { path, mediaId: media.id, signedUrl: await createSignedDownloadUrl(path) }
}
