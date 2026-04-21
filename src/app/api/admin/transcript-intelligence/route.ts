import { NextResponse } from 'next/server'
import { getEffectiveAiConfigsForOrganization } from '@/lib/ai/model-config'
import {
  isTranscriptIntelligencePreset,
  type TranscriptIntelligencePreset,
} from '@/lib/ai/transcript-intelligence'
import { requireAdminOrgContext, serializeAdminApiError } from '../_lib/write-access'

const MISSING_TRANSCRIPT_PRESET_MIGRATION_MESSAGE =
  'Database migration missing: transcript intelligence preset column is not available yet. Please run the latest Supabase migrations.'

function isMissingTranscriptPresetColumn(
  error: { code?: string | null; message?: string | null } | null | undefined,
) {
  if (!error) return false
  if (error.code === 'PGRST204') return true
  const message = (error.message ?? '').toLowerCase()
  return (
    message.includes('organization_ai_settings')
    && message.includes('transcript_intelligence_preset')
  )
}

export async function POST(request: Request) {
  try {
    if (!(process.env.OPENAI_API_KEY ?? '').trim()) {
      throw new Error('OPENAI_API_KEY is missing for OpenAI transcript presets.')
    }

    const body = (await request.json()) as {
      preset?: TranscriptIntelligencePreset
    }
    const preset = body.preset?.trim()
    if (!preset || !isTranscriptIntelligencePreset(preset)) {
      return NextResponse.json(
        { ok: false, code: 'invalid_transcript_preset', message: 'Invalid transcript intelligence preset.' },
        { status: 400 },
      )
    }

    const context = await requireAdminOrgContext()
    const configs = await getEffectiveAiConfigsForOrganization(context.organizationId)
    const defaultConfig = configs.generate_mom

    const { error } = await context.adminSupabase
      .from('organization_ai_settings')
      .upsert(
        {
          organization_id: context.organizationId,
          provider: defaultConfig.provider,
          model: defaultConfig.model,
          transcript_intelligence_preset: preset,
          generate_mom_provider: configs.generate_mom.provider,
          generate_mom_model: configs.generate_mom.model,
          go_deeper_ask_provider: configs.go_deeper_ask.provider,
          go_deeper_ask_model: configs.go_deeper_ask.model,
          go_deeper_agent_provider: configs.go_deeper_agent.provider,
          go_deeper_agent_model: configs.go_deeper_agent.model,
          generate_itineraries_provider: configs.generate_itineraries.provider,
          generate_itineraries_model: configs.generate_itineraries.model,
        },
        { onConflict: 'organization_id' },
      )

    if (error && isMissingTranscriptPresetColumn(error)) {
      return NextResponse.json(
        {
          ok: false,
          code: 'missing_transcript_preset_migration',
          message: MISSING_TRANSCRIPT_PRESET_MIGRATION_MESSAGE,
        },
        { status: 409 },
      )
    }

    if (error) {
      throw new Error(error.message)
    }

    await context.adminSupabase.from('audit_logs').insert({
      organization_id: context.organizationId,
      user_id: context.userId,
      action: 'organization_transcript_preset_updated',
      details: { preset },
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    const { status, message, code } = serializeAdminApiError(
      error,
      'Failed to update transcript intelligence preset',
    )
    return NextResponse.json({ ok: false, message, code }, { status })
  }
}
