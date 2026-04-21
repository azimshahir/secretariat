import { generateObject } from 'ai'
import { z } from 'zod'
import {
  getEffectiveAiConfigForOrganization,
  getEffectiveAiConfigForUserPlan,
  resolveLanguageModelForOrganization,
  resolveLanguageModelForUserPlan,
} from '@/lib/ai/model-config'
import { buildPromptAgendaTimelineSegmentation } from '@/lib/ai/prompts'
import {
  formatSecondsToTimecode,
  parseTimecodeToSeconds,
  parseTranscriptTimelineStructureFromFile,
  type TranscriptTimelineAnchor,
  type TranscriptTimelineStructure,
} from '@/lib/transcript-timeline'
import {
  analyzeAgendaSegmentationOptionsSchema,
  confirmAgendaSegmentationInputSchema,
  uuidSchema,
} from '@/lib/validation'
import { NO_TRANSCRIPTION_SEGMENT_MARKER } from '@/app/meeting/[id]/setup/agenda-timeline-row'
import { isMissingMeetingRulesColumn, resolveMeetingRulesPrompt, type DatabaseClient } from './shared'
import type {
  ConfirmSegmentationResult,
  SegmentationPreviewResult,
  SegmentationPreviewRow,
} from './types'

interface AgendaRow {
  id: string
  agenda_no: string
  title: string
  planned_time: string | null
  is_skipped?: boolean
}

type PreviewMappingStatus = SegmentationPreviewRow['mappingStatus']

interface DraftPreviewRow {
  agendaId: string
  agendaNo: string
  agendaTitle: string
  startSec: number | null
  endSec: number | null
  confidence: number
  reason: string
  mappingStatus: PreviewMappingStatus
  requiresReview: boolean
}

interface DeterministicRange {
  startSec: number
  endSec: number
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

function normalizeAgendaNo(value: string) {
  return value.replace(/\s+/g, '').toLowerCase()
}

function normalizeTitle(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseClockSeconds(token: string | null | undefined) {
  if (!token) return null
  const match = token.trim().match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/i)
  if (!match) return null

  let hours = Number(match[1] ?? 0)
  const minutes = Number(match[2] ?? 0)
  const seconds = Number(match[3] ?? 0)
  const meridiem = (match[4] ?? '').toLowerCase().replace(/\./g, '')
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return null
  }
  if (minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) {
    return null
  }

  if (meridiem === 'am') {
    if (hours === 12) hours = 0
  } else if (meridiem === 'pm') {
    if (hours !== 12) hours += 12
  }

  if (hours < 0 || hours >= 24) return null
  return (hours * 3600) + (minutes * 60) + seconds
}

function buildPlannedOffsets(targetAgendas: AgendaRow[]) {
  const plannedSeconds = targetAgendas
    .map(agenda => ({
      agendaId: agenda.id,
      absoluteSec: parseClockSeconds(agenda.planned_time),
    }))
    .filter((entry): entry is { agendaId: string; absoluteSec: number } => entry.absoluteSec !== null)

  if (plannedSeconds.length === 0) {
    return new Map<string, number>()
  }

  const baseline = Math.min(...plannedSeconds.map(entry => entry.absoluteSec))
  return new Map(plannedSeconds.map(entry => [entry.agendaId, entry.absoluteSec - baseline]))
}

