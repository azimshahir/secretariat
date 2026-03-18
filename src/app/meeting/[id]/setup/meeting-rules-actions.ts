'use server'

import { createClient } from '@/lib/supabase/server'
import { meetingRulesPromptSchema, uuidSchema } from '@/lib/validation'

const MISSING_COLUMN_HINT = 'Database migration missing: column public.meetings.meeting_rules is not created yet. Please run the latest Supabase migrations.'

function isMissingMeetingRulesColumn(error: { code?: string | null; message?: string | null } | null | undefined) {
  if (!error) return false
  if (error.code === 'PGRST204') return true
  const message = (error.message ?? '').toLowerCase()
  return message.includes('meeting_rules') && message.includes('schema cache')
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

async function assertMeetingInOrg(
  supabase: Awaited<ReturnType<typeof createClient>>,
  meetingId: string,
  organizationId: string,
) {
  const { data: meeting, error } = await supabase
    .from('meetings')
    .select('id')
    .eq('id', meetingId)
    .eq('organization_id', organizationId)
    .single()

  if (error || !meeting) {
    throw new Error('Meeting not found or inaccessible')
  }
}

export async function saveMeetingRules(meetingId: string, rules: string) {
  const parsedMeetingId = uuidSchema.parse(meetingId)
  const parsedRules = meetingRulesPromptSchema.parse(rules).trim()
  const { supabase, organizationId, userId } = await requireUserOrg()

  await assertMeetingInOrg(supabase, parsedMeetingId, organizationId)

  const { error } = await supabase
    .from('meetings')
    .update({ meeting_rules: parsedRules })
    .eq('id', parsedMeetingId)
    .eq('organization_id', organizationId)

  if (error) {
    if (isMissingMeetingRulesColumn(error)) {
      throw new Error(MISSING_COLUMN_HINT)
    }
    throw new Error(error.message)
  }

  await supabase.from('audit_logs').insert({
    organization_id: organizationId,
    meeting_id: parsedMeetingId,
    user_id: userId,
    action: 'meeting_rules_updated',
    details: { meeting_id: parsedMeetingId, rules_length: parsedRules.length },
  })
}
