'use server'

import { createClient } from '@/lib/supabase/server'
import { saveMeetingRulesWithClient } from '@/lib/meeting-generation/meeting-rules'
import type { DatabaseClient } from '@/lib/meeting-generation/shared'

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
    supabase: supabase as unknown as DatabaseClient,
    userId: user.id,
    organizationId: profile.organization_id,
  }
}

export async function saveMeetingRules(meetingId: string, rules: string) {
  const { supabase, organizationId, userId } = await requireUserOrg()
  await saveMeetingRulesWithClient({
    supabase,
    meetingId,
    organizationId,
    userId,
    rules,
  })
}
