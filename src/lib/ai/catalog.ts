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

export const AI_TASKS: AiTask[] = [
  'generate_mom',
  'go_deeper_ask',
  'go_deeper_agent',
  'generate_itineraries',
]

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
  generate_itineraries: 'Agenda, presenter list, and summary-of-decision itinerary generation.',
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
