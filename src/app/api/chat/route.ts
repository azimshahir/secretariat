import { streamText } from 'ai'
import { PDFParse } from 'pdf-parse'
import { createClient } from '@/lib/supabase/server'
import { resolveLanguageModelForOrganization, resolveModelById } from '@/lib/ai/model-config'
import { getDefaultPersona } from '@/lib/ai/personas'
import { uuidSchema } from '@/lib/validation'

type Segment = {
  content: string
  speaker: string | null
  start_offset: number | null
  end_offset: number | null
}

function formatTimestamp(seconds: number | null): string {
  if (seconds == null) return ''
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function buildTranscriptContext(segments: Segment[]) {
  if (segments.length === 0) return 'No transcript segments were assigned for this agenda.'
  return segments
    .map(seg => {
      const ts = seg.start_offset != null
        ? `[${formatTimestamp(seg.start_offset)}–${formatTimestamp(seg.end_offset)}]`
        : ''
      const speaker = seg.speaker ? `${seg.speaker}: ` : ''
      return `${ts} ${speaker}${seg.content}`
    })
    .join('\n\n')
}

export async function POST(req: Request) {
  try {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const body = await req.json()
  const { agendaId, mode, modelId, webSearch } = body as {
    agendaId: string
    mode: 'ask' | 'agent'
    modelId?: string
    webSearch?: boolean
  }
  const rawMessages: Array<{ role: string; parts?: Array<{ type?: string; text?: string }>; content?: string }> = body.messages ?? []
  uuidSchema.parse(agendaId)

  // Fetch context
  const { data: agenda } = await supabase
    .from('agendas')
    .select('*, meetings(*, committees(id, name, slug, persona_prompt))')
    .eq('id', agendaId)
    .single()

  if (!agenda) return new Response('Agenda not found', { status: 404 })

  const meeting = agenda.meetings as unknown as {
    id: string
    organization_id: string
    committees: { id: string; name: string; slug: string; persona_prompt: string | null } | null
  }

  const persona = meeting.committees?.persona_prompt
    || getDefaultPersona(meeting.committees?.slug ?? 'board')

  // Get transcript segments for context
  const { data: segments } = await supabase
    .from('transcript_segments')
    .select('content, speaker, start_offset, end_offset')
    .eq('agenda_id', agendaId)
    .order('sort_order')

  const transcriptContext = buildTranscriptContext((segments ?? []) as Segment[])

  let slideContext = 'No slide context available.'
  const { data: slideFiles } = await supabase
    .from('media_files')
    .select('storage_path')
    .eq('meeting_id', meeting.id)
    .eq('file_type', 'slides_pdf')
    .eq('is_purged', false)
    .order('created_at', { ascending: false })
    .limit(1)

  const slidePath = slideFiles?.[0]?.storage_path

  // Try pre-parsed text first
  if (slidePath) {
    try {
      const { data: files } = await supabase.storage.from('meeting-files').list(`${meeting.id}/processed`)
      const parsedFile = files?.find(f => f.name.startsWith('slides-'))
      if (parsedFile) {
        const { data: slideTextFile } = await supabase.storage.from('meeting-files').download(`${meeting.id}/processed/${parsedFile.name}`)
        if (slideTextFile) {
          const text = await slideTextFile.text()
          if (text.trim()) slideContext = text.trim()
        }
      }
    } catch {
      // Fallback to raw PDF parsing below.
    }
  }

  if (slideContext === 'No slide context available.' && slidePath) {
    try {
      const { data: slideFile } = await supabase.storage.from('meeting-files').download(slidePath)
      if (slideFile) {
        const slideBuffer = Buffer.from(await slideFile.arrayBuffer())
        const parser = new PDFParse({ data: slideBuffer })
        try {
          const parsed = await parser.getText()
          if (parsed.text?.trim()) slideContext = parsed.text.trim()
        } finally {
          await parser.destroy()
        }
      }
    } catch {
      // If slide parsing fails, continue with transcript-only context.
    }
  }

  // Fetch committee RAG documents when web mode is ON
  let ragContext = ''
  if (webSearch && meeting.committees?.id) {
    const { data: chunks } = await supabase
      .from('committee_rag_chunks')
      .select(`
        content,
        chunk_index,
        committee_rag_documents!inner(document_name, file_name)
      `)
      .eq('committee_id', meeting.committees.id)
      .limit(400)

    if (chunks && chunks.length > 0) {
      ragContext = chunks
        .filter(c => (c.content ?? '').trim().length > 0)
        .slice(0, 20)
        .map(c => {
          const doc = Array.isArray(c.committee_rag_documents)
            ? c.committee_rag_documents[0]
            : c.committee_rag_documents
          const name = doc?.document_name || doc?.file_name || 'Document'
          return `[${name}] ${c.content?.trim()}`
        })
        .join('\n\n')
    }
  }

  // Get current minute content
  const { data: minute } = await supabase
    .from('minutes')
    .select('content')
    .eq('agenda_id', agendaId)
    .eq('is_current', true)
    .single()

  const committeeName = meeting.committees?.name ?? 'Board'
  const agendaLabel = `Agenda ${agenda.agenda_no}: "${agenda.title}"`

  let systemPrompt: string

  if (mode === 'ask') {
    const webModeBlock = webSearch ? `
IMPORTANT — WEB MODE IS ACTIVE.
You are BOTH a meeting expert AND an industry analyst. You MUST answer external questions (forecasts, regulations, market outlook, economic trends) using your general knowledge. Do NOT refuse or say "not in the context" for external topics.

For external/analytical questions:
1. FIRST provide your **[Analysis]** — your expert opinion using general knowledge (BNM policies, OPR outlook, economic data, industry benchmarks, regulatory frameworks).
2. THEN provide **[Meeting Context]** — what was discussed about this topic in the meeting.

For meeting-specific questions:
- Answer from the transcript/slides/minutes as normal.
` : ''

    systemPrompt = `${persona}

You are the **${committeeName} Secretariat** assistant for ${agendaLabel}.
${webModeBlock}
RESPONSE STYLE:
- Give COMPREHENSIVE, detailed answers — never summarize briefly.
- When asked what someone said, quote or closely paraphrase ALL their statements.
- Cite timestamps (e.g. "at 03:45") when referencing the transcript.
- Attribute every statement to the speaker by name.
- Structure answers with bullet points or paragraphs for readability.
- Use formal corporate language appropriate for ${committeeName}.
${!webSearch ? `- Answer ONLY from the transcript, slides, and minutes provided below.
- If the information is not in the context, say so and explain what's missing.
- Never fabricate figures, names, or decisions.` : ''}

MEETING DATA:

FULL MEETING TRANSCRIPT:
---
${transcriptContext}
---

PRESENTATION SLIDES / PAPER:
---
${slideContext}
---

${minute ? `CURRENT GENERATED MINUTES:\n---\n${minute.content}\n---` : ''}
${ragContext ? `\nCOMMITTEE REFERENCE DOCUMENTS (guidelines, policies):\n---\n${ragContext}\n---` : ''}
EXAMPLES:

User: "What did Mr. Ahmad say?"
Assistant: "Mr. Ahmad made several statements during the discussion:

1. **On the current rate** (at 02:15) — He stated that the current rate was competitive against the market and suggested that it be maintained for the quarter.

2. **On competitors** (at 04:30) — He referred to benchmarking data and said that Competitor A was offering a slightly lower rate while Competitor B was higher, placing the Bank broadly in the middle of the market.

3. **In support of the proposal** (at 06:12) — He stated that he had no objection to Management's proposal and supported maintaining it."
${webSearch ? `
User: "OPR prediction next 2 months"
Assistant: "**[Analysis]**
Based on current economic indicators and BNM's monetary policy stance:

- BNM has maintained the OPR at 3.00% since the 25bps cut in May 2025
- Malaysia's GDP growth remains moderate at 4.5-5.0%, with inflation contained below 3%
- Market consensus from Bloomberg and Reuters surveys suggests BNM is likely to hold the OPR steady through Q2 2026, barring major external shocks
- Key risks that could trigger a change: Fed rate decisions, ringgit depreciation pressure, or significant slowdown in export demand

**Outlook**: OPR is expected to remain at 3.00% for the next 2 months (March–April 2026). A cut is unlikely given stable inflation, and a hike is not warranted given moderate growth.

**[Meeting Context]**
The committee's discussion aligns with this outlook:
- Puan Noorliza (at 16:21) confirmed OPR unchanged at 3.00% since May 2025 cut, with no competitors announcing rate changes
- Management recommended maintaining FRIA-i rates given the stable OPR environment
- Dato' Tengku Ahmad Badli Shah (at 17:22) noted the next review would be Q2 2026 'or earlier if OPR changes,' suggesting they also expect OPR stability in the near term."` : ''}`
  } else {
    systemPrompt = `${persona}

You are the **${committeeName} Secretariat** agent. You make targeted edits to the meeting minutes for ${agendaLabel}.

CURRENT MINUTES:
---
${minute?.content ?? '(No minutes generated yet)'}
---

TRANSCRIPT REFERENCE:
---
${transcriptContext}
---

RULES:
- If the user provides "SELECTED EXCERPT", return ONLY the rewritten excerpt text.
- Otherwise, return the FULL updated minutes with the change applied.
- Only modify the specific section the user references.
- Maintain the same formatting structure (NOTED, DISCUSSED, ACTION ITEMS).
- Use formal third-person corporate language appropriate for ${committeeName}.
- Do NOT remove or change parts the user didn't ask to modify.
- You may reference the transcript above to add accurate details.
- Wrap any uncertain items in [[VERIFY: text]].`
  }

  const model = modelId
    ? resolveModelById(modelId)
    : await resolveLanguageModelForOrganization(
        meeting.organization_id,
        mode === 'agent' ? 'go_deeper_agent' : 'go_deeper_ask',
      )

  // Convert UIMessage (parts-based) to simple { role, content } for streamText
  const modelMessages = rawMessages.map(m => {
    const text = (m.parts ?? [])
      .filter(p => p.type === 'text')
      .map(p => p.text ?? '')
      .join('')
    return {
      role: m.role as 'user' | 'assistant',
      content: text || m.content || '',
    }
  }).filter(m => m.content.length > 0)

  const result = streamText({
    model,
    system: systemPrompt,
    messages: modelMessages,
  })

  return result.toUIMessageStreamResponse()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Chat API error'
    console.error('[chat/route] Error:', message)
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
