import { streamText } from 'ai'
import { z } from 'zod'
import { getDefaultPersona } from '@/lib/ai/personas'
import { listCanonicalCurrentMinutesForAgendaIds } from '@/lib/meeting-generation/current-minute'
import { compileMinuteMindContext, listMinuteMindEntriesForScope } from '@/lib/meeting-generation/minute-mind'
import { buildMeetingChatSourcePolicyBlock, selectTopRelevantExcerpts } from '@/lib/meeting-generation/source-policy'
import { normalizeAskChatModelId } from '@/lib/ai/ask-chat-model'
import { resolveModelById } from '@/lib/ai/model-config'
import {
  assertAskModelAllowedForUserPlan,
  getUserEntitlementSnapshot,
} from '@/lib/subscription/entitlements'
import { uuidSchema } from '@/lib/validation'
import {
  requireWritableMeetingContext,
} from '../../../committee-generation/_lib/write-access'

export const runtime = 'nodejs'

type ChatMessagePart = {
  type?: string
  text?: string
}

type RawChatMessage = {
  role: string
  parts?: ChatMessagePart[]
  content?: string
}

type TranscriptSegmentRow = {
  agenda_id: string
  content: string
  speaker: string | null
  start_offset: number | null
  end_offset: number | null
  sort_order: number
}

const bodySchema = z.object({
  modelId: z.string().optional(),
  messages: z.array(z.object({
    role: z.string(),
    parts: z.array(z.object({
      type: z.string().optional(),
      text: z.string().optional(),
    })).optional(),
    content: z.string().optional(),
  })).default([]),
})

function formatTimestamp(seconds: number | null) {
  if (seconds == null) return ''
  const safe = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const remainingSeconds = safe % 60
  return [hours, minutes, remainingSeconds].map(value => String(value).padStart(2, '0')).join(':')
}

function buildAgendaOutline(agendas: Array<{ agenda_no: string; title: string }>) {
  if (agendas.length === 0) return 'No agenda outline is available.'

  return agendas
    .map(agenda => `- Agenda ${agenda.agenda_no}: ${agenda.title}`)
    .join('\n')
}

function buildTranscriptContext(
  segments: TranscriptSegmentRow[],
  agendaLabels: Map<string, string>,
  fallbackTranscriptContent?: string | null,
) {
  if (segments.length === 0) {
    const fallback = fallbackTranscriptContent?.trim()
    return fallback
      ? fallback
      : 'No transcript segments are available for this meeting.'
  }

  return segments
    .map(segment => {
      const label = agendaLabels.get(segment.agenda_id) ?? 'Unmapped agenda'
      const timestamp = segment.start_offset != null
        ? `[${formatTimestamp(segment.start_offset)}–${formatTimestamp(segment.end_offset)}]`
        : ''
      const speaker = segment.speaker ? `${segment.speaker}: ` : ''
      return `${timestamp} ${label}\n${speaker}${segment.content}`.trim()
    })
    .join('\n\n')
}

function buildMinutesContext(
  agendas: Array<{ id: string; agenda_no: string; title: string }>,
  minutesByAgenda: Map<string, string>,
) {
  const sections = agendas
    .map(agenda => {
      const content = minutesByAgenda.get(agenda.id)?.trim()
      if (!content) return null
      return `Agenda ${agenda.agenda_no} - ${agenda.title}\n---\n${content}\n---`
    })
    .filter((section): section is string => Boolean(section))

  return sections.length > 0
    ? sections.join('\n\n')
    : 'No generated minutes are available for this meeting.'
}

