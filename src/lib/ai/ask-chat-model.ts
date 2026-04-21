import {
  AI_MODEL_OPTIONS,
  isSupportedAiModel,
  type AiModelOption,
} from '@/lib/ai/catalog'

export const ASK_CHAT_MODEL_STORAGE_KEY = 'secretariat.ask-chat-model'

export const ASK_CHAT_MODEL_OPTIONS = AI_MODEL_OPTIONS

export function normalizeAskChatModelId(
  value: string | null | undefined,
  allowedModelIds?: string[],
) {
  const trimmed = value?.trim() ?? ''
  if (!trimmed || !isSupportedAiModel(trimmed)) return ''
  if (allowedModelIds && !allowedModelIds.includes(trimmed)) return ''
  return trimmed
}

export function filterAskChatModelOptions(options: AiModelOption[], allowedModelIds?: string[]) {
  if (!allowedModelIds || allowedModelIds.length === 0) return options
  const allowed = new Set(allowedModelIds)
  return options.filter(option => allowed.has(option.id))
}

export function readStoredAskChatModelId(
  storage: Pick<Storage, 'getItem' | 'removeItem'> | null | undefined,
  allowedModelIds?: string[],
) {
  if (!storage) return ''
  const normalized = normalizeAskChatModelId(storage.getItem(ASK_CHAT_MODEL_STORAGE_KEY), allowedModelIds)
  if (!normalized) {
    storage.removeItem(ASK_CHAT_MODEL_STORAGE_KEY)
  }
  return normalized
}

export function writeStoredAskChatModelId(
  storage: Pick<Storage, 'setItem' | 'removeItem'> | null | undefined,
  modelId: string,
  allowedModelIds?: string[],
) {
  if (!storage) return
  const normalized = normalizeAskChatModelId(modelId, allowedModelIds)
  if (!normalized) {
    storage.removeItem(ASK_CHAT_MODEL_STORAGE_KEY)
    return
  }
  storage.setItem(ASK_CHAT_MODEL_STORAGE_KEY, normalized)
}
