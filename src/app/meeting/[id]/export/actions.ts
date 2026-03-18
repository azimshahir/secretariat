'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { uuidSchema } from '@/lib/validation'

export async function finalizeMeeting(meetingId: string) {
  uuidSchema.parse(meetingId)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { data: meeting } = await supabase
    .from('meetings')
    .select('id, status, organization_id')
    .eq('id', meetingId)
    .single()

  if (!meeting) throw new Error('Meeting not found')
  if (meeting.status === 'finalized') return

  const { error: updateError } = await supabase
    .from('meetings')
    .update({ status: 'finalized' })
    .eq('id', meetingId)

  if (updateError) throw new Error(updateError.message)

  await supabase.from('audit_logs').insert({
    organization_id: meeting.organization_id,
    meeting_id: meetingId,
    user_id: user.id,
    action: 'meeting_finalized',
    details: { status: 'finalized' },
  })

  revalidatePath('/')
  revalidatePath(`/meeting/${meetingId}/export`)
}
