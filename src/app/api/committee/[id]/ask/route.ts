import { generateText } from 'ai'
import { z } from 'zod'
import { getDefaultPersona } from '@/lib/ai/personas'
import { resolveLanguageModelForUserPlan } from '@/lib/ai/model-config'
import { getMeetingLink } from '@/lib/meeting-links'
import type { CommitteeChatMeetingMatch } from '@/lib/committee-chat'
import { compileMinuteMindContext, listMinuteMindEntriesForScope } from '@/lib/meeting-generation/minute-mind'
import { buildCommitteeChatSourcePolicyBlock, selectTopRelevantExcerpts } from '@/lib/meeting-generation/source-policy'
import { getUserEntitlementSnapshot } from '@/lib/subscription/entitlements'
import { uuidSchema } from '@/lib/validation'
import {
  requireReadableCommitteeContext,
  serializeCommitteeGenerationApiError,
} from '../../../committee-generation/_lib/write-access'

export const runtime = 'nodejs'

const bodySchema = z.object({
  query: z.string().trim().min(1).max(4000),
})

const STOPWORDS = new Set([
  'a', 'about', 'ada', 'adakah', 'and', 'apa', 'atau', 'bagi', 'be', 'boleh', 'by',
  'dah', 'dalam', 'dan', 'dari', 'dengan', 'for', 'has', 'have', 'i', 'in', 'ini',
  'is', 'it', 'itu', 'je', 'juga', 'kah', 'ke', 'kepada', 'keputusan', 'keputusan',
  'macam', 'meeting', 'mengenai', 'mention', 'of', 'on', 'pasal', 'perkara', 'psl',
  'saya', 'semua', 'tak', 'tentang', 'that', 'the', 'this', 'to', 'tu', 'untuk',
  'what', 'yang',
])

type MeetingRow = {
  id: string
  title: string
  meeting_date: string
  status: CommitteeChatMeetingMatch['status']
  finalized_content: string | null
}

type AgendaRow = {
  id: string
  meeting_id: string
  agenda_no: string
  title: string
}

type MinuteRow = {
  agenda_id: string
  content: string
}

