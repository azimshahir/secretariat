import type { DatabaseClient } from '@/lib/meeting-generation/shared'
import {
  buildCommitteeFormattingDefaultSnapshot,
  hasAgendaFormattingConfigured,
  matchCommitteeFormattingDefaultSnapshot,
  parseCommitteeFormattingDefaultSnapshot,
  shouldAutoApplyCommitteeFormattingDefault,
} from '@/lib/committee-formatting-defaults'

const MISSING_COMMITTEE_FORMATTING_DEFAULTS_HINT =
  'Database migration missing: committee formatting default columns are not created yet. Please run the latest Supabase migrations.'

function isMissingCommitteeFormattingDefaultsSchemaError(error: { code?: string | null; message?: string | null } | null | undefined) {
  if (!error) return false
  if (error.code === '42703' || error.code === 'PGRST204' || error.code === 'PGRST205' || error.code === '42P01') return true
  const message = (error.message ?? '').toLowerCase()
  return (
    message.includes('committee_generation_settings')
    || message.includes('formatting_default_snapshot')
    || message.includes('committee_formatting_default_applied_at')
  )
}

function toFormattingDefaultErrorMessage(error: { message?: string | null } | null | undefined, fallback: string) {
  const message = (error?.message ?? '').trim()
  return message || fallback
}

export async function saveCommitteeFormattingDefaultForMeeting(
  supabase: DatabaseClient,
  meetingId: string,
) {
  const { data: meeting, error: meetingError } = await supabase
    .from('meetings')
    .select('committee_id')
    .eq('id', meetingId)
    .single()

  if (meetingError || !meeting) {
    throw new Error(toFormattingDefaultErrorMessage(meetingError, 'Meeting not found'))
  }
  if (!meeting.committee_id) {
    throw new Error('Link this meeting to a committee before saving a committee default')
  }

  const { data: agendas, error: agendaError } = await supabase
    .from('agendas')
    .select('title, sort_order, format_template_id, minute_playbook_id, minute_playbook_variant_override_id, additional_info')
    .eq('meeting_id', meetingId)
    .order('sort_order')

  if (agendaError) {
    throw new Error(toFormattingDefaultErrorMessage(agendaError, 'Failed to load meeting agendas'))
  }
  if (!agendas || agendas.length === 0) {
    throw new Error('Add agenda rows before saving a committee default')
  }
  if (!agendas.some(hasAgendaFormattingConfigured)) {
    throw new Error('Add at least one agenda formatting before saving a committee default')
  }

  const snapshot = buildCommitteeFormattingDefaultSnapshot(agendas, meetingId)
  const { error: saveError } = await supabase
    .from('committee_generation_settings')
    .upsert(
      {
        committee_id: meeting.committee_id,
        formatting_default_snapshot: snapshot,
      },
      { onConflict: 'committee_id' },
    )

  if (saveError) {
    if (isMissingCommitteeFormattingDefaultsSchemaError(saveError)) {
      throw new Error(MISSING_COMMITTEE_FORMATTING_DEFAULTS_HINT)
    }
    throw new Error(toFormattingDefaultErrorMessage(saveError, 'Failed to save committee formatting default'))
  }

  return snapshot
}

