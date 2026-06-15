/** V2 Minute Generation — 1 prompt per agenda via generateObject(). */
import { generateObject } from 'ai'
import { resolveLanguageModelForOrganization } from '@/lib/ai/model-config'
import { getDefaultPersona } from '@/lib/ai/personas'
import {
  buildMinuteSystemPrompt, buildMinuteUserPrompt,
  type MinutePromptContext, type AgendaPromptInput,
} from '@/lib/ai/generate-minute-prompt'
import {
  freeFormMinuteSchema, templateFillMinuteSchema,
  renderFreeFormToText, renderTemplateFillToText,
  type FreeFormMinuteOutput, type TemplateFillMinuteOutput,
} from '@/lib/ai/minute-output-schema'
import { buildStructuredTranscriptLine } from './transcript-output'
import { listMinuteMindEntriesForScope, compileMinuteMindContext } from './minute-mind'
import { renderMinuteTemplateSkeleton } from './minute-template'
import type { DatabaseClient } from './shared'

// ── Types ─────────────────────────────────────────────────────────────

export interface MeetingContextV2 {
  meetingId: string
  organizationId: string
  committeeId: string | null
  committeeName: string
  committeeSlug: string
  committeePersona: string
  meetingRules: string | null
  glossary: { acronym: string; full_meaning: string }[]
}

export interface AgendaGenerationResult {
  agendaId: string
  agendaNo: string
  mode: 'free-form' | 'template-fill'
  output: FreeFormMinuteOutput | TemplateFillMinuteOutput
  content: string
}

// ── Load shared meeting context (once per meeting) ────────────────────

export async function loadMeetingContextV2(
  supabase: DatabaseClient, meetingId: string,
): Promise<MeetingContextV2> {
  const { data: meeting, error } = await supabase
    .from('meetings')
    .select('id, organization_id, meeting_rules, committees(id, name, slug, persona_prompt)')
    .eq('id', meetingId).single()
  if (error || !meeting) throw new Error('Meeting not found')

  const c = meeting.committees as unknown as {
    id: string; name: string; slug: string; persona_prompt: string | null
  } | null
  const { data: glossary } = await supabase
    .from('glossary').select('acronym, full_meaning')
    .eq('committee_id', c?.id ?? '')

  return {
    meetingId: meeting.id, organizationId: meeting.organization_id,
    committeeId: c?.id ?? null, committeeName: c?.name ?? 'Board',
    committeeSlug: c?.slug ?? 'board',
    committeePersona: c?.persona_prompt || getDefaultPersona(c?.slug ?? 'board'),
    meetingRules: meeting.meeting_rules ?? null, glossary: glossary ?? [],
  }
}

// ── Generate minute for a single agenda (1 API call) ──────────────────

