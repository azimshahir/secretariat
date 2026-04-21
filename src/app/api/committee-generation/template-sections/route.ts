import { NextResponse } from 'next/server'
import {
  parseStoredTemplateGroups,
  serializeTemplateGroupsForStorage,
  TEMPLATE_SECTION_IDS,
} from '@/app/meeting/[id]/setup/settings-template-model'
import { uuidSchema } from '@/lib/validation'
import {
  requireWritableCommitteeContext,
  serializeCommitteeGenerationApiError,
} from '../_lib/write-access'

export const runtime = 'nodejs'

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

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      committeeId?: string
      groups?: unknown
    }
    const committeeId = uuidSchema.parse(body.committeeId ?? '')
    const groups = parseStoredTemplateGroups(body.groups)

    if (!Array.isArray(body.groups) || groups.length === 0) {
      throw new Error('Template groups are required')
    }

    const context = await requireWritableCommitteeContext(committeeId)
    const minuteInstruction = getMinuteInstructionFromGroups(groups)

    const { error } = await context.adminSupabase
      .from('committee_generation_settings')
      .upsert(
        {
          committee_id: committeeId,
          minute_instruction: minuteInstruction,
          template_sections: serializeTemplateGroupsForStorage(groups),
        },
        { onConflict: 'committee_id' },
      )

    if (error) {
      throw new Error(error.message)
    }

    await context.adminSupabase.from('audit_logs').insert({
      organization_id: context.organizationId,
      user_id: context.userId,
      action: 'committee_template_sections_updated',
      details: {
        committee_id: committeeId,
        groups_count: groups.length,
      },
    })

    return NextResponse.json({
      ok: true,
      groups: serializeTemplateGroupsForStorage(groups),
    })
  } catch (error) {
    const { status, message } = serializeCommitteeGenerationApiError(error, 'Failed to save committee template sections')
    console.error('[api/committee-generation/template-sections] failed:', message)
    return NextResponse.json({ ok: false, message }, { status })
  }
}
