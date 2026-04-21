import { anthropic } from '@ai-sdk/anthropic'
import { google } from '@ai-sdk/google'
import { openai } from '@ai-sdk/openai'
import { streamText } from 'ai'
import {
  normalizeAgendaPdfPath,
  resolveAgendaPdfSource,
  usesHeaderAgendaPdf,
  type AgendaPdfRecordLike,
} from '@/lib/agenda-pdf'
import { inferProviderFromModel, type AiProvider } from '@/lib/ai/catalog'
import { normalizeAskChatModelId } from '@/lib/ai/ask-chat-model'
import { getEffectiveAiConfigForUserPlan, resolveModelById } from '@/lib/ai/model-config'
import { getDefaultPersona } from '@/lib/ai/personas'
import { GO_DEEPER_AGENT_ACTIONS_END, GO_DEEPER_AGENT_ACTIONS_START, splitGoDeeperAgentResponse } from '@/lib/meeting-generation/go-deeper-agent-actions'
import { trimContextBlock, getCachedAgendaSlideText } from '@/lib/meeting-generation/go-deeper-chat'
import { getCanonicalCurrentMinuteForAgendaId } from '@/lib/meeting-generation/current-minute'
import { compileMinuteMindContext, listMinuteMindEntriesForScope } from '@/lib/meeting-generation/minute-mind'
import { buildAgendaChatSourcePolicyBlock, selectTopRelevantExcerpts } from '@/lib/meeting-generation/source-policy'
import {
  assertAskModelAllowedForUserPlan,
  consumeGoDeeperAgentCredit,
  getUserEntitlementSnapshot,
} from '@/lib/subscription/entitlements'
import { createClient } from '@/lib/supabase/server'
import { uuidSchema } from '@/lib/validation'

export const runtime = 'nodejs'

const MAX_TRANSCRIPT_CONTEXT_CHARS = 18_000
const MAX_SLIDE_CONTEXT_CHARS = 12_000
const MAX_MINUTE_CONTEXT_CHARS = 8_000
const MAX_RAG_CONTEXT_CHARS = 6_000

type Segment = {
  content: string
  speaker: string | null
  start_offset: number | null
  end_offset: number | null
}

type ChatRequestBody = {
  agendaId: string
  mode: 'ask' | 'agent'
  modelId?: string
  webSearch?: boolean
  messages?: Array<{
    role: string
    parts?: Array<{ type?: string; text?: string }>
    content?: string
  }>
}

