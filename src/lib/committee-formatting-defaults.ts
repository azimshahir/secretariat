import { z } from 'zod'

import type { Agenda } from '@/lib/supabase/types'

const committeeFormattingDefaultRowSchema = z.object({
  title: z.string(),
  normalizedTitle: z.string(),
  sortOrder: z.number().int().nonnegative(),
  formatTemplateId: z.string().uuid().nullable(),
  minutePlaybookId: z.string().uuid().nullable(),
  minutePlaybookVariantOverrideId: z.string().uuid().nullable(),
  additionalInfo: z.string().nullable(),
})

const committeeFormattingDefaultSnapshotSchema = z.object({
  savedAt: z.string().datetime({ offset: true }),
  sourceMeetingId: z.string().uuid(),
  rows: z.array(committeeFormattingDefaultRowSchema),
})

export type CommitteeFormattingDefaultRow = z.infer<typeof committeeFormattingDefaultRowSchema>
export type CommitteeFormattingDefaultSnapshot = z.infer<typeof committeeFormattingDefaultSnapshotSchema>

type AgendaFormattingSource = Pick<
  Agenda,
  'title' | 'sort_order' | 'format_template_id' | 'minute_playbook_id' | 'minute_playbook_variant_override_id' | 'additional_info'
>

type AgendaFormattingTarget = Pick<
  Agenda,
  'id' | 'title' | 'sort_order' | 'format_template_id' | 'minute_playbook_id' | 'minute_playbook_variant_override_id' | 'additional_info'
>

export interface MatchedCommitteeFormattingRow {
  agendaId: string
  formatTemplateId: string | null
  minutePlaybookId: string | null
  minutePlaybookVariantOverrideId: string | null
  additionalInfo: string | null
}

function normalizeNullableText(value: string | null | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export function normalizeAgendaTitleForCommitteeDefault(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

export function hasAgendaFormattingConfigured(agenda: Pick<AgendaFormattingTarget, 'format_template_id' | 'minute_playbook_id' | 'minute_playbook_variant_override_id' | 'additional_info'>) {
  return Boolean(
    agenda.format_template_id
    || agenda.minute_playbook_id
    || agenda.minute_playbook_variant_override_id
    || normalizeNullableText(agenda.additional_info),
  )
}

export function buildCommitteeFormattingDefaultSnapshot(
  agendas: AgendaFormattingSource[],
  sourceMeetingId: string,
): CommitteeFormattingDefaultSnapshot {
  return {
    savedAt: new Date().toISOString(),
    sourceMeetingId,
    rows: agendas
      .map(agenda => ({
        title: agenda.title,
        normalizedTitle: normalizeAgendaTitleForCommitteeDefault(agenda.title),
        sortOrder: agenda.sort_order,
        formatTemplateId: agenda.format_template_id,
        minutePlaybookId: agenda.minute_playbook_id,
        minutePlaybookVariantOverrideId: agenda.minute_playbook_variant_override_id,
        additionalInfo: normalizeNullableText(agenda.additional_info),
      }))
      .sort((left, right) => left.sortOrder - right.sortOrder),
  }
}

export function parseCommitteeFormattingDefaultSnapshot(value: unknown): CommitteeFormattingDefaultSnapshot | null {
  const parsed = committeeFormattingDefaultSnapshotSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function shouldAutoApplyCommitteeFormattingDefault(params: {
  snapshot: CommitteeFormattingDefaultSnapshot | null
  meetingCreatedAt: string
  alreadyAppliedAt: string | null
}) {
  if (!params.snapshot || params.alreadyAppliedAt) return false

  const snapshotSavedAt = Date.parse(params.snapshot.savedAt)
  const meetingCreatedAt = Date.parse(params.meetingCreatedAt)
  if (Number.isNaN(snapshotSavedAt) || Number.isNaN(meetingCreatedAt)) return false

  return meetingCreatedAt >= snapshotSavedAt
}

export function matchCommitteeFormattingDefaultSnapshot(
  snapshot: CommitteeFormattingDefaultSnapshot,
  agendas: AgendaFormattingTarget[],
): MatchedCommitteeFormattingRow[] {
  if (snapshot.rows.length === 0 || agendas.length === 0) return []

  const orderedAgendas = [...agendas].sort((left, right) => left.sort_order - right.sort_order)
  const sourceRows = snapshot.rows.map((row, index) => ({
    ...row,
    index,
    matched: false,
  }))
  const matches = new Map<string, CommitteeFormattingDefaultRow>()

  for (const agenda of orderedAgendas) {
    const normalizedTitle = normalizeAgendaTitleForCommitteeDefault(agenda.title)
    if (!normalizedTitle) continue

    const matchingRow = sourceRows.find(
      row => !row.matched && row.normalizedTitle === normalizedTitle,
    )
    if (!matchingRow) continue

    matchingRow.matched = true
    matches.set(agenda.id, matchingRow)
  }

  const unmatchedAgendas = orderedAgendas.filter(agenda => !matches.has(agenda.id))
  const unmatchedRows = sourceRows.filter(row => !row.matched)
  const fallbackCount = Math.min(unmatchedAgendas.length, unmatchedRows.length)

  for (let index = 0; index < fallbackCount; index += 1) {
    matches.set(unmatchedAgendas[index].id, unmatchedRows[index])
  }

  return orderedAgendas.flatMap(agenda => {
    const source = matches.get(agenda.id)
    if (!source) return []

    return [{
      agendaId: agenda.id,
      formatTemplateId: source.formatTemplateId,
      minutePlaybookId: source.minutePlaybookId,
      minutePlaybookVariantOverrideId: source.minutePlaybookVariantOverrideId,
      additionalInfo: source.additionalInfo,
    }]
  })
}
