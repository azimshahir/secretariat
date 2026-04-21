import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import {
  GO_DEEPER_AGENT_CREDIT_COST,
  TRANSCRIPTION_SECONDS_PER_CREDIT,
  getAllowedAiModelOptionsForPlan,
  getSubscriptionPlan,
  normalizePlanTier,
} from '@/lib/subscription/catalog'
import {
  getSubscriptionSchemaCompatibility,
  isMissingProfilesCreditBalanceColumn,
  isMissingUserCreditLedgerTable,
  isMissingUserSubscriptionUsageTable,
  type SubscriptionSchemaCompatibility,
} from '@/lib/subscription/schema-compat'
import type {
  PlanTier,
  UserCreditLedger,
  UserCreditLedgerEntryKind,
  UserSubscriptionUsageMonthly,
} from '@/lib/supabase/types'

type AdminClient = ReturnType<typeof createAdminClient>
type EntitlementErrorLike = { code?: string | null; message?: string | null }

export class SubscriptionLimitError extends Error {
  code: string
  status: number

  constructor(message: string, code: string, status = 403) {
    super(message)
    this.code = code
    this.status = status
  }
}

export interface UserEntitlementSnapshot {
  userId: string
  organizationId: string
  planTier: PlanTier
  creditBalance: number
  subscriptionSetupPending: boolean
  compatibility: SubscriptionSchemaCompatibility
  usageMonth: string
  usage: UserSubscriptionUsageMonthly
  transcriptReviewJobsRemaining: number
  transcriptionSecondsRemaining: number
  extractMinuteRunsRemaining: number | null
  includedCreditsRemaining: number
  walletCreditsRemaining: number
  totalCreditsRemaining: number
}

interface LoadedProfile {
  id: string
  organization_id: string
  plan: string | null
  credit_balance: number
}

function startOfCurrentUsageMonth(referenceDate = new Date()) {
  const year = referenceDate.getUTCFullYear()
  const month = referenceDate.getUTCMonth()
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10)
}

function toSafeInt(value: number | null | undefined) {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value as number)) : 0
}

function toEntitlementErrorLike(error: unknown): EntitlementErrorLike {
  if (error && typeof error === 'object') {
    const candidate = error as EntitlementErrorLike
    return {
      code: candidate.code ?? null,
      message: candidate.message ?? null,
    }
  }

  return {
    code: null,
    message: error instanceof Error ? error.message : String(error),
  }
}

async function loadProfile(
  admin: AdminClient,
  userId: string,
  organizationId?: string | null,
  compatibility?: SubscriptionSchemaCompatibility,
) {
  const shouldReadCreditBalance = compatibility?.profilesCreditBalanceAvailable ?? true
  const query = shouldReadCreditBalance
    ? admin.from('profiles').select('id, organization_id, plan, credit_balance').eq('id', userId)
    : admin.from('profiles').select('id, organization_id, plan').eq('id', userId)

  if (organizationId) {
    query.eq('organization_id', organizationId)
  }

  const { data, error } = await query.maybeSingle()
  if (error) {
    throw new Error(error.message)
  }
  if (!data) {
    throw new Error('User profile not found')
  }

  return {
    id: data.id,
    organization_id: data.organization_id,
    plan: data.plan,
    credit_balance: shouldReadCreditBalance ? toSafeInt((data as { credit_balance?: number | null }).credit_balance) : 0,
  } satisfies LoadedProfile
}

function createEmptyUsageRow(params: {
  userId: string
  organizationId: string
  usageMonth: string
}) {
  return {
    user_id: params.userId,
    organization_id: params.organizationId,
    usage_month: params.usageMonth,
    meetings_created: 0,
    transcript_review_jobs: 0,
    transcription_seconds_used: 0,
    go_deeper_agent_runs: 0,
    best_fit_mom_runs: 0,
    extract_minute_runs: 0,
    credits_consumed: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } satisfies UserSubscriptionUsageMonthly
}

