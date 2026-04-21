import type { MinutePlaybookVariantKey } from './minute-playbooks'

export type ResolvedOutcomeMode = 'closed' | 'follow_up'

export function getResolvedOutcomeLabel(mode: ResolvedOutcomeMode) {
  return mode === 'follow_up' ? 'Follow-up' : 'Closed'
}

export function mapResolvedOutcomeModeToVariantKey(
  mode: ResolvedOutcomeMode,
): Extract<MinutePlaybookVariantKey, 'with_action' | 'without_action'> {
  return mode === 'follow_up' ? 'with_action' : 'without_action'
}

export function mapResolutionVariantKeyToResolvedOutcomeMode(
  variantKey: MinutePlaybookVariantKey | null | undefined,
): ResolvedOutcomeMode | null {
  if (variantKey === 'with_action') return 'follow_up'
  if (variantKey === 'without_action') return 'closed'
  return null
}

export function inferResolvedOutcomeMode(params: {
  resolvedOutcomeMode?: string | null
  resolutionVariantKey?: MinutePlaybookVariantKey | null
  hasActionItems?: boolean
  content?: string | null
}): ResolvedOutcomeMode | null {
  if (params.resolvedOutcomeMode === 'closed' || params.resolvedOutcomeMode === 'follow_up') {
    return params.resolvedOutcomeMode
  }

  const fromVariant = mapResolutionVariantKeyToResolvedOutcomeMode(params.resolutionVariantKey ?? null)
  if (fromVariant) return fromVariant

  if (params.hasActionItems) return 'follow_up'

  const content = params.content?.trim() ?? ''
  if (!content) return null

  if (/\bAction\s*By\s*:|\bPIC\s*:|\bOwner\s*:|\bfollow-?up\b/i.test(content)) {
    return 'follow_up'
  }

  if (/\bRESOLVED\b/i.test(content)) {
    return 'closed'
  }

  return null
}
