import type { TranscriptIntelligencePreset } from '@/lib/supabase/types'

export interface TranscriptIntelligenceConfig {
  preset: TranscriptIntelligencePreset
  title: string
  badge: string
  summary: string
  note: string
  sttModel: string
  cleanupModel: string
  refinementModel: string
  numericVerifierModel: string | null
  usesDiarizedStt: boolean
}

export const TRANSCRIPT_INTELLIGENCE_CONFIGS: Record<TranscriptIntelligencePreset, TranscriptIntelligenceConfig> = {
  testing: {
    preset: 'testing',
    title: 'Testing / Cheapest',
    badge: 'Lowest cost',
    summary: 'Best for testing transcript flow quickly with the smallest OpenAI spend.',
    note: 'Future audio/video uploads only. Existing transcripts stay unchanged until rerun.',
    sttModel: 'gpt-4o-mini-transcribe',
    cleanupModel: 'gpt-4o-mini',
    refinementModel: 'gpt-4o-mini',
    numericVerifierModel: null,
    usesDiarizedStt: false,
  },
  balanced: {
    preset: 'balanced',
    title: 'Balanced / Recommended',
    badge: 'Best value',
    summary: 'Recommended default for normal users: better transcript cleanup with still-friendly cost.',
    note: 'Future audio/video uploads only. Existing transcripts stay unchanged until rerun.',
    sttModel: 'gpt-4o-transcribe',
    cleanupModel: 'gpt-5.4-mini',
    refinementModel: 'gpt-5.4-mini',
    numericVerifierModel: null,
    usesDiarizedStt: false,
  },
  high_accuracy: {
    preset: 'high_accuracy',
    title: 'High Accuracy',
    badge: 'Best quality',
    summary: 'Best for important meetings, stronger cleanup, diarized STT, and targeted numeric review.',
    note: 'Future audio/video uploads only. The numeric verifier runs only on flagged transcript chunks.',
    sttModel: 'gpt-4o-transcribe-diarize',
    cleanupModel: 'gpt-5.4',
    refinementModel: 'gpt-5.4',
    numericVerifierModel: 'gpt-5.4-pro',
    usesDiarizedStt: true,
  },
}

export const TRANSCRIPT_INTELLIGENCE_PRESETS = Object.keys(
  TRANSCRIPT_INTELLIGENCE_CONFIGS,
) as TranscriptIntelligencePreset[]

export function isTranscriptIntelligencePreset(value: string): value is TranscriptIntelligencePreset {
  return value === 'testing' || value === 'balanced' || value === 'high_accuracy'
}

export function normalizeTranscriptIntelligencePreset(
  value: string | null | undefined,
): TranscriptIntelligencePreset {
  if (!value) return 'balanced'
  const normalized = value.trim().toLowerCase()
  return isTranscriptIntelligencePreset(normalized) ? normalized : 'balanced'
}

export function getTranscriptIntelligenceConfig(
  preset: TranscriptIntelligencePreset,
): TranscriptIntelligenceConfig {
  return TRANSCRIPT_INTELLIGENCE_CONFIGS[preset]
}

export type { TranscriptIntelligencePreset } from '@/lib/supabase/types'
