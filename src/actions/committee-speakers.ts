'use server'

import { createClient } from '@/lib/supabase/server'
import {
  COMMITTEE_SPEAKER_SELECT,
  type CommitteeSpeaker,
} from '@/lib/committee-speakers'
import { uuidSchema } from '@/lib/validation'

export async function getCommitteeSpeakers(committeeId: string): Promise<CommitteeSpeaker[]> {
  uuidSchema.parse(committeeId)
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('committee_speakers')
    .select(COMMITTEE_SPEAKER_SELECT)
    .eq('committee_id', committeeId)
    .order('sort_order')
  if (error) throw new Error(error.message)
  return data ?? []
}