function clampConfidence(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function buildTimelinePromptText(structure: TranscriptTimelineStructure, startSec = 0, endSec = structure.durationSec) {
  return structure.cues
    .filter(cue => cue.endSec > startSec && cue.startSec < endSec)
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

async function getMeetingContext(
  supabase: DatabaseClient,
  meetingId: string,
  organizationId: string,
) {
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
  if (!meeting || meeting.organization_id !== organizationId) {
    throw new Error('Meeting not found or inaccessible')
  }

  return {
    meetingTitle: meeting.title,
    meetingRules: typeof meeting.meeting_rules === 'string' ? meeting.meeting_rules : '',
  }
}

async function loadTimelineFromStoredTranscript(
  supabase: DatabaseClient,
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
  const structure = await parseTranscriptTimelineStructureFromFile(file)
  return { transcriptId: transcript.id, structure }
}

function agendaHasChildren(agendaNo: string, allAgendas: AgendaRow[]) {
  if (!agendaNo.endsWith('.0')) return false
  const childPrefix = agendaNo.slice(0, -1)
  return allAgendas.some(agenda => agenda.agenda_no !== agendaNo && agenda.agenda_no.startsWith(childPrefix))
}

async function getTargetAgendas(
  supabase: DatabaseClient,
  meetingId: string,
) {
  const { data: agendaRows, error } = await supabase
    .from('agendas')
    .select('id, agenda_no, title, planned_time, is_skipped')
    .eq('meeting_id', meetingId)
    .order('sort_order')
  if (error) throw new Error(error.message)
  if (!agendaRows || agendaRows.length === 0) throw new Error('No agendas found in this meeting')

  const allAgendas = agendaRows as AgendaRow[]
  const targetAgendas = allAgendas.filter(agenda => !agenda.is_skipped && !agendaHasChildren(agenda.agenda_no, allAgendas))

  return {
    allAgendas,
    targetAgendas,
  }
}

function matchExplicitAnchors(
  targetAgendas: AgendaRow[],
  anchors: TranscriptTimelineAnchor[],
) {
  const candidateAnchors = anchors
    .filter(anchor => anchor.kind === 'agenda_start' || anchor.kind === 'section_start')
    .sort((left, right) => left.startSec - right.startSec)

  const byAgendaNo = new Map<string, TranscriptTimelineAnchor[]>()
  const byTitle = new Map<string, TranscriptTimelineAnchor[]>()

  for (const anchor of candidateAnchors) {
    if (anchor.agendaNo) {
      const key = normalizeAgendaNo(anchor.agendaNo)
      const list = byAgendaNo.get(key) ?? []
      list.push(anchor)
      byAgendaNo.set(key, list)
    }
    if (anchor.title) {
      const titleKey = normalizeTitle(anchor.title)
      if (titleKey) {
        const list = byTitle.get(titleKey) ?? []
        list.push(anchor)
        byTitle.set(titleKey, list)
      }
    }
  }

  const matches = new Map<string, { anchor: TranscriptTimelineAnchor; reason: string; confidence: number }>()

  for (const agenda of targetAgendas) {
    const exactMatch = byAgendaNo
      .get(normalizeAgendaNo(agenda.agenda_no))
      ?.sort((left, right) => {
        const leftScore = (
          (left.title ? 1 : 0)
          + (normalizeTitle(left.title ?? '') === normalizeTitle(agenda.title) ? 2 : 0)
        )
        const rightScore = (
          (right.title ? 1 : 0)
          + (normalizeTitle(right.title ?? '') === normalizeTitle(agenda.title) ? 2 : 0)
        )
        if (leftScore !== rightScore) return rightScore - leftScore
        return left.startSec - right.startSec
      })[0]
    if (exactMatch) {
      matches.set(agenda.id, {
        anchor: exactMatch,
        reason: `Matched explicit transcript anchor for Agenda ${agenda.agenda_no}.`,
        confidence: 0.99,
      })
      continue
    }

    const titleMatch = byTitle.get(normalizeTitle(agenda.title))?.[0]
    if (titleMatch) {
      matches.set(agenda.id, {
        anchor: titleMatch,
        reason: `Matched transcript anchor by agenda title for Agenda ${agenda.agenda_no}.`,
        confidence: 0.96,
      })
    }
  }

  return matches
}

function findNextBoundaryAfter(
  startSec: number,
  anchors: TranscriptTimelineAnchor[],
  durationSec: number,
) {
  const boundary = anchors
    .filter(anchor => (
      (anchor.kind === 'break_start' || anchor.kind === 'meeting_end' || anchor.kind === 'agenda_start' || anchor.kind === 'section_start')
      && anchor.startSec > startSec
    ))
    .sort((left, right) => left.startSec - right.startSec)[0]

  return boundary?.startSec ?? durationSec
}

function buildExplicitRows(
  targetAgendas: AgendaRow[],
  matches: Map<string, { anchor: TranscriptTimelineAnchor; reason: string; confidence: number }>,
  anchors: TranscriptTimelineAnchor[],
  durationSec: number,
) {
  const rows = new Map<string, DraftPreviewRow>()
  const orderedMatches = targetAgendas
    .map(agenda => {
      const match = matches.get(agenda.id)
      if (!match) return null
      return {
        agenda,
        anchor: match.anchor,
        reason: match.reason,
        confidence: match.confidence,
      }
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort((left, right) => left.anchor.startSec - right.anchor.startSec)

  for (let index = 0; index < orderedMatches.length; index += 1) {
    const current = orderedMatches[index]
    const nextMatchedStart = orderedMatches[index + 1]?.anchor.startSec ?? null
    const boundedEnd = findNextBoundaryAfter(current.anchor.startSec, anchors, durationSec)
    const endSec = nextMatchedStart !== null
      ? Math.min(nextMatchedStart, boundedEnd)
      : boundedEnd

    rows.set(current.agenda.id, {
      agendaId: current.agenda.id,
      agendaNo: current.agenda.agenda_no,
      agendaTitle: current.agenda.title,
      startSec: current.anchor.startSec,
      endSec: endSec > current.anchor.startSec ? endSec : current.anchor.startSec + 30,
      confidence: current.confidence,
      reason: current.reason,
      mappingStatus: 'explicit',
      requiresReview: false,
    })
  }

  return rows
}

function buildKnownRanges(targetAgendas: AgendaRow[], rowsByAgendaId: Map<string, DraftPreviewRow>) {
  return targetAgendas
    .map((agenda, index) => ({
      agenda,
      index,
      row: rowsByAgendaId.get(agenda.id) ?? null,
    }))
    .filter((entry): entry is { agenda: AgendaRow; index: number; row: DraftPreviewRow } => Boolean(entry.row && entry.row.startSec !== null && entry.row.endSec !== null))
}

function getGapBoundary(
  anchors: TranscriptTimelineAnchor[],
  direction: 'before' | 'after',
  referenceSec: number,
  fallbackSec: number,
) {
  const relevant = anchors
    .filter(anchor => anchor.kind === 'break_start' || anchor.kind === 'break_end' || anchor.kind === 'meeting_end')
    .filter(anchor => direction === 'before' ? anchor.startSec < referenceSec : anchor.startSec > referenceSec)
    .sort((left, right) => direction === 'before' ? right.startSec - left.startSec : left.startSec - right.startSec)[0]

  return relevant?.startSec ?? fallbackSec
}

function buildBoundedSuggestions(
  targetAgendas: AgendaRow[],
  rowsByAgendaId: Map<string, DraftPreviewRow>,
  anchors: TranscriptTimelineAnchor[],
  durationSec: number,
  plannedOffsets: Map<string, number>,
) {
  const known = buildKnownRanges(targetAgendas, rowsByAgendaId)
  const suggestions = new Map<string, DraftPreviewRow>()

  for (let index = 0; index < targetAgendas.length; ) {
    const agenda = targetAgendas[index]
    if (rowsByAgendaId.has(agenda.id)) {
      index += 1
      continue
    }

    let groupEndIndex = index
    while (groupEndIndex + 1 < targetAgendas.length && !rowsByAgendaId.has(targetAgendas[groupEndIndex + 1].id)) {
      groupEndIndex += 1
    }

    const group = targetAgendas.slice(index, groupEndIndex + 1)
    const previousKnown = [...known].reverse().find(entry => entry.index < index) ?? null
    const nextKnown = known.find(entry => entry.index > groupEndIndex) ?? null

    const leftBoundary = previousKnown?.row.endSec
      ?? getGapBoundary(anchors, 'before', nextKnown?.row.startSec ?? durationSec, 0)
    const rightBoundary = nextKnown?.row.startSec
      ?? getGapBoundary(anchors, 'after', previousKnown?.row.endSec ?? 0, durationSec)

    if (leftBoundary === null || rightBoundary === null || rightBoundary <= leftBoundary) {
      index = groupEndIndex + 1
      continue
    }

    if (group.length === 1) {
      const onlyAgenda = group[0]
      suggestions.set(onlyAgenda.id, {
        agendaId: onlyAgenda.id,
        agendaNo: onlyAgenda.agenda_no,
        agendaTitle: onlyAgenda.title,
        startSec: leftBoundary,
        endSec: rightBoundary,
        confidence: 0.58,
        reason: 'Suggested from the bounded gap between explicit transcript anchors.',
        mappingStatus: 'suggested',
        requiresReview: true,
      })
      index = groupEndIndex + 1
      continue
    }

    const groupOffsets = group
      .map(agendaRow => ({
        agenda: agendaRow,
        offset: plannedOffsets.get(agendaRow.id) ?? null,
      }))
      .filter((entry): entry is { agenda: AgendaRow; offset: number } => entry.offset !== null)

    const previousOffset = previousKnown ? plannedOffsets.get(previousKnown.agenda.id) ?? null : null
    const nextOffset = nextKnown ? plannedOffsets.get(nextKnown.agenda.id) ?? null : null

    const canProjectWithPlannedTime =
      groupOffsets.length === group.length
      && previousOffset !== null
      && nextOffset !== null
      && nextOffset > previousOffset

    if (canProjectWithPlannedTime) {
      for (let groupIndex = 0; groupIndex < group.length; groupIndex += 1) {
        const currentAgenda = group[groupIndex]
        const currentOffset = plannedOffsets.get(currentAgenda.id) ?? previousOffset
        const nextGroupAgenda = group[groupIndex + 1] ?? null
        const nextOffsetForRange = nextGroupAgenda
          ? plannedOffsets.get(nextGroupAgenda.id) ?? nextOffset
          : nextOffset

        const startSec = leftBoundary + Math.round(((currentOffset - previousOffset) / (nextOffset - previousOffset)) * (rightBoundary - leftBoundary))
        const endSec = nextGroupAgenda
          ? leftBoundary + Math.round(((nextOffsetForRange - previousOffset) / (nextOffset - previousOffset)) * (rightBoundary - leftBoundary))
          : rightBoundary

        suggestions.set(currentAgenda.id, {
          agendaId: currentAgenda.id,
          agendaNo: currentAgenda.agenda_no,
          agendaTitle: currentAgenda.title,
          startSec,
          endSec: Math.max(endSec, startSec + 30),
          confidence: 0.66,
          reason: 'Suggested from a bounded interval using neighboring explicit anchors and planned agenda times.',
          mappingStatus: 'suggested',
          requiresReview: true,
        })
      }
    }

    index = groupEndIndex + 1
  }

  return suggestions
}

function buildSemanticWindows(
  targetAgendas: AgendaRow[],
  rowsByAgendaId: Map<string, DraftPreviewRow>,
  anchors: TranscriptTimelineAnchor[],
  durationSec: number,
) {
  const windows = new Map<string, DeterministicRange>()
  const known = buildKnownRanges(targetAgendas, rowsByAgendaId)

  for (let index = 0; index < targetAgendas.length; index += 1) {
    const agenda = targetAgendas[index]
    if (rowsByAgendaId.has(agenda.id)) continue

    const previousKnown = [...known].reverse().find(entry => entry.index < index) ?? null
    const nextKnown = known.find(entry => entry.index > index) ?? null

    const startSec = previousKnown?.row.endSec
      ?? getGapBoundary(anchors, 'before', nextKnown?.row.startSec ?? durationSec, 0)
    const endSec = nextKnown?.row.startSec
      ?? getGapBoundary(anchors, 'after', previousKnown?.row.endSec ?? 0, durationSec)

    if (startSec !== null && endSec !== null && endSec > startSec) {
      windows.set(agenda.id, { startSec, endSec })
    }
  }

  return windows
}

async function runAiSemanticPass(params: {
  organizationId: string
  userPlanTier?: string | null
  meetingTitle: string
  targetAgendas: AgendaRow[]
  unresolvedAgendas: AgendaRow[]
  rowsByAgendaId: Map<string, DraftPreviewRow>
  structure: TranscriptTimelineStructure
  agendaDeviationPrompt?: string
  meetingRulesPrompt?: string
}) {
  if (params.unresolvedAgendas.length === 0) {
    return {
      rows: new Map<string, DraftPreviewRow>(),
      warnings: [] as string[],
    }
  }

  const windows = buildSemanticWindows(
    params.targetAgendas,
    params.rowsByAgendaId,
    params.structure.anchors,
    params.structure.durationSec,
  )

  const windowedAgendas = params.unresolvedAgendas.filter(agenda => windows.has(agenda.id))
  if (windowedAgendas.length === 0) {
    return {
      rows: new Map<string, DraftPreviewRow>(),
      warnings: ['Some agendas still need review because the transcript did not provide a safe window for semantic mapping.'],
    }
  }

  const timelineStart = Math.min(...windowedAgendas.map(agenda => windows.get(agenda.id)?.startSec ?? 0))
  const timelineEnd = Math.max(...windowedAgendas.map(agenda => windows.get(agenda.id)?.endSec ?? 0))
  const rawTimeline = buildTimelinePromptText(params.structure, timelineStart, timelineEnd)
  const { timeline, truncated } = truncateTimelineForPrompt(rawTimeline)
  const knownAnchors = Array.from(params.rowsByAgendaId.values())
    .filter((row): row is DraftPreviewRow & { mappingStatus: 'explicit' | 'suggested'; startSec: number; endSec: number } => (
      (row.mappingStatus === 'explicit' || row.mappingStatus === 'suggested')
      && row.startSec !== null
      && row.endSec !== null
    ))
    .map(row => ({
      agendaNo: row.agendaNo,
      title: row.agendaTitle,
      startSec: row.startSec,
      endSec: row.endSec,
      source: row.mappingStatus,
    }))

  const prompt = buildPromptAgendaTimelineSegmentation({
    meetingTitle: params.meetingTitle,
    agendaList: windowedAgendas.map(agenda => ({
      id: agenda.id,
      agendaNo: agenda.agenda_no,
      title: agenda.title,
    })),
    timeline,
    agendaDeviationNote: params.agendaDeviationPrompt,
    meetingRulesPrompt: params.meetingRulesPrompt,
    knownAnchors,
    timelineScopeNote: `Only map the unresolved agendas inside the transcript window ${formatSecondsToTimecode(timelineStart)}-${formatSecondsToTimecode(timelineEnd)}.`,
  })

  const effectiveAi = params.userPlanTier
    ? await getEffectiveAiConfigForUserPlan(params.organizationId, params.userPlanTier)
    : await getEffectiveAiConfigForOrganization(params.organizationId)

  try {
    const result = await generateObject({
      model: params.userPlanTier
        ? await resolveLanguageModelForUserPlan(params.organizationId, params.userPlanTier)
        : await resolveLanguageModelForOrganization(params.organizationId),
      schema: llmAgendaSegmentationSchema,
      prompt,
    })

    const rows = new Map<string, DraftPreviewRow>()
    for (const item of result.object.items) {
      const agenda = windowedAgendas.find(candidate => candidate.id === item.agendaId)
      if (!agenda) continue

      const window = windows.get(item.agendaId)
      if (!window) continue

      const startSec = Math.max(window.startSec, Math.floor(item.startSec))
      const endSec = Math.min(window.endSec, Math.ceil(item.endSec))
      if (endSec <= startSec) continue

      rows.set(item.agendaId, {
        agendaId: agenda.id,
        agendaNo: agenda.agenda_no,
        agendaTitle: agenda.title,
        startSec,
        endSec,
        confidence: clampConfidence(item.confidence ?? 0.55, 0.5, 0.8),
        reason: (item.reason ?? '').trim() || 'Suggested semantically from the unresolved transcript window.',
        mappingStatus: 'semantic',
        requiresReview: true,
      })
    }

    return {
      rows,
      warnings: truncated
        ? ['Transcript window was truncated for model context while filling unresolved agenda timestamps.']
        : [],
    }
  } catch (error) {
    if (process.env.NODE_ENV !== 'production' && effectiveAi.provider === 'openai') {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[Agenda Segmentation] Semantic gap fill failed', {
        provider: effectiveAi.provider,
        model: effectiveAi.model,
        error: message,
      })
    }

    return {
      rows: new Map<string, DraftPreviewRow>(),
      warnings: ['AI could not confidently fill some unresolved agendas. Please review those rows manually.'],
    }
  }
}

function buildUnresolvedRows(
  targetAgendas: AgendaRow[],
  rowsByAgendaId: Map<string, DraftPreviewRow>,
) {
  const unresolvedRows = new Map<string, DraftPreviewRow>()

  for (const agenda of targetAgendas) {
    if (rowsByAgendaId.has(agenda.id)) continue
    unresolvedRows.set(agenda.id, {
      agendaId: agenda.id,
      agendaNo: agenda.agenda_no,
      agendaTitle: agenda.title,
      startSec: null,
      endSec: null,
      confidence: 0.35,
      reason: 'Needs review. No explicit transcript anchor or safe bounded interval was found for this agenda.',
      mappingStatus: 'unresolved',
      requiresReview: true,
    })
  }

  return unresolvedRows
}

function buildPreviewRowsInAgendaOrder(
  targetAgendas: AgendaRow[],
  rowsByAgendaId: Map<string, DraftPreviewRow>,
) {
  return targetAgendas.map((agenda) => {
    const row = rowsByAgendaId.get(agenda.id)
    if (!row) {
      return {
        agendaId: agenda.id,
        agendaNo: agenda.agenda_no,
        agendaTitle: agenda.title,
        startSec: null,
        endSec: null,
        confidence: 0.35,
        reason: 'Needs review. No transcript evidence was mapped to this agenda yet.',
        mappingStatus: 'unresolved' as const,
        requiresReview: true,
      } satisfies SegmentationPreviewRow
    }

    return row satisfies SegmentationPreviewRow
  })
}

function validateNoOverlap(rows: Array<{ agendaId: string; startSec: number; endSec: number }>) {
  const sorted = [...rows].sort((a, b) => a.startSec - b.startSec)
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]
    const current = sorted[index]
    if (current.startSec < previous.endSec) {
      throw new Error(`Timeline overlap detected between rows for agendas ${previous.agendaId} and ${current.agendaId}.`)
    }
  }
}

