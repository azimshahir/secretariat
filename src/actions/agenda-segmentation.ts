'use server'

import { generateObject } from 'ai'
import { z } from 'zod'
import { getEffectiveAiConfigForOrganization, resolveLanguageModelForOrganization } from '@/lib/ai/model-config'
import { createClient } from '@/lib/supabase/server'
import { buildPromptAgendaTimelineSegmentation } from '@/lib/ai/prompts'
import {
  formatSecondsToTimecode,
  parseTimecodeToSeconds,
  parseTranscriptTimelineFromFile,
  type TranscriptTimelineCue,
} from '@/lib/transcript-timeline'
import {
  analyzeAgendaSegmentationOptionsSchema,
  confirmAgendaSegmentationInputSchema,
  uuidSchema,
} from '@/lib/validation'

interface AgendaRow {
  id: string
  agenda_no: string
  title: string
}

export interface SegmentationPreviewRow {
  agendaId: string
  agendaNo: string
  agendaTitle: string
  startSec: number
  endSec: number
  confidence: number
  reason: string
}

export interface SegmentationPreviewResult {
  transcriptId: string
  rows: SegmentationPreviewRow[]
  warnings: string[]
  durationSec: number
}

export interface ConfirmSegmentationResult {
  savedSegmentCount: number
}

const llmAgendaSegmentationSchema = z.object({
  items: z.array(z.object({
    agendaId: z.string().min(1),
    startSec: z.number(),
    endSec: z.number(),
    confidence: z.number().min(0).max(1),
    reason: z.string().max(400),
  })),
})

function buildTimelinePromptText(cues: TranscriptTimelineCue[]) {
  return cues
    .map(cue => `[${formatSecondsToTimecode(cue.startSec)}-${formatSecondsToTimecode(cue.endSec)}] ${cue.speaker ? `${cue.speaker}: ` : ''}${cue.text}`)
    .join('\n')
}

function truncateTimelineForPrompt(input: string) {
  const maxChars = 120_000
  if (input.length <= maxChars) return { timeline: input, truncated: false }
  const headSize = 90_000
  const tailSize = maxChars - headSize
  return {
    timeline: `${input.slice(0, headSize)}\n...[timeline truncated for model context]...\n${input.slice(-tailSize)}`,
    truncated: true,
  }
}

function isMissingMeetingRulesColumn(error: { code?: string | null; message?: string | null } | null | undefined) {
  if (!error) return false
  if (error.code === 'PGRST204') return true
  const message = (error.message ?? '').toLowerCase()
  return message.includes('meeting_rules') && message.includes('schema cache')
}

async function requireMeetingContext(meetingId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()
  if (!profile) throw new Error('Profile not found')

  let { data: meeting, error: meetingError } = await supabase
    .from('meetings')
    .select('id, title, organization_id, meeting_rules')
    .eq('id', meetingId)
    .single()
  if (meetingError && isMissingMeetingRulesColumn(meetingError)) {
    const fallback = await supabase
      .from('meetings')
      .select('id, title, organization_id')
      .eq('id', meetingId)
      .single()
    meeting = fallback.data
      ? { ...fallback.data, meeting_rules: '' }
      : null
    meetingError = fallback.error
  }
  if (meetingError) throw new Error(meetingError.message)
  if (!meeting || meeting.organization_id !== profile.organization_id) {
    throw new Error('Meeting not found or inaccessible')
  }

  return {
    supabase,
    meetingTitle: meeting.title,
    organizationId: meeting.organization_id as string,
    meetingRules: typeof meeting.meeting_rules === 'string' ? meeting.meeting_rules : '',
  }
}

function resolveMeetingRulesPrompt(
  options: z.infer<typeof analyzeAgendaSegmentationOptionsSchema>,
  fallback: string,
) {
  const canonical = options.meetingRulesPrompt?.trim()
  if (canonical) return canonical

  const legacy = options.highlightPrompt?.trim()
  if (legacy) return legacy

  const fromMeeting = fallback.trim()
  if (fromMeeting) return fromMeeting

  return undefined
}