async function getOrCreateMonthlyUsage(
  admin: AdminClient,
  params: {
    userId: string
    organizationId: string
    usageMonth: string
    planTier?: string | null | undefined
  },
) {
  const { data, error } = await admin
    .from('user_subscription_usage_monthly')
    .select('*')
    .eq('user_id', params.userId)
    .eq('usage_month', params.usageMonth)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  if (data) {
    return data as UserSubscriptionUsageMonthly
  }

  const insertedRow = {
    user_id: params.userId,
    organization_id: params.organizationId,
    usage_month: params.usageMonth,
    meetings_created: 0,
    transcript_review_jobs: 0,
    transcription_seconds_used: 0,
    go_deeper_agent_runs: 0,
    best_fit_mom_runs: 0,
    extract_minute_runs: 0,
    credits_consumed: 0,
  }

  const { data: inserted, error: insertError } = await admin
    .from('user_subscription_usage_monthly')
    .insert(insertedRow)
    .select('*')
    .single()

  if (insertError || !inserted) {
    throw new Error(insertError?.message ?? 'Failed to initialize monthly subscription usage')
  }

  const plan = getSubscriptionPlan(params.planTier)
  await admin
    .from('user_credit_ledger')
    .insert({
      user_id: params.userId,
      organization_id: params.organizationId,
      usage_month: params.usageMonth,
      entry_kind: 'monthly_included_credits',
      credits_delta: plan.includedCredits,
      applies_to_wallet: false,
      reason: `${plan.label} monthly included credits`,
      metadata: {
        planTier: plan.tier,
        includedCredits: plan.includedCredits,
      },
    })

  return inserted as UserSubscriptionUsageMonthly
}

async function updateMonthlyUsage(
  admin: AdminClient,
  current: UserSubscriptionUsageMonthly,
  next: Partial<UserSubscriptionUsageMonthly>,
) {
  const payload = {
    meetings_created: toSafeInt(next.meetings_created ?? current.meetings_created),
    transcript_review_jobs: toSafeInt(next.transcript_review_jobs ?? current.transcript_review_jobs),
    transcription_seconds_used: toSafeInt(next.transcription_seconds_used ?? current.transcription_seconds_used),
    go_deeper_agent_runs: toSafeInt(next.go_deeper_agent_runs ?? current.go_deeper_agent_runs),
    best_fit_mom_runs: toSafeInt(next.best_fit_mom_runs ?? current.best_fit_mom_runs),
    extract_minute_runs: toSafeInt(next.extract_minute_runs ?? current.extract_minute_runs),
    credits_consumed: toSafeInt(next.credits_consumed ?? current.credits_consumed),
  }

  const { data, error } = await admin
    .from('user_subscription_usage_monthly')
    .update(payload)
    .eq('user_id', current.user_id)
    .eq('usage_month', current.usage_month)
    .select('*')
    .single()

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to update subscription usage')
  }

  return data as UserSubscriptionUsageMonthly
}

async function insertLedgerEntry(
  admin: AdminClient,
  input: Omit<UserCreditLedger, 'id' | 'created_at'>,
) {
  const { error } = await admin
    .from('user_credit_ledger')
    .insert({
      user_id: input.user_id,
      organization_id: input.organization_id,
      usage_month: input.usage_month,
      meeting_id: input.meeting_id,
      entry_kind: input.entry_kind,
      credits_delta: input.credits_delta,
      applies_to_wallet: input.applies_to_wallet,
      reason: input.reason,
      metadata: input.metadata ?? {},
      created_by: input.created_by,
    })

  if (error) {
    throw new Error(error.message)
  }
}

