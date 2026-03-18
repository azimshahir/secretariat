'use server'

import { createClient } from '@/lib/supabase/server'
import { meetingStatusSchema, uuidSchema } from '@/lib/validation'

export async function updateMeetingStatus(meetingId: string, status: string) {
  uuidSchema.parse(meetingId)
  const safeStatus = meetingStatusSchema.parse(status)
  const supabase = await createClient()
  const { error } = await supabase.from('meetings').update({ status: safeStatus }).eq('id', meetingId)
  if (error) throw new Error(error.message)
}
