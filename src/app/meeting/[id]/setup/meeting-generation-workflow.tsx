'use client'

import { useMemo, useRef, useState } from 'react'
import { Plus, RefreshCcw, Sparkles, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { GenerationConfig } from '@/lib/meeting-generation/types'
import { GenerateForm, type GenerateConfig } from './generate-form'
import { formatSecondsToTimecode, parseTimecodeToSeconds } from '@/lib/timecode'
import type { Agenda } from '@/lib/supabase/types'
import type { MomGenerationState, StartMomGenerationOptions } from './use-mom-generation-queue'
import type { AgendaTimelineRow } from './agenda-timeline-row'
import {
  confirmAgendaSegmentationRequest,
  MeetingGenerationApiError,
  previewAgendaSegmentationRequest,
  saveMeetingRulesRequest,
  uploadMeetingTranscriptRequest,
} from './meeting-generation-api'

interface EditablePreviewRow {
  id: string
  agendaId: string
  startTime: string
  endTime: string
  forcedResolvedOutcomeMode: 'closed' | null
  confidence: number
  reason: string
  mappingStatus: 'explicit' | 'semantic' | 'suggested' | 'unresolved'
  requiresReview: boolean
  transcriptionSnapshot: {
    startTime: string
    endTime: string
    confidence: number
    reason: string
    mappingStatus: 'explicit' | 'semantic' | 'suggested' | 'unresolved'
    requiresReview: boolean
  } | null
}

function buildEditableRowsSignature(rows: EditablePreviewRow[]) {
  return rows
    .map(row => [
      row.agendaId,
      row.startTime.trim(),
      row.endTime.trim(),
      row.forcedResolvedOutcomeMode ?? 'none',
      row.mappingStatus,
      row.requiresReview ? 'review' : 'ready',
    ].join(':'))
    .join('|')
}

const CLOSURE_ONLY_DEFAULT_DURATION_SEC = 30
const TIMECODE_PATTERN = /^\d{1,2}:[0-5]\d:[0-5]\d$/

function buildForcedResolvedOutcomeModes(rows: Array<{
  agendaId: string
  forcedResolvedOutcomeMode?: 'closed' | null
}>) {
  return Object.fromEntries(
    rows.flatMap(row => row.forcedResolvedOutcomeMode === 'closed'
      ? [[row.agendaId, 'closed' as const]]
      : []),
  )
}

function createClosureOnlyTimeRange(rows: EditablePreviewRow[], rowId: string) {
  const rowIndex = rows.findIndex(row => row.id === rowId)
  if (rowIndex === -1) {
    return {
      startTime: formatSecondsToTimecode(0),
      endTime: formatSecondsToTimecode(CLOSURE_ONLY_DEFAULT_DURATION_SEC),
    }
  }

  const currentRow = rows[rowIndex]
  const currentStartSec = parseTimecodeToSeconds(currentRow.startTime)
  const currentEndSec = parseTimecodeToSeconds(currentRow.endTime)
  if (currentStartSec !== null && currentEndSec !== null && currentEndSec > currentStartSec) {
    return {
      startTime: currentRow.startTime,
      endTime: currentRow.endTime,
    }
  }

  if (currentStartSec !== null) {
    return {
      startTime: formatSecondsToTimecode(currentStartSec),
      endTime: formatSecondsToTimecode(currentStartSec + CLOSURE_ONLY_DEFAULT_DURATION_SEC),
    }
  }

  const previousEndSec = rowIndex > 0
    ? parseTimecodeToSeconds(rows[rowIndex - 1]?.endTime ?? '')
    : null
  const nextStartSec = rowIndex < rows.length - 1
    ? parseTimecodeToSeconds(rows[rowIndex + 1]?.startTime ?? '')
    : null

  if (previousEndSec !== null) {
    const nextEndSec = nextStartSec !== null && nextStartSec > previousEndSec
      ? Math.min(previousEndSec + CLOSURE_ONLY_DEFAULT_DURATION_SEC, nextStartSec)
      : previousEndSec + CLOSURE_ONLY_DEFAULT_DURATION_SEC
    return {
      startTime: formatSecondsToTimecode(previousEndSec),
      endTime: formatSecondsToTimecode(nextEndSec > previousEndSec ? nextEndSec : previousEndSec + CLOSURE_ONLY_DEFAULT_DURATION_SEC),
    }
  }

  if (nextStartSec !== null && nextStartSec >= CLOSURE_ONLY_DEFAULT_DURATION_SEC) {
    return {
      startTime: formatSecondsToTimecode(Math.max(0, nextStartSec - CLOSURE_ONLY_DEFAULT_DURATION_SEC)),
      endTime: formatSecondsToTimecode(nextStartSec),
    }
  }

  return {
    startTime: formatSecondsToTimecode(0),
    endTime: formatSecondsToTimecode(CLOSURE_ONLY_DEFAULT_DURATION_SEC),
  }
}

async function detectMediaDuration(file: File) {
  if (!(file.type.startsWith('audio/') || file.type.startsWith('video/'))) {
    return null
  }

  const objectUrl = URL.createObjectURL(file)
  try {
    const media = document.createElement(file.type.startsWith('video/') ? 'video' : 'audio')
    media.preload = 'metadata'

    const duration = await new Promise<number>((resolve, reject) => {
      const cleanup = () => {
        media.onloadedmetadata = null
        media.onerror = null
      }

      media.onloadedmetadata = () => {
        const nextDuration = Number.isFinite(media.duration) ? media.duration : NaN
        cleanup()
        if (!Number.isFinite(nextDuration) || nextDuration <= 0) {
          reject(new Error('Unable to read recording duration'))
          return
        }
        resolve(nextDuration)
      }

      media.onerror = () => {
        cleanup()
        reject(new Error('Unable to read recording duration'))
      }

      media.src = objectUrl
    })

    return duration
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

interface MeetingGenerationWorkflowProps {
  meetingId: string
  existingAgendas: Agenda[]
  hasExistingTranscript: boolean
  hasSavedTimeline?: boolean
  existingTimelineRows?: AgendaTimelineRow[]
  intent?: 'generate' | 'rearrange'
  initialMeetingRules: string
  skippedAgendaIds?: string[]
  generationState: MomGenerationState
  onStartGeneration: (options: StartMomGenerationOptions) => Promise<boolean>
  onTimelineSaved?: (rows: AgendaTimelineRow[]) => void
  onGenerationStarted?: () => void
  isGenerateDisabled?: boolean
  generateDisabledReason?: string
}

export function MeetingGenerationWorkflow({
  meetingId,
  existingAgendas,
  hasExistingTranscript,
  hasSavedTimeline = false,
  existingTimelineRows = [],
  intent = 'generate',
  initialMeetingRules,
  skippedAgendaIds = [],
  generationState,
  onStartGeneration,
  onTimelineSaved,
  onGenerationStarted,
  isGenerateDisabled = false,
  generateDisabledReason,
}: MeetingGenerationWorkflowProps) {
  const [generating, setGenerating] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [savingTimeline, setSavingTimeline] = useState(false)
  const [activeTranscriptId, setActiveTranscriptId] = useState<string | null>(null)
  const [uploadedTranscriptFileKey, setUploadedTranscriptFileKey] = useState<string | null>(null)
  const [lastConfig, setLastConfig] = useState<GenerateConfig | null>(null)
  const [previewTranscriptId, setPreviewTranscriptId] = useState<string | null>(null)
  const [previewWarnings, setPreviewWarnings] = useState<string[]>([])
  const [editableRows, setEditableRows] = useState<EditablePreviewRow[]>([])
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [savedTimelineSignature, setSavedTimelineSignature] = useState('')
  const transcriptUploadInFlightRef = useRef(false)
  const editableRowsSignature = useMemo(
    () => buildEditableRowsSignature(editableRows),
    [editableRows],
  )
  const hasSavedPreviewTimeline = editableRows.length > 0 && savedTimelineSignature === editableRowsSignature
  const hasUnsavedTimelineChanges = editableRows.length > 0 && savedTimelineSignature !== editableRowsSignature
  const rowsNeedingReview = editableRows.filter(row => row.requiresReview)
  const hasPendingReview = rowsNeedingReview.length > 0

  const isPending = generating || analyzing || confirming || generationState.isGenerating
  const agendaOptions = useMemo(() => existingAgendas.filter(a => !skippedAgendaIds.includes(a.id)), [existingAgendas, skippedAgendaIds])
  const agendaMap = useMemo(
    () => new Map(existingAgendas.map(agenda => [agenda.id, agenda])),
    [existingAgendas],
  )
  const queueAgendas = useMemo(
    () => existingAgendas.filter(agenda => !skippedAgendaIds.includes(agenda.id)),
    [existingAgendas, skippedAgendaIds],
  )
  const forcedResolvedOutcomeModesFromSavedTimeline = useMemo(
    () => buildForcedResolvedOutcomeModes(existingTimelineRows),
    [existingTimelineRows],
  )
  const hasTranscriptAvailable = hasExistingTranscript || Boolean(activeTranscriptId)

  function getFileKey(file: File | null | undefined) {
    if (!file) return null
    return `${file.name}:${file.size}:${file.lastModified}`
  }

  function formatTranscriptUploadFailure(error: MeetingGenerationApiError) {
    const stageLabels: Record<string, string> = {
      validate_request: 'validating the transcript upload',
      authorize_meeting: 'verifying access to this meeting',
      parse_transcript: 'parsing the transcript file',
      resolve_transcript_preset: 'loading the transcript intelligence preset',
      clean_transcript: 'cleaning the transcript with meeting context',
      upload_storage: 'uploading the transcript file',
      insert_media_file: 'saving transcript file metadata',
      insert_transcript: 'saving transcript content',
      cleanup_old_transcripts: 'cleaning up older transcript versions',
    }

    const stageLabel = stageLabels[error.stage ?? ''] ?? 'processing the transcript upload'
    return `Transcript upload failed while ${stageLabel}: ${error.message}`
  }

  async function ensureTranscriptUploaded(file: File) {
    const fileKey = getFileKey(file)
    if (activeTranscriptId && fileKey && fileKey === uploadedTranscriptFileKey) {
      return activeTranscriptId
    }

    if (transcriptUploadInFlightRef.current) {
      throw new Error('Transcript upload is already in progress. Please wait.')
    }

    transcriptUploadInFlightRef.current = true
    try {
      const durationSec = await detectMediaDuration(file)
      const uploaded = await uploadMeetingTranscriptRequest(meetingId, file, durationSec)
      setActiveTranscriptId(uploaded.transcriptId)
      setUploadedTranscriptFileKey(fileKey)
      return uploaded.transcriptId
    } catch (error) {
      if (error instanceof MeetingGenerationApiError && error.stage) {
        throw new Error(formatTranscriptUploadFailure(error))
      }
      throw error
    } finally {
      transcriptUploadInFlightRef.current = false
    }
  }

  function toEditableRows(rows: Array<{
    agendaId: string
    startSec: number | null
    endSec: number | null
    confidence: number
    reason: string
    mappingStatus: 'explicit' | 'semantic' | 'suggested' | 'unresolved'
    requiresReview: boolean
  }>): EditablePreviewRow[] {
    return rows.map(row => ({
      id: crypto.randomUUID(),
      agendaId: row.agendaId,
      startTime: typeof row.startSec === 'number' ? formatSecondsToTimecode(row.startSec) : '',
      endTime: typeof row.endSec === 'number' ? formatSecondsToTimecode(row.endSec) : '',
      forcedResolvedOutcomeMode: null,
      confidence: row.confidence,
      reason: row.reason,
      mappingStatus: row.mappingStatus,
      requiresReview: row.requiresReview,
      transcriptionSnapshot: null,
    }))
  }

  function toTimelineRows(rows: EditablePreviewRow[]): AgendaTimelineRow[] {
    return rows.map(row => {
      const agenda = agendaMap.get(row.agendaId)
      return {
        agendaId: row.agendaId,
        agendaNo: agenda?.agenda_no ?? 'Agenda',
        agendaTitle: agenda?.title ?? row.agendaId,
        startTime: row.startTime.trim() || null,
        endTime: row.endTime.trim() || null,
        forcedResolvedOutcomeMode: row.forcedResolvedOutcomeMode,
        confidence: row.confidence,
        reason: row.reason || null,
        mappingStatus: row.mappingStatus,
        requiresReview: row.requiresReview,
      }
    })
  }

  function validateRows(rows: EditablePreviewRow[]) {
    const errors: Record<string, string> = {}
    const normalized: Array<{ id: string; agendaId: string; startSec: number; endSec: number }> = []

    for (const row of rows) {
      if (row.forcedResolvedOutcomeMode === 'closed') {
        if (!agendaMap.has(row.agendaId)) {
          errors[row.id] = 'Please select a valid agenda.'
        }
        continue
      }

      if (row.requiresReview) {
        errors[row.id] = row.startTime && row.endTime
          ? 'Accept or edit this suggested mapping before saving.'
          : 'This row still needs manual review before saving.'
        continue
      }

      const startSec = parseTimecodeToSeconds(row.startTime)
      const endSec = parseTimecodeToSeconds(row.endTime)
      if (!agendaMap.has(row.agendaId)) {
        errors[row.id] = 'Please select a valid agenda.'
        continue
      }
      if (startSec === null || endSec === null) {
        errors[row.id] = 'Use HH:MM:SS format.'
        continue
      }
      if (endSec <= startSec) {
        errors[row.id] = 'End time must be after start time.'
        continue
      }
      normalized.push({ id: row.id, agendaId: row.agendaId, startSec, endSec })
    }

    const sorted = [...normalized].sort((a, b) => a.startSec - b.startSec)
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1]
      const current = sorted[index]
      if (current.startSec < previous.endSec) {
        errors[current.id] = 'Overlaps with previous row.'
      }
    }

    return { errors, valid: Object.keys(errors).length === 0 }
  }

  function getMissingFormattingMessage() {
    const missingFormatting = queueAgendas.filter(agenda => !agenda.format_template_id && !agenda.minute_playbook_id)
    if (missingFormatting.length === 0) return null
    const list = missingFormatting
      .slice(0, 8)
      .map(agenda => `${agenda.agenda_no} ${agenda.title}`)
      .join(', ')
    return `Saved exact formatting is required before generation: ${list}`
  }

  async function runTeamsAnalysis(config: GenerateConfig, transcriptId?: string | null) {
    const result = await previewAgendaSegmentationRequest(meetingId, {
      transcriptId: transcriptId ?? null,
      useTeamsTranscription: true,
      agendaDeviationPrompt: config.agendaDeviationPrompt,
      meetingRulesPrompt: config.meetingRulesPrompt,
      highlightPrompt: config.highlightPrompt,
    })

    setPreviewTranscriptId(result.transcriptId)
    setEditableRows(toEditableRows(result.rows))
    setPreviewWarnings(result.warnings)
    setRowErrors({})
    setSavedTimelineSignature('')
    setLastConfig(config)
  }

  async function persistTimelineRows() {
    if (!previewTranscriptId) {
      throw new Error('Analyze transcript first')
    }

    const validation = validateRows(editableRows)
    setRowErrors(validation.errors)
    if (!validation.valid) {
      throw new Error('Please fix timeline row errors before continuing')
    }

    const candidateRowsToPersist = editableRows
      .filter(row => row.forcedResolvedOutcomeMode !== 'closed')
      .map(row => ({
        agendaId: row.agendaId,
        startTime: row.startTime.trim(),
        endTime: row.endTime.trim(),
      }))
    const closureRowsToPersist = editableRows
      .filter(row => row.forcedResolvedOutcomeMode === 'closed')
      .map(row => ({
        agendaId: row.agendaId,
        startTime: row.startTime.trim(),
        endTime: row.endTime.trim(),
      }))

    const rowsToPersist = candidateRowsToPersist.filter(row => TIMECODE_PATTERN.test(row.startTime) && TIMECODE_PATTERN.test(row.endTime))
    const closureRows = closureRowsToPersist.filter(row => TIMECODE_PATTERN.test(row.startTime) && TIMECODE_PATTERN.test(row.endTime))

    if (rowsToPersist.length !== candidateRowsToPersist.length) {
      throw new Error('Some timeline rows still have invalid time format. Please review the rows that still use transcription.')
    }
    if (closureRows.length !== closureRowsToPersist.length) {
      throw new Error('Some No Transcription rows are missing valid time ranges. Toggle them again or review the timeline before continuing.')
    }

    const result = await confirmAgendaSegmentationRequest(meetingId, {
      transcriptId: previewTranscriptId,
      rows: rowsToPersist,
      closureRows,
    })

    onTimelineSaved?.(toTimelineRows(editableRows))
    setSavedTimelineSignature(editableRowsSignature)

    return result
  }

  async function handleGenerate(config: GenerateConfig) {
    const rulesToPersist = (config.meetingRulesPrompt || config.highlightPrompt || '').trim()

    if (config.useTeamsTranscription) {
      const shouldReuseSavedTimeline =
        intent === 'generate'
        &&
        hasSavedTimeline
        && !config.transcriptFile
        && editableRows.length === 0
        && !previewTranscriptId

      if (shouldReuseSavedTimeline) {
        setGenerating(true)
        try {
          await saveMeetingRulesRequest(meetingId, rulesToPersist)

          const missingFormattingMessage = getMissingFormattingMessage()
          if (missingFormattingMessage) {
            toast.error(missingFormattingMessage)
            return
          }

          const started = await onStartGeneration({
            agendas: queueAgendas,
            generationConfig: {
              useTeamsTranscription: true,
              speakerMatchMethod: config.speakerMatchMethod,
              transcriptId: activeTranscriptId,
              languages: config.languages,
              agendaDeviationPrompt: config.agendaDeviationPrompt,
              meetingRulesPrompt: config.meetingRulesPrompt,
              highlightPrompt: config.highlightPrompt,
              excludeDeckPoints: config.excludeDeckPoints,
              requireCompleteFormatting: true,
              skippedAgendaIds,
              forcedResolvedOutcomeModes: forcedResolvedOutcomeModesFromSavedTimeline,
            },
          })

          if (started) {
            toast.success('Draft MoM generation started using the saved transcript timeline.')
            onGenerationStarted?.()
          }
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'Failed to generate minutes')
        } finally {
          setGenerating(false)
        }
        return
      }

      if (editableRows.length > 0 || previewTranscriptId) {
        toast.error('Review the transcript timeline preview below, then save timestamps or generate MoM there.')
        return
      }

      if (config.transcriptFile || hasTranscriptAvailable) {
        toast.error('Analyze Transcript first to build the timeline preview before generating draft minutes.')
      } else {
        toast.error('Attach a Microsoft Teams transcript first, or use a saved transcript.')
      }
      return
    }

    setGenerating(true)
    try {
      await saveMeetingRulesRequest(meetingId, rulesToPersist)
      const missingFormattingMessage = getMissingFormattingMessage()
      if (missingFormattingMessage) {
        toast.error(missingFormattingMessage)
        return
      }

      let runTranscriptId = activeTranscriptId
      const fileToUpload = config.recordingFile || config.transcriptFile
      if (fileToUpload) {
        runTranscriptId = await ensureTranscriptUploaded(fileToUpload)
      }

      const generationConfig: GenerationConfig = {
        useTeamsTranscription: config.useTeamsTranscription,
        speakerMatchMethod: config.speakerMatchMethod,
        transcriptId: runTranscriptId,
        languages: config.languages,
        agendaDeviationPrompt: config.agendaDeviationPrompt,
        meetingRulesPrompt: config.meetingRulesPrompt,
        highlightPrompt: config.highlightPrompt,
        excludeDeckPoints: config.excludeDeckPoints,
        requireCompleteFormatting: true,
        skippedAgendaIds,
        forcedResolvedOutcomeModes: {},
      }

      const started = await onStartGeneration({
        agendas: queueAgendas,
        generationConfig,
      })

      if (started) {
        toast.success('Draft generation started. Follow the agenda progress below.')
        setEditableRows([])
        setPreviewWarnings([])
        setPreviewTranscriptId(null)
        onGenerationStarted?.()
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to generate minutes')
    } finally {
      setGenerating(false)
    }
  }

  async function handleRegenerateTranscript(config: GenerateConfig) {
    await handleAnalyzeTranscript(config, 'regenerate')
  }

  async function handleAnalyzeTranscript(config: GenerateConfig, mode: 'analyze' | 'regenerate' = 'analyze') {
    setAnalyzing(true)
    try {
      const rulesToPersist = (config.meetingRulesPrompt || config.highlightPrompt || '').trim()
      await saveMeetingRulesRequest(meetingId, rulesToPersist)

      let transcriptId = activeTranscriptId
      if (config.transcriptFile) {
        transcriptId = await ensureTranscriptUploaded(config.transcriptFile)
      }

      if (!transcriptId && !hasExistingTranscript) {
        throw new Error('Attach a Microsoft transcript file first, or upload one in Step 2.')
      }

      await runTeamsAnalysis({
        ...config,
        useTeamsTranscription: true,
        speakerMatchMethod: 'teams_transcript',
      }, transcriptId)
      toast.success(
        mode === 'regenerate'
          ? 'Transcript timeline regenerated. Review and save the new mapping here.'
          : 'Timeline preview generated. Review and confirm to generate draft minutes.',
      )
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : mode === 'regenerate'
            ? 'Failed to regenerate transcript timeline'
            : 'Failed to analyze transcript timeline',
      )
    } finally {
      setAnalyzing(false)
    }
  }

  async function handleReanalyze() {
    if (!lastConfig) return
    setAnalyzing(true)
    try {
      await runTeamsAnalysis(lastConfig, previewTranscriptId ?? activeTranscriptId)
      toast.success('Timeline re-analyzed')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to re-analyze timeline')
    } finally {
      setAnalyzing(false)
    }
  }

  function handleAddRow() {
    const agendaId = agendaOptions[0]?.id
    if (!agendaId) return
    const previousEnd = editableRows.length > 0
      ? parseTimecodeToSeconds(editableRows[editableRows.length - 1].endTime) ?? 0
      : 0
    setEditableRows(prev => [...prev, {
      id: crypto.randomUUID(),
      agendaId,
      startTime: formatSecondsToTimecode(previousEnd),
      endTime: formatSecondsToTimecode(previousEnd + 30),
      confidence: 0.5,
      reason: 'Added manually',
      forcedResolvedOutcomeMode: null,
      mappingStatus: 'suggested',
      requiresReview: false,
      transcriptionSnapshot: null,
    }])
  }

  function resolveRowReview(rowId: string) {
    setEditableRows(prev => prev.map(row => {
      if (row.id !== rowId) return row
      if (!row.startTime.trim() || !row.endTime.trim()) return row
      return {
        ...row,
        requiresReview: false,
      }
    }))
    setRowErrors(prev => ({ ...prev, [rowId]: '' }))
  }

  function markRowClosureOnly(rowId: string) {
    setEditableRows(prev => prev.map(row => {
      if (row.id !== rowId) return row
      if (row.forcedResolvedOutcomeMode === 'closed') {
        const snapshot = row.transcriptionSnapshot
        return {
          ...row,
          forcedResolvedOutcomeMode: null,
          startTime: snapshot?.startTime ?? row.startTime,
          endTime: snapshot?.endTime ?? row.endTime,
          confidence: snapshot?.confidence ?? row.confidence,
          reason: snapshot?.reason ?? '',
          mappingStatus: snapshot?.mappingStatus ?? row.mappingStatus,
          requiresReview: snapshot?.requiresReview ?? false,
          transcriptionSnapshot: null,
        }
      }

      const nextTimeRange = createClosureOnlyTimeRange(prev, rowId)
      const preservedStartTime = row.startTime.trim() || nextTimeRange.startTime
      const preservedEndTime = row.endTime.trim() || nextTimeRange.endTime
      return {
        ...row,
        startTime: preservedStartTime,
        endTime: preservedEndTime,
        forcedResolvedOutcomeMode: 'closed',
        requiresReview: false,
        mappingStatus: row.mappingStatus === 'explicit' ? 'explicit' : 'suggested',
        reason: 'Marked No Transcription for quick approval / noting with no discussed section.',
        confidence: Math.max(row.confidence, 0.5),
        transcriptionSnapshot: {
          startTime: preservedStartTime,
          endTime: preservedEndTime,
          confidence: row.confidence,
          reason: row.reason,
          mappingStatus: row.mappingStatus,
          requiresReview: row.requiresReview,
        },
      }
    }))
    setRowErrors(prev => ({ ...prev, [rowId]: '' }))
  }

  async function handleSaveTimestamp() {
    setSavingTimeline(true)
    try {
      const result = await persistTimelineRows()
      toast.success(`Timestamps saved (${result.savedSegmentCount} transcript cue${result.savedSegmentCount === 1 ? '' : 's'}). You can keep editing or generate MoM next.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save timestamps')
    } finally {
      setSavingTimeline(false)
    }
  }

  async function handleConfirmGenerate() {
    if (!previewTranscriptId || !lastConfig) {
      toast.error('Analyze transcript first')
      return
    }

    const missingFormattingMessage = getMissingFormattingMessage()
    if (missingFormattingMessage) {
      toast.error(missingFormattingMessage)
      return
    }

    setConfirming(true)
    try {
      const result = await persistTimelineRows()

      const started = await onStartGeneration({
        agendas: queueAgendas,
        generationConfig: {
          useTeamsTranscription: true,
          speakerMatchMethod: lastConfig.speakerMatchMethod,
          languages: lastConfig.languages,
          transcriptId: previewTranscriptId,
          agendaDeviationPrompt: lastConfig.agendaDeviationPrompt,
          meetingRulesPrompt: lastConfig.meetingRulesPrompt,
          highlightPrompt: lastConfig.highlightPrompt,
          excludeDeckPoints: lastConfig.excludeDeckPoints,
          requireCompleteFormatting: true,
          skippedAgendaIds,
          forcedResolvedOutcomeModes: buildForcedResolvedOutcomeModes(editableRows),
        },
      })

      if (started) {
        setEditableRows([])
        setPreviewWarnings([])
        setPreviewTranscriptId(null)
        setSavedTimelineSignature('')
        toast.success(`Timeline saved (${result.savedSegmentCount} transcript cue${result.savedSegmentCount === 1 ? '' : 's'}). Draft generation started.`)
        onGenerationStarted?.()
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to confirm and generate')
    } finally {
      setConfirming(false)
    }
  }

  return (
    <div className="space-y-6">
      <GenerateForm
        onGenerate={handleGenerate}
        onAnalyzeTranscript={handleAnalyzeTranscript}
        onRegenerateTranscript={handleRegenerateTranscript}
        isPending={isPending}
        initialMeetingRules={initialMeetingRules}
        hasSavedTimeline={hasSavedTimeline}
        preferTeamsTranscription={hasSavedTimeline}
        savedTimelineAction={intent === 'rearrange' ? 'reanalyze' : 'generate'}
        isGenerateDisabled={isGenerateDisabled}
        generateDisabledReason={generateDisabledReason}
        primaryActionMode={intent === 'rearrange' ? 'analyze' : 'generate'}
      />

      {editableRows.length > 0 && (
        <div className="space-y-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h4 className="text-sm font-semibold">Agenda Timeline Preview</h4>
              <p className="text-xs text-zinc-500">
                Review and edit timeline rows before generating MoM
              </p>
            </div>
            <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-4 lg:w-auto">
              <Button
                variant="outline"
                size="sm"
                onClick={() => { void handleReanalyze() }}
                disabled={analyzing || confirming || generationState.isGenerating}
                className="gap-1.5"
              >
                <RefreshCcw className="h-3.5 w-3.5" />
                Re-analyze
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleAddRow}
                disabled={confirming || generationState.isGenerating}
                className="gap-1.5"
              >
                <Plus className="h-3.5 w-3.5" />
                Add row
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { void handleSaveTimestamp() }}
                disabled={
                  savingTimeline
                  || analyzing
                  || confirming
                  || generationState.isGenerating
                  || !previewTranscriptId
                  || hasPendingReview
                  || !hasUnsavedTimelineChanges
                }
                className="gap-1.5"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {savingTimeline ? 'Saving...' : 'Save timestamp'}
              </Button>
              <Button
                size="sm"
                onClick={() => { void handleConfirmGenerate() }}
                disabled={confirming || savingTimeline || analyzing || generationState.isGenerating || hasPendingReview}
                className="gap-1.5"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {confirming ? 'Preparing...' : 'Generate MoM'}
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            {hasSavedPreviewTimeline ? (
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
                Timestamp saved. You can still edit before generating MoM.
              </span>
            ) : hasUnsavedTimelineChanges ? (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                Timestamp changes not saved yet.
              </span>
            ) : null}
            {hasPendingReview ? (
              <span className="rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-orange-700 dark:border-orange-800 dark:bg-orange-950/30 dark:text-orange-200">
                {rowsNeedingReview.length} row{rowsNeedingReview.length === 1 ? '' : 's'} still need review or acceptance.
              </span>
            ) : null}
            {editableRows.some(row => row.forcedResolvedOutcomeMode === 'closed') ? (
              <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-sky-700 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-200">
                No Transcription rows will generate without a DISCUSSED section.
              </span>
            ) : null}
          </div>

          {previewWarnings.length > 0 && (
            <div className="space-y-1 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-200">
              {previewWarnings.map((warning, index) => (
                <p key={`${warning}-${index}`}>- {warning}</p>
              ))}
            </div>
          )}

          <div className="space-y-3">
            {editableRows.map(row => {
              const agenda = agendaMap.get(row.agendaId)
              const mappingLabel = row.mappingStatus === 'explicit'
                ? 'Explicit anchor'
                : row.mappingStatus === 'suggested'
                  ? 'Suggested'
                  : row.mappingStatus === 'semantic'
                    ? 'Semantic fill'
                    : 'Unresolved'
              return (
                <div
                  key={row.id}
                  className={`space-y-2 rounded-md border p-3 ${
                    row.requiresReview
                      ? row.mappingStatus === 'unresolved'
                        ? 'border-red-200 bg-red-50/50 dark:border-red-800/70 dark:bg-red-950/20'
                        : 'border-amber-200 bg-amber-50/40 dark:border-amber-800/70 dark:bg-amber-950/20'
                      : 'border-zinc-200 dark:border-zinc-700'
                  }`}
                >
                  <div className="grid gap-2 md:grid-cols-[1fr_130px_130px_auto]">
                    <select
                      value={row.agendaId}
                      onChange={(event) => {
                        setEditableRows(prev => prev.map(item => (
                          item.id === row.id
                            ? {
                                ...item,
                              agendaId: event.target.value,
                                requiresReview: false,
                                forcedResolvedOutcomeMode: item.forcedResolvedOutcomeMode,
                                mappingStatus: item.mappingStatus === 'explicit' ? 'explicit' : 'suggested',
                              }
                            : item
                        )))
                        setRowErrors(prev => ({ ...prev, [row.id]: '' }))
                      }}
                      className="h-9 rounded-md border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                    >
                      {agendaOptions.map(option => (
                        <option key={option.id} value={option.id}>
                          {option.agenda_no} - {option.title}
                        </option>
                      ))}
                    </select>
                    <input
                      value={row.startTime}
                      onChange={(event) => {
                        setEditableRows(prev => prev.map(item => (
                          item.id === row.id
                            ? {
                                ...item,
                                startTime: event.target.value,
                                requiresReview: false,
                                forcedResolvedOutcomeMode: item.forcedResolvedOutcomeMode,
                                mappingStatus: item.mappingStatus === 'explicit' ? 'explicit' : 'suggested',
                              }
                            : item
                        )))
                        setRowErrors(prev => ({ ...prev, [row.id]: '' }))
                      }}
                      placeholder="00:00:30"
                      disabled={row.forcedResolvedOutcomeMode === 'closed'}
                      className={`h-9 rounded-md border border-zinc-300 px-2 text-sm tabular-nums dark:border-zinc-700 ${
                        row.forcedResolvedOutcomeMode === 'closed'
                          ? 'cursor-not-allowed bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500'
                          : 'bg-white dark:bg-zinc-900'
                      }`}
                    />
                    <input
                      value={row.endTime}
                      onChange={(event) => {
                        setEditableRows(prev => prev.map(item => (
                          item.id === row.id
                            ? {
                                ...item,
                                endTime: event.target.value,
                                requiresReview: false,
                                forcedResolvedOutcomeMode: item.forcedResolvedOutcomeMode,
                                mappingStatus: item.mappingStatus === 'explicit' ? 'explicit' : 'suggested',
                              }
                            : item
                        )))
                        setRowErrors(prev => ({ ...prev, [row.id]: '' }))
                      }}
                      placeholder="00:01:30"
                      disabled={row.forcedResolvedOutcomeMode === 'closed'}
                      className={`h-9 rounded-md border border-zinc-300 px-2 text-sm tabular-nums dark:border-zinc-700 ${
                        row.forcedResolvedOutcomeMode === 'closed'
                          ? 'cursor-not-allowed bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500'
                          : 'bg-white dark:bg-zinc-900'
                      }`}
                    />
                    <div className="flex gap-2">
                      {row.requiresReview && row.startTime.trim() && row.endTime.trim() ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => resolveRowReview(row.id)}
                          className="h-9 px-3"
                        >
                          Accept
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        variant={row.forcedResolvedOutcomeMode === 'closed' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => markRowClosureOnly(row.id)}
                        className="h-9 px-3"
                      >
                        {row.forcedResolvedOutcomeMode === 'closed' ? 'Use Transcription' : 'No Transcription'}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setEditableRows(prev => prev.filter(item => item.id !== row.id))}
                        className="h-9 px-3"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <p className="text-xs text-zinc-500">
                    <span className="font-semibold text-zinc-700 dark:text-zinc-200">{mappingLabel}</span>
                    {row.forcedResolvedOutcomeMode === 'closed' ? (
                      <>
                        {' - '}
                        <span className="font-semibold text-sky-700 dark:text-sky-300">No Transcription</span>
                      </>
                    ) : null}
                    {' - '}
                    {agenda?.agenda_no ?? 'Agenda'}
                    {row.forcedResolvedOutcomeMode === 'closed' ? (
                      <>
                        {' - '}
                        timeline ignored
                      </>
                    ) : (
                      <>
                        {' - '}
                        {row.startTime || 'Needs review'}
                        {' - '}
                        {row.endTime || 'Needs review'}
                      </>
                    )}
                    {row.reason ? ` - ${row.reason}` : ''}
                    {Number.isFinite(row.confidence) ? ` - confidence ${Math.round(row.confidence * 100)}%` : ''}
                  </p>
                  {rowErrors[row.id] && (
                    <p className="text-xs text-red-600 dark:text-red-400">{rowErrors[row.id]}</p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
