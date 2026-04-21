import { meetingRulesPromptSchema, uuidSchema } from '@/lib/validation'
import { type DatabaseClient, isMissingMeetingRulesColumn, MISSING_MEETING_RULES_HINT } from './shared'

async function assertMeetingInOrg(
  supabase: DatabaseClient,
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

export async function saveMeetingRulesWithClient(params: {
  supabase: DatabaseClient
  meetingId: string
  organizationId: string
  userId: string
  rules: string
}) {
  const parsedMeetingId = uuidSchema.parse(params.meetingId)
  const parsedRules = meetingRulesPromptSchema.parse(params.rules).trim()

  await assertMeetingInOrg(params.supabase, parsedMeetingId, params.organizationId)

  const { error } = await params.supabase
    .from('meetings')
    .update({ meeting_rules: parsedRules })
    .eq('id', parsedMeetingId)
    .eq('organization_id', params.organizationId)

  if (error) {
    if (isMissingMeetingRulesColumn(error)) {
      throw new Error(MISSING_MEETING_RULES_HINT)
    }
    throw new Error(error.message)
  }

  await params.supabase.from('audit_logs').insert({
    organization_id: params.organizationId,
    meeting_id: parsedMeetingId,
    user_id: params.userId,
    action: 'meeting_rules_updated',
    details: { meeting_id: parsedMeetingId, rules_length: parsedRules.length },
  })
}