function jsonError(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function formatTimestamp(seconds: number | null): string {
  if (seconds == null) return ''
  const safe = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(safe / 60)
  const remainingSeconds = safe % 60
  return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
}

function buildTranscriptContext(segments: Segment[]) {
  if (segments.length === 0) return 'No transcript segments were assigned for this agenda.'
  return segments
    .map(segment => {
      const timestamp = segment.start_offset != null
        ? `[${formatTimestamp(segment.start_offset)}–${formatTimestamp(segment.end_offset)}]`
        : ''
      const speaker = segment.speaker ? `${segment.speaker}: ` : ''
      return `${timestamp} ${speaker}${segment.content}`.trim()
    })
    .join('\n\n')
}

function buildAskPrompt(params: {
  persona: string
  committeeName: string
  agendaLabel: string
  transcriptContext: string
  slideSourceNote: string
  slideContext: string
  minuteContent: string
  ragContext: string
  formatterRuleBlock?: string
  hardRulesBlock?: string
  committeeFactsBlock?: string
  webSearch: boolean
}) {
  const groundedRule = params.webSearch
    ? '- Web mode is active. You MUST use current web sources for definitions, terminology, external facts, regulations, market context, and recent developments when the meeting record alone is not enough.'
    : '- Stay grounded in the transcript, slides, and minutes below. If something is missing, say exactly what is missing.'

  const ragBlock = params.ragContext
    ? `\nCOMMITTEE REFERENCE DOCUMENTS:\n---\n${params.ragContext}\n---`
    : ''

  return `${params.persona}

You are the ${params.committeeName} Secretariat officer who prepared, reviewed, and understands the working minutes for ${params.agendaLabel}.
Speak like the responsible secretariat for this meeting record, not like a generic AI assistant.

${buildAgendaChatSourcePolicyBlock()}
${groundedRule}
- Use clear, professional language suitable for secretariat work, but sound warm, steady, and helpful instead of dry or robotic.
- Sound like someone who knows this meeting file closely and is helping a colleague interpret or verify the record.
- Start with a direct answer in 1-2 sentences before going into detail.
- If the answer is supported by the meeting record, open naturally with phrasing such as "Yes - I found this in the meeting record..." or "No - this does not appear in the meeting record..." and mention the relevant timestamp when available.
- If web mode contributes external knowledge, introduce it naturally with phrasing such as "From my review of current public references..." or "Based on current external references..."
- Prefer concrete phrasing such as "In the transcript", "In the current minutes", or "For this agenda" instead of "based on the materials you provided".
- When useful, answer in a first-person secretariat voice, but never imply certainty beyond the record.
- Cite timestamps and speakers when relying on transcript evidence.
- Mention the agenda number/title when useful.
- When web mode is active, do not say a term is undefined merely because the meeting materials omit it if a standard external definition exists.
- Do not paste raw URLs or long links anywhere in the body of the answer. References will be shown separately in the UI.
- When web mode is active and the question needs external knowledge, structure the answer as:
  1. a short direct opener
  2. [Analysis]
  3. [Meeting Context]
- If you rely on mind rules or reusable formatter memory, apply them naturally in the wording instead of describing them meta-style.

${params.formatterRuleBlock ? `REUSABLE FORMATTER MEMORY:\n---\n${params.formatterRuleBlock}\n---\n\n` : ''}${params.hardRulesBlock ? `MIND HARD RULES:\n---\n${params.hardRulesBlock}\n---\n\n` : ''}${params.committeeFactsBlock ? `MIND STANDING FACTS AND TERMINOLOGY:\n---\n${params.committeeFactsBlock}\n---\n\n` : ''}MEETING DATA:

TRANSCRIPT CONTEXT:
---
${params.transcriptContext}
---

${params.slideSourceNote ? `SLIDE SOURCE NOTE:\n${params.slideSourceNote}\n\n` : ''}PRESENTATION SLIDES / PAPER:
---
${params.slideContext}
---

CURRENT GENERATED MINUTES:
---
${params.minuteContent}
---${ragBlock}`
}

function getWebSearchConfig(provider: AiProvider) {
  if (provider === 'anthropic') {
    return {
      tools: {
        web_search: anthropic.tools.webSearch_20250305({
          maxUses: 3,
        }),
      },
      toolChoice: {
        type: 'tool' as const,
        toolName: 'web_search',
      },
      label: 'anthropic_web_search',
    }
  }

  if (provider === 'openai') {
    return {
      tools: {
        web_search: openai.tools.webSearch({
          externalWebAccess: true,
          searchContextSize: 'medium',
        }),
      },
      toolChoice: {
        type: 'tool' as const,
        toolName: 'web_search',
      },
      label: 'openai_web_search',
    }
  }

  return {
    tools: {
      google_search: google.tools.googleSearch({
        mode: 'MODE_UNSPECIFIED',
      }),
    },
    toolChoice: {
      type: 'tool' as const,
      toolName: 'google_search',
    },
    label: 'google_search',
  }
}

function buildAgentPrompt(params: {
  persona: string
  committeeName: string
  agendaLabel: string
  transcriptContext: string
  minuteContent: string
  formatterRuleBlock?: string
  hardRulesBlock?: string
  committeeFactsBlock?: string
}) {
  return `${params.persona}

You are the ${params.committeeName} Secretariat editor who drafted and understands the working minutes for ${params.agendaLabel}.
Sound like the responsible secretariat revising the minute, not like a generic AI tool.

CURRENT MINUTES:
---
${params.minuteContent}
---

TRANSCRIPT REFERENCE:
---
${params.transcriptContext}
---

RULES:
- If the user provides "SELECTED EXCERPT" and the request needs a current-minute edit, the visible reply must be ONLY the rewritten excerpt text.
- Otherwise, if the request needs a current-minute edit, the visible reply must be the FULL updated minutes with the requested change applied.
- If intent is "save_only", the visible reply must be a short acknowledgement in 1-2 sentences that clearly states what will be remembered.
- If intent is "both" and no selected excerpt is present, the visible reply must still include the FULL updated minutes first, followed by one short sentence confirming the rule will be remembered for future work.
- Only edit the specific section the user is asking to change.
- Preserve the existing structure and formatting unless the user explicitly requests otherwise.
- Use formal third-person corporate language appropriate for ${params.committeeName}.
- When you explain a proposed change, frame it like a secretariat editor updating the record for this agenda.
- Do not remove or rewrite unrelated parts.
- Use the transcript only to make the requested edit more accurate.
- Wrap uncertain details in [[VERIFY: text]].

INTENT CLASSIFICATION:
- Use "apply_only" when the user is asking to change the current minute only.
- Use "save_only" when the user is giving a future rule, standing preference, terminology rule, or committee fact to remember later.
- Use "both" when the user wants the current minute changed now and also wants the rule remembered for future work.
- Use "none" when the user is only clarifying, asking a question, confirming something, or there is no concrete action yet.
- If the user is explicitly asking to change the RESOLVED outcome mode between closure/no action and follow-up/action, still treat that as a current-minute change and set "resolvedOutcomeChange" accordingly.

CLASSIFICATION EXAMPLES:
- "Boleh tak kau ubah 61% tu jadi 63% and recalculate account size." -> apply_only
- "Next time boleh tak dekat resolved kalau x de action buat 'Noted as presented' je." -> save_only
- "Boleh tak lepas ni kau ubah Head, CMRD tu jadi CRO, dia dah naik pangkat." -> both
- "There is no action needed, change it to no action now." -> apply_only + resolvedOutcomeChange.nextMode = "closed"
- "This agenda still needs follow-up, change it back to follow-up." -> apply_only + resolvedOutcomeChange.nextMode = "follow_up"
- Clarification-only or confirmation-only conversation -> none

AGENT ACTION METADATA:
- After the visible reply, append this exact machine-only block and nothing after it:
${GO_DEEPER_AGENT_ACTIONS_START}
{"intent":"none","applyScope":"none","minuteProposalText":"","sourceExcerpt":"","mindDraft":null,"resolvedOutcomeChange":null}
${GO_DEEPER_AGENT_ACTIONS_END}
- Do not wrap the metadata block in markdown fences.
- The JSON must be valid.
- Always append the metadata block, even when intent is "none".
- The visible reply must never be empty.
- When intent is "apply_only" or "both":
  - set "applyScope" to "selection" if the prompt includes "SELECTED EXCERPT"; otherwise set it to "minute"
  - set "minuteProposalText" to the rewritten excerpt for selection scope, or the full updated minutes for minute scope
  - if applyScope is "selection", copy the exact original selection into "sourceExcerpt"
- When intent is "save_only" or "both", provide "mindDraft" with:
  - scopeType: agenda, meeting, or committee
  - entryType: formatting_rule, writing_preference, committee_fact, or exception
  - title: short label
  - content: the remembered rule or fact in clear prose
  - appliesToGeneration: true unless the rule is chat-only
  - appliesToChat: true unless the rule is generation-only
  - isActive: true
- If the remembered instruction is about reusable minute structure, section order, opener lines, RESOLVED layout, field labels, or previous-minute formatting examples, prefer:
  - scopeType: committee
  - entryType: formatting_rule
- Formatting rules are reusable formatter memory for future agendas. They should guide structure and slot-filling style, not serve as factual evidence.
- When save intent is absent, set "mindDraft" to null.
- When apply intent is absent, set "applyScope" to "none", "minuteProposalText" to "", and "sourceExcerpt" to "".
- When the user asks to switch the agenda between closure/no action and follow-up/action:
  - set "resolvedOutcomeChange" to {"nextMode":"closed"} or {"nextMode":"follow_up"}
  - rewrite the visible minute so the RESOLVED content matches that mode
  - keep "minuteProposalText" as the full updated minute or rewritten excerpt needed for that switch
  - if no outcome switch is being requested, set "resolvedOutcomeChange" to null.
${params.formatterRuleBlock ? `\n\nREUSABLE FORMATTER MEMORY:\n---\n${params.formatterRuleBlock}\n---` : ''}${params.hardRulesBlock ? `\n\nMIND HARD RULES:\n---\n${params.hardRulesBlock}\n---` : ''}${params.committeeFactsBlock ? `\n\nMIND STANDING FACTS AND TERMINOLOGY:\n---\n${params.committeeFactsBlock}\n---` : ''}`
}

function createTimings() {
  const startedAt = Date.now()
  const values: Record<string, number> = {}

  return {
    set(name: string, durationMs: number) {
      values[name] = durationMs
    },
    flush(extra: Record<string, unknown> = {}) {
      console.info('[api/chat] timings', {
        total_ms: Date.now() - startedAt,
        ...values,
        ...extra,
      })
    },
  }
}

export async function POST(req: Request) {
  const timings = createTimings()
  let mode: 'ask' | 'agent' | 'unknown' = 'unknown'
  let webSearchEnabled = false
  let agendaId: string | null = null

  try {
    const supabase = await createClient()

    const authStartedAt = Date.now()
    const { data: { user } } = await supabase.auth.getUser()
    timings.set('auth_ms', Date.now() - authStartedAt)
    if (!user) return new Response('Unauthorized', { status: 401 })

    const body = await req.json() as ChatRequestBody
    agendaId = uuidSchema.parse(body.agendaId)
    mode = body.mode
    webSearchEnabled = Boolean(body.webSearch) && mode === 'ask'
    const requestedModelId = body.modelId?.trim() || ''
    const askModelId = mode === 'ask'
      ? normalizeAskChatModelId(requestedModelId)
      : ''
    if (mode === 'ask' && !askModelId) {
      return jsonError(
        requestedModelId
          ? 'Selected Ask model is no longer supported. Please choose another model.'
          : 'Choose an Ask model before sending your question.',
      )
    }
    const rawMessages = body.messages ?? []
    const latestUserQuery = [...rawMessages]
      .reverse()
      .find(message => message.role === 'user')
    const latestUserText = latestUserQuery
      ? ((latestUserQuery.parts ?? [])
          .filter(part => part.type === 'text')
          .map(part => part.text ?? '')
          .join('')
          .trim() || latestUserQuery.content?.trim() || '')
      : ''

    const agendaLookupStartedAt = Date.now()
    const { data: agenda, error: agendaError } = await supabase
      .from('agendas')
      .select('id, agenda_no, title, slide_pages, sort_order, meeting_id, meetings(id, organization_id, committees(id, name, slug, persona_prompt))')
      .eq('id', agendaId)
      .single()
    timings.set('agenda_lookup_ms', Date.now() - agendaLookupStartedAt)

    if (agendaError || !agenda) {
      return new Response('Agenda not found', { status: 404 })
    }

    const meeting = agenda.meetings as unknown as {
      id: string
      organization_id: string
      committees: { id: string; name: string; slug: string; persona_prompt: string | null } | null
    }
    const entitlement = await getUserEntitlementSnapshot({
      userId: user.id,
      organizationId: meeting.organization_id,
    })

    if (mode === 'ask') {
      assertAskModelAllowedForUserPlan(entitlement.planTier, askModelId)
    } else {
      await consumeGoDeeperAgentCredit({
        userId: user.id,
        organizationId: meeting.organization_id,
        meetingId: meeting.id,
        createdBy: user.id,
      })
    }

    const persona = meeting.committees?.persona_prompt
      || getDefaultPersona(meeting.committees?.slug ?? 'board')
    const committeeName = meeting.committees?.name ?? 'Board'
    const committeeId = meeting.committees?.id ?? null
    const agendaLabel = `Agenda ${agenda.agenda_no}: "${agenda.title}"`
    const directSlidePath = normalizeAgendaPdfPath(agenda.slide_pages)
    const needsHeaderSlideLookup = mode === 'ask' && usesHeaderAgendaPdf(agenda.slide_pages)

    const transcriptPromise = (async () => {
      const startedAt = Date.now()
      const { data, error } = await supabase
        .from('transcript_segments')
        .select('content, speaker, start_offset, end_offset')
        .eq('agenda_id', agendaId)
        .order('sort_order')
      timings.set('transcript_fetch_ms', Date.now() - startedAt)
      if (error) throw new Error(error.message)
      return (data ?? []) as Segment[]
    })()

    const minutePromise = (async () => {
      const startedAt = Date.now()
      const minute = await getCanonicalCurrentMinuteForAgendaId<{
        id: string
        agenda_id: string
        content: string
      }>({
        supabase,
        agendaId,
        extraColumns: 'content',
      })
      timings.set('current_minute_lookup_ms', Date.now() - startedAt)
      return minute
    })()

    const mindPromise = (async () => {
      const startedAt = Date.now()
        const entries = await listMinuteMindEntriesForScope({
          supabase: supabase as never,
          organizationId: meeting.organization_id,
          committeeId,
          meetingId: meeting.id,
          agendaId,
        })
      timings.set('minute_mind_fetch_ms', Date.now() - startedAt)
      return entries
    })()

    const modelPromise = (async () => {
      const startedAt = Date.now()
      if (mode === 'ask') {
        const provider = inferProviderFromModel(askModelId)
        if (!provider) {
          throw new Error(`Unknown Ask model: ${askModelId}`)
        }
        const model = resolveModelById(askModelId)
        timings.set('model_resolution_ms', Date.now() - startedAt)
        return {
          model,
          provider,
        }
      }

      const config = await getEffectiveAiConfigForUserPlan(
        meeting.organization_id,
        entitlement.planTier,
        'go_deeper_agent',
      )
      const model = resolveModelById(config.model)
      timings.set('model_resolution_ms', Date.now() - startedAt)
      return {
        model,
        provider: config.provider,
      }
    })()

    const ragPromise = mode === 'ask' && committeeId && latestUserText
      ? (async () => {
          const startedAt = Date.now()
          const { data: chunks } = await supabase
            .from('committee_rag_chunks')
            .select(`
              content,
              chunk_index,
              committee_rag_documents!inner(document_name, file_name)
            `)
            .eq('committee_id', committeeId)
            .limit(400)

          timings.set('rag_fetch_ms', Date.now() - startedAt)

          if (!chunks || chunks.length === 0) return ''

          const rendered = selectTopRelevantExcerpts(
            `${agendaLabel}\n${latestUserText}`,
            chunks.flatMap(chunk => {
              const doc = Array.isArray(chunk.committee_rag_documents)
                ? chunk.committee_rag_documents[0]
                : chunk.committee_rag_documents
              const name = doc?.document_name || doc?.file_name || 'Document'
              const content = (chunk.content ?? '').trim()
              if (!content) return []
              const chunkNo = typeof chunk.chunk_index === 'number' ? chunk.chunk_index + 1 : 1
              return [{
                source: `${name} (chunk ${chunkNo})`,
                text: content,
              }]
            }),
            8,
          )
            .map(excerpt => `[${excerpt.source}] ${excerpt.text}`)
            .join('\n\n')

          return trimContextBlock(rendered, MAX_RAG_CONTEXT_CHARS)
        })()
      : Promise.resolve('')

    const slidePromise = mode === 'ask'
      ? (async () => {
          let slidePath = directSlidePath
          let slideSourceNote = ''

          if (!slidePath && needsHeaderSlideLookup) {
            const startedAt = Date.now()
            const { data: meetingAgendas, error } = await supabase
              .from('agendas')
              .select('id, agenda_no, title, slide_pages, sort_order')
              .eq('meeting_id', meeting.id)
              .order('sort_order')
            timings.set('header_slide_resolution_ms', Date.now() - startedAt)

            if (error) throw new Error(error.message)

            const resolvedAgendaPdf = resolveAgendaPdfSource(
              (meetingAgendas ?? []) as AgendaPdfRecordLike[],
              agendaId,
            )

            slidePath = resolvedAgendaPdf.path
            slideSourceNote = resolvedAgendaPdf.source === 'header' && resolvedAgendaPdf.headerAgendaNo
              ? `Slide context is inherited from header Agenda ${resolvedAgendaPdf.headerAgendaNo}: "${resolvedAgendaPdf.headerAgendaTitle ?? 'Section Header'}". Use only the parts relevant to ${agendaLabel}.`
              : ''
          }

          if (!slidePath) {
            return {
              slideContext: 'No slide context available.',
              slideSourceNote,
              slideCacheSource: 'none' as const,
            }
          }

          const cachedSlide = await getCachedAgendaSlideText({
            meetingId: meeting.id,
            slidePath,
            onTiming(name, durationMs) {
              timings.set(name, durationMs)
            },
          })

          return {
            slideContext: trimContextBlock(
              cachedSlide.text || 'No slide context available.',
              MAX_SLIDE_CONTEXT_CHARS,
            ) || 'No slide context available.',
            slideSourceNote,
            slideCacheSource: cachedSlide.source,
          }
        })()
      : Promise.resolve({
          slideContext: 'No slide context available.',
          slideSourceNote: '',
          slideCacheSource: 'skipped' as const,
        })

    const [segments, minute, mindEntries, modelBundle, ragContext, slideBundle] = await Promise.all([
      transcriptPromise,
      minutePromise,
      mindPromise,
      modelPromise,
      ragPromise,
      slidePromise,
    ])

    const transcriptContext = trimContextBlock(
      buildTranscriptContext(segments),
      MAX_TRANSCRIPT_CONTEXT_CHARS,
    ) || 'No transcript segments were assigned for this agenda.'

    const minuteContent = trimContextBlock(
      minute?.content ?? '(No minutes generated yet)',
      MAX_MINUTE_CONTEXT_CHARS,
    ) || '(No minutes generated yet)'

    const mindContext = compileMinuteMindContext(mindEntries, 'chat')

    const systemPrompt = mode === 'agent'
      ? buildAgentPrompt({
          persona,
          committeeName,
          agendaLabel,
          transcriptContext,
          minuteContent,
          formatterRuleBlock: mindContext.formatterRuleBlock,
          hardRulesBlock: mindContext.hardRulesBlock,
          committeeFactsBlock: mindContext.committeeFactsBlock,
        })
      : buildAskPrompt({
          persona,
          committeeName,
          agendaLabel,
          transcriptContext,
          slideSourceNote: slideBundle.slideSourceNote,
          slideContext: slideBundle.slideContext,
          minuteContent,
          ragContext,
          formatterRuleBlock: mindContext.formatterRuleBlock,
          hardRulesBlock: mindContext.hardRulesBlock,
          committeeFactsBlock: mindContext.committeeFactsBlock,
          webSearch: webSearchEnabled,
        })

    const webSearchConfig = webSearchEnabled
      ? getWebSearchConfig(modelBundle.provider)
      : null

    const modelMessages = rawMessages
      .map(message => {
        const text = (message.parts ?? [])
          .filter(part => part.type === 'text')
          .map(part => part.text ?? '')
          .join('')
        const rawContent = text || message.content || ''
        const content = mode === 'agent' && message.role === 'assistant'
          ? splitGoDeeperAgentResponse(rawContent).visibleText
          : rawContent

        return {
          role: message.role as 'user' | 'assistant',
          content,
        }
      })
      .filter(message => message.content.trim().length > 0)

    timings.flush({
      agenda_id: agendaId,
      mode,
      web_search: webSearchEnabled,
      slide_cache_source: slideBundle.slideCacheSource,
      web_search_provider: webSearchConfig?.label ?? 'disabled',
      stream_starting: true,
    })

    const result = streamText({
      model: modelBundle.model,
      system: systemPrompt,
      messages: modelMessages,
      tools: webSearchConfig?.tools as never,
      toolChoice: webSearchConfig?.toolChoice as never,
    })

    return result.toUIMessageStreamResponse()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Chat API error'
    timings.flush({
      agenda_id: agendaId,
      mode,
      web_search: webSearchEnabled,
      error: message,
    })
    console.error('[chat/route] Error:', message)
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
