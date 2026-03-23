import 'server-only'

import { anthropic } from '@ai-sdk/anthropic'
import { google } from '@ai-sdk/google'
import { openai } from '@ai-sdk/openai'
import {
  AI_PROVIDER_MODELS,
  AI_TASKS,
  inferProviderFromModel,
  type AiProvider,
  type AiTask,
  type EffectiveAiConfig,
  toProvider,
} from '@/lib/ai/catalog'
import { createAdminClient } from '@/lib/supabase/admin'

interface OrganizationAiSettingsRow {
  provider: string | null
  model: string | null
  generate_mom_provider: string | null
  generate_mom_model: string | null
  go_deeper_ask_provider: string | null
  go_deeper_ask_model: string | null
  go_deeper_agent_provider: string | null
  go_deeper_agent_model: string | null
  generate_itineraries_provider: string | null
  generate_itineraries_model: string | null
}

function isMissingAiTaskSettingsColumn(error: { code?: string | null; message?: string | null } | null | undefined) {
  if (!error) return false
  if (error.code === 'PGRST204') return true
  const message = (error.message ?? '').toLowerCase()
  return message.includes('organization_ai_settings') && message.includes('schema cache')
}

const ENV_DEFAULTS: Record<AiProvider, string> = {
  anthropic: 'claude-sonnet-4-5-20250929',
  openai: 'gpt-5',
  google: 'gemini-2.5-pro',
}

const AI_TASK_FIELD_MAP: Record<AiTask, {
  provider: keyof OrganizationAiSettingsRow
  model: keyof OrganizationAiSettingsRow
}> = {
  generate_mom: {
    provider: 'generate_mom_provider',
    model: 'generate_mom_model',
  },
  go_deeper_ask: {
    provider: 'go_deeper_ask_provider',
    model: 'go_deeper_ask_model',
  },
  go_deeper_agent: {
    provider: 'go_deeper_agent_provider',
    model: 'go_deeper_agent_model',
  },
  generate_itineraries: {
    provider: 'generate_itineraries_provider',
    model: 'generate_itineraries_model',
  },
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

function toTaskConfig(
  row: OrganizationAiSettingsRow | null | undefined,
  task: AiTask,
  fallback: EffectiveAiConfig,
): EffectiveAiConfig {
  if (!row) return fallback

  const taskFields = AI_TASK_FIELD_MAP[task]
  const taskProvider = toProvider(String(row[taskFields.provider] ?? ''))
  const taskModel = String(row[taskFields.model] ?? '').trim()

  if (taskProvider && taskModel) {
    return { provider: taskProvider, model: taskModel }
  }

  const legacyProvider = toProvider(row.provider)
  const legacyModel = String(row.model ?? '').trim()
  if (legacyProvider && legacyModel) {
    return { provider: legacyProvider, model: legacyModel }
  }

  return fallback
}

async function getOrganizationAiSettingsRow(
  organizationId: string | null | undefined,
): Promise<OrganizationAiSettingsRow | null> {
  if (!organizationId) return null

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('organization_ai_settings')
    .select(`
      provider,
      model,
      generate_mom_provider,
      generate_mom_model,
      go_deeper_ask_provider,
      go_deeper_ask_model,
      go_deeper_agent_provider,
      go_deeper_agent_model,
      generate_itineraries_provider,
      generate_itineraries_model
    `)
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (error && isMissingAiTaskSettingsColumn(error)) {
    const fallback = await admin
      .from('organization_ai_settings')
      .select('provider, model')
      .eq('organization_id', organizationId)
      .maybeSingle()

    if (fallback.error || !fallback.data) return null
    return {
      provider: fallback.data.provider,
      model: fallback.data.model,
      generate_mom_provider: null,
      generate_mom_model: null,
      go_deeper_ask_provider: null,
      go_deeper_ask_model: null,
      go_deeper_agent_provider: null,
      go_deeper_agent_model: null,
      generate_itineraries_provider: null,
      generate_itineraries_model: null,
    }
  }

  if (error || !data) return null
  return data as OrganizationAiSettingsRow
}

export async function getEffectiveAiConfigsForOrganization(
  organizationId: string | null | undefined,
): Promise<Record<AiTask, EffectiveAiConfig>> {
  const fallback = getEnvDefaultConfig()
  const row = await getOrganizationAiSettingsRow(organizationId)

  return AI_TASKS.reduce((configs, task) => {
    configs[task] = toTaskConfig(row, task, fallback)
    return configs
  }, {} as Record<AiTask, EffectiveAiConfig>)
}

export async function getEffectiveAiConfigForOrganization(
  organizationId: string | null | undefined,
  task: AiTask = 'generate_mom',
): Promise<EffectiveAiConfig> {
  const configs = await getEffectiveAiConfigsForOrganization(organizationId)
  return configs[task]
}

export async function resolveLanguageModelForOrganization(
  organizationId: string | null | undefined,
  task: AiTask = 'generate_mom',
) {
  const config = await getEffectiveAiConfigForOrganization(organizationId, task)
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

export {
  AI_PROVIDER_MODELS,
}

export type {
  AiProvider,
  AiTask,
  EffectiveAiConfig,
}
