export type AiProvider = 'anthropic' | 'openai' | 'google'

export type AiTask =
  | 'generate_mom'
  | 'go_deeper_ask'
  | 'go_deeper_agent'
  | 'generate_itineraries'

export interface EffectiveAiConfig {
  provider: AiProvider
  model: string
}

export interface AiModelOption {
  id: string
  label: string
  provider: AiProvider
}

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
    'gemini-3-pro-preview',
    'gemini-3-flash-preview',
    'gemini-3-pro-image-preview',
    'gemini-2.5-pro',
    'gemini-2.5-flash',
  ],
}

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google Gemini',
}

export const AI_MODEL_LABELS: Record<string, string> = {
  'claude-sonnet-4-5-20250929': 'Claude Sonnet 4.5',
  'claude-opus-4-6': 'Claude Opus 4.6',
  'gpt-5': 'GPT-5',
  'gpt-5-mini': 'GPT-5 Mini',
  'gpt-5-nano': 'GPT-5 Nano',
  'gpt-4.1': 'GPT-4.1',
  'gemini-3-pro-preview': 'Gemini 3 Pro Preview',
  'gemini-3-flash-preview': 'Gemini 3 Flash Preview',
  'gemini-3-pro-image-preview': 'Gemini 3 Pro Image Preview',
  'gemini-2.5-pro': 'Gemini 2.5 Pro',
  'gemini-2.5-flash': 'Gemini 2.5 Flash',
}

export const AI_TASKS: AiTask[] = [
  'generate_mom',
  'go_deeper_ask',
  'go_deeper_agent',
  'generate_itineraries',
]

export const AI_ADMIN_TASKS = [
  'generate_mom',
  'go_deeper_ask',
  'go_deeper_agent',
  'generate_itineraries',
] as const satisfies readonly AiTask[]

export type AdminAiTask = typeof AI_ADMIN_TASKS[number]

export const AI_TASK_LABELS: Record<AiTask, string> = {
  generate_mom: 'Generate MoM',
  go_deeper_ask: 'Go Deeper Ask Mode',
  go_deeper_agent: 'Go Deeper Agent Mode',
  generate_itineraries: 'Generate Itineraries',
}

export const AI_TASK_DESCRIPTIONS: Record<AiTask, string> = {
  generate_mom: 'Drafting, cross-referencing, minute synthesis, and related minute outputs.',
  go_deeper_ask: 'Question answering over transcript, papers, and meeting context.',
  go_deeper_agent: 'Rewrite and apply minute edits from Go Deeper agent interactions.',
  generate_itineraries: 'Agenda, presenter list, and Matter Arising itinerary generation.',
}

export function isAiProvider(value: string): value is AiProvider {
  return value === 'anthropic' || value === 'openai' || value === 'google'
}

export function toProvider(value: string | null | undefined): AiProvider | null {
  if (!value) return null
  const normalized = value.trim().toLowerCase()
  return isAiProvider(normalized) ? normalized : null
}

export function inferProviderFromModel(model: string): AiProvider | null {
  const value = model.trim().toLowerCase()
  if (!value) return null
  if (value.startsWith('claude')) return 'anthropic'
  if (value.startsWith('gpt')) return 'openai'
  if (value.startsWith('gemini')) return 'google'
  return null
}

export function isSupportedProviderModel(provider: AiProvider, model: string) {
  return AI_PROVIDER_MODELS[provider].includes(model)
}

export function isSupportedAiModel(model: string) {
  const provider = inferProviderFromModel(model)
  if (!provider) return false
  return isSupportedProviderModel(provider, model)
}

export function getAiModelLabel(model: string) {
  return AI_MODEL_LABELS[model] ?? model
}

export const AI_MODEL_OPTIONS: AiModelOption[] = (
  Object.entries(AI_PROVIDER_MODELS) as [AiProvider, string[]][]
).flatMap(([provider, models]) => (
  models.map(model => ({
    id: model,
    label: getAiModelLabel(model),
    provider,
  }))
))