function buildSnapshot(
  profile: LoadedProfile,
  usage: UserSubscriptionUsageMonthly,
  compatibility: SubscriptionSchemaCompatibility,
) {
  const planTier = normalizePlanTier(profile.plan)
  const plan = getSubscriptionPlan(planTier)
  const includedCreditsRemaining = Math.max(0, plan.includedCredits - toSafeInt(usage.credits_consumed))
  const walletCreditsRemaining = toSafeInt(profile.credit_balance)
  const totalCreditsRemaining = includedCreditsRemaining + walletCreditsRemaining

  return {
    userId: profile.id,
    organizationId: profile.organization_id,
    planTier,
    creditBalance: walletCreditsRemaining,
    subscriptionSetupPending: compatibility.subscriptionSetupPending,
    compatibility,
    usageMonth: usage.usage_month,
    usage,
    transcriptReviewJobsRemaining: Math.max(0, plan.transcriptReviewJobs - toSafeInt(usage.transcript_review_jobs)),
    transcriptionSecondsRemaining: Math.max(0, plan.transcriptionHours * 3600 - toSafeInt(usage.transcription_seconds_used)),
    extractMinuteRunsRemaining: plan.extractMinuteMonthlyLimit == null
      ? null
      : Math.max(0, plan.extractMinuteMonthlyLimit - toSafeInt(usage.extract_minute_runs)),
    includedCreditsRemaining,
    walletCreditsRemaining,
    totalCreditsRemaining,
  } satisfies UserEntitlementSnapshot
}

export async function getUserEntitlementSnapshot(params: {
  userId: string
  organizationId?: string | null
  adminSupabase?: AdminClient
}) {
  const admin = params.adminSupabase ?? createAdminClient()
  const usageMonth = startOfCurrentUsageMonth()
  let compatibility = await getSubscriptionSchemaCompatibility({
    organizationId: params.organizationId,
    adminSupabase: admin,
  })
  let profile: LoadedProfile

  try {
    profile = await loadProfile(
      admin,
      params.userId,
      params.organizationId,
      compatibility,
    )
  } catch (error) {
    const normalizedError = toEntitlementErrorLike(error)
    if (!isMissingProfilesCreditBalanceColumn(normalizedError)) {
      throw error
    }

    compatibility = {
      ...compatibility,
      profilesCreditBalanceAvailable: false,
      subscriptionSetupPending: true,
    }

    profile = await loadProfile(
      admin,
      params.userId,
      params.organizationId,
      compatibility,
    )
  }

  let usage: UserSubscriptionUsageMonthly
  if (compatibility.subscriptionSetupPending) {
    usage = createEmptyUsageRow({
      userId: profile.id,
      organizationId: profile.organization_id,
      usageMonth,
    })
  } else {
    try {
      usage = await getOrCreateMonthlyUsage(admin, {
        userId: profile.id,
        organizationId: profile.organization_id,
        usageMonth,
        planTier: profile.plan,
      })
    } catch (error) {
      const normalizedError = toEntitlementErrorLike(error)
      if (
        !isMissingUserSubscriptionUsageTable(normalizedError)
        && !isMissingUserCreditLedgerTable(normalizedError)
      ) {
        throw error
      }

      compatibility = {
        ...compatibility,
        usageTrackingAvailable: false,
        creditLedgerAvailable: false,
        subscriptionSetupPending: true,
      }
      usage = createEmptyUsageRow({
        userId: profile.id,
        organizationId: profile.organization_id,
        usageMonth,
      })
    }
  }

  return buildSnapshot(profile, usage, compatibility)
}

export function getAskModelOptionsForUserPlan(planTier: string | null | undefined) {
  return getAllowedAiModelOptionsForPlan(planTier)
}

export function assertAskModelAllowedForUserPlan(planTier: string | null | undefined, modelId: string) {
  const allowed = getAllowedAiModelOptionsForPlan(planTier)
  if (!allowed.some(option => option.id === modelId)) {
    throw new SubscriptionLimitError(
      'That AI model is not available on your current plan.',
      'ask_model_not_allowed',
      403,
    )
  }
}

