'use server'

import { createClient } from '@/lib/supabase/server'
import { extractSlideText } from '@/lib/file-processing'
import { uuidSchema } from '@/lib/validation'
import { uploadFileToStorage } from './shared'
import { assertFileSize } from './validation'

export async function uploadSlides(meetingId: string, file: File) {
  uuidSchema.parse(meetingId)
  assertFileSize(file)
  const supabase = await createClient()
  const upload = await uploadFileToStorage(meetingId, file, 'slides_pdf')
  const slideText = await extractSlideText(file)
  const parsedPath = `${meetingId}/processed/slides-${Date.now()}.txt`
  const textFile = new File([slideText], 'slides-parsed.txt', { type: 'text/plain' })

  const { data: signedUpload, error: signedError } = await supabase.storage
    .from('meeting-files')
    .createSignedUploadUrl(parsedPath)
  if (signedError || !signedUpload?.token) throw new Error(signedError?.message ?? 'Failed to sign slide text upload')

  const { error: uploadError } = await supabase.storage
    .from('meeting-files')
    .uploadToSignedUrl(parsedPath, signedUpload.token, textFile)
  if (uploadError) throw new Error(uploadError.message)

  // Parsed slide text stored at predictable path: {meetingId}/processed/slides-*.txt
  return true
}
