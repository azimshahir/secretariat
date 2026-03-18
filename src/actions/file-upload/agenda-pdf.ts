'use server'

import { uuidSchema } from '@/lib/validation'
import { uploadFileToStorage } from './shared'
import { assertFileSize } from './validation'

export async function uploadAgendaPdf(meetingId: string, file: File) {
  uuidSchema.parse(meetingId)
  assertFileSize(file)

  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
  if (!isPdf) throw new Error('Only PDF files are supported')

  return uploadFileToStorage(meetingId, file, 'slides_pdf')
}

