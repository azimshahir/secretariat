import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  parseStoredTemplateGroups,
  serializeTemplateGroupsForStorage,
  TEMPLATE_SECTION_IDS,
} from '@/app/meeting/[id]/setup/settings-template-model'
import {
  parseMeetingSpeakerOverrides,
  serializeMeetingSpeakerOverrides,
} from '@/lib/meeting-settings-overrides'
import { uuidSchema } from '@/lib/validation'
import {
  requireWritableMeetingContext,
  serializeCommitteeGenerationApiError,
} from '../../../committee-generation/_lib/write-access'

export const runtime = 'nodejs'

const bodySchema = z.object({
  action: z.enum(['save_templates', 'save_speakers']),
  groups: z.unknown().optional(),
  speakers: z.unknown().optional(),
})

function getMinuteInstructionFromGroups(groups: ReturnType<typeof parseStoredTemplateGroups>) {
  for (const group of groups) {
    for (const section of group.sections) {
      if (section.id === TEMPLATE_SECTION_IDS.minuteOfMeeting) {
        return section.prompt.trim()
      }
    }
  }
  return ''
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const meetingId = uuidSchema.parse(id)
    const body = bodySchema.parse(await request.json())
    const context = await requireWritableMeetingContext(meetingId)

    if (body.action === 'save_templates') {
      const groups = parseStoredTemplateGroups(body.groups)
      if (!Array.isArray(body.groups) || groups.length === 0) {
        throw new Error('Template groups are required')
      }

      const { error } = await context.adminSupabase
        .from('meetings')
        .update({
          template_section_overrides: serializeTemplateGroupsForStorage(groups),
          meeting_rules: getMinuteInstructionFromGroups(groups),
        })
        .eq('id', meetingId)

      if (error) {
        throw new Error(error.message)
      }

      return NextResponse.json({
        ok: true,
        groups: serializeTemplateGroupsForStorage(groups),
      })
    }

    const speakers = parseMeetingSpeakerOverrides(body.speakers)
    if (!Array.isArray(body.speakers)) {
      throw new Error('Speaker overrides are required')
    }

    const { error } = await context.adminSupabase
      .from('meetings')
      .update({
        speaker_overrides: serializeMeetingSpeakerOverrides(speakers),
      })
      .eq('id', meetingId)

    if (error) {
      throw new Error(error.message)
    }

    return NextResponse.json({
      ok: true,
      speakers: serializeMeetingSpeakerOverrides(speakers),
    })
  } catch (error) {
    const { status, message } = serializeCommitteeGenerationApiError(error, 'Failed to save meeting settings override')
    console.error('[api/meeting/[id]/settings-overrides] failed:', message)
    return NextResponse.json({ ok: false, message }, { status })
  }
}