export async function assertTranscriptUploadAllowed(params: {
  userId: string
  organizationId?: string | null
  mediaKind: 'audio' | 'video' | 'document'
  durationSec?: number | null
  adminSupabase?: AdminClient
}) {
  const snapshot = await getUserEntitlementSnapshot(params)
  if (snapshot.subscriptionSetupPending) {
    return snapshot
  }
  const plan = getSubscriptionPlan(snapshot.planTier)

  if (snapshot.transcriptReviewJobsRemaining <= 0) {
    throw new SubscriptionLimitError(
      'You have used all transcript reviews for this month. Ask your admin to top up credits or change your plan.',
      'transcript_reviews_exhausted',
    )
  }

  if (params.mediaKind === 'audio' && !plan.supportsAudioUpload) {
    throw new SubscriptionLimitError(
      'Audio upload is not available on your current plan.',
      'audio_upload_not_allowed',
    )
  }

  if (params.mediaKind === 'video' && !plan.supportsVideoUpload) {
    throw new SubscriptionLimitError(
      'Video upload is not available on your current plan.',
      'video_upload_not_allowed',
    )
  }

  const durationSec = toSafeInt(params.durationSec)
  if ((params.mediaKind === 'audio' || params.mediaKind === 'video') && durationSec > 0) {
    const maxUploadSeconds = plan.transcriptionHours * 3600
    if (maxUploadSeconds <= 0) {
      throw new SubscriptionLimitError(
        'Media upload is not available on your current plan.',
        'media_upload_not_allowed',
      )
    }
    if (durationSec > maxUploadSeconds) {
      throw new SubscriptionLimitError(
        `This recording is longer than the ${plan.transcriptionHours} hour limit allowed for a single upload on your plan.`,
        'media_duration_exceeded',
      )
    }

    const currentSeconds = toSafeInt(snapshot.usage.transcription_seconds_used)
    const includedSeconds = plan.transcriptionHours * 3600
    const overageCredits = Math.max(
      0,
      Math.ceil(Math.max(0, currentSeconds + durationSec - includedSeconds) / TRANSCRIPTION_SECONDS_PER_CREDIT)
        - Math.ceil(Math.max(0, currentSeconds - includedSeconds) / TRANSCRIPTION_SECONDS_PER_CREDIT),
    )

    if (overageCredits > snapshot.totalCreditsRemaining) {
      throw new SubscriptionLimitError(
        'This upload needs more transcription credits than you have left. Ask your admin to top up credits or change your plan.',
        'transcription_credits_exhausted',
      )
    }
  }

  return snapshot
}

