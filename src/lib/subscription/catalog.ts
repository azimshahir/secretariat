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
    'gpt-5-nano',
    'gpt-5-mini',
    'gemini-3-flash-preview',
    'gemini-2.5-flash',
  ],
  basic: [
    'gpt-5-mini',
    'gpt-5',
    'gemini-3-flash-preview',
    'gemini-2.5-flash',
    'gemini-2.5-pro',
  ],
  pro: [
    'claude-sonnet-4-5-20250929',
    'gpt-5-mini',
    'gpt-5',
    'gpt-4.1',
    'gemini-3-flash-preview',
    'gemini-2.5-flash',
    'gemini-2.5-pro',
  ],
  premium: AI_MODEL_OPTIONS.map(option => option.id),
}

export const SUBSCRIPTION_PLANS: Record<PlanTier, SubscriptionPlanDefinition> = {
  free: {
    tier: 'free',
    label: 'Free',
    priceRmMonthly: 0,
    subtitle: 'Try the workflow before you commit.',
    operatorsLabel: '1 operator',
    committeeAllowanceLabel: '1 secretariat',
    transcriptReviewJobs: 5,
    transcriptionHours: 0,
    includedCredits: 10,
    supportsAudioUpload: false,
    supportsVideoUpload: false,
    extractMinuteMonthlyLimit: 0,
    bestFitCreditsPerRun: null,
    allowedModelIds: PLAN_ALLOWED_MODEL_IDS.free,
    cardHighlights: [
      '5 transcript reviews per month',
      'DOCX / transcript review only',
      '10 included agent credits',
      'Standard MoM only',
    ],
    supportLabel: 'Basic support',
  },
  basic: {
    tier: 'basic',
    label: 'Basic',
    priceRmMonthly: 29,
    subtitle: 'For solo secretariat work with light audio review.',
    operatorsLabel: '1 operator',
    committeeAllowanceLabel: '2 secretariats',
    transcriptReviewJobs: 20,
    transcriptionHours: 2,
    includedCredits: 30,
    supportsAudioUpload: true,
    supportsVideoUpload: false,
    extractMinuteMonthlyLimit: 5,
    bestFitCreditsPerRun: 8,
    allowedModelIds: PLAN_ALLOWED_MODEL_IDS.basic,
    cardHighlights: [
      'Audio upload with 2 included hours',
      '20 transcript reviews per month',
      '30 included credits',
      'Limited Extract Minute',
    ],
    supportLabel: 'Email support',
  },
  pro: {
    tier: 'pro',
    label: 'Pro',
    priceRmMonthly: 39,
    subtitle: 'Best value for small teams running real meetings.',
    operatorsLabel: '3 operators',
    committeeAllowanceLabel: '5 secretariats',
    transcriptReviewJobs: 50,
    transcriptionHours: 5,
    includedCredits: 100,
    supportsAudioUpload: true,
    supportsVideoUpload: true,
    extractMinuteMonthlyLimit: null,
    bestFitCreditsPerRun: 5,
    allowedModelIds: PLAN_ALLOWED_MODEL_IDS.pro,
    cardHighlights: [
      'Audio + video upload with 5 included hours',
      '50 transcript reviews per month',
      '100 included credits',
      'Full Extract Minute access',
    ],
    supportLabel: 'Priority email support',
  },
  premium: {
    tier: 'premium',
    label: 'Premium',
    priceRmMonthly: 99,
    subtitle: 'For departments handling heavier, higher-touch workflows.',
    operatorsLabel: '10 operators',
    committeeAllowanceLabel: '15 secretariats',
    transcriptReviewJobs: 150,
    transcriptionHours: 20,
    includedCredits: 300,
    supportsAudioUpload: true,
    supportsVideoUpload: true,
    extractMinuteMonthlyLimit: null,
    bestFitCreditsPerRun: 3,
    allowedModelIds: PLAN_ALLOWED_MODEL_IDS.premium,
    cardHighlights: [
      'Audio + video upload with 20 included hours',
      '150 transcript reviews per month',
      '300 included credits',
      'Largest AI model allowance and support window',
    ],
    supportLabel: 'Priority support',
  },
}

export const SUBSCRIPTION_PLAN_ORDER: PlanTier[] = [
  'free',
  'basic',
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