async function loadTimelineFromStoredTranscript(
  supabase: Awaited<ReturnType<typeof createClient>>,
  meetingId: string,
  explicitTranscriptId?: string | null,
) {
  let transcriptQuery = supabase
    .from('transcripts')
    .select('id, storage_path')
    .eq('meeting_id', meetingId)
    .order('created_at', { ascending: false })
    .limit(1)

  if (explicitTranscriptId) {
    transcriptQuery = supabase
      .from('transcripts')
      .select('id, storage_path')
      .eq('id', explicitTranscriptId)
      .eq('meeting_id', meetingId)
      .limit(1)
  }

  const { data: transcriptRows, error: transcriptError } = await transcriptQuery
  if (transcriptError) throw new Error(transcriptError.message)

  const transcript = transcriptRows?.[0]
  if (!transcript) throw new Error('No transcript found. Upload Microsoft Teams transcript first.')
  if (!transcript.storage_path) {
    throw new Error('Timestamped transcript source is unavailable. Please re-upload VTT/DOCX Teams transcript.')
  }

  const { data: blob, error: fileError } = await supabase.storage
    .from('meeting-files')
    .download(transcript.storage_path)
  if (fileError || !blob) {
    throw new Error(fileError?.message ?? 'Failed to download transcript source file')
  }

  const ext = transcript.storage_path.split('.').pop() ?? 'docx'
  const file = new File([blob], `transcript.${ext}`, { type: blob.type || 'application/octet-stream' })
  const cues = await parseTranscriptTimelineFromFile(file)
  return { transcriptId: transcript.id, cues }
}

async function getTargetAgendas(
  supabase: Awaited<ReturnType<typeof createClient>>,
  meetingId: string,
) {
  const { data: agendaRows, error } = await supabase
    .from('agendas')
    .select('id, agenda_no, title, is_skipped')
    .eq('meeting_id', meetingId)
    .order('sort_order')
  if (error) throw new Error(error.message)
  if (!agendaRows || agendaRows.length === 0) throw new Error('No agendas found in this meeting')

  const allAgendas = agendaRows as (AgendaRow & { is_skipped?: boolean })[]
  return {
    allAgendas: allAgendas as AgendaRow[],
    targetAgendas: allAgendas.filter(a => !a.is_skipped) as AgendaRow[],
  }
}

function normalizePreviewRows(
  items: z.infer<typeof llmAgendaSegmentationSchema>['items'],
  targetAgendas: AgendaRow[],
  durationSec: number,
) {
  const warnings: string[] = []
  const agendaMap = new Map(targetAgendas.map(agenda => [agenda.id, agenda]))
  const agendaOrder = new Map(targetAgendas.map((agenda, index) => [agenda.id, index]))
  const bestByAgendaId = new Map<string, {
    agendaId: string
    startSec: number
    endSec: number
    confidence: number
    reason: string
  }>()

  for (const item of items) {
    if (!agendaMap.has(item.agendaId)) continue
    const startSec = Math.max(0, Math.floor(item.startSec))
    const endSec = Math.min(durationSec, Math.ceil(item.endSec))
    if (endSec <= startSec) continue

    const current = bestByAgendaId.get(item.agendaId)
    const next = {
      agendaId: item.agendaId,
      startSec,
      endSec,
      confidence: item.confidence ?? 0.5,
      reason: (item.reason ?? '').trim(),
    }

    if (!current || next.confidence > current.confidence) {
      bestByAgendaId.set(item.agendaId, next)
    }
  }

  const safeDuration = Math.max(durationSec, targetAgendas.length * 30, 60)
  const estimatedByAgendaId = new Map<string, {
    agendaId: string
    startSec: number
    endSec: number
    confidence: number
    reason: string
  }>()

  targetAgendas.forEach((agenda, index) => {
    const startSec = Math.floor((index * safeDuration) / targetAgendas.length)
    const nextBoundary = Math.floor(((index + 1) * safeDuration) / targetAgendas.length)
    const endSec = Math.max(startSec + 30, nextBoundary)
    estimatedByAgendaId.set(agenda.id, {
      agendaId: agenda.id,
      startSec,
      endSec,
      confidence: 0.2,
      reason: 'Best-effort inferred from timeline progression (no explicit agenda marker).',
    })
  })

  const coveredByLlm = new Set(bestByAgendaId.keys())
  const missing = targetAgendas.filter(agenda => !coveredByLlm.has(agenda.id))
  if (bestByAgendaId.size === 0) {
    warnings.push('AI did not find explicit agenda boundaries. Generated best-effort timeline for all agendas.')
  } else if (missing.length > 0) {
    warnings.push(`AI had low certainty for ${missing.length} agenda(s). Filled remaining rows with best-effort timeline inference.`)
  }

  const mergedRows = targetAgendas
    .map(agenda => {
      const llm = bestByAgendaId.get(agenda.id)
      if (llm) return llm
      return estimatedByAgendaId.get(agenda.id)!
    })
    .sort((a, b) => {
      if (a.startSec !== b.startSec) return a.startSec - b.startSec
      return (agendaOrder.get(a.agendaId) ?? 0) - (agendaOrder.get(b.agendaId) ?? 0)
    })

  const nonOverlapping: SegmentationPreviewRow[] = []
  for (const row of mergedRows) {
    const previous = nonOverlapping[nonOverlapping.length - 1]
    let adjustedStart = row.startSec
    if (previous && adjustedStart < previous.endSec) {
      adjustedStart = previous.endSec
      warnings.push(`Adjusted overlap between agenda ${previous.agendaNo} and ${agendaMap.get(row.agendaId)?.agenda_no ?? row.agendaId}.`)
    }
    let adjustedEnd = row.endSec
    if (adjustedEnd <= adjustedStart) adjustedEnd = adjustedStart + 30
    const agenda = agendaMap.get(row.agendaId)
    if (!agenda) continue
    nonOverlapping.push({
      agendaId: row.agendaId,
      agendaNo: agenda.agenda_no,
      agendaTitle: agenda.title,
      startSec: adjustedStart,
      endSec: adjustedEnd,
      confidence: row.confidence,
      reason: row.reason,
    })
  }

  return { rows: nonOverlapping, warnings }
}

