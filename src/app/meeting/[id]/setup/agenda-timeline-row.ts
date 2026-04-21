export const NO_TRANSCRIPTION_SEGMENT_MARKER = '[NO_TRANSCRIPTION]'

export interface AgendaTimelineRow {
  agendaId: string
  agendaNo: string
  agendaTitle: string
  startTime: string | null
  endTime: string | null
  forcedResolvedOutcomeMode?: 'closed' | null
  confidence?: number | null
  reason?: string | null
  mappingStatus?: 'explicit' | 'semantic' | 'suggested' | 'unresolved'
  requiresReview?: boolean
}
