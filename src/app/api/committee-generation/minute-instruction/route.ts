import { NextResponse } from 'next/server'
import {
  committeeMinuteInstructionSchema,
  uuidSchema,
} from '@/lib/validation'
import {
  requireWritableCommitteeContext,
  serializeCommitteeGenerationApiError,
} from '../_lib/write-access'

const MISSING_TABLE_HINT = 'Database migration missing: table public.committee_generation_settings is not created yet. Please run the latest Supabase migrations.'

function isMissingCommitteeGenerationSettingsTable(error: { code?: string | null; message?: string | null } | null | undefined) {
  if (!error) return false
  if (error.code === 'PGRST205') return true
  const message = (error.message ?? '').toLowerCase()
  return message.includes('committee_generation_settings') && message.includes('schema cache')
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      committeeId?: string
      instruction?: string
    }
    const committeeId = uuidSchema.parse(body.committeeId ?? '')
    const instruction = committeeMinuteInstructionSchema.parse(body.instruction ?? '').trim()
    const context = await requireWritableCommitteeContext(committeeId)

    const { error } = await context.adminSupabase
      .from('committee_generation_settings')
      .upsert(
        {
          committee_id: committeeId,
          minute_instruction: instruction,
        },
        { onConflict: 'committee_id' },
      )

    if (error) {
      if (isMissingCommitteeGenerationSettingsTable(error)) {
        throw new Error(MISSING_TABLE_HINT)
      }
      throw new Error(error.message)
    }

    await context.adminSupabase.from('audit_logs').insert({
      organization_id: context.organizationId,
      user_id: context.userId,
      action: 'committee_minute_instruction_updated',
      details: { committee_id: committeeId },
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    const { status, message } = serializeCommitteeGenerationApiError(error, 'Failed to save minute instruction')
    console.error('[api/committee-generation/minute-instruction] failed:', message)
    return NextResponse.json({ ok: false, message }, { status })
  }
}
