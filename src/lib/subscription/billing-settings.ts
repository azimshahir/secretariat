import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'

export interface BillingSettings {
  creditsPerTranscriptionHour: number
  creditPriceRm: number
}

export const DEFAULT_BILLING_SETTINGS: BillingSettings = {
  creditsPerTranscriptionHour: 4,
  creditPriceRm: 0.20,
}

// Top-up slider bounds (credits)
export const TOPUP_MIN_CREDITS = 10
export const TOPUP_MAX_CREDITS = 2000
export const TOPUP_STEP_CREDITS = 10

function isMissingBillingSettingsTable(error: { code?: string | null; message?: string | null } | null) {
  if (!error) return false
  if (error.code === '42P01') return true
  const message = (error.message ?? '').toLowerCase()
  return message.includes('organization_billing_settings')
}

export async function getBillingSettings(
  organizationId: string | null | undefined,
  adminSupabase?: ReturnType<typeof createAdminClient>,
): Promise<BillingSettings> {
  if (!organizationId) return DEFAULT_BILLING_SETTINGS
  const admin = adminSupabase ?? createAdminClient()
  const { data, error } = await admin
    .from('organization_billing_settings')
    .select('credits_per_transcription_hour, credit_price_rm')
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (error) {
    if (isMissingBillingSettingsTable(error)) return DEFAULT_BILLING_SETTINGS
    throw new Error(error.message)
  }
  if (!data) return DEFAULT_BILLING_SETTINGS

  return {
    creditsPerTranscriptionHour: Math.max(1, Math.trunc(data.credits_per_transcription_hour ?? DEFAULT_BILLING_SETTINGS.creditsPerTranscriptionHour)),
    creditPriceRm: Number(data.credit_price_rm ?? DEFAULT_BILLING_SETTINGS.creditPriceRm),
  }
}

export function transcriptionCreditCost(durationSec: number, creditsPerHour: number): number {
  if (durationSec <= 0) return 0
  return Math.ceil((durationSec / 3600) * creditsPerHour)
}
