import type { MeetingStatus } from '@/lib/supabase/types'

export interface CommitteeChatMeetingMatch {
  meetingId: string
  title: string
  meetingDate: string
  status: MeetingStatus
  excerpt: string
  href: string
}

export interface CommitteeChatResponse {
  ok: true
  answer: string
  meetingMatches: CommitteeChatMeetingMatch[]
}
