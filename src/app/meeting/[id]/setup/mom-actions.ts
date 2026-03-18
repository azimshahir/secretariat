'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { uuidSchema, saveAgendaFormattingSchema } from '@/lib/validation'

const MISSING_CLEAR_FORMATTING_RPC_HINT =
  'Database migration missing: clear formatting RPC functions are not created yet. Please run the latest Supabase migrations.'

type SupabaseErrorLike = { code?: string | null; message?: string | null } | null | undefined
type ServerSupabase = Awaited<ReturnType<typeof createClient>>

export interface SavedAgendaFormatting {
  templateId: string
  templateName: string
  promptText: string
  additionalInfo: string
}

export interface AgendaFormattingState {
  agendaId: string
  templateId: string | null
  templateName: string | null
  promptText: string
  additionalInfo: string
}

function toErrorMessage(error: SupabaseErrorLike, fallback: string) {
  const message = (error?.message ?? '').trim()
  return message || fallback
}

function isMissingRpcFunctionError(error: SupabaseErrorLike, functionName: string) {
  if (!error) return false
  if (error.code === 'PGRST202') return true
  const message = (error.message ?? '').toLowerCase()
  const fn = functionName.toLowerCase()
  return message.includes(fn) && (message.includes('schema cache') || message.includes('function'))
}

function isMissingAdditionalInfoColumnError(error: SupabaseErrorLike) {
  if (!error) return false
  if (error.code === '42703') return true
  const message = (error.message ?? '').toLowerCase()
  if (!message.includes('additional_info')) return false
  return (
    message.includes('does not exist')
    || message.includes('schema cache')
    || message.includes('could not find')
    || error.code === 'PGRST204'
  )
}

async function clearAgendaFormattingLegacy(supabase: ServerSupabase, agendaId: string) {
  const { error } = await supabase
    .from('agendas')
    .update({
      format_template_id: null,
      additional_info: null,
    })
    .eq('id', agendaId)

  if (!error) return

  if (isMissingAdditionalInfoColumnError(error)) {
    const { error: fallbackError } = await supabase
      .from('agendas')
      .update({ format_template_id: null })
      .eq('id', agendaId)
    if (!fallbackError) return
    throw new Error(toErrorMessage(fallbackError, 'Failed to clear formatting'))
  }

  throw new Error(toErrorMessage(error, 'Failed to clear formatting'))
}

async function clearMeetingFormattingLegacy(supabase: ServerSupabase, meetingId: string) {
  const { error } = await supabase
    .from('agendas')
    .update({
      format_template_id: null,
      additional_info: null,
    })
    .eq('meeting_id', meetingId)

  if (!error) return

  if (isMissingAdditionalInfoColumnError(error)) {
    const { error: fallbackError } = await supabase
      .from('agendas')
      .update({ format_template_id: null })
      .eq('meeting_id', meetingId)
    if (!fallbackError) return
    throw new Error(toErrorMessage(fallbackError, 'Failed to clear meeting formatting'))
  }

  throw new Error(toErrorMessage(error, 'Failed to clear meeting formatting'))
}

export async function upsertFormatFromPaste(
  agendaId: string,
  committeeId: string,
  name: string,
  promptText: string,
  additionalInfo?: string,
): Promise<SavedAgendaFormatting> {
  const parsed = saveAgendaFormattingSchema.safeParse({
    agendaId,
    committeeId,
    name: name.trim(),
    promptText,
    additionalInfo: additionalInfo ?? '',
  })
  if (!parsed.success) {
    const tooLarge = parsed.error.issues.some(
      issue =>
        issue.code === 'too_big'
        && (issue.path.includes('promptText') || issue.path.includes('additionalInfo')),
    )
    if (tooLarge) {
      throw new Error('Formatting content too large. Please reduce size.')
    }
    throw new Error('Invalid formatting input')
  }
  const {
    agendaId: parsedAgendaId,
    committeeId: parsedCommitteeId,
    name: parsedName,
    promptText: parsedPromptText,
    additionalInfo: parsedAdditionalInfo,
  } = parsed.data

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  // Create format template
  const { data: template, error } = await supabase
    .from('format_templates')
    .insert({ committee_id: parsedCommitteeId, name: parsedName, prompt_text: parsedPromptText })
    .select('id')
    .single()

  if (error || !template) throw new Error('Failed to save format template')

  // Link template to agenda — use .select().single() to detect silent RLS failures
  const { data: linked, error: linkError } = await supabase
    .from('agendas')
    .update({
      format_template_id: template.id,
      additional_info: parsedAdditionalInfo || null,
    })
    .eq('id', parsedAgendaId)
    .select('id')
    .single()

  if (linkError || !linked) {
    // Retry without additional_info if column is missing
    if (isMissingAdditionalInfoColumnError(linkError)) {
      const { data: fallbackLinked, error: fallbackError } = await supabase
        .from('agendas')
        .update({ format_template_id: template.id })
        .eq('id', parsedAgendaId)
        .select('id')
        .single()
      if (fallbackError || !fallbackLinked) {
        throw new Error(toErrorMessage(fallbackError, 'Failed to link format to agenda — check RLS policies'))
      }
    } else {
      throw new Error(toErrorMessage(linkError, 'Failed to link format to agenda — check RLS policies'))
    }
  }

  return {
    templateId: template.id,
    templateName: parsedName,
    promptText: parsedPromptText,
    additionalInfo: parsedAdditionalInfo,
  }
}

