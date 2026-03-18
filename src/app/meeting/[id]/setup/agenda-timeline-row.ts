export interface AgendaTimelineRow {
  agendaId: string
  agendaNo: string
  agendaTitle: string
  startTime: string
  endTime: string
  confidence?: number | null
  reason?: string | null
}
