import { getTranscriptIntelligenceConfigForOrganization } from '@/lib/ai/transcript-intelligence-server'
import { extractTranscript } from '@/lib/file-processing'
import { uuidSchema } from '@/lib/validation'
import { cleanTranscriptForMeetingContext } from './transcript-intelligence'
import type { DatabaseClient } from './shared'
import type { TranscriptUploadResult, TranscriptUploadStage } from './types'

type ErrorLike = {
  message?: string | null
  code?: string | null
}

export class TranscriptUploadStageError extends Error {
  stage: TranscriptUploadStage
  code?: string
  originalMessage?: string

  constructor(stage: TranscriptUploadStage, message: string, options?: { code?: string | null; originalMessage?: string | null }) {
    super(message)
    this.stage = stage
    this.code = options?.code ?? undefined
    this.originalMessage = options?.originalMessage ?? undefined
  }
}

function toErrorLike(error: unknown): ErrorLike {
  if (error && typeof error === 'object') {
    const candidate = error as ErrorLike
    return {
      message: candidate.message ?? null,
      code: candidate.code ?? null,
    }
  }
  return {
    message: error instanceof Error ? error.message : String(error),
    code: null,
  }
}

function failStage(
  stage: TranscriptUploadStage,
  friendlyMessage: string,
  error: unknown,
): never {
  const details = toErrorLike(error)
  throw new TranscriptUploadStageError(stage, friendlyMessage, {
    code: details.code,
    originalMessage: details.message,
  })
}

function buildStoragePath(meetingId: string, fileName: string, folder: 'transcript_docx') {
  const ext = fileName.split('.').pop() ?? 'bin'
  return `${meetingId}/${folder}/${Date.now()}.${ext}`
}

function buildTranscriptLexiconPrompt(params: Awaited<ReturnType<typeof loadMeetingTranscriptCleanupContext>>) {
  const agendaHints = params.agendaList
    .slice(0, 20)
    .map(agenda => `${agenda.agendaNo} ${agenda.title}`)
    .join('; ')
  const glossaryHints = params.glossary
    .slice(0, 40)
    .map(item => `${item.acronym} = ${item.fullMeaning}`)
    .join('; ')

  const hintParts = [
    params.committeeName ? `Committee: ${params.committeeName}` : null,
    agendaHints ? `Agenda terms: ${agendaHints}` : null,
    glossaryHints ? `Glossary: ${glossaryHints}` : null,
  ].filter(Boolean)

  return hintParts.join('\n')
}

async function loadMeetingTranscriptCleanupContext(
  supabase: DatabaseClient,
  meetingId: string,
) {
  const { data: meeting, error: meetingError } = await supabase
    .from('meetings')
    .select('title, committee_id, committees(name)')
    .eq('id', meetingId)
    .single()

  if (meetingError || !meeting) {
    throw new Error(meetingError?.message ?? 'Meeting not found')
  }

  const { data: agendas, error: agendasError } = await supabase
    .from('agendas')
    .select('agenda_no, title, presenter')
    .eq('meeting_id', meetingId)
    .order('sort_order')

  if (agendasError) {
    throw new Error(agendasError.message)
  }

  let glossary: Array<{ acronym: string; fullMeaning: string }> = []
  if (meeting.committee_id) {
    const { data: glossaryRows, error: glossaryError } = await supabase
      .from('glossary')
      .select('acronym, full_meaning')
      .eq('committee_id', meeting.committee_id)
      .order('acronym')

    if (glossaryError) {
      throw new Error(glossaryError.message)
    }

    glossary = (glossaryRows ?? []).map(row => ({
      acronym: row.acronym,
      fullMeaning: row.full_meaning,
    }))
  }

  return {
    meetingTitle: meeting.title,
    committeeName: (meeting.committees as { name?: string | null } | null)?.name ?? null,
    agendaList: (agendas ?? []).map(agenda => ({
      agendaNo: agenda.agenda_no,
      title: agenda.title,
      presenter: agenda.presenter,
    })),
    glossary,
  }
}