export async function maybeApplyCommitteeFormattingDefaultToMeeting(
  supabase: DatabaseClient,
  meetingId: string,
) {
  const { data: meeting, error: meetingError } = await supabase
    .from('meetings')
    .select('committee_id, created_at, committee_formatting_default_applied_at')
    .eq('id', meetingId)
    .single()

  if (meetingError || !meeting) {
    throw new Error(toFormattingDefaultErrorMessage(meetingError, 'Meeting not found'))
  }
  if (!meeting.committee_id) {
    return { applied: false, matchedCount: 0 }
  }

  const { data: settings, error: settingsError } = await supabase
    .from('committee_generation_settings')
    .select('formatting_default_snapshot')
    .eq('committee_id', meeting.committee_id)
    .maybeSingle()

  if (settingsError) {
    if (isMissingCommitteeFormattingDefaultsSchemaError(settingsError)) {
      throw new Error(MISSING_COMMITTEE_FORMATTING_DEFAULTS_HINT)
    }
    throw new Error(toFormattingDefaultErrorMessage(settingsError, 'Failed to load committee formatting default'))
  }

  const snapshot = parseCommitteeFormattingDefaultSnapshot(settings?.formatting_default_snapshot ?? null)
  if (!shouldAutoApplyCommitteeFormattingDefault({
    snapshot,
    meetingCreatedAt: meeting.created_at,
    alreadyAppliedAt: meeting.committee_formatting_default_applied_at,
  })) {
    return { applied: false, matchedCount: 0 }
  }
  if (!snapshot) {
    return { applied: false, matchedCount: 0 }
  }

  const { data: agendas, error: agendaError } = await supabase
    .from('agendas')
    .select('id, title, sort_order, format_template_id, minute_playbook_id, minute_playbook_variant_override_id, additional_info')
    .eq('meeting_id', meetingId)
    .order('sort_order')

  if (agendaError) {
    throw new Error(toFormattingDefaultErrorMessage(agendaError, 'Failed to load meeting agendas'))
  }
  if (!agendas || agendas.length === 0) {
    return { applied: false, matchedCount: 0 }
  }
  if (agendas.some(hasAgendaFormattingConfigured)) {
    return { applied: false, matchedCount: 0 }
  }

  const matches = matchCommitteeFormattingDefaultSnapshot(snapshot, agendas)
  if (matches.length === 0) {
    return { applied: false, matchedCount: 0 }
  }

  const [playbookRows, variantRows, templateRows] = await Promise.all([
    (() => {
      const ids = [...new Set(matches.map(match => match.minutePlaybookId).filter(Boolean))]
      if (ids.length === 0) return Promise.resolve({ data: [] as Array<{ id: string }>, error: null })
      return supabase
        .from('minute_playbooks')
        .select('id')
        .in('id', ids)
    })(),
    (() => {
      const ids = [...new Set(matches.map(match => match.minutePlaybookVariantOverrideId).filter(Boolean))]
      if (ids.length === 0) return Promise.resolve({ data: [] as Array<{ id: string }>, error: null })
      return supabase
        .from('minute_playbook_variants')
        .select('id')
        .in('id', ids)
    })(),
    (() => {
      const ids = [...new Set(matches.map(match => match.formatTemplateId).filter(Boolean))]
      if (ids.length === 0) return Promise.resolve({ data: [] as Array<{ id: string }>, error: null })
      return supabase
        .from('format_templates')
        .select('id')
        .in('id', ids)
    })(),
  ])

  if (playbookRows.error) throw new Error(toFormattingDefaultErrorMessage(playbookRows.error, 'Failed to validate playbooks'))
  if (variantRows.error) throw new Error(toFormattingDefaultErrorMessage(variantRows.error, 'Failed to validate playbook variants'))
  if (templateRows.error) throw new Error(toFormattingDefaultErrorMessage(templateRows.error, 'Failed to validate templates'))

  const validPlaybookIds = new Set((playbookRows.data ?? []).map(row => row.id))
  const validVariantIds = new Set((variantRows.data ?? []).map(row => row.id))
  const validTemplateIds = new Set((templateRows.data ?? []).map(row => row.id))

  for (const match of matches) {
    const minutePlaybookId = match.minutePlaybookId && validPlaybookIds.has(match.minutePlaybookId)
      ? match.minutePlaybookId
      : null
    const formatTemplateId = match.formatTemplateId && validTemplateIds.has(match.formatTemplateId)
      ? match.formatTemplateId
      : null
    const variantOverrideId = minutePlaybookId && match.minutePlaybookVariantOverrideId && validVariantIds.has(match.minutePlaybookVariantOverrideId)
      ? match.minutePlaybookVariantOverrideId
      : null

    const { error: updateError } = await supabase
      .from('agendas')
      .update({
        format_template_id: formatTemplateId,
        minute_playbook_id: minutePlaybookId,
        minute_playbook_variant_override_id: variantOverrideId,
        additional_info: match.additionalInfo,
      })
      .eq('id', match.agendaId)

    if (updateError) {
      throw new Error(toFormattingDefaultErrorMessage(updateError, 'Failed to apply committee formatting default'))
    }
  }

  const { error: markAppliedError } = await supabase
    .from('meetings')
    .update({ committee_formatting_default_applied_at: new Date().toISOString() })
    .eq('id', meetingId)

  if (markAppliedError) {
    if (isMissingCommitteeFormattingDefaultsSchemaError(markAppliedError)) {
      throw new Error(MISSING_COMMITTEE_FORMATTING_DEFAULTS_HINT)
    }
    throw new Error(toFormattingDefaultErrorMessage(markAppliedError, 'Failed to mark meeting default application'))
  }

  return {
    applied: true,
    matchedCount: matches.length,
  }
}