export async function recordTranscriptUploadUsage(params: {
  userId: string
  organizationId?: string | null
  meetingId?: string | null
  durationSec?: number | null
  adminSupabase?: AdminClient
  createdBy?: string | null
}) {
  const admin = params.adminSupabase ?? createAdminClient()
  const snapshot = await getUserEntitlementSnapshot({
    userId: params.userId,
    organizationId: params.organizationId,
    adminSupabase: admin,
  })
  if (snapshot.subscriptionSetupPending) {
    return snapshot
  }
  const plan = getSubscriptionPlan(snapshot.planTier)
  const durationSec = toSafeInt(params.durationSec)
  const currentSeconds = toSafeInt(snapshot.usage.transcription_seconds_used)
  const nextSeconds = currentSeconds + durationSec
  const currentCreditsConsumed = toSafeInt(snapshot.usage.credits_consumed)
  const overageCreditsBefore = Math.ceil(Math.max(0, currentSeconds - plan.transcriptionHours * 3600) / TRANSCRIPTION_SECONDS_PER_CREDIT)
  const overageCreditsAfter = Math.ceil(Math.max(0, nextSeconds - plan.transcriptionHours * 3600) / TRANSCRIPTION_SECONDS_PER_CREDIT)
  const overageCredits = Math.max(0, overageCreditsAfter - overageCreditsBefore)
  const totalCreditsRemaining = snapshot.totalCreditsRemaining

  if (overageCredits > totalCreditsRemaining) {
    throw new SubscriptionLimitError(
      'This upload needs more transcription credits than you have left. Ask your admin to top up credits or change your plan.',
      'transcription_credits_exhausted',
    )
  }

  const nextCreditsConsumed = currentCreditsConsumed + overageCredits
  const walletCreditsBefore = Math.max(0, currentCreditsConsumed - plan.includedCredits)
  const walletCreditsAfter = Math.max(0, nextCreditsConsumed - plan.includedCredits)
  const walletCreditsDelta = walletCreditsAfter - walletCreditsBefore

  const updatedUsage = await updateMonthlyUsage(admin, snapshot.usage, {
    transcript_review_jobs: snapshot.usage.transcript_review_jobs + 1,
    transcription_seconds_used: nextSeconds,
    credits_consumed: nextCreditsConsumed,
  })

  if (walletCreditsDelta > 0) {
    const { error } = await admin
      .from('profiles')
      .update({
        credit_balance: Math.max(0, snapshot.creditBalance - walletCreditsDelta),
      })
      .eq('id', snapshot.userId)

    if (error) {
      throw new Error(error.message)
    }
  }

  await insertLedgerEntry(admin, {
    user_id: snapshot.userId,
    organization_id: snapshot.organizationId,
    usage_month: updatedUsage.usage_month,
    meeting_id: params.meetingId ?? null,
    entry_kind: 'transcription_overage',
    credits_delta: walletCreditsDelta > 0 ? -walletCreditsDelta : 0,
    applies_to_wallet: walletCreditsDelta > 0,
    reason: overageCredits > 0 ? 'Transcription overage consumed credits' : 'Transcript review recorded within included allowance',
    metadata: {
      durationSec,
      totalCreditCost: overageCredits,
      includedCreditsApplied: Math.max(0, overageCredits - walletCreditsDelta),
      walletCreditsApplied: walletCreditsDelta,
    },
    created_by: params.createdBy ?? snapshot.userId,
  })

  return buildSnapshot({
    id: snapshot.userId,
    organization_id: snapshot.organizationId,
    plan: snapshot.planTier,
    credit_balance: walletCreditsDelta > 0 ? Math.max(0, snapshot.creditBalance - walletCreditsDelta) : snapshot.creditBalance,
  }, updatedUsage, snapshot.compatibility)
}

export async function consumeFeatureCredits(params: {
  userId: string
  organizationId?: string | null
  meetingId?: string | null
  entryKind: Extract<UserCreditLedgerEntryKind, 'go_deeper_agent' | 'best_fit_mom'>
  creditCost: number
  usageField: 'go_deeper_agent_runs' | 'best_fit_mom_runs'
  adminSupabase?: AdminClient
  createdBy?: string | null
  reason: string
  metadata?: Record<string, unknown>
}) {
  const admin = params.adminSupabase ?? createAdminClient()
  const snapshot = await getUserEntitlementSnapshot({
    userId: params.userId,
    organizationId: params.organizationId,
    adminSupabase: admin,
  })
  if (snapshot.subscriptionSetupPending) {
    return snapshot
  }

  if (params.creditCost > snapshot.totalCreditsRemaining) {
    throw new SubscriptionLimitError(
      'You do not have enough credits left for this action. Ask your admin to top up credits or change your plan.',
      'insufficient_credits',
    )
  }

  const currentCreditsConsumed = toSafeInt(snapshot.usage.credits_consumed)
  const plan = getSubscriptionPlan(snapshot.planTier)
  const nextCreditsConsumed = currentCreditsConsumed + params.creditCost
  const walletCreditsBefore = Math.max(0, currentCreditsConsumed - plan.includedCredits)
  const walletCreditsAfter = Math.max(0, nextCreditsConsumed - plan.includedCredits)
  const walletCreditsDelta = walletCreditsAfter - walletCreditsBefore

  const updatedUsage = await updateMonthlyUsage(admin, snapshot.usage, {
    [params.usageField]: toSafeInt(snapshot.usage[params.usageField]) + 1,
    credits_consumed: nextCreditsConsumed,
  } as Partial<UserSubscriptionUsageMonthly>)

  if (walletCreditsDelta > 0) {
    const { error } = await admin
      .from('profiles')
      .update({
        credit_balance: Math.max(0, snapshot.creditBalance - walletCreditsDelta),
      })
      .eq('id', snapshot.userId)

    if (error) {
      throw new Error(error.message)
    }
  }

  await insertLedgerEntry(admin, {
    user_id: snapshot.userId,
    organization_id: snapshot.organizationId,
    usage_month: updatedUsage.usage_month,
    meeting_id: params.meetingId ?? null,
    entry_kind: params.entryKind,
    credits_delta: walletCreditsDelta > 0 ? -walletCreditsDelta : 0,
    applies_to_wallet: walletCreditsDelta > 0,
    reason: params.reason,
    metadata: {
      totalCreditCost: params.creditCost,
      includedCreditsApplied: Math.max(0, params.creditCost - walletCreditsDelta),
      walletCreditsApplied: walletCreditsDelta,
      ...(params.metadata ?? {}),
    },
    created_by: params.createdBy ?? snapshot.userId,
  })

  return buildSnapshot({
    id: snapshot.userId,
    organization_id: snapshot.organizationId,
    plan: snapshot.planTier,
    credit_balance: walletCreditsDelta > 0 ? Math.max(0, snapshot.creditBalance - walletCreditsDelta) : snapshot.creditBalance,
  }, updatedUsage, snapshot.compatibility)
}

