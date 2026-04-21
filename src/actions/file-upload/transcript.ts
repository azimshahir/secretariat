'use server'

import { createClient } from '@/lib/supabase/server'
import type { DatabaseClient } from '@/lib/meeting-generation/shared'
import { uploadTranscriptWithClient } from '@/lib/meeting-generation/transcript'
import { uuidSchema } from '@/lib/validation'
import { assertFileSize } from './validation'

export async function uploadTranscript(meetingId: string, file: File) {
  const parsedMeetingId = uuidSchema.parse(meetingId)
  assertFileSize(file)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')
  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()

  return await uploadTranscriptWithClient({
    supabase: supabase as unknown as DatabaseClient,
    meetingId: parsedMeetingId,
    file,
    userId: user.id,
    organizationId: profile?.organization_id ?? null,
  })
}
