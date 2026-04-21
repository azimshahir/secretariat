export interface CommitteeSpeaker {
  id: string
  committee_id: string
  speaker_name: string
  position: string
  sort_order: number
}

export const COMMITTEE_SPEAKER_SELECT =
  'id, committee_id, speaker_name, position, sort_order'

export function normalizeSpeakerHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}
