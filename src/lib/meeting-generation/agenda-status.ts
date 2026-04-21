import { uuidSchema } from '@/lib/validation'
import type { DatabaseClient } from './shared'

export type AgendaMinuteStatus = 'done' | 'ongoing' | 'pending'

export async function updateAgendaStatusWithClient(params: {
  supabase: DatabaseClient
  meetingId: string
  agendaIds: string[]
  status: AgendaMinuteStatus
}) {
  const meetingId = uuidSchema.parse(params.meetingId)
  params.agendaIds.forEach(id => uuidSchema.parse(id))

  if (params.agendaIds.length === 0) {
    return
  }

  const { data: agendas, error: agendaError } = await params.supabase
    .from('agendas')
    .select('id')
    .eq('meeting_id', meetingId)
    .in('id', params.agendaIds)

  if (agendaError) {
    throw new Error(agendaError.message)
  }

  if ((agendas?.length ?? 0) !== params.agendaIds.length) {
    throw new Error('One or more agendas are outside this meeting')
  }

  const { error: updateError } = await params.supabase
    .from('agendas')
    .update({ minute_status: params.status })
    .eq('meeting_id', meetingId)
    .in('id', params.agendaIds)

  if (updateError) {
    throw new Error(updateError.message)
  }
}
