'use client'

import { useMemo, useState } from 'react'
import { Plus, RefreshCcw, Sparkles, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { GenerateForm, type GenerateConfig } from './generate-form'
import { uploadTranscript } from '@/actions/file-upload/transcript'
import type { GenerationConfig } from '@/actions/ai-generate'
import { analyzeAgendaSegmentation, confirmAgendaSegmentation } from '@/actions/agenda-segmentation'
import { formatSecondsToTimecode, parseTimecodeToSeconds } from '@/lib/timecode'
import type { Agenda } from '@/lib/supabase/types'
import { saveMeetingRules } from './meeting-rules-actions'
import type { MomGenerationState, StartMomGenerationOptions } from './use-mom-generation-queue'
import type { AgendaTimelineRow } from './agenda-timeline-row'

interface EditablePreviewRow {
  id: string
  agendaId: string
  startTime: string
  endTime: string
  confidence: number
  reason: string
}

interface MeetingGenerationWorkflowProps {
  meetingId: string
  existingAgendas: Agenda[]
  hasExistingTranscript: boolean
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
  const [activeTranscriptId, setActiveTranscriptId] = useState<string | null>(null)
  const [lastConfig, setLastConfig] = useState<GenerateConfig | null>(null)
  const [previewTranscriptId, setPreviewTranscriptId] = useState<string | null>(null)
  const [previewWarnings, setPreviewWarnings] = useState<string[]>([])
  const [editableRows, setEditableRows] = useState<EditablePreviewRow[]>([])
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})

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
  const hasTranscriptAvailable = hasExistingTranscript || Boolean(activeTranscriptId)

  function toEditableRows(rows: Array<{
    agendaId: string
    startSec: number
    endSec: number
    confidence: number
    reason: string
  }>): EditablePreviewRow[] {
    return rows.map(row => ({
      id: crypto.randomUUID(),
      agendaId: row.agendaId,
      startTime: formatSecondsToTimecode(row.startSec),
      endTime: formatSecondsToTimecode(row.endSec),
      confidence: row.confidence,
      reason: row.reason,
    }))
  }

  function toTimelineRows(rows: EditablePreviewRow[]): AgendaTimelineRow[] {
    return rows.map(row => {
      const agenda = agendaMap.get(row.agendaId)
      return {
        agendaId: row.agendaId,
        agendaNo: agenda?.agenda_no ?? 'Agenda',
        agendaTitle: agenda?.title ?? row.agendaId,
        startTime: row.startTime,
        endTime: row.endTime,
        confidence: row.confidence,
        reason: row.reason || null,
      }
    })
  }

  function validateRows(rows: EditablePreviewRow[]) {
    const errors: Record<string, string> = {}
    const normalized: Array<{ id: string; agendaId: string; startSec: number; endSec: number }> = []

    for (const row of rows) {
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

  async function runTeamsAnalysis(config: GenerateConfig, transcriptId?: string | null) {
    const result = await analyzeAgendaSegmentation(meetingId, {
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
    setLastConfig(config)
  }

  async function handleGenerate(config: GenerateConfig) {
    const rulesToPersist = (config.meetingRulesPrompt || config.highlightPrompt || '').trim()

    if (config.useTeamsTranscription) {
      setAnalyzing(true)
      try {
        await saveMeetingRules(meetingId, rulesToPersist)
        if (!config.transcriptFile && !hasTranscriptAvailable) {
          throw new Error('Attach a Microsoft transcript file first, or upload one in Step 2.')
        }

        let transcriptId = activeTranscriptId
        if (config.transcriptFile) {
          const uploaded = await uploadTranscript(meetingId, config.transcriptFile)
          transcriptId = uploaded.transcriptId
          setActiveTranscriptId(uploaded.transcriptId)
        }

        await runTeamsAnalysis(config, transcriptId)
        toast.success('Timeline preview generated. Review and confirm to generate minutes.')
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to analyze transcript timeline')
      } finally {
        setAnalyzing(false)
      }
      return
    }

    setGenerating(true)
    try {
      await saveMeetingRules(meetingId, rulesToPersist)
      let runTranscriptId = activeTranscriptId
      const fileToUpload = config.recordingFile || config.transcriptFile
      if (fileToUpload) {
        const uploaded = await uploadTranscript(meetingId, fileToUpload)
        runTranscriptId = uploaded.transcriptId
        setActiveTranscriptId(uploaded.transcriptId)
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
        requireCompleteFormatting: false,
        skippedAgendaIds,
      }

      const started = await onStartGeneration({
        agendas: queueAgendas,
        generationConfig,
      })

      if (started) {
        toast.success('Generation started. Follow the agenda progress below.')
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
    }])
  }

  async function handleConfirmGenerate() {
    if (!previewTranscriptId || !lastConfig) {
      toast.error('Analyze transcript first')
      return
    }

    const validation = validateRows(editableRows)
    setRowErrors(validation.errors)
    if (!validation.valid) {
      toast.error('Please fix timeline row errors before confirming')
      return
    }

    setConfirming(true)
    try {
      const result = await confirmAgendaSegmentation({
        meetingId,
        transcriptId: previewTranscriptId,
        rows: editableRows.map(row => ({
          agendaId: row.agendaId,
          startTime: row.startTime,
          endTime: row.endTime,
        })),
      })

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
          requireCompleteFormatting: false,
          skippedAgendaIds,
        },
      })

      if (started) {
        onTimelineSaved?.(toTimelineRows(editableRows))
        setEditableRows([])
        setPreviewWarnings([])
        setPreviewTranscriptId(null)
        toast.success(`Timeline saved (${result.savedSegmentCount} transcript cue${result.savedSegmentCount === 1 ? '' : 's'}). Generation started.`)
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
        isPending={isPending}
        initialMeetingRules={initialMeetingRules}
        isGenerateDisabled={isGenerateDisabled}
        generateDisabledReason={generateDisabledReason}
      />

      {editableRows.length > 0 && (
        <div className="space-y-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold">Agenda Timeline Preview</h4>
              <p className="text-xs text-zinc-500">
                Review and edit timeline rows before generating MoM
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
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
                size="sm"
                onClick={() => { void handleConfirmGenerate() }}
                disabled={confirming || analyzing || generationState.isGenerating}
                className="gap-1.5"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {confirming ? 'Preparing...' : 'Confirm & Generate'}
              </Button>
            </div>
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
              return (
                <div key={row.id} className="space-y-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-700">
                  <div className="grid gap-2 md:grid-cols-[1fr_130px_130px_auto]">
                    <select
                      value={row.agendaId}
                      onChange={(event) => {
                        setEditableRows(prev => prev.map(item => (
                          item.id === row.id ? { ...item, agendaId: event.target.value } : item
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
                          item.id === row.id ? { ...item, startTime: event.target.value } : item
                        )))
                        setRowErrors(prev => ({ ...prev, [row.id]: '' }))
                      }}
                      placeholder="00:00:30"
                      className="h-9 rounded-md border border-zinc-300 bg-white px-2 text-sm tabular-nums dark:border-zinc-700 dark:bg-zinc-900"
                    />
                    <input
                      value={row.endTime}
                      onChange={(event) => {
                        setEditableRows(prev => prev.map(item => (
                          item.id === row.id ? { ...item, endTime: event.target.value } : item
                        )))
                        setRowErrors(prev => ({ ...prev, [row.id]: '' }))
                      }}
                      placeholder="00:01:30"
                      className="h-9 rounded-md border border-zinc-300 bg-white px-2 text-sm tabular-nums dark:border-zinc-700 dark:bg-zinc-900"
                    />
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
                  <p className="text-xs text-zinc-500">
                    {agenda?.agenda_no ?? 'Agenda'} - {row.startTime} - {row.endTime}
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
