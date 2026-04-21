import { z } from 'zod'
import type { CommitteeSpeaker } from '@/lib/committee-speakers'

const meetingSpeakerOverrideSchema = z.object({
  id: z.string().min(1),
  speaker_name: z.string().min(1),
  position: z.string(),
  sort_order: z.number().int().nonnegative(),
})

const meetingSpeakerOverridesSchema = z.array(meetingSpeakerOverrideSchema)

export function parseMeetingSpeakerOverrides(value: unknown): CommitteeSpeaker[] {
  const parsed = meetingSpeakerOverridesSchema.safeParse(value)
  if (!parsed.success) return []

  return parsed.data
    .map(row => ({
      id: row.id,
      committee_id: '',
      speaker_name: row.speaker_name,
      position: row.position,
      sort_order: row.sort_order,
    }))
    .sort((left, right) => left.sort_order - right.sort_order)
}

export function serializeMeetingSpeakerOverrides(speakers: CommitteeSpeaker[]) {
  return speakers.map((speaker, index) => ({
    id: speaker.id,
    speaker_name: speaker.speaker_name,
    position: speaker.position,
    sort_order: typeof speaker.sort_order === 'number' ? speaker.sort_order : index,
  }))
}

export function resolveEffectiveMeetingSpeakers(params: {
  committeeSpeakers: CommitteeSpeaker[]
  meetingSpeakerOverrides: unknown
}) {
  const overrides = parseMeetingSpeakerOverrides(params.meetingSpeakerOverrides)
  if (overrides.length === 0) {
    return params.committeeSpeakers
  }

  return overrides
}