function getLatestUserMessage(messages: RawChatMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'user') continue
    const text = (message.parts ?? [])
      .filter(part => part.type === 'text')
      .map(part => part.text ?? '')
      .join('')
      .trim()

    if (text) return text
    if (typeof message.content === 'string' && message.content.trim()) {
      return message.content.trim()
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
    const { messages, modelId } = bodySchema.parse(await request.json())
    const askModelId = normalizeAskChatModelId(modelId ?? '')
    if (!askModelId) {
      return new Response(JSON.stringify({
        error: modelId?.trim()
          ? 'Selected Ask model is no longer supported. Please choose another model.'
          : 'Choose an Ask model before sending your question.',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    const latestUserQuery = getLatestUserMessage(messages as RawChatMessage[])
    const context = await requireWritableMeetingContext(meetingId)
    const entitlement = await getUserEntitlementSnapshot({
      userId: context.userId,
      organizationId: context.organizationId,
    })
    assertAskModelAllowedForUserPlan(entitlement.planTier, askModelId)

    const { data: meeting, error: meetingError } = await context.adminSupabase
      .from('meetings')
      .select('id, title, organization_id, committees(id, name, slug, persona_prompt)')
      .eq('id', meetingId)
      .single()

    if (meetingError || !meeting) {
      throw new Error(meetingError?.message || 'Meeting not found')
    }

    const { data: agendas, error: agendasError } = await context.adminSupabase
      .from('agendas')
      .select('id, agenda_no, title, sort_order')
      .eq('meeting_id', meetingId)
      .order('sort_order')

    if (agendasError) {
      throw new Error(agendasError.message)
    }

    const agendaRows = agendas ?? []
    const agendaIdList = agendaRows.map(agenda => agenda.id)
    const agendaLabels = new Map(
      agendaRows.map(agenda => [agenda.id, `Agenda ${agenda.agenda_no} - ${agenda.title}`]),
    )

    const { data: latestTranscript, error: transcriptError } = await context.adminSupabase
      .from('transcripts')
      .select('id, source, content, created_at')
      .eq('meeting_id', meetingId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (transcriptError) {
      throw new Error(transcriptError.message)
    }

    const { data: transcriptSegments, error: segmentsError } = latestTranscript
      ? await context.adminSupabase
          .from('transcript_segments')
          .select('agenda_id, content, speaker, start_offset, end_offset, sort_order')
          .eq('transcript_id', latestTranscript.id)
          .order('start_offset', { ascending: true })
          .order('sort_order', { ascending: true })
      : { data: [], error: null }

    if (segmentsError) {
      throw new Error(segmentsError.message)
    }

    const minuteRows = await listCanonicalCurrentMinutesForAgendaIds<{
      id: string
      agenda_id: string
      content: string
    }>({
      supabase: context.adminSupabase,
      agendaIds: agendaIdList,
      extraColumns: 'content',
    })

    const minutesByAgenda = new Map(
      Array.from(minuteRows.values()).map(row => [row.agenda_id, row.content]),
    )

    const committee = Array.isArray(meeting.committees)
      ? meeting.committees[0]
      : meeting.committees
    const committeeId = committee?.id ?? null
    const committeeName = committee?.name ?? 'Board'
    const persona = committee?.persona_prompt
      || getDefaultPersona(committee?.slug ?? 'board')

    const transcriptContext = buildTranscriptContext(
      (transcriptSegments ?? []) as TranscriptSegmentRow[],
      agendaLabels,
      latestTranscript?.content,
    )
    const minutesContext = buildMinutesContext(agendaRows, minutesByAgenda)
    const agendaOutline = buildAgendaOutline(agendaRows)
    const mindEntries = await listMinuteMindEntriesForScope({
      supabase: context.adminSupabase,
      organizationId: context.organizationId,
      committeeId,
      meetingId,
    })
    const mindContext = compileMinuteMindContext(mindEntries, 'chat')
    const ragContext = committeeId && latestUserQuery
      ? await (async () => {
          const { data: chunks, error } = await context.adminSupabase
            .from('committee_rag_chunks')
            .select(`
              content,
              chunk_index,
              committee_rag_documents!inner(document_name, file_name)
            `)
            .eq('committee_id', committeeId)
            .limit(250)

          if (error || !chunks || chunks.length === 0) return ''

          const excerpts = selectTopRelevantExcerpts(
            `${meeting.title}\n${latestUserQuery}`,
            chunks.flatMap(chunk => {
              const document = Array.isArray(chunk.committee_rag_documents)
                ? chunk.committee_rag_documents[0]
                : chunk.committee_rag_documents
              const label = document?.document_name || document?.file_name || 'Committee reference'
              const content = (chunk.content ?? '').trim()
              if (!content) return []
              const chunkNo = typeof chunk.chunk_index === 'number' ? chunk.chunk_index + 1 : 1
              return [{
                source: `${label} (chunk ${chunkNo})`,
                text: content,
              }]
            }),
            8,
          )

          if (excerpts.length === 0) return ''
          return excerpts
            .map(excerpt => `[${excerpt.source}] ${excerpt.text}`)
            .join('\n\n')
        })()
      : ''

    const systemPrompt = `${persona}

You are the ${committeeName} Secretariat meeting assistant for the meeting titled "${meeting.title}".

You answer questions about the WHOLE meeting, not just one agenda.

${buildMeetingChatSourcePolicyBlock()}

RESPONSE STYLE:
- Use clear, formal, professional language.
- Be comprehensive but readable.
- Use bullets when that helps clarity.
- Cite timestamps when relying on transcript evidence.
- Mention the relevant agenda number/title when useful.
${mindContext.formatterRuleBlock ? `\n\nREUSABLE FORMATTER MEMORY:\n${mindContext.formatterRuleBlock}` : ''}
${mindContext.hardRulesBlock ? `\n\nMIND HARD RULES:\n${mindContext.hardRulesBlock}` : ''}
${mindContext.committeeFactsBlock ? `\n\nMIND STANDING FACTS AND TERMINOLOGY:\n${mindContext.committeeFactsBlock}` : ''}

MEETING AGENDA OUTLINE:
---
${agendaOutline}
---

FULL MEETING TRANSCRIPT CONTEXT:
---
${transcriptContext}
---

CURRENT GENERATED MINUTES ACROSS THE MEETING:
---
${minutesContext}
---${ragContext ? `\n\nCOMMITTEE REFERENCE CONTEXT:\n---\n${ragContext}\n---` : ''}`

    const modelMessages = (messages as RawChatMessage[])
      .map(message => {
        const text = (message.parts ?? [])
          .filter(part => part.type === 'text')
          .map(part => part.text ?? '')
          .join('')

        return {
          role: message.role as 'user' | 'assistant',
          content: text || message.content || '',
        }
      })
      .filter(message => message.content.trim().length > 0)

    const model = resolveModelById(askModelId)

    const result = streamText({
      model,
      system: systemPrompt,
      messages: modelMessages,
    })

    return result.toUIMessageStreamResponse()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Meeting chatbot failed'
    console.error('[api/meeting/[id]/mom-chat] failed', { message })
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