export async function uploadTranscriptWithClient(params: {
  supabase: DatabaseClient
  meetingId: string
  file: File
  userId: string
  organizationId?: string | null
}): Promise<TranscriptUploadResult> {
  const meetingId = uuidSchema.parse(params.meetingId)
  const isMediaInput = params.file.type.startsWith('audio/') || params.file.type.startsWith('video/')
  let transcriptPresetConfig = null as Awaited<
    ReturnType<typeof getTranscriptIntelligenceConfigForOrganization>
  > | null
  let cleanupContext = null as Awaited<ReturnType<typeof loadMeetingTranscriptCleanupContext>> | null

  if (isMediaInput) {
    try {
      transcriptPresetConfig = await getTranscriptIntelligenceConfigForOrganization(
        params.organizationId ?? null,
      )
    } catch (error) {
      failStage(
        'resolve_transcript_preset',
        'Failed to resolve transcript intelligence preset.',
        error,
      )
    }

    try {
      cleanupContext = await loadMeetingTranscriptCleanupContext(params.supabase, meetingId)
    } catch (error) {
      failStage(
        'clean_transcript',
        'Failed to load meeting context for transcript cleanup.',
        error,
      )
    }
  }

  let parsed: Awaited<ReturnType<typeof extractTranscript>>
  try {
    parsed = await extractTranscript(
      params.file,
      transcriptPresetConfig
        ? {
            media: {
              sttModel: transcriptPresetConfig.sttModel,
              lexiconPrompt: transcriptPresetConfig.usesDiarizedStt
                ? undefined
                : buildTranscriptLexiconPrompt(cleanupContext ?? {
                    meetingTitle: '',
                    committeeName: null,
                    agendaList: [],
                    glossary: [],
                  }),
              useDiarizedStt: transcriptPresetConfig.usesDiarizedStt,
            },
          }
        : undefined,
    )
  } catch (error) {
    const details = toErrorLike(error)
    const message = details.message?.trim()
    failStage(
      'parse_transcript',
      message || 'Failed to parse transcript file. Please use a valid DOCX/VTT/TXT transcript or supported audio/video file.',
      error,
    )
  }

  const source = isMediaInput
    ? 'openai_stt'
    : params.file.name.toLowerCase().endsWith('.vtt')
      ? 'upload_vtt'
      : 'upload_docx'
  let finalContent = parsed.content
  let rawContent = parsed.rawContent
  let processingMetadata = parsed.processingMetadata ?? {}

  if (isMediaInput && transcriptPresetConfig) {
    try {
      rawContent = parsed.rawContent ?? parsed.content
      finalContent = await cleanTranscriptForMeetingContext({
        config: transcriptPresetConfig,
        rawTranscript: rawContent,
        meetingTitle: cleanupContext?.meetingTitle ?? '',
        committeeName: cleanupContext?.committeeName ?? null,
        agendaList: cleanupContext?.agendaList ?? [],
        glossary: cleanupContext?.glossary ?? [],
        speakerNames: Object.keys(parsed.speakerMap),
      })
      processingMetadata = {
        ...processingMetadata,
        preset: transcriptPresetConfig.preset,
        sttModel: transcriptPresetConfig.sttModel,
        cleanupModel: transcriptPresetConfig.cleanupModel,
        refinementModel: transcriptPresetConfig.refinementModel,
        numericVerifierModel: transcriptPresetConfig.numericVerifierModel,
        processedAt: new Date().toISOString(),
      }
    } catch (error) {
      failStage(
        'clean_transcript',
        'Failed to clean transcript with meeting context.',
        error,
      )
    }
  }

  const { data: existingTranscripts, error: existingTranscriptsError } = await params.supabase
    .from('transcripts')
    .select('id')
    .eq('meeting_id', meetingId)
  if (existingTranscriptsError) {
    failStage('cleanup_old_transcripts', 'Failed to check existing transcripts before saving the new transcript.', existingTranscriptsError)
  }

  let storagePath: string | null = null

  if (!isMediaInput) {
    storagePath = buildStoragePath(meetingId, params.file.name, 'transcript_docx')
    const { error: uploadError } = await params.supabase.storage
      .from('meeting-files')
      .upload(storagePath, params.file)
    if (uploadError) {
      failStage('upload_storage', 'Failed to upload transcript source file to storage.', uploadError)
    }

    const { error: mediaError } = await params.supabase
      .from('media_files')
      .insert({
        meeting_id: meetingId,
        file_type: 'transcript_docx',
        storage_path: storagePath,
        original_name: params.file.name,
        size_bytes: params.file.size,
      })
    if (mediaError) {
      failStage('insert_media_file', 'Failed to save transcript file metadata.', mediaError)
    }
  }

  const { data: inserted, error } = await params.supabase
    .from('transcripts')
    .insert({
      meeting_id: meetingId,
      content: finalContent,
      raw_content: rawContent,
      source,
      speaker_map: parsed.speakerMap,
      processing_metadata: processingMetadata,
      storage_path: storagePath,
    })
    .select('id, source, storage_path')
    .single()

  if (error || !inserted) {
    failStage('insert_transcript', 'Failed to save transcript content.', error ?? new Error('Failed to save transcript'))
  }

  const oldTranscriptIds = (existingTranscripts ?? [])
    .map(row => row.id)
    .filter(id => id !== inserted.id)
  if (oldTranscriptIds.length > 0) {
    const { error: cleanupError } = await params.supabase
      .from('transcripts')
      .delete()
      .in('id', oldTranscriptIds)
    if (cleanupError) {
      failStage('cleanup_old_transcripts', 'New transcript saved, but failed to remove older transcript versions.', cleanupError)
    }
  }

  if (isMediaInput && params.organizationId) {
    await params.supabase.from('audit_logs').insert({
      organization_id: params.organizationId,
      meeting_id: meetingId,
      user_id: params.userId,
      action: 'raw_media_processed_ephemeral',
      details: {
        file_name: params.file.name,
        policy: 'immediate_purge_after_transcription',
        diarization_applied: parsed.diarizationApplied,
        transcript_preset: transcriptPresetConfig?.preset ?? null,
        stt_model: transcriptPresetConfig?.sttModel ?? null,
        cleanup_model: transcriptPresetConfig?.cleanupModel ?? null,
      },
    })
  }

  return {
    transcriptId: inserted.id,
    source: inserted.source as TranscriptUploadResult['source'],
    storagePath: inserted.storage_path,
  }
}
