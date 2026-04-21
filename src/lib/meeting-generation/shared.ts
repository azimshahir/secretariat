import { createAdminClient } from '@/lib/supabase/admin'
import type { GenerationConfig } from './types'

export type DatabaseClient = ReturnType<typeof createAdminClient>

export const MISSING_MEETING_RULES_HINT =
  'Database migration missing: column public.meetings.meeting_rules is not created yet. Please run the latest Supabase migrations.'

export function isMissingMeetingRulesColumn(error: { code?: string | null; message?: string | null } | null | undefined) {
  if (!error) return false
  if (error.code === 'PGRST204') return true
  const message = (error.message ?? '').toLowerCase()
  return message.includes('meeting_rules') && message.includes('schema cache')
}

export function resolveMeetingRulesPrompt(
  config?: Pick<GenerationConfig, 'meetingRulesPrompt' | 'highlightPrompt'>,
  fallback?: string | null,
) {
  const canonical = config?.meetingRulesPrompt?.trim()
  if (canonical) return canonical

  const legacy = config?.highlightPrompt?.trim()
  if (legacy) return legacy

  const fromMeeting = fallback?.trim()
  if (fromMeeting) return fromMeeting

  return undefined
}
