import 'server-only'

import { anthropic } from '@ai-sdk/anthropic'
import { openai } from '@ai-sdk/openai'
import { google } from '@ai-sdk/google'
import { createAdminClient } from '@/lib/supabase/admin'

export type AiProvider = 'anthropic' | 'openai' | 'google'

export const AI_PROVIDER_MODELS: Record<AiProvider, string[]> = {
  anthropic: [
    'claude-sonnet-4-5-20250929',
    'claude-opus-4-6',
  ],
  openai: [
    'gpt-5',
    'gpt-5-mini',
    'gpt-5-nano',
    'gpt-4.1',
  ],
  google: [
    'gemini-2.5-pro',
    'gemini-2.5-flash',
  ],
}

const ENV_DEFAULTS: Record<AiProvider, string> = {
  anthropic: 'claude-sonnet-4-5-20250929',
  openai: 'gpt-5',
  google: 'gemini-2.5-pro',
}

export interface EffectiveAiConfig {
  provider: AiProvider
  model: string
}

function isAiProvider(value: string): value is AiProvider {
  return value === 'anthropic' || value === 'openai' || value === 'google'
}

function toProvider(value: string | null | undefined): AiProvider | null {
  if (!value) return null
  const normalized = value.trim().toLowerCase()
  return isAiProvider(normalized) ? normalized : null
}

function inferProviderFromModel(model: string): AiProvider | null {
  const value = model.trim().toLowerCase()
  if (!value) return null
  if (value.startsWith('claude')) return 'anthropic'
  if (value.startsWith('gpt')) return 'openai'
  if (value.startsWith('gemini')) return 'google'
  return null
}

function getEnvDefaultConfig(): EffectiveAiConfig {
  const rawModel = (process.env.AI_MODEL ?? '').trim()
  const envProvider = toProvider(process.env.AI_PROVIDER)
  const inferredProvider = inferProviderFromModel(rawModel)
  const provider = envProvider ?? inferredProvider ?? 'anthropic'
  const model = rawModel || ENV_DEFAULTS[provider]
  return { provider, model }
}

function assertProviderKey(provider: AiProvider) {
  if (provider === 'anthropic' && !(process.env.ANTHROPIC_API_KEY ?? '').trim()) {
    throw new Error('ANTHROPIC_API_KEY is missing for Anthropic model selection.')
  }
  if (provider === 'openai' && !(process.env.OPENAI_API_KEY ?? '').trim()) {
    throw new Error('OPENAI_API_KEY is missing for OpenAI model selection.')
  }
  if (provider === 'google') {
    const hasGoogleKey = Boolean((process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? '').trim())
      || Boolean((process.env.GOOGLE_API_KEY ?? '').trim())
    if (!hasGoogleKey) {
      throw new Error('GOOGLE_GENERATIVE_AI_API_KEY is missing for Gemini model selection.')
    }
  }
}

export async function getEffectiveAiConfigForOrganization(
  organizationId: string | null | undefined,
): Promise<EffectiveAiConfig> {
  const fallback = getEnvDefaultConfig()
  if (!organizationId) return fallback

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('organization_ai_settings')
    .select('provider, model')
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (error || !data) return fallback

  const provider = toProvider(data.provider)
  const model = String(data.model ?? '').trim()
  if (!provider || !model) return fallback
  return { provider, model }
}

export async function resolveLanguageModelForOrganization(
  organizationId: string | null | undefined,
) {
  const config = await getEffectiveAiConfigForOrganization(organizationId)
  assertProviderKey(config.provider)

  if (config.provider === 'anthropic') return anthropic(config.model)
  if (config.provider === 'openai') return openai(config.model)
  return google(config.model)
}

export function resolveModelById(modelId: string) {
  const provider = inferProviderFromModel(modelId)
  if (!provider) throw new Error(`Unknown model: ${modelId}`)
  assertProviderKey(provider)
  if (provider === 'anthropic') return anthropic(modelId)
  if (provider === 'openai') return openai(modelId)
  return google(modelId)
}

export function isSupportedProviderModel(provider: AiProvider, model: string) {
  return AI_PROVIDER_MODELS[provider].includes(model)
}