function validateNoOverlap(rows: Array<{ agendaId: string; startSec: number; endSec: number }>) {
  const sorted = [...rows].sort((a, b) => a.startSec - b.startSec)
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1]
    const current = sorted[i]
    if (current.startSec < prev.endSec) {
      throw new Error(`Timeline overlap detected between rows for agendas ${prev.agendaId} and ${current.agendaId}.`)
    }
  }
}

export async function analyzeAgendaSegmentation(
  meetingId: string,
  options: z.infer<typeof analyzeAgendaSegmentationOptionsSchema>,
): Promise<SegmentationPreviewResult> {
  const parsedMeetingId = uuidSchema.parse(meetingId)
  const parsedOptions = analyzeAgendaSegmentationOptionsSchema.parse(options)
  if (!parsedOptions.useTeamsTranscription) {
    throw new Error('Timeline analysis is only available for Microsoft transcription mode.')
  }

  const { supabase, meetingTitle, organizationId, meetingRules } = await requireMeetingContext(parsedMeetingId)
  const { targetAgendas } = await getTargetAgendas(supabase, parsedMeetingId)
  const { transcriptId, cues } = await loadTimelineFromStoredTranscript(
    supabase,
    parsedMeetingId,
    parsedOptions.transcriptId ?? undefined,
  )

  const durationSec = cues[cues.length - 1]?.endSec ?? 0
  const rawTimeline = buildTimelinePromptText(cues)
  const { timeline, truncated } = truncateTimelineForPrompt(rawTimeline)

  const prompt = buildPromptAgendaTimelineSegmentation({
    meetingTitle,
    agendaList: targetAgendas.map(agenda => ({
      id: agenda.id,
      agendaNo: agenda.agenda_no,
      title: agenda.title,
    })),
    timeline,
    agendaDeviationNote: parsedOptions.agendaDeviationPrompt || undefined,
    meetingRulesPrompt: resolveMeetingRulesPrompt(parsedOptions, meetingRules),
  })

  const effectiveAi = await getEffectiveAiConfigForOrganization(organizationId)
  let object: z.infer<typeof llmAgendaSegmentationSchema>
  try {
    const result = await generateObject({
      model: await resolveLanguageModelForOrganization(organizationId),
      schema: llmAgendaSegmentationSchema,
      prompt,
    })
    object = result.object
  } catch (error) {
    if (process.env.NODE_ENV !== 'production' && effectiveAi.provider === 'openai') {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[Agenda Segmentation] OpenAI structured output failed', {
        provider: effectiveAi.provider,
        model: effectiveAi.model,
        error: message,
      })
    }
    throw error
  }

  const normalized = normalizePreviewRows(object.items, targetAgendas, durationSec)
  const warnings = [...normalized.warnings]
  if (truncated) {
    warnings.unshift('Transcript timeline was truncated for model context. Re-run with shorter transcript if mapping looks incomplete.')
  }

  return {
    transcriptId,
    rows: normalized.rows,
    warnings,
    durationSec,
  }
}

