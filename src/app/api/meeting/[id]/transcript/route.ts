import { NextResponse } from 'next/server'
import { assertFileSize } from '@/actions/file-upload/validation'
import { TranscriptUploadStageError, uploadTranscriptWithClient } from '@/lib/meeting-generation/transcript'
import type { TranscriptUploadErrorPayload, TranscriptUploadStage } from '@/lib/meeting-generation/types'
import {
  assertTranscriptUploadAllowed,
  recordTranscriptUploadUsage,
  SubscriptionLimitError,
} from '@/lib/subscription/entitlements'
import { uuidSchema } from '@/lib/validation'
import {
  requireWritableMeetingContext,
  serializeCommitteeGenerationApiError,
} from '../../../committee-generation/_lib/write-access'

export const runtime = 'nodejs'

function createTranscriptFailurePayload(params: {
  stage: TranscriptUploadStage
  message: string
  code?: string
}): TranscriptUploadErrorPayload & { ok: false } {
  return {
    ok: false,
    stage: params.stage,
    message: params.message,
    code: params.code,
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let meetingId: string | null = null
  let fileName: string | null = null
  let fileType: string | null = null

  try {
    const { id } = await params
    meetingId = uuidSchema.parse(id)
    const formData = await request.formData()
    const file = formData.get('file')
    const durationSecValue = String(formData.get('durationSec') ?? '').trim()

    if (!(file instanceof File)) {
      const payload = createTranscriptFailurePayload({
        stage: 'validate_request',
        message: 'Transcript file is required',
      })
      return NextResponse.json(payload, { status: 400 })
    }

    fileName = file.name
    fileType = file.type || 'application/octet-stream'

    try {
      assertFileSize(file)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Transcript file is too large'
      const payload = createTranscriptFailurePayload({
        stage: 'validate_request',
        message,
      })
      return NextResponse.json(payload, { status: 400 })
    }

    const context = await requireWritableMeetingContext(meetingId)
    const mediaKind = file.type.startsWith('audio/')
      ? 'audio'
      : file.type.startsWith('video/')
        ? 'video'
        : 'document'
    const durationSec = durationSecValue ? Number(durationSecValue) : null

    await assertTranscriptUploadAllowed({
      userId: context.userId,
      organizationId: context.organizationId,
      mediaKind,
      durationSec: Number.isFinite(durationSec) ? durationSec : null,
    })
    const result = await uploadTranscriptWithClient({
      supabase: context.adminSupabase,
      meetingId,
      file,
      userId: context.userId,
      organizationId: context.organizationId,
    })
    await recordTranscriptUploadUsage({
      userId: context.userId,
      organizationId: context.organizationId,
      meetingId,
      durationSec: Number.isFinite(durationSec) ? durationSec : null,
      createdBy: context.userId,
    })

    return NextResponse.json({
      ok: true,
      transcriptId: result.transcriptId,
      source: result.source,
      storagePath: result.storagePath,
    })
  } catch (error) {
    if (error instanceof SubscriptionLimitError) {
      return NextResponse.json(createTranscriptFailurePayload({
        stage: 'validate_request',
        message: error.message,
        code: error.code,
      }), { status: error.status })
    }

    if (error instanceof TranscriptUploadStageError) {
      const status = error.stage === 'parse_transcript' ? 400 : 500
      console.error('[api/meeting/[id]/transcript] stage failed', {
        meetingId,
        fileName,
        fileType,
        stage: error.stage,
        code: error.code,
        originalMessage: error.originalMessage,
      })
      return NextResponse.json(createTranscriptFailurePayload({
        stage: error.stage,
        message: error.message,
        code: error.code,
      }), { status })
    }

    const { status, message } = serializeCommitteeGenerationApiError(error, 'Failed to upload transcript')
    const stage: TranscriptUploadStage = status === 401 || status === 403 || status === 404
      ? 'authorize_meeting'
      : 'validate_request'

    console.error('[api/meeting/[id]/transcript] failed', {
      meetingId,
      fileName,
      fileType,
      stage,
      status,
      message,
      originalMessage: error instanceof Error ? error.message : String(error),
    })

    return NextResponse.json(createTranscriptFailurePayload({
      stage,
      message,
    }), { status })
  }
}
