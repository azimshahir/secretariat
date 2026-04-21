import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import {
  getTranscriptIntelligenceConfig,
  normalizeTranscriptIntelligencePreset,
  type TranscriptIntelligenceConfig,
} from './transcript-intelligence'

function isMissingTranscriptPresetColumn(
  error: { code?: string | null; message?: string | null } | null | undefined,
) {
  if (!error) return false
  if (error.code === 'PGRST204' || error.code === '42703') return true
  const message = (error.message ?? '').toLowerCase()
  return (
    message.includes('organization_ai_settings')
    && message.includes('transcript_intelligence_preset')
  )
}

function isMissingOrganizationAiSettingsTable(
  error: { code?: string | null; message?: string | null } | null | undefined,
) {
  if (!error) return false
  if (error.code === '42P01' || error.code === 'PGRST205') return true
  const message = (error.message ?? '').toLowerCase()
  return (
    message.includes('organization_ai_settings')
    && (message.includes('does not exist') || message.includes('schema cache'))
  )
}

export async function getTranscriptIntelligencePresetForOrganization(
  organizationId: string | null | undefined,
) {
  if (!organizationId) return 'balanced' as const

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('organization_ai_settings')
    .select('transcript_intelligence_preset')
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (error && !isMissingTranscriptPresetColumn(error) && !isMissingOrganizationAiSettingsTable(error)) {
    throw new Error(error.message)
  }

  return normalizeTranscriptIntelligencePreset(data?.transcript_intelligence_preset)
}

export async function getTranscriptIntelligenceConfigForOrganization(
  organizationId: string | null | undefined,
): Promise<TranscriptIntelligenceConfig> {
  const preset = await getTranscriptIntelligencePresetForOrganization(organizationId)
  return getTranscriptIntelligenceConfig(preset)
}