type RagChunkRow = {
  content: string
  chunk_index?: number | null
  committee_rag_documents:
    | { document_name: string | null; file_name: string | null }
    | Array<{ document_name: string | null; file_name: string | null }>
    | null
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenizeQuery(value: string) {
  const normalized = normalizeText(value)
  const tokens = normalized
    .split(' ')
    .map(token => token.trim())
    .filter(token => token.length > 1 && !STOPWORDS.has(token))

  return tokens.length > 0 ? tokens : normalized.split(' ').filter(Boolean)
}

function countOccurrences(haystack: string, needle: string) {
  if (!needle) return 0
  const parts = haystack.split(needle)
  return parts.length > 1 ? parts.length - 1 : 0
}

function buildExcerpt(text: string, tokens: string[], maxLength = 220) {
  const source = text.replace(/\s+/g, ' ').trim()
  if (!source) return ''

  const normalized = normalizeText(source)
  const firstToken = tokens.find(token => normalized.includes(token))
  if (!firstToken) {
    return source.length > maxLength ? `${source.slice(0, maxLength - 3).trimEnd()}...` : source
  }

  const index = normalized.indexOf(firstToken)
  const start = Math.max(0, index - 70)
  const end = Math.min(source.length, index + maxLength - 20)
  const excerpt = source.slice(start, end).trim()
  const prefix = start > 0 ? '...' : ''
  const suffix = end < source.length ? '...' : ''
  return `${prefix}${excerpt}${suffix}`
}

function scoreContent(params: {
  title: string
  content: string
  query: string
  tokens: string[]
}) {
  const normalizedTitle = normalizeText(params.title)
  const normalizedContent = normalizeText(params.content)
  const normalizedQuery = normalizeText(params.query)
  let score = 0

  if (normalizedQuery.length > 3 && normalizedContent.includes(normalizedQuery)) {
    score += 28
  }
  if (normalizedQuery.length > 3 && normalizedTitle.includes(normalizedQuery)) {
    score += 24
  }

  params.tokens.forEach(token => {
    const titleHits = countOccurrences(normalizedTitle, token)
    const contentHits = countOccurrences(normalizedContent, token)
    score += titleHits * 10
    score += contentHits * 5
  })

  return score
}

function buildMeetingSource(params: {
  meeting: MeetingRow
  agendas: AgendaRow[]
  currentMinuteMap: Map<string, string>
}) {
  const agendaOutline = params.agendas
    .map(agenda => `Agenda ${agenda.agenda_no}: ${agenda.title}`)
    .join('\n')

  const minuteContent = params.agendas
    .map(agenda => {
      const content = params.currentMinuteMap.get(agenda.id)?.trim()
      if (!content) return null
      return `Agenda ${agenda.agenda_no} - ${agenda.title}\n${content}`
    })
    .filter((value): value is string => Boolean(value))
    .join('\n\n')

  const baseContent = params.meeting.finalized_content?.trim() || minuteContent
  const searchable = [params.meeting.title, agendaOutline, baseContent].filter(Boolean).join('\n\n')

  return {
    searchable,
    excerptSource: baseContent || agendaOutline || params.meeting.title,
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const committeeId = uuidSchema.parse(id)
    const { query } = bodySchema.parse(await request.json())
    const context = await requireReadableCommitteeContext(committeeId)
    const entitlement = await getUserEntitlementSnapshot({
      userId: context.userId,
      organizationId: context.organizationId,
    })

    const { data: committee, error: committeeError } = await context.adminSupabase
      .from('committees')
      .select('id, name, slug, persona_prompt')
      .eq('id', committeeId)
      .maybeSingle()

    if (committeeError || !committee) {
      throw new Error(committeeError?.message || 'Committee not found')
    }

    const { data: meetingsData, error: meetingsError } = await context.adminSupabase
      .from('meetings')
      .select('id, title, meeting_date, status, finalized_content')
      .eq('committee_id', committeeId)
      .order('meeting_date', { ascending: false })
      .limit(60)

    if (meetingsError) {
      throw new Error(meetingsError.message)
    }

    const meetings = (meetingsData ?? []) as MeetingRow[]
    const meetingIds = meetings.map(meeting => meeting.id)

    const [agendasResult, ragResult, mindEntries] = await Promise.all([
      meetingIds.length > 0
        ? context.adminSupabase
            .from('agendas')
            .select('id, meeting_id, agenda_no, title')
            .in('meeting_id', meetingIds)
            .order('sort_order')
        : Promise.resolve({ data: [] as AgendaRow[], error: null }),
      context.adminSupabase
        .from('committee_rag_chunks')
        .select(`
          content,
          chunk_index,
          committee_rag_documents!inner(document_name, file_name)
        `)
        .eq('committee_id', committeeId)
        .limit(120),
      listMinuteMindEntriesForScope({
        supabase: context.adminSupabase,
        organizationId: context.organizationId,
        committeeId,
      }),
    ])

    if (agendasResult.error) {
      throw new Error(agendasResult.error.message)
    }
    if (ragResult.error) {
      throw new Error(ragResult.error.message)
    }

    const agendas = (agendasResult.data ?? []) as AgendaRow[]
    const agendaIds = agendas.map(agenda => agenda.id)

    const { data: currentMinutesData, error: minutesError } = agendaIds.length > 0
      ? await context.adminSupabase
          .from('minutes')
          .select('agenda_id, content')
          .in('agenda_id', agendaIds)
          .eq('is_current', true)
      : { data: [] as MinuteRow[], error: null }

    if (minutesError) {
      throw new Error(minutesError.message)
    }

    const currentMinuteMap = new Map(
      ((currentMinutesData ?? []) as MinuteRow[]).map(row => [row.agenda_id, row.content]),
    )
    const agendasByMeetingId = agendas.reduce<Map<string, AgendaRow[]>>((map, agenda) => {
      const current = map.get(agenda.meeting_id) ?? []
      current.push(agenda)
      map.set(agenda.meeting_id, current)
      return map
    }, new Map())

    const queryTokens = tokenizeQuery(query)
    const scoredMeetings = meetings
      .map(meeting => {
        const source = buildMeetingSource({
          meeting,
          agendas: agendasByMeetingId.get(meeting.id) ?? [],
          currentMinuteMap,
        })

        return {
          meeting,
          score: scoreContent({
            title: meeting.title,
            content: source.searchable,
            query,
            tokens: queryTokens,
          }),
          excerpt: buildExcerpt(source.excerptSource, queryTokens),
        }
      })
      .filter(item => item.score > 0)
      .sort((left, right) => right.score - left.score || right.meeting.meeting_date.localeCompare(left.meeting.meeting_date))

    const meetingMatches: CommitteeChatMeetingMatch[] = scoredMeetings
      .slice(0, 6)
      .map(item => ({
        meetingId: item.meeting.id,
        title: item.meeting.title,
        meetingDate: item.meeting.meeting_date,
        status: item.meeting.status,
        excerpt: item.excerpt || 'Relevant discussion found in this meeting record.',
        href: getMeetingLink(item.meeting.id, item.meeting.status),
      }))

    const ragMatches = selectTopRelevantExcerpts(
      query,
      ((ragResult.data ?? []) as RagChunkRow[]).flatMap(chunk => {
        const document = Array.isArray(chunk.committee_rag_documents)
          ? chunk.committee_rag_documents[0]
          : chunk.committee_rag_documents
        const label = document?.document_name || document?.file_name || 'Committee reference'
        const content = (chunk.content ?? '').trim()
        if (!content) return []
        const chunkNo = typeof chunk.chunk_index === 'number'
          ? (chunk.chunk_index + 1)
          : 1
        return [{
          source: `${label} (chunk ${chunkNo})`,
          text: content,
        }]
      }),
      8,
    )
      .map(item => `[${item.source}] ${item.text}`)

    const meetingContextBlock = meetingMatches.length > 0
      ? meetingMatches
          .map(match => {
            const meeting = meetings.find(item => item.id === match.meetingId)
            const agendaTitles = (agendasByMeetingId.get(match.meetingId) ?? [])
              .slice(0, 8)
              .map(agenda => `Agenda ${agenda.agenda_no}: ${agenda.title}`)
              .join('\n')
            const finalizedOrDraft = meeting?.finalized_content?.trim()
              || (agendasByMeetingId.get(match.meetingId) ?? [])
                .map(agenda => currentMinuteMap.get(agenda.id)?.trim())
                .filter((value): value is string => Boolean(value))
                .join('\n\n')

            return `MEETING: ${match.title}
DATE: ${match.meetingDate}
STATUS: ${match.status}
MATCH EXCERPT:
${match.excerpt}
AGENDA OUTLINE:
${agendaTitles || 'No agenda outline available.'}
DETAILED CONTEXT:
${finalizedOrDraft || 'No finalized or current minute content available.'}`
          })
          .join('\n\n---\n\n')
      : 'No directly matching meeting record was found.'

    const ragContextBlock = ragMatches.length > 0
      ? ragMatches.join('\n\n')
      : 'No directly matching committee reference text was found.'
    const mindContext = compileMinuteMindContext(mindEntries, 'chat')

    const persona = committee.persona_prompt || getDefaultPersona(committee.slug ?? 'board')
    const model = await resolveLanguageModelForUserPlan(
      context.organizationId,
      entitlement.planTier,
      'go_deeper_ask',
    )

    const result = await generateText({
      model,
      system: `${persona}

You are the committee-level Ask assistant for ${committee.name}.
Answer using the committee knowledge base and historical meeting records supplied below.

${buildCommitteeChatSourcePolicyBlock()}

RESPONSE RULES:
- Start with a direct answer in 1-2 sentences.
- If the user is asking whether this committee has discussed a topic before, answer yes/no first when the record supports that.
- Use clear professional secretariat language.
- Mention relevant meetings only when they are supported by the supplied context.
- If the record is inconclusive, say that clearly.
- Do not invent meetings, minutes, decisions, dates, or committee facts.
${mindContext.formatterRuleBlock ? `\n\nREUSABLE FORMATTER MEMORY:\n${mindContext.formatterRuleBlock}` : ''}${mindContext.hardRulesBlock ? `\n\nMIND HARD RULES:\n${mindContext.hardRulesBlock}` : ''}${mindContext.committeeFactsBlock ? `\n\nMIND STANDING FACTS AND TERMINOLOGY:\n${mindContext.committeeFactsBlock}` : ''}

MATCHED MEETING RECORDS:
---
${meetingContextBlock}
---

COMMITTEE REFERENCE CONTEXT:
---
${ragContextBlock}
---`,
      prompt: `User question: ${query}`,
    })

    return new Response(JSON.stringify({
      ok: true,
      answer: result.text.trim(),
      meetingMatches,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    const { status, message } = serializeCommitteeGenerationApiError(
      error,
      'Failed to answer committee question',
    )
    return new Response(JSON.stringify({ ok: false, message }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