export async function consumeGoDeeperAgentCredit(params: {
  userId: string
  organizationId?: string | null
  meetingId?: string | null
  adminSupabase?: AdminClient
  createdBy?: string | null
}) {
  return consumeFeatureCredits({
    ...params,
    entryKind: 'go_deeper_agent',
    creditCost: GO_DEEPER_AGENT_CREDIT_COST,
    usageField: 'go_deeper_agent_runs',
    reason: 'Go Deeper Agent run consumed 1 credit',
  })
}

export async function assertExtractMinuteAllowed(params: {
  userId: string
  organizationId?: string | null
  adminSupabase?: AdminClient
}) {
  const snapshot = await getUserEntitlementSnapshot(params)
  if (snapshot.subscriptionSetupPending) {
    return snapshot
  }
  const plan = getSubscriptionPlan(snapshot.planTier)

  if (plan.extractMinuteMonthlyLimit === 0) {
    throw new SubscriptionLimitError(
      'Extract Minute is not available on your current plan.',
      'extract_minute_not_allowed',
    )
  }

  if (plan.extractMinuteMonthlyLimit != null && snapshot.extractMinuteRunsRemaining === 0) {
    throw new SubscriptionLimitError(
      'You have used all Extract Minute runs for this month. Ask your admin to change your plan.',
      'extract_minute_limit_reached',
    )
  }

  return snapshot
}

export async function recordExtractMinuteUsage(params: {
  userId: string
  organizationId?: string | null
  meetingId?: string | null
  adminSupabase?: AdminClient
  createdBy?: string | null
}) {
  const admin = params.adminSupabase ?? createAdminClient()
  const snapshot = await assertExtractMinuteAllowed({
    userId: params.userId,
    organizationId: params.organizationId,
    adminSupabase: admin,
  })
  if (snapshot.subscriptionSetupPending) {
    return snapshot
  }

  const updatedUsage = await updateMonthlyUsage(admin, snapshot.usage, {
    extract_minute_runs: snapshot.usage.extract_minute_runs + 1,
  })

  await insertLedgerEntry(admin, {
    user_id: snapshot.userId,
    organization_id: snapshot.organizationId,
    usage_month: updatedUsage.usage_month,
    meeting_id: params.meetingId ?? null,
    entry_kind: 'extract_minute',
    credits_delta: 0,
    applies_to_wallet: false,
    reason: 'Extract Minute run recorded',
    metadata: {},
    created_by: params.createdBy ?? snapshot.userId,
  })

  return buildSnapshot({
    id: snapshot.userId,
    organization_id: snapshot.organizationId,
    plan: snapshot.planTier,
    credit_balance: snapshot.creditBalance,
  }, updatedUsage, snapshot.compatibility)
}