export async function analyzeAgendaSegmentationWithClient(params: {
  supabase: DatabaseClient
  meetingId: string
  organizationId: string
  userPlanTier?: string | null
  options: z.infer<typeof analyzeAgendaSegmentationOptionsSchema>
}): Promise<SegmentationPreviewResult> {
  const meetingId = uuidSchema.parse(params.meetingId)
  const parsedOptions = analyzeAgendaSegmentationOptionsSchema.parse(params.options)
  if (!parsedOptions.useTeamsTranscription) {
    throw new Error('Timeline analysis is only available for Microsoft transcription mode.')
  }

  const { meetingTitle, meetingRules } = await getMeetingContext(
    params.supabase,
    meetingId,
    params.organizationId,
  )
  const { targetAgendas } = await getTargetAgendas(params.supabase, meetingId)
  const { transcriptId, structure } = await loadTimelineFromStoredTranscript(
    params.supabase,
    meetingId,
    parsedOptions.transcriptId ?? undefined,
  )

  const durationSec = structure.durationSec
  const plannedOffsets = buildPlannedOffsets(targetAgendas)
  const explicitMatches = matchExplicitAnchors(targetAgendas, structure.anchors)
  const rowsByAgendaId = buildExplicitRows(targetAgendas, explicitMatches, structure.anchors, durationSec)

  const suggestedRows = buildBoundedSuggestions(
    targetAgendas,
    rowsByAgendaId,
    structure.anchors,
    durationSec,
    plannedOffsets,
  )
  suggestedRows.forEach((row, agendaId) => {
    if (!rowsByAgendaId.has(agendaId)) {
      rowsByAgendaId.set(agendaId, row)
    }
  })

  const unresolvedAgendas = targetAgendas.filter(agenda => !rowsByAgendaId.has(agenda.id))
  const semanticResult = await runAiSemanticPass({
    organizationId: params.organizationId,
    userPlanTier: params.userPlanTier,
    meetingTitle,
    targetAgendas,
    unresolvedAgendas,
    rowsByAgendaId,
    structure,
    agendaDeviationPrompt: parsedOptions.agendaDeviationPrompt || undefined,
    meetingRulesPrompt: resolveMeetingRulesPrompt(parsedOptions, meetingRules),
  })
  semanticResult.rows.forEach((row, agendaId) => {
    if (!rowsByAgendaId.has(agendaId)) {
      rowsByAgendaId.set(agendaId, row)
    }
  })

  const unresolvedRows = buildUnresolvedRows(targetAgendas, rowsByAgendaId)
  unresolvedRows.forEach((row, agendaId) => {
    if (!rowsByAgendaId.has(agendaId)) {
      rowsByAgendaId.set(agendaId, row)
    }
  })

  const rows = buildPreviewRowsInAgendaOrder(targetAgendas, rowsByAgendaId)
  const warnings: string[] = [...semanticResult.warnings]

  const suggestedCount = rows.filter(row => row.mappingStatus === 'suggested').length
  const unresolvedCount = rows.filter(row => row.mappingStatus === 'unresolved').length
  if (suggestedCount > 0) {
    warnings.push(`${suggestedCount} agenda timestamp suggestion(s) need review before saving.`)
  }
  if (unresolvedCount > 0) {
    warnings.push(`${unresolvedCount} agenda(s) still need manual timestamp review because no safe transcript anchor was found.`)
  }

  return {
    transcriptId,
    rows,
    warnings,
    durationSec,
  }
}

