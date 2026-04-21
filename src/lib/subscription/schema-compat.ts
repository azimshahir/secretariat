import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>
type SupabaseErrorLike = { code?: string | null; message?: string | null } | null | undefined

function normalizeErrorMessage(error: SupabaseErrorLike) {
  return (error?.message ?? '').toLowerCase()
}

function isMissingColumn(error: SupabaseErrorLike, table: string, column: string) {
  if (!error) return false
  if (error.code === '42703' || error.code === 'PGRST204') return true

  const message = normalizeErrorMessage(error)
  return (
    message.includes(table.toLowerCase())
    && message.includes(column.toLowerCase())
    && (
      message.includes('column')
      || message.includes('schema cache')
      || message.includes('could not find')
    )
  )
}

function isMissingTable(error: SupabaseErrorLike, table: string) {
  if (!error) return false
  if (error.code === '42p01' || error.code === 'PGRST205') return true

  const message = normalizeErrorMessage(error)
  return (
    message.includes(table.toLowerCase())
    && (
      message.includes('relation')
      || message.includes('does not exist')
      || message.includes('schema cache')
      || message.includes('could not find')
    )
  )
}

export function isMissingProfilesCreditBalanceColumn(error: SupabaseErrorLike) {
  return isMissingColumn(error, 'profiles', 'credit_balance')
}

export function isMissingUserSubscriptionUsageTable(error: SupabaseErrorLike) {
  return isMissingTable(error, 'user_subscription_usage_monthly')
}

export function isMissingUserCreditLedgerTable(error: SupabaseErrorLike) {
  return isMissingTable(error, 'user_credit_ledger')
}

export function isMissingOrganizationAiPlanSettingsTable(error: SupabaseErrorLike) {
  return isMissingTable(error, 'organization_ai_plan_settings')
}

export interface SubscriptionSchemaCompatibility {
  profilesCreditBalanceAvailable: boolean
  usageTrackingAvailable: boolean
  creditLedgerAvailable: boolean
  planAiMatrixAvailable: boolean
  subscriptionSetupPending: boolean
}

export async function getSubscriptionSchemaCompatibility(params: {
  organizationId?: string | null
  adminSupabase?: AdminClient
} = {}): Promise<SubscriptionSchemaCompatibility> {
  const admin = params.adminSupabase ?? createAdminClient()

  const profileQuery = admin
    .from('profiles')
    .select('credit_balance', { count: 'exact', head: true })
    .limit(1)

  if (params.organizationId) {
    profileQuery.eq('organization_id', params.organizationId)
  }

  const usageQuery = admin
    .from('user_subscription_usage_monthly')
    .select('user_id', { count: 'exact', head: true })
    .limit(1)

  if (params.organizationId) {
    usageQuery.eq('organization_id', params.organizationId)
  }

  const ledgerQuery = admin
    .from('user_credit_ledger')
    .select('id', { count: 'exact', head: true })
    .limit(1)

  if (params.organizationId) {
    ledgerQuery.eq('organization_id', params.organizationId)
  }

  const planAiQuery = admin
    .from('organization_ai_plan_settings')
    .select('organization_id', { count: 'exact', head: true })
    .limit(1)

  if (params.organizationId) {
    planAiQuery.eq('organization_id', params.organizationId)
  }

  const [
    { error: profileError },
    { error: usageError },
    { error: ledgerError },
    { error: planAiError },
  ] = await Promise.all([
    profileQuery,
    usageQuery,
    ledgerQuery,
    planAiQuery,
  ])

  const profilesCreditBalanceAvailable = !isMissingProfilesCreditBalanceColumn(profileError)
  const usageTrackingAvailable = !isMissingUserSubscriptionUsageTable(usageError)
  const creditLedgerAvailable = !isMissingUserCreditLedgerTable(ledgerError)
  const planAiMatrixAvailable = !isMissingOrganizationAiPlanSettingsTable(planAiError)

  return {
    profilesCreditBalanceAvailable,
    usageTrackingAvailable,
    creditLedgerAvailable,
    planAiMatrixAvailable,
    subscriptionSetupPending: !profilesCreditBalanceAvailable
      || !usageTrackingAvailable
      || !creditLedgerAvailable,
  }
}
