'use server'

import { createClient } from '@/lib/supabase/server'
import { uuidSchema } from '@/lib/validation'
import { uploadFileToStorage } from '@/actions/file-upload/shared'
import { assertFileSize } from '@/actions/file-upload/validation'
import type { Agenda } from '@/lib/supabase/types'
import { normalizeMeetingPackConfig } from './meeting-pack-model'

async function fetchAgendasForMeeting(meetingId: string) {
  const supabase = await createClient()
  const { data: agendas } = await supabase
    .from('agendas')
    .select('*')
    .eq('meeting_id', meetingId)
    .order('sort_order')

  return agendas ?? []
}

export async function getMeetingPackConfig(meetingId: string) {
  uuidSchema.parse(meetingId)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { data: meeting, error } = await supabase
    .from('meetings')
    .select('id, meeting_pack_config')
    .eq('id', meetingId)
    .single()

  if (error || !meeting) throw new Error(error?.message ?? 'Meeting not found')

  const agendas = await fetchAgendasForMeeting(meetingId) as Agenda[]
  return normalizeMeetingPackConfig(meeting.meeting_pack_config, agendas)
}

export async function saveMeetingPackConfig(meetingId: string, rawConfig: unknown) {
  uuidSchema.parse(meetingId)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { data: meeting, error } = await supabase
    .from('meetings')
    .select('id')
    .eq('id', meetingId)
    .single()

  if (error || !meeting) throw new Error(error?.message ?? 'Meeting not found')

  const agendas = await fetchAgendasForMeeting(meetingId) as Agenda[]
  const normalized = normalizeMeetingPackConfig(rawConfig, agendas)

  const { error: updateError } = await supabase
    .from('meetings')
    .update({ meeting_pack_config: normalized as unknown as Record<string, unknown> })
    .eq('id', meetingId)

  if (updateError) throw new Error(updateError.message)
  return normalized
}

export async function uploadMeetingPackPdf(meetingId: string, file: File) {
  uuidSchema.parse(meetingId)
  assertFileSize(file)

  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
  if (!isPdf) throw new Error('Only PDF files are supported')

  const uploaded = await uploadFileToStorage(meetingId, file, 'slides_pdf')
  return { path: uploaded.path }
}