export async function confirmAgendaSegmentation(
  input: z.infer<typeof confirmAgendaSegmentationInputSchema>,
): Promise<ConfirmSegmentationResult> {
  const parsed = confirmAgendaSegmentationInputSchema.parse(input)
  const { supabase } = await requireMeetingContext(parsed.meetingId)

  const { allAgendas } = await getTargetAgendas(supabase, parsed.meetingId)
  const agendaMap = new Map(allAgendas.map(agenda => [agenda.id, agenda]))
  const { cues } = await loadTimelineFromStoredTranscript(supabase, parsed.meetingId, parsed.transcriptId)
  const durationSec = cues[cues.length - 1]?.endSec ?? 0

  const normalizedRows = parsed.rows.map((row, index) => {
    if (!agendaMap.has(row.agendaId)) {
      throw new Error(`Row ${index + 1} references an agenda outside this meeting.`)
    }

    const startSec = parseTimecodeToSeconds(row.startTime)
    const endSec = parseTimecodeToSeconds(row.endTime)
    if (startSec === null || endSec === null) {
      throw new Error(`Row ${index + 1} has invalid timecode format. Use HH:MM:SS.`)
    }
    if (endSec <= startSec) {
      throw new Error(`Row ${index + 1} has invalid range: end time must be after start time.`)
    }
    if (startSec >= durationSec) {
      throw new Error(`Row ${index + 1} starts after transcript duration.`)
    }

    return {
      agendaId: row.agendaId,
      startSec,
      endSec: Math.min(endSec, durationSec),
    }
  }).filter(row => row.endSec > row.startSec)

  if (normalizedRows.length === 0) {
    throw new Error('No valid timeline rows to confirm.')
  }

  validateNoOverlap(normalizedRows)

  const { error: deleteError } = await supabase
    .from('transcript_segments')
    .delete()
    .eq('transcript_id', parsed.transcriptId)
  if (deleteError) throw new Error(deleteError.message)

  const nextSortByAgenda = new Map<string, number>()
  const inserts: Array<{
    transcript_id: string
    agenda_id: string
    content: string
    speaker: string | null
    start_offset: number
    end_offset: number
    sort_order: number
  }> = []

  for (const row of normalizedRows.sort((a, b) => a.startSec - b.startSec)) {
    const selectedCues = cues
      .filter(cue => cue.endSec > row.startSec && cue.startSec < row.endSec)
      .sort((a, b) => a.sortOrder - b.sortOrder)
    if (selectedCues.length === 0) continue

    for (const cue of selectedCues) {
      const content = cue.text.trim()
      if (!content) continue

      const startOffset = Math.max(row.startSec, cue.startSec)
      const endOffset = Math.min(row.endSec, cue.endSec)
      if (endOffset <= startOffset) continue

      const sortOrder = nextSortByAgenda.get(row.agendaId) ?? 0
      inserts.push({
        transcript_id: parsed.transcriptId,
        agenda_id: row.agendaId,
        content,
        speaker: cue.speaker,
        start_offset: startOffset,
        end_offset: endOffset,
        sort_order: sortOrder,
      })
      nextSortByAgenda.set(row.agendaId, sortOrder + 1)
    }
  }

  if (inserts.length === 0) {
    throw new Error('No transcript cues matched the selected ranges. Please adjust the timeline rows.')
  }

  const { error: insertError } = await supabase
    .from('transcript_segments')
    .insert(inserts)
  if (insertError) throw new Error(insertError.message)

  return {
    savedSegmentCount: inserts.length,
  }
}