export async function confirmAgendaSegmentationWithClient(params: {
  supabase: DatabaseClient
  meetingId: string
  organizationId: string
  input: z.infer<typeof confirmAgendaSegmentationInputSchema>
}): Promise<ConfirmSegmentationResult> {
  const parsed = confirmAgendaSegmentationInputSchema.parse(params.input)
  const meetingId = uuidSchema.parse(params.meetingId)

  if (parsed.meetingId !== meetingId) {
    throw new Error('Meeting mismatch for agenda segmentation confirmation.')
  }

  await getMeetingContext(params.supabase, meetingId, params.organizationId)

  const { allAgendas } = await getTargetAgendas(params.supabase, meetingId)
  const agendaMap = new Map(allAgendas.map(agenda => [agenda.id, agenda]))
  const { structure } = await loadTimelineFromStoredTranscript(params.supabase, meetingId, parsed.transcriptId)
  const cues = structure.cues
  const durationSec = structure.durationSec

  const normalizedRows = parsed.rows
    .map((row, index) => {
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
    })
    .filter(row => row.endSec > row.startSec)
  const normalizedClosureRows = parsed.closureRows
    .map((row, index) => {
      if (!agendaMap.has(row.agendaId)) {
        throw new Error(`No Transcription row ${index + 1} references an agenda outside this meeting.`)
      }

      const startSec = parseTimecodeToSeconds(row.startTime)
      const endSec = parseTimecodeToSeconds(row.endTime)
      if (startSec === null || endSec === null) {
        throw new Error(`No Transcription row ${index + 1} has invalid timecode format. Use HH:MM:SS.`)
      }
      if (endSec <= startSec) {
        throw new Error(`No Transcription row ${index + 1} has invalid range: end time must be after start time.`)
      }
      if (startSec >= durationSec) {
        throw new Error(`No Transcription row ${index + 1} starts after transcript duration.`)
      }

      return {
        agendaId: row.agendaId,
        startSec,
        endSec: Math.min(endSec, durationSec),
      }
    })
    .filter(row => row.endSec > row.startSec)

  if (normalizedRows.length > 0) {
    validateNoOverlap(normalizedRows)
  }

  const { error: deleteError } = await params.supabase
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

  const closureSortByAgenda = new Map<string, number>()
  for (const row of normalizedClosureRows.sort((a, b) => a.startSec - b.startSec)) {
    const sortOrder = closureSortByAgenda.get(row.agendaId) ?? 0
    inserts.push({
      transcript_id: parsed.transcriptId,
      agenda_id: row.agendaId,
      content: NO_TRANSCRIPTION_SEGMENT_MARKER,
      speaker: null,
      start_offset: row.startSec,
      end_offset: row.endSec,
      sort_order: sortOrder,
    })
    closureSortByAgenda.set(row.agendaId, sortOrder + 1)
  }

  if (inserts.length > 0) {
    const { error: insertError } = await params.supabase
      .from('transcript_segments')
      .insert(inserts)
    if (insertError) throw new Error(insertError.message)
  }

  return {
    savedSegmentCount: inserts.length,
  }
}
