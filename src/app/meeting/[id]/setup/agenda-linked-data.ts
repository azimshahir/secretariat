import type { ResolvedOutcomeMode } from '@/lib/meeting-generation/resolved-outcome'

export interface AgendaLinkedDataState {
  hasMinute: boolean
  hasDraft: boolean
  hasActionItems: boolean
  resolvedOutcomeMode: ResolvedOutcomeMode | null
}