export async function getAgendaFormattingState(agendaId: string): Promise<AgendaFormattingState> {
  const parsedAgendaId = uuidSchema.parse(agendaId)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  let { data: agenda, error: agendaError } = await supabase
    .from('agendas')
    .select('id, additional_info, format_template_id')
    .eq('id', parsedAgendaId)
    .single()

  if (agendaError && isMissingAdditionalInfoColumnError(agendaError)) {
    const fallback = await supabase
      .from('agendas')
      .select('id, format_template_id')
      .eq('id', parsedAgendaId)
      .single()
    agenda = fallback.data
      ? { ...fallback.data, additional_info: '' }
      : null
    agendaError = fallback.error
  }

  if (agendaError) throw new Error(toErrorMessage(agendaError, 'Failed to load agenda formatting'))
  if (!agenda) {
    throw new Error('Agenda not found')
  }

  if (!agenda.format_template_id) {
    return {
      agendaId: parsedAgendaId,
      templateId: null,
      templateName: null,
      promptText: '',
      additionalInfo: agenda.additional_info ?? '',
    }
  }

  const { data: template, error: templateError } = await supabase
    .from('format_templates')
    .select('id, name, prompt_text')
    .eq('id', agenda.format_template_id)
    .single()
  if (templateError) throw new Error(toErrorMessage(templateError, 'Failed to load template formatting'))

  return {
    agendaId: parsedAgendaId,
    templateId: template?.id ?? agenda.format_template_id,
    templateName: template?.name ?? null,
    promptText: template?.prompt_text ?? '',
    additionalInfo: agenda.additional_info ?? '',
  }
}

export async function updateAgendaStatus(
  agendaIds: string[],
  status: 'done' | 'ongoing' | 'pending',
) {
  agendaIds.forEach(id => uuidSchema.parse(id))
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  for (const id of agendaIds) {
    await supabase.from('agendas').update({ minute_status: status }).eq('id', id)
  }
}

export async function updateAgendaSkipped(agendaId: string, isSkipped: boolean) {
  const parsedId = uuidSchema.parse(agendaId)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  await supabase.from('agendas').update({ is_skipped: isSkipped }).eq('id', parsedId)
}

export async function bulkSaveSkipped(meetingId: string, skippedIds: string[]) {
  const parsedMeetingId = uuidSchema.parse(meetingId)
  skippedIds.forEach(id => uuidSchema.parse(id))
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  // Reset all to not skipped
  await supabase.from('agendas').update({ is_skipped: false }).eq('meeting_id', parsedMeetingId)
  // Set skipped ones
  if (skippedIds.length > 0) {
    await supabase.from('agendas').update({ is_skipped: true }).in('id', skippedIds)
  }
}

export async function applyFormatToSubItems(
  templateId: string,
  subItemIds: string[],
) {
  uuidSchema.parse(templateId)
  subItemIds.forEach(id => uuidSchema.parse(id))
  if (subItemIds.length === 0) return

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { error } = await supabase
    .from('agendas')
    .update({ format_template_id: templateId })
    .in('id', subItemIds)

  if (error) {
    throw new Error(`Failed to apply format to sub-items: ${error.message}`)
  }
}

export async function clearAgendaFormatting(agendaId: string) {
  const parsedAgendaId = uuidSchema.parse(agendaId)

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { error: rpcError } = await supabase
    .rpc('clear_agenda_formatting_for_org_member', { p_agenda_id: parsedAgendaId })

  if (!rpcError) return

  if (isMissingRpcFunctionError(rpcError, 'clear_agenda_formatting_for_org_member')) {
    try {
      await clearAgendaFormattingLegacy(supabase, parsedAgendaId)
      return
    } catch (legacyError) {
      const legacyMessage = legacyError instanceof Error ? ` (${legacyError.message})` : ''
      throw new Error(`${MISSING_CLEAR_FORMATTING_RPC_HINT}${legacyMessage}`)
    }
  }

  throw new Error(toErrorMessage(rpcError, 'Failed to clear formatting'))
}

export async function clearMeetingFormatting(meetingId: string) {
  const parsedMeetingId = uuidSchema.parse(meetingId)

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { error: rpcError } = await supabase
    .rpc('clear_meeting_formatting_for_org_member', { p_meeting_id: parsedMeetingId })

  if (!rpcError) return

  if (isMissingRpcFunctionError(rpcError, 'clear_meeting_formatting_for_org_member')) {
    try {
      await clearMeetingFormattingLegacy(supabase, parsedMeetingId)
      return
    } catch (legacyError) {
      const legacyMessage = legacyError instanceof Error ? ` (${legacyError.message})` : ''
      throw new Error(`${MISSING_CLEAR_FORMATTING_RPC_HINT}${legacyMessage}`)
    }
  }

  throw new Error(toErrorMessage(rpcError, 'Failed to clear meeting formatting'))
}

export async function clearAllGeneratedMinutes(meetingId: string) {
  const parsedId = uuidSchema.parse(meetingId)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { data: agendas } = await supabase
    .from('agendas').select('id').eq('meeting_id', parsedId)
  if (!agendas?.length) return

  const agendaIds = agendas.map(a => a.id)

  // Delete minutes for all agendas in this meeting
  await supabase.from('minutes').delete().in('agenda_id', agendaIds)
  // Reset agenda statuses to pending
  await supabase.from('agendas').update({ minute_status: 'pending' }).eq('meeting_id', parsedId)

  revalidatePath(`/meeting/${parsedId}/setup`)
}
