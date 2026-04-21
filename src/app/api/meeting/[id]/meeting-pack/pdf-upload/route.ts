import { NextResponse } from 'next/server'
import { assertFileSize } from '@/actions/file-upload/validation'
import { uuidSchema } from '@/lib/validation'
import {
  requireWritableMeetingContext,
  serializeCommitteeGenerationApiError,
} from '../../../../committee-generation/_lib/write-access'

export const runtime = 'nodejs'

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
      throw new Error('PDF file is required')
    }

    assertFileSize(file)
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    if (!isPdf) {
      throw new Error('Only PDF files are supported')
    }

    const context = await requireWritableMeetingContext(meetingId)
    const ext = file.name.split('.').pop() ?? 'pdf'
    const path = `${meetingId}/slides_pdf/${Date.now()}.${ext}`

    const { error: uploadError } = await context.adminSupabase.storage
      .from('meeting-files')
      .upload(path, file)
    if (uploadError) {
      throw new Error(uploadError.message)
    }

    const { data: media, error: mediaError } = await context.adminSupabase
      .from('media_files')
      .insert({
        meeting_id: meetingId,
        file_type: 'slides_pdf',
        storage_path: path,
        original_name: file.name,
        size_bytes: file.size,
      })
      .select('id')
      .single()
    if (mediaError || !media) {
      throw new Error(mediaError?.message ?? 'Failed to save uploaded PDF metadata')
    }

    const { data: signedUrlData, error: signedUrlError } = await context.adminSupabase.storage
      .from('meeting-files')
      .createSignedUrl(path, 3600)
    if (signedUrlError || !signedUrlData?.signedUrl) {
      throw new Error(signedUrlError?.message ?? 'Failed to generate PDF preview link')
    }

    return NextResponse.json({
      ok: true,
      path,
      mediaId: media.id,
      signedUrl: signedUrlData.signedUrl,
    })
  } catch (error) {
    const { status, message } = serializeCommitteeGenerationApiError(
      error,
      'Failed to upload Meeting Pack PDF',
    )
    console.error('[api/meeting/[id]/meeting-pack/pdf-upload] failed:', message)
    return NextResponse.json({ ok: false, message }, { status })
  }
}
