'use server'

import { createClient } from '@/lib/supabase/server'
import {
  committeeMinuteInstructionSchema,
  uuidSchema,
} from '@/lib/validation'
import type { CommitteeGenerationSettingsResult } from './committee-generation-model'

const MISSING_TABLE_HINT = 'Database migration missing: table public.committee_generation_settings is not created yet. Please run the latest Supabase migrations.'

function isMissingCommitteeGenerationSettingsTable(error: { code?: string | null; message?: string | null } | null | undefined) {
  if (!error) return false
  if (error.code === 'PGRST205') return true
  const message = (error.message ?? '').toLowerCase()
  return message.includes('committee_generation_settings') && message.includes('schema cache')
}

async function requireUserOrg() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()

  if (!profile) throw new Error('Profile not found')

  return {
    supabase,
    userId: user.id,
    organizationId: profile.organization_id,
  }
}

async function assertCommitteeInOrg(
  supabase: Awaited<ReturnType<typeof createClient>>,
  committeeId: string,
  organizationId: string,
) {
  const { data: committee, error } = await supabase
    .from('committees')
    .select('id')
    .eq('id', committeeId)
    .eq('organization_id', organizationId)
    .single()

  if (error || !committee) {
    throw new Error('Committee not found or inaccessible')
  }
}

export async function getCommitteeGenerationSettings(committeeId: string): Promise<CommitteeGenerationSettingsResult> {
  const parsedCommitteeId = uuidSchema.parse(committeeId)
  const { supabase, organizationId } = await requireUserOrg()

  await assertCommitteeInOrg(supabase, parsedCommitteeId, organizationId)

  const { data: settings, error: settingsError } = await supabase
    .from('committee_generation_settings')
    .select('default_format_template_id, default_format_source_name, minute_instruction, template_sections')
    .eq('committee_id', parsedCommitteeId)
    .maybeSingle()
  if (settingsError) {
    if (isMissingCommitteeGenerationSettingsTable(settingsError)) {
      return {
        committeeId: parsedCommitteeId,
        defaultFormatTemplateId: null,
        defaultFormatTemplateText: null,
        defaultFormatSourceName: null,
        minuteInstruction: '',
        templateSections: [],
      }
    }
    throw new Error(settingsError.message)
  }

  let defaultFormatTemplateText: string | null = null
  if (settings?.default_format_template_id) {
    const { data: template } = await supabase
      .from('format_templates')
      .select('prompt_text')
      .eq('id', settings.default_format_template_id)
      .eq('committee_id', parsedCommitteeId)
      .maybeSingle()

    defaultFormatTemplateText = template?.prompt_text ?? null
  }

  return {
    committeeId: parsedCommitteeId,
    defaultFormatTemplateId: settings?.default_format_template_id ?? null,
    defaultFormatTemplateText,
    defaultFormatSourceName: settings?.default_format_source_name ?? null,
    minuteInstruction: settings?.minute_instruction ?? '',
    templateSections: Array.isArray(settings?.template_sections) ? settings.template_sections : [],
  }
}

async function persistCommitteeMinuteInstruction(committeeId: string, instruction: string) {
  const parsedCommitteeId = uuidSchema.parse(committeeId)
  const parsedInstruction = committeeMinuteInstructionSchema.parse(instruction).trim()

  const { supabase, organizationId, userId } = await requireUserOrg()
  await assertCommitteeInOrg(supabase, parsedCommitteeId, organizationId)

  const { error } = await supabase
    .from('committee_generation_settings')
    .upsert(
      {
        committee_id: parsedCommitteeId,
        minute_instruction: parsedInstruction,
      },
      { onConflict: 'committee_id' },
    )

  if (error) {
    if (isMissingCommitteeGenerationSettingsTable(error)) {
      throw new Error(MISSING_TABLE_HINT)
    }
    throw new Error(error.message)
  }

  await supabase.from('audit_logs').insert({
    organization_id: organizationId,
    user_id: userId,
    action: 'committee_minute_instruction_updated',
    details: { committee_id: parsedCommitteeId },
  })
}

export async function saveCommitteeMinuteInstruction(
  committeeId: string,
  instruction: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await persistCommitteeMinuteInstruction(committeeId, instruction)
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save minute instruction'
    console.error('[saveCommitteeMinuteInstruction] failed:', {
      committeeId,
      message,
    })
    return { ok: false, message }
  }
}
