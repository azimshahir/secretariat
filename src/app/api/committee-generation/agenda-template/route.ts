import { NextResponse } from 'next/server'
import { buildLegacyStoredMinuteTemplateData } from '@/lib/meeting-generation/minute-template'
import { uuidSchema } from '@/lib/validation'
import {
  requireWritableCommitteeContext,
  serializeCommitteeGenerationApiError,
} from '../_lib/write-access'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      committeeId?: unknown
      templateJson?: unknown
    }

    const committeeId = uuidSchema.parse(body.committeeId)
    if (typeof body.templateJson !== 'string') {
      throw new Error('Template JSON is required')
    }

    const context = await requireWritableCommitteeContext(committeeId)
    const legacyTemplate = buildLegacyStoredMinuteTemplateData(body.templateJson)

    const { error: deleteError } = await context.adminSupabase
      .from('format_templates')
      .delete()
      .eq('committee_id', committeeId)
      .eq('name', 'Default Agenda')
    if (deleteError) {
      throw new Error(deleteError.message)
    }

    const { error: insertError } = await context.adminSupabase
      .from('format_templates')
      .insert({
        committee_id: committeeId,
        name: 'Default Agenda',
        prompt_text: body.templateJson,
        compiled_template_json: legacyTemplate.compiledTemplateJson,
        compiled_template_version: legacyTemplate.compiledTemplateVersion,
        compiled_template_hash: legacyTemplate.compiledTemplateHash,
      })
    if (insertError) {
      throw new Error(insertError.message)
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    const { status, message } = serializeCommitteeGenerationApiError(error, 'Failed to save agenda template')
    console.error('[api/committee-generation/agenda-template] failed:', message)
    return NextResponse.json({ ok: false, message }, { status })
  }
}
