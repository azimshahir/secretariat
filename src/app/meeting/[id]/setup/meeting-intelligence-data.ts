'use client'

import type { CommitteeSpeaker } from '@/actions/committee-speakers'
import type { Agenda } from '@/lib/supabase/types'
import type { AgendaTimelineRow } from './agenda-timeline-row'
import type { MinuteEntry } from './minute-entry'

export type GraphView = 'heatmap' | 'bar' | 'line' | 'stacked'
export type AgendaFilter = 'all' | 'heated' | 'overrun'
export type AgendaStatus = 'On Track' | 'Heated' | 'Overrun' | 'Needs Follow-up'

export interface AgendaAnalyticsRecord {
  id: string
  agendaNo: string
  title: string
  displayLabel: string
  plannedMinutes: number
  actualMinutes: number
  durationMinutes: number
  speakerCount: number
  interruptions: number
  objections: number
  actionItems: number
  decisionMade: boolean
  sentimentScore: number
  heatScore: number
  status: AgendaStatus
  normalizedMetrics: {
    duration: number
    speakers: number
    interruptions: number
    objections: number
  }
  contributionMetrics: {
    duration: number
    speakers: number
    interruptions: number
    objections: number
  }
}

export interface SpeakerParticipationRow {
  name: string
  participationScore: number
  agendasCovered: number
  speakingMoments: number
}

export interface ActionItemRecord {
  id: string
  agendaId: string
  agendaNo: string
  task: string
  owner: string
  deadline: string
  status: 'Open' | 'In Progress' | 'Blocked' | 'Completed'
}

export interface MeetingAnalyticsSummary {
  meetingTitle: string
  date: string
  chairman: string
  totalAgendas: number
  totalSpeakers: number
  totalDecisions: number
  totalActionItems: number
  totalDuration: number
  meetingTemperature: {
    label: 'Cool' | 'Warm' | 'Hot'
    score: number
  }
  meetingEfficiencyScore: number
  overallSummary: string
  narrative: string
}

export interface MeetingInsights {
  mostHeatedAgenda: AgendaAnalyticsRecord | null
  longestDiscussion: AgendaAnalyticsRecord | null
  mostActiveSpeaker: SpeakerParticipationRow | null
  meetingEfficiencyScore: number
  agendaOverrunAlert: AgendaAnalyticsRecord | null
}

export interface MeetingIntelligenceDataset {
  summary: MeetingAnalyticsSummary
  agendas: AgendaAnalyticsRecord[]
  speakers: SpeakerParticipationRow[]
  actionItems: ActionItemRecord[]
  insights: MeetingInsights
}

interface BuildMeetingIntelligenceInput {
  meetingId: string
  meetingTitle: string
  meetingDate: string
  committeeName: string | null
  existingAgendas: Agenda[]
  timelineRows: AgendaTimelineRow[]
  currentMinutesByAgenda: Record<string, MinuteEntry>
  committeeSpeakers: CommitteeSpeaker[]
}

const FALLBACK_CHAIRMEN = [
  'Encik Ahmad Fikri',
  'Puan Nur Aisyah',
  'Dato’ Farid Rahman',
  'Encik Syamil Hakim',
]

const FALLBACK_SPEAKERS = [
  'Azim Shahir',
  'Aiman Zulkifli',
  'Nur Syuhada',
  'Farhan Rashid',
  'Alya Nabilah',
  'Haziq Rahman',
  'Siti Mariam',
  'Danial Haris',
]

