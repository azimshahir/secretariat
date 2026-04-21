'use server'

import { createClient } from '@/lib/supabase/server'
import { generateAllMinutesWithClient, generateMinutesForAgendaWithClient } from '@/lib/meeting-generation/generate-minutes'
import type { DatabaseClient } from '@/lib/meeting-generation/shared'
import type {
  GenerateMinutesForAgendaResult,
  GenerationConfig,
  GenerationRuntimeContext,
} from '@/lib/meeting-generation/types'
import { normalizePlanTier } from '@/lib/subscription/catalog'

interface GenerateAllMinutesResult {
  generatedCount: number
  skippedCount: number
  skipped: Array<{ agendaId: string; agendaNo: string; reason: string }>
}

export type { GenerationConfig, GenerationRuntimeContext, GenerateMinutesForAgendaResult }

async function requireUserContext() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, plan')
    .eq('id', user.id)
    .single()

  return {
    supabase: supabase as unknown as DatabaseClient,
    userId: user.id,
    organizationId: profile?.organization_id ?? null,
    planTier: normalizePlanTier(profile?.plan),
  }
}

export async function generateMinutesForAgenda(
  agendaId: string,
  config?: GenerationConfig,
  runtimeContext?: GenerationRuntimeContext,
): Promise<GenerateMinutesForAgendaResult> {
  const { supabase, userId, organizationId, planTier } = await requireUserContext()
  return await generateMinutesForAgendaWithClient({
    supabase,
    agendaId,
    userId,
    organizationId,
    config,
    runtimeContext: {
      ...runtimeContext,
      userPlanTier: runtimeContext?.userPlanTier ?? planTier,
    },
  })
}

export async function generateAllMinutes(
  meetingId: string,
  config?: GenerationConfig,
): Promise<GenerateAllMinutesResult> {
  const { supabase, userId, organizationId, planTier } = await requireUserContext()
  return await generateAllMinutesWithClient({
    supabase,
    meetingId,
    userId,
    organizationId,
    userPlanTier: planTier,
    config,
  })
}