export async function adjustUserCreditWallet(params: {
  targetUserId: string
  organizationId: string
  deltaCredits: number
  reason: string
  createdBy: string
  adminSupabase?: AdminClient
}) {
  const admin = params.adminSupabase ?? createAdminClient()
  const compatibility = await getSubscriptionSchemaCompatibility({
    organizationId: params.organizationId,
    adminSupabase: admin,
  })

  if (!compatibility.profilesCreditBalanceAvailable || !compatibility.creditLedgerAvailable) {
    throw new SubscriptionLimitError(
      'This action needs the latest subscription database update.',
      'subscription_schema_not_ready',
      503,
    )
  }

  const profile = await loadProfile(admin, params.targetUserId, params.organizationId, compatibility)
  const nextBalance = Math.max(0, toSafeInt(profile.credit_balance) + Math.trunc(params.deltaCredits))

  if (params.deltaCredits < 0 && nextBalance === 0 && toSafeInt(profile.credit_balance) + Math.trunc(params.deltaCredits) < 0) {
    throw new SubscriptionLimitError(
      'Cannot deduct more credits than the user currently has in their wallet.',
      'credit_deduction_exceeds_balance',
      400,
    )
  }

  const { error } = await admin
    .from('profiles')
    .update({ credit_balance: nextBalance })
    .eq('id', params.targetUserId)

  if (error) {
    throw new Error(error.message)
  }

  const usageMonth = startOfCurrentUsageMonth()
  await insertLedgerEntry(admin, {
    user_id: profile.id,
    organization_id: profile.organization_id,
    usage_month: usageMonth,
    meeting_id: null,
    entry_kind: params.deltaCredits >= 0 ? 'admin_top_up' : 'admin_deduction',
    credits_delta: Math.trunc(params.deltaCredits),
    applies_to_wallet: true,
    reason: params.reason,
    metadata: {
      beforeBalance: toSafeInt(profile.credit_balance),
      afterBalance: nextBalance,
    },
    created_by: params.createdBy,
  })

  return nextBalance
}

export async function recordMeetingCreatedUsage(params: {
  userId: string
  organizationId?: string | null
  adminSupabase?: AdminClient
}) {
  const admin = params.adminSupabase ?? createAdminClient()
  const snapshot = await getUserEntitlementSnapshot({
    userId: params.userId,
    organizationId: params.organizationId,
    adminSupabase: admin,
  })
  if (snapshot.subscriptionSetupPending) {
    return snapshot
  }

  const updatedUsage = await updateMonthlyUsage(admin, snapshot.usage, {
    meetings_created: snapshot.usage.meetings_created + 1,
  })

  return buildSnapshot({
    id: snapshot.userId,
    organization_id: snapshot.organizationId,
    plan: snapshot.planTier,
    credit_balance: snapshot.creditBalance,
  }, updatedUsage, snapshot.compatibility)
}

export async function listCurrentMonthUsageForOrganization(params: {
  organizationId: string
  adminSupabase?: AdminClient
}) {
  const admin = params.adminSupabase ?? createAdminClient()
  let compatibility = await getSubscriptionSchemaCompatibility({
    organizationId: params.organizationId,
    adminSupabase: admin,
  })
  if (compatibility.subscriptionSetupPending || !compatibility.usageTrackingAvailable) {
    return []
  }
  const usageMonth = startOfCurrentUsageMonth()
  const { data, error } = await admin
    .from('user_subscription_usage_monthly')
    .select('*')
    .eq('organization_id', params.organizationId)
    .eq('usage_month', usageMonth)

  if (error) {
    const normalizedError = toEntitlementErrorLike(error)
    if (isMissingUserSubscriptionUsageTable(normalizedError)) {
      compatibility = {
        ...compatibility,
        usageTrackingAvailable: false,
        subscriptionSetupPending: true,
      }
      return []
    }

    throw new Error(error.message)
  }

  return (data ?? []) as UserSubscriptionUsageMonthly[]
}

export type {
  SubscriptionPlanDefinition,
} from '@/lib/subscription/catalog'
