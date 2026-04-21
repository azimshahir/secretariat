import type { ResolutionVariantMetadata } from '@/lib/meeting-generation/types'
import type { ResolvedOutcomeMode } from '@/lib/meeting-generation/resolved-outcome'

export interface MinuteEntry {
  content: string
  updatedAt: string
  minuteId?: string | null
  sourceAgendaRevision?: number | null
  agendaContentRevision?: number | null
  isStale?: boolean
  resolvedOutcomeMode?: ResolvedOutcomeMode | null
  resolutionVariantKey?: ResolutionVariantMetadata['resolutionVariantKey']
  resolutionVariantLabel?: ResolutionVariantMetadata['resolutionVariantLabel']
  resolutionVariantSource?: ResolutionVariantMetadata['resolutionVariantSource']
  resolutionExactRenderEnforced?: ResolutionVariantMetadata['resolutionExactRenderEnforced']
}

export function isMinuteEntryStale(entry?: MinuteEntry | null) {
  return Boolean(entry?.content?.trim()) && Boolean(entry?.isStale)
}
