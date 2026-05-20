import type { AiModelOption } from '@/lib/ai/catalog'
import { AI_MODEL_OPTIONS } from '@/lib/ai/catalog'
import type { PlanTier } from '@/lib/supabase/types'

export const SUBSCRIPTION_TOP_UP_PACKS = [
  {
    id: 'credits-50',
    label: '50 agent credits',
    priceRm: 8,
    copy: 'Useful for extra Go Deeper Agent runs and Best Fit exports.',
  },
  {
    id: 'credits-100',
    label: '100 agent credits',
    priceRm: 15,
    copy: 'Best for heavier AI editing and MoM export overages.',
  },
  {
    id: 'transcription-2h',
    label: '2 extra transcription hours',
    priceRm: 8,
    copy: 'For overflow audio or video transcription beyond the included hours.',
  },
  {
    id: 'transcription-5h',
    label: '5 extra transcription hours',
    priceRm: 15,
    copy: 'Adds more room for heavier meeting review and recording workloads.',
  },
] as const

export interface SubscriptionPlanDefinition {
  tier: PlanTier
  label: string
  priceRmMonthly: number
  subtitle: string
  operatorsLabel: string
  committeeAllowanceLabel: string
  transcriptReviewJobs: number
  transcriptionHours: number
  includedCredits: number
  supportsAudioUpload: boolean
  supportsVideoUpload: boolean
  extractMinuteMonthlyLimit: number | null
  bestFitCreditsPerRun: number | null
  allowedModelIds: string[]
  cardHighlights: string[]
  supportLabel: string
}

const PLAN_ALLOWED_MODEL_IDS: Record<PlanTier, string[]> = {
  free: [
    'claude-sonnet-4-20250514',
  ],
  basic: [
    'claude-sonnet-4-20250514',
  ],
  pro: [
    'claude-sonnet-4-20250514',
  ],
  premium: [
    'claude-sonnet-4-20250514',
  ],
}

export const SUBSCRIPTION_PLANS: Record<PlanTier, SubscriptionPlanDefinition> = {
  free: {
    tier: 'free',
    label: 'Free',
    priceRmMonthly: 0,
    subtitle: 'Try the workflow — 2 meetings per month.',
    operatorsLabel: '1 operator',
    committeeAllowanceLabel: '1 secretariat',
    transcriptReviewJobs: 2,
    transcriptionHours: 1,
    includedCredits: 10,
    supportsAudioUpload: true,
    supportsVideoUpload: false,
    extractMinuteMonthlyLimit: 0,
    bestFitCreditsPerRun: null,
    allowedModelIds: PLAN_ALLOWED_MODEL_IDS.free,
    cardHighlights: [
      '2 meetings per month',
      '1 hour transcription included',
      'Claude Sonnet 4 AI engine',
      'Standard MoM generation',
    ],
    supportLabel: 'Community support',
  },
  /** @deprecated Legacy tier — maps to free in new pricing */
  basic: {
    tier: 'basic',
    label: 'Basic',
    priceRmMonthly: 0,
    subtitle: 'Legacy tier — same as Free.',
    operatorsLabel: '1 operator',
    committeeAllowanceLabel: '1 secretariat',
    transcriptReviewJobs: 2,
    transcriptionHours: 1,
    includedCredits: 10,
    supportsAudioUpload: true,
    supportsVideoUpload: false,
    extractMinuteMonthlyLimit: 0,
    bestFitCreditsPerRun: null,
    allowedModelIds: PLAN_ALLOWED_MODEL_IDS.basic,
    cardHighlights: [
      '2 meetings per month',
      '1 hour transcription included',
      'Claude Sonnet 4 AI engine',
      'Standard MoM generation',
    ],
    supportLabel: 'Community support',
  },
  pro: {
    tier: 'pro',
    label: 'Pro',
    priceRmMonthly: 79,
    subtitle: 'For working Company Secretaries — 15 meetings per month.',
    operatorsLabel: '1 operator',
    committeeAllowanceLabel: '5 secretariats',
    transcriptReviewJobs: 15,
    transcriptionHours: 10,
    includedCredits: 100,
    supportsAudioUpload: true,
    supportsVideoUpload: true,
    extractMinuteMonthlyLimit: null,
    bestFitCreditsPerRun: 5,
    allowedModelIds: PLAN_ALLOWED_MODEL_IDS.pro,
    cardHighlights: [
      '15 meetings per month',
      '10 hours transcription included',
      'Audio + video upload',
      'Full Extract Minute & Go Deeper',
    ],
    supportLabel: 'Email support',
  },
  premium: {
    tier: 'premium',
    label: 'Unlimited',
    priceRmMonthly: 149,
    subtitle: 'Unlimited meetings for heavy users.',
    operatorsLabel: '1 operator',
    committeeAllowanceLabel: 'Unlimited secretariats',
    transcriptReviewJobs: 999,
    transcriptionHours: 30,
    includedCredits: 500,
    supportsAudioUpload: true,
    supportsVideoUpload: true,
    extractMinuteMonthlyLimit: null,
    bestFitCreditsPerRun: 3,
    allowedModelIds: PLAN_ALLOWED_MODEL_IDS.premium,
    cardHighlights: [
      'Unlimited meetings',
      '30 hours transcription included',
      'Audio + video upload',
      'Priority support & all features',
    ],
    supportLabel: 'Priority support',
  },
}

/** All tiers including legacy basic */
export const SUBSCRIPTION_PLAN_ORDER: PlanTier[] = [
  'free',
  'basic',
  'pro',
  'premium',
]

/** Display tiers for pricing page (excludes legacy basic) */
export const SUBSCRIPTION_DISPLAY_TIERS: PlanTier[] = [
  'free',
  'pro',
  'premium',
]

export const GO_DEEPER_AGENT_CREDIT_COST = 1
export const TRANSCRIPTION_SECONDS_PER_CREDIT = 15 * 60

export function normalizePlanTier(value: string | null | undefined): PlanTier {
  const normalized = value?.trim().toLowerCase()
  if (normalized === 'free' || normalized === 'basic' || normalized === 'pro' || normalized === 'premium') {
    return normalized
  }
  if (normalized === 'max') return 'premium'
  return 'free'
}

export function getSubscriptionPlan(tier: string | null | undefined) {
  return SUBSCRIPTION_PLANS[normalizePlanTier(tier)]
}

export function getAllowedAiModelIdsForPlan(tier: string | null | undefined) {
  return getSubscriptionPlan(tier).allowedModelIds
}

export function getAllowedAiModelOptionsForPlan(tier: string | null | undefined): AiModelOption[] {
  const allowed = new Set(getAllowedAiModelIdsForPlan(tier))
  return AI_MODEL_OPTIONS.filter(option => allowed.has(option.id))
}

export function isAiModelAllowedForPlan(tier: string | null | undefined, modelId: string) {
  return getAllowedAiModelIdsForPlan(tier).includes(modelId)
}
