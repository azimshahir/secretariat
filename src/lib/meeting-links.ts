import type { MeetingStatus } from '@/lib/supabase/types'

export function normalizeMeetingStatus(
  status: string | null | undefined,
): MeetingStatus {
  switch (status) {
    case 'draft':
    case 'pending_setup':
    case 'mapping':
    case 'generating':
    case 'in_progress':
    case 'finalized':
      return status
    default:
      return 'in_progress'
  }
}

export function getMeetingLink(id: string, status: string | null | undefined) {
  switch (normalizeMeetingStatus(status)) {
    case 'draft':
    case 'pending_setup':
      return `/meeting/${id}/setup`
    case 'mapping':
      return `/meeting/${id}/map`
    case 'generating':
    case 'in_progress':
      return `/meeting/${id}/setup`
    case 'finalized':
      return `/meeting/${id}/view`
  }
}