export async function generateMinuteForAgendaV2(params: {
  supabase: DatabaseClient
  ctx: MeetingContextV2
  agendaId: string
  transcriptId?: string | null
}): Promise<AgendaGenerationResult> {
  const { supabase, ctx, agendaId } = params

  const { data: agenda } = await supabase.from('agendas')
    .select('id, agenda_no, title, presenter, additional_info, format_template_id')
    .eq('id', agendaId).single()
  if (!agenda) throw new Error(`Agenda ${agendaId} not found`)

  // Transcript
  let segQ = supabase.from('transcript_segments')
    .select('content, speaker, start_offset').eq('agenda_id', agendaId).order('sort_order')
  if (params.transcriptId) segQ = segQ.eq('transcript_id', params.transcriptId)
  const { data: segments } = await segQ
  const lines = (segments ?? [])
    .filter(s => s.content !== '__NO_TRANSCRIPTION__')
    .map(s => buildStructuredTranscriptLine({ content: s.content, speaker: s.speaker, startOffset: s.start_offset }))
    .filter(Boolean)
  if (lines.length === 0) throw new Error(`No transcript segments for agenda ${agenda.agenda_no}`)

  // Minute Mind rules
  const mindEntries = await listMinuteMindEntriesForScope({
    supabase, organizationId: ctx.organizationId,
    committeeId: ctx.committeeId, meetingId: ctx.meetingId, agendaId,
  })
  const mind = compileMinuteMindContext(mindEntries, 'generation')

  // Template (if assigned)
  let templateSkeleton: string | null = null
  if (agenda.format_template_id) {
    const { data: tmpl } = await supabase.from('format_templates')
      .select('compiled_template').eq('id', agenda.format_template_id).single()
    if (tmpl?.compiled_template) {
      try {
        const parsed = typeof tmpl.compiled_template === 'string'
          ? JSON.parse(tmpl.compiled_template) : tmpl.compiled_template
        templateSkeleton = renderMinuteTemplateSkeleton(parsed)
      } catch { /* skip invalid */ }
    }
  }

  const promptCtx: MinutePromptContext = {
    committeeName: ctx.committeeName, committeePersona: ctx.committeePersona,
    glossary: ctx.glossary, formatterRules: mind.formatterRuleBlock ?? null,
    hardRules: mind.hardRulesBlock ?? null, committeeFacts: mind.committeeFactsBlock ?? null,
    meetingRules: ctx.meetingRules,
  }
  const promptInput: AgendaPromptInput = {
    agendaNo: agenda.agenda_no, agendaTitle: agenda.title, presenter: agenda.presenter,
    transcript: lines.join('\n'), paperExcerpts: null,
    additionalInfo: agenda.additional_info, templateSkeleton, templateEntryDescriptions: null,
  }

  const isTemplate = !!templateSkeleton
  const model = await resolveLanguageModelForOrganization(ctx.organizationId, 'generate_mom')
  const { object } = await generateObject({
    model,
    schema: isTemplate ? templateFillMinuteSchema : freeFormMinuteSchema,
    // System block (persona/rules/glossary) is identical across all agendas in a meeting.
    // Mark it cacheable: Anthropic caches the prefix (cache_control); OpenAI caches it
    // automatically and ignores the provider option. Big saving on the 16-agenda batch.
    messages: [
      {
        role: 'system',
        content: buildMinuteSystemPrompt(promptCtx),
        providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
      },
      { role: 'user', content: buildMinuteUserPrompt(promptInput) },
    ],
    temperature: 0.3,
  })

  return {
    agendaId, agendaNo: agenda.agenda_no,
    mode: isTemplate ? 'template-fill' : 'free-form',
    output: object as FreeFormMinuteOutput | TemplateFillMinuteOutput,
    content: isTemplate
      ? renderTemplateFillToText(object as TemplateFillMinuteOutput)
      : renderFreeFormToText(object as FreeFormMinuteOutput),
  }
}

// ── Retry helper (transient AI/network failures) ──────────────────────

async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  attempts = 3,
): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (attempt < attempts) {
        const backoffMs = 500 * Math.pow(3, attempt - 1) // 500ms, 1500ms
        console.warn(`[generateAllMinutesV2] ${label} attempt ${attempt} failed, retrying in ${backoffMs}ms`)
        await new Promise(resolve => setTimeout(resolve, backoffMs))
      }
    }
  }
  throw lastError
}

// ── Batch: all agendas in parallel (max 5 concurrent) ─────────────────

export async function generateAllMinutesV2(params: {
  supabase: DatabaseClient
  meetingId: string
  transcriptId?: string | null
  concurrency?: number
}): Promise<AgendaGenerationResult[]> {
  const ctx = await loadMeetingContextV2(params.supabase, params.meetingId)
  const { data: agendas } = await params.supabase.from('agendas')
    .select('id').eq('meeting_id', params.meetingId).order('sort_order')
  if (!agendas?.length) throw new Error('No agendas found for this meeting')

  const limit = params.concurrency ?? 5
  const results: AgendaGenerationResult[] = []
  const queue = [...agendas]

  while (queue.length > 0) {
    const batch = queue.splice(0, limit)
    const settled = await Promise.allSettled(
      batch.map(a => withRetry(
        () => generateMinuteForAgendaV2({
          supabase: params.supabase, ctx, agendaId: a.id,
          transcriptId: params.transcriptId,
        }),
        `agenda ${a.id}`,
      )),
    )
    for (const r of settled) {
      if (r.status === 'fulfilled') results.push(r.value)
      else console.error('[generateAllMinutesV2] agenda failed:', r.reason)
    }
  }
  return results
}
