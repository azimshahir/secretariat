'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { uuidSchema } from '@/lib/validation'

export async function submitFinalizedMom(meetingId: string, content: string) {
  uuidSchema.parse(meetingId)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { data: meeting } = await supabase
    .from('meetings')
    .select('id, organization_id, status')
    .eq('id', meetingId)
    .single()
  if (!meeting) throw new Error('Meeting not found')

  await supabase.from('meetings').update({
    finalized_content: content,
    status: 'finalized',
    finalized_at: new Date().toISOString(),
  }).eq('id', meetingId)

  await supabase.from('audit_logs').insert({
    organization_id: meeting.organization_id,
    meeting_id: meetingId,
    user_id: user.id,
    action: 'meeting_finalized',
    details: { content_length: content.length },
  })

  revalidatePath(`/meeting/${meetingId}/setup`)
  revalidatePath('/')
}

export async function getFinalizedContent(meetingId: string) {
  uuidSchema.parse(meetingId)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { data: meeting } = await supabase
    .from('meetings')
    .select('id, title, meeting_date, finalized_content, status')
    .eq('id', meetingId)
    .single()
  if (!meeting) throw new Error('Meeting not found')

  return {
    title: meeting.title,
    meetingDate: meeting.meeting_date,
    content: meeting.finalized_content,
    status: meeting.status,
  }
}