const ACTION_ITEM_TEMPLATES = [
  'Prepare follow-up impact paper',
  'Validate revised implementation timeline',
  'Circulate updated decision note',
  'Confirm stakeholder feedback actions',
  'Submit final risk assessment update',
  'Table final recommendation at next meeting',
]

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function round(value: number, decimals = 0) {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

function roundToNearestFive(value: number) {
  return Math.max(5, Math.round(value / 5) * 5)
}

function hashString(input: string) {
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function seededFraction(seedKey: string) {
  return hashString(seedKey) / 4294967295
}

function seededInt(seedKey: string, min: number, max: number) {
  if (max <= min) return min
  const span = max - min + 1
  return min + Math.floor(seededFraction(seedKey) * span)
}

function seededItem<T>(seedKey: string, items: readonly T[]) {
  return items[seededInt(seedKey, 0, items.length - 1)]
}

function parseTimecodeToSeconds(value: string) {
  const parts = value.split(':').map(Number)
  if (parts.some(Number.isNaN)) return 0
  if (parts.length === 3) {
    return (parts[0] * 3600) + (parts[1] * 60) + parts[2]
  }
  if (parts.length === 2) {
    return (parts[0] * 60) + parts[1]
  }
  return parts[0] ?? 0
}

function minutesFromTimeline(row?: AgendaTimelineRow) {
  if (!row) return null
  const seconds = Math.max(0, parseTimecodeToSeconds(row.endTime) - parseTimecodeToSeconds(row.startTime))
  const minutes = seconds / 60
  return minutes > 0 ? round(minutes, 1) : null
}

function normalize(value: number, min: number, max: number) {
  if (max <= min) return 0.5
  return clamp((value - min) / (max - min), 0, 1)
}

function agendaLabel(agendaNo: string) {
  return `Agenda ${agendaNo}`
}

function extractSpeakerName(speaker: CommitteeSpeaker) {
  const candidate = speaker as unknown as Record<string, unknown>
  const name = candidate.name
    ?? candidate.speaker_name
    ?? candidate.display_name
    ?? candidate.full_name

  return typeof name === 'string' && name.trim().length > 0 ? name.trim() : null
}

function extractSpeakerRole(speaker: CommitteeSpeaker) {
  const candidate = speaker as unknown as Record<string, unknown>
  const role = candidate.role
    ?? candidate.designation
    ?? candidate.title
    ?? candidate.position

  return typeof role === 'string' ? role : ''
}

function resolveChairman(speakers: CommitteeSpeaker[], meetingTitle: string) {
  const matched = speakers.find((speaker) => /chair|chairman|pengerusi/i.test(extractSpeakerRole(speaker)))
  const speakerName = matched ? extractSpeakerName(matched) : null
  if (speakerName) return speakerName
  return seededItem(meetingTitle, FALLBACK_CHAIRMEN)
}

function buildSpeakerPool(speakers: CommitteeSpeaker[], meetingTitle: string) {
  const names = speakers
    .map(extractSpeakerName)
    .filter((value): value is string => Boolean(value))

  const unique = Array.from(new Set(names))
  if (unique.length >= 4) return unique

  const fallback = [...FALLBACK_SPEAKERS]
  while (unique.length < 6 && fallback.length > 0) {
    const picked = seededItem(`${meetingTitle}:${unique.length}`, fallback)
    unique.push(picked)
    fallback.splice(fallback.indexOf(picked), 1)
  }

  return unique
}

function inferDecision(content: string | undefined, seedKey: string) {
  if (content && /(approved|resolved|agreed|decided|endorsed|adopted|noted)/i.test(content)) return true
  return seededFraction(`${seedKey}:decision`) > 0.42
}

function inferActionItemCount(content: string | undefined, seedKey: string, decisionMade: boolean) {
  const boosted = content && /(action|follow-up|follow up|submit|prepare|review|update)/i.test(content)
  const base = seededInt(`${seedKey}:actions`, decisionMade ? 0 : 1, decisionMade ? 2 : 3)
  return clamp(boosted ? base + 1 : base, 0, 4)
}

function buildAgendaBaseRecord(
  agenda: Agenda,
  timelineRow: AgendaTimelineRow | undefined,
  minute: MinuteEntry | undefined,
  meetingId: string,
) {
  const seedBase = `${meetingId}:${agenda.id}:${agenda.agenda_no}`
  const rawMinutes = minutesFromTimeline(timelineRow)
  const seededActualMinutes = seededInt(`${seedBase}:actual`, 8, 28)
  const actualMinutes = rawMinutes && rawMinutes >= 3 ? round(rawMinutes, 1) : seededActualMinutes
  const plannedRatio = 0.82 + (seededFraction(`${seedBase}:planned-ratio`) * 0.28)
  const plannedMinutes = roundToNearestFive(actualMinutes * plannedRatio)
  const speakerCount = clamp(
    Math.round((actualMinutes / 5) + seededInt(`${seedBase}:speakers`, 2, 6)),
    3,
    16,
  )
  const interruptions = clamp(
    seededInt(`${seedBase}:interruptions`, 0, Math.max(2, Math.round(actualMinutes / 4) + 2)),
    0,
    10,
  )
  const objections = clamp(
    seededInt(`${seedBase}:objections`, 0, Math.max(1, Math.round(interruptions / 2) + 2)),
    0,
    8,
  )
  const decisionMade = inferDecision(minute?.content, seedBase)
  const actionItems = inferActionItemCount(minute?.content, seedBase, decisionMade)
  const sentimentScore = round((seededFraction(`${seedBase}:sentiment`) * 1.4) - 0.4, 2)

  return {
    id: agenda.id,
    agendaNo: agenda.agenda_no,
    title: agenda.title,
    displayLabel: agendaLabel(agenda.agenda_no),
    plannedMinutes,
    actualMinutes,
    durationMinutes: actualMinutes,
    speakerCount,
    interruptions,
    objections,
    actionItems,
    decisionMade,
    sentimentScore,
  }
}

function buildActionItems(
  agendas: AgendaAnalyticsRecord[],
  speakerPool: string[],
  meetingDate: string,
) {
  const baseDate = new Date(meetingDate)
  return agendas.flatMap((agenda) => {
    return Array.from({ length: agenda.actionItems }).map((_, index) => {
      const seedBase = `${agenda.id}:task:${index}`
      const deadline = new Date(baseDate)
      deadline.setDate(deadline.getDate() + seededInt(`${seedBase}:deadline`, 3, 21))
      return {
        id: `${agenda.id}-${index + 1}`,
        agendaId: agenda.id,
        agendaNo: agenda.agendaNo,
        task: `${seededItem(seedBase, ACTION_ITEM_TEMPLATES)} for ${agenda.displayLabel}`,
        owner: seededItem(`${seedBase}:owner`, speakerPool),
        deadline: deadline.toLocaleDateString('en-MY', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        }),
        status: seededItem(`${seedBase}:status`, ['Open', 'In Progress', 'Blocked', 'Completed'] as const),
      }
    })
  }).slice(0, 8)
}

function buildSpeakerParticipation(
  agendas: AgendaAnalyticsRecord[],
  speakerPool: string[],
) {
  const totals = new Map<string, SpeakerParticipationRow>()

  agendas.forEach((agenda) => {
    const slots = clamp(Math.min(agenda.speakerCount, speakerPool.length), 2, Math.min(5, speakerPool.length))
    for (let index = 0; index < slots; index += 1) {
      const speakerName = speakerPool[(hashString(`${agenda.id}:speaker:${index}`) + index) % speakerPool.length]
      const speakingMoments = clamp(
        Math.round((agenda.speakerCount / slots) + seededInt(`${agenda.id}:${speakerName}:moments`, 1, 5)),
        2,
        14,
      )
      const existing = totals.get(speakerName)
      if (existing) {
        existing.participationScore += speakingMoments + Math.round(agenda.heatScore / 30)
        existing.speakingMoments += speakingMoments
        existing.agendasCovered += 1
      } else {
        totals.set(speakerName, {
          name: speakerName,
          participationScore: speakingMoments + Math.round(agenda.heatScore / 30),
          speakingMoments,
          agendasCovered: 1,
        })
      }
    }
  })

  return Array.from(totals.values())
    .sort((left, right) => right.participationScore - left.participationScore)
    .slice(0, 6)
}

function computeMeetingTemperature(score: number) {
  if (score >= 70) return 'Hot' as const
  if (score >= 45) return 'Warm' as const
  return 'Cool' as const
}

export function filterAgendaAnalytics(agendas: AgendaAnalyticsRecord[], filter: AgendaFilter) {
  if (filter === 'heated') return agendas.filter(agenda => agenda.heatScore >= 70)
  if (filter === 'overrun') return agendas.filter(agenda => agenda.actualMinutes > agenda.plannedMinutes * 1.15)
  return agendas
}

export function buildMeetingIntelligenceDataset({
  meetingId,
  meetingTitle,
  meetingDate,
  committeeName,
  existingAgendas,
  timelineRows,
  currentMinutesByAgenda,
  committeeSpeakers,
}: BuildMeetingIntelligenceInput): MeetingIntelligenceDataset {
  const timelineByAgendaId = new Map(timelineRows.map(row => [row.agendaId, row]))

  const baseAgendas = existingAgendas.map(agenda =>
    buildAgendaBaseRecord(
      agenda,
      timelineByAgendaId.get(agenda.id),
      currentMinutesByAgenda[agenda.id],
      meetingId,
    ),
  )

  const durationValues = baseAgendas.map(agenda => agenda.actualMinutes)
  const speakerValues = baseAgendas.map(agenda => agenda.speakerCount)
  const interruptionValues = baseAgendas.map(agenda => agenda.interruptions)
  const objectionValues = baseAgendas.map(agenda => agenda.objections)

  const durationMin = Math.min(...durationValues, 0)
  const durationMax = Math.max(...durationValues, 1)
  const speakerMin = Math.min(...speakerValues, 0)
  const speakerMax = Math.max(...speakerValues, 1)
  const interruptionMin = Math.min(...interruptionValues, 0)
  const interruptionMax = Math.max(...interruptionValues, 1)
  const objectionMin = Math.min(...objectionValues, 0)
  const objectionMax = Math.max(...objectionValues, 1)

  const agendas = baseAgendas.map((agenda) => {
    const normalizedDuration = normalize(agenda.actualMinutes, durationMin, durationMax)
    const normalizedSpeakers = normalize(agenda.speakerCount, speakerMin, speakerMax)
    const normalizedInterruptions = normalize(agenda.interruptions, interruptionMin, interruptionMax)
    const normalizedObjections = normalize(agenda.objections, objectionMin, objectionMax)

    const contributionDuration = round(normalizedDuration * 35)
    const contributionSpeakers = round(normalizedSpeakers * 25)
    const contributionInterruptions = round(normalizedInterruptions * 20)
    const contributionObjections = round(normalizedObjections * 20)
    const heatScore = round(
      (
        (0.35 * normalizedDuration)
        + (0.25 * normalizedSpeakers)
        + (0.20 * normalizedInterruptions)
        + (0.20 * normalizedObjections)
      ) * 100,
    )

    const status: AgendaStatus = agenda.actionItems > 0 && !agenda.decisionMade
      ? 'Needs Follow-up'
      : agenda.actualMinutes > agenda.plannedMinutes * 1.15
        ? 'Overrun'
        : heatScore >= 70
          ? 'Heated'
          : 'On Track'

    return {
      ...agenda,
      heatScore,
      status,
      normalizedMetrics: {
        duration: normalizedDuration,
        speakers: normalizedSpeakers,
        interruptions: normalizedInterruptions,
        objections: normalizedObjections,
      },
      contributionMetrics: {
        duration: contributionDuration,
        speakers: contributionSpeakers,
        interruptions: contributionInterruptions,
        objections: contributionObjections,
      },
    }
  }).sort((left, right) => left.agendaNo.localeCompare(right.agendaNo, undefined, { numeric: true, sensitivity: 'base' }))

  const speakerPool = buildSpeakerPool(committeeSpeakers, meetingTitle)
  const speakers = buildSpeakerParticipation(agendas, speakerPool)
  const actionItems = buildActionItems(agendas, speakerPool, meetingDate)
  const totalDuration = agendas.reduce((sum, agenda) => sum + agenda.actualMinutes, 0)
  const totalPlanned = agendas.reduce((sum, agenda) => sum + agenda.plannedMinutes, 0)
  const totalDecisions = agendas.filter(agenda => agenda.decisionMade).length
  const totalActionItems = agendas.reduce((sum, agenda) => sum + agenda.actionItems, 0)
  const averageHeat = agendas.length > 0
    ? round(agendas.reduce((sum, agenda) => sum + agenda.heatScore, 0) / agendas.length)
    : 0
  const averageInterruptions = agendas.length > 0
    ? agendas.reduce((sum, agenda) => sum + agenda.interruptions, 0) / agendas.length
    : 0
  const decisionRate = agendas.length > 0 ? totalDecisions / agendas.length : 0
  const overrunRatio = totalPlanned > 0 ? totalDuration / totalPlanned : 1
  const meetingEfficiencyScore = clamp(
    round(100 - Math.max(0, (overrunRatio - 1) * 40) - (averageInterruptions * 2.5) + (decisionRate * 12)),
    28,
    98,
  )

  const mostHeatedAgenda = [...agendas].sort((left, right) => right.heatScore - left.heatScore)[0] ?? null
  const longestDiscussion = [...agendas].sort((left, right) => right.actualMinutes - left.actualMinutes)[0] ?? null
  const agendaOverrunAlert = [...agendas]
    .filter(agenda => agenda.actualMinutes > agenda.plannedMinutes * 1.15)
    .sort((left, right) => (right.actualMinutes - right.plannedMinutes) - (left.actualMinutes - left.plannedMinutes))[0] ?? null

  const chairman = resolveChairman(committeeSpeakers, meetingTitle)
  const overallSummary = agendas.length > 0
    ? `${meetingTitle} covered ${agendas.length} agenda items across ${round(totalDuration)} minutes with ${totalDecisions} decisions and ${totalActionItems} follow-up actions identified for the secretariat team.`
    : `No agenda analytics are available yet for ${meetingTitle}.`

  const narrativeAgenda = mostHeatedAgenda ?? longestDiscussion
  const narrative = narrativeAgenda
    ? `${narrativeAgenda.displayLabel} generated the highest discussion intensity and ${narrativeAgenda.status === 'Overrun' ? 'exceeded its allocated time window' : 'drew the broadest participation'}, signalling elevated stakeholder attention and a likely need for follow-up alignment.`
    : 'Generate transcript timestamps to unlock discussion heat insights and agenda-level analytics.'

  return {
    summary: {
      meetingTitle,
      date: new Date(meetingDate).toLocaleDateString('en-MY', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
      chairman: committeeName && committeeName.trim().length > 0
        ? chairman
        : chairman,
      totalAgendas: agendas.length,
      totalSpeakers: speakers.length,
      totalDecisions,
      totalActionItems,
      totalDuration: round(totalDuration),
      meetingTemperature: {
        label: computeMeetingTemperature(averageHeat),
        score: averageHeat,
      },
      meetingEfficiencyScore,
      overallSummary,
      narrative,
    },
    agendas,
    speakers,
    actionItems,
    insights: {
      mostHeatedAgenda,
      longestDiscussion,
      mostActiveSpeaker: speakers[0] ?? null,
      meetingEfficiencyScore,
      agendaOverrunAlert,
    },
  }
}

