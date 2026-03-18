'use server'

import { generateText } from 'ai'
import { PDFParse } from 'pdf-parse'
import { createClient } from '@/lib/supabase/server'
import { getDefaultPersona } from '@/lib/ai/personas'
import { resolveLanguageModelForOrganization } from '@/lib/ai/model-config'
import { matchIgnoredAgendasFromInstruction } from '@/lib/minute-instruction'
import { uuidSchema } from '@/lib/validation'
import {
  buildPrompt1_ContextCleaning,
  buildPrompt2_CrossReference,
  buildPrompt3_Synthesis,
  extractConfidenceMarkers,
} from '@/lib/ai/prompts'
import type { z } from 'zod'
import type { generateConfigSchema } from '@/lib/validation'

export type GenerationConfig = z.infer<typeof generateConfigSchema>

interface CommitteeGenerationContext {
  defaultFormatTemplateId: string | null
  minuteInstruction: string
}

interface GenerationRuntimeContext {
  committeeContext?: CommitteeGenerationContext
  ignoredAgendaNos?: string[]
  meetingRulesPrompt?: string
  transcriptId?: string | null
}

interface ReferenceExcerpt {
  source: string
  text: string
}

interface GenerateAllMinutesResult {
  generatedCount: number
  skippedCount: number
  skipped: Array<{ agendaId: string; agendaNo: string; reason: string }>
}

function isMissingMeetingRulesColumn(error: { code?: string | null; message?: string | null } | null | undefined) {
  if (!error) return false
  if (error.code === 'PGRST204') return true
  const message = (error.message ?? '').toLowerCase()
  return message.includes('meeting_rules') && message.includes('schema cache')
}

function resolveMeetingRulesPrompt(
  config?: GenerationConfig,
  fallback?: string | null,
) {
  const canonical = config?.meetingRulesPrompt?.trim()
  if (canonical) return canonical

  const legacy = config?.highlightPrompt?.trim()
  if (legacy) return legacy

  const fromMeeting = fallback?.trim()
  if (fromMeeting) return fromMeeting

  return undefined
}

async function getCommitteeGenerationContext(
  supabase: Awaited<ReturnType<typeof createClient>>,
  committeeId: string | null | undefined,
): Promise<CommitteeGenerationContext> {
  if (!committeeId) {
    return {
      defaultFormatTemplateId: null,
      minuteInstruction: '',
    }
  }

  const { data: settings } = await supabase
    .from('committee_generation_settings')
    .select('default_format_template_id, minute_instruction')
    .eq('committee_id', committeeId)
    .maybeSingle()

  return {
    defaultFormatTemplateId: settings?.default_format_template_id ?? null,
    minuteInstruction: settings?.minute_instruction ?? '',
  }
}

function stripHtmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function normalizeWhitespace(value: string) {
  return value
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'have', 'were', 'been', 'into', 'their',
  'there', 'about', 'which', 'shall', 'would', 'could', 'should', 'agenda', 'meeting', 'minutes',
  'committee', 'noted', 'discussed', 'resolved', 'action', 'items',
])

function tokenizeForScore(text: string) {
  return normalizeWhitespace(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(token => token.length > 2 && !STOP_WORDS.has(token))
}

function scoreExcerpt(queryTokens: string[], candidate: string) {
  if (queryTokens.length === 0 || !candidate.trim()) return 0
  const haystack = candidate.toLowerCase()
  let score = 0
  for (const token of queryTokens) {
    if (!haystack.includes(token)) continue
    score += 1
  }
  return score / queryTokens.length
}

function selectTopRelevantExcerpts(
  queryText: string,
  candidates: Array<{ source: string; text: string }>,
  topK: number,
): ReferenceExcerpt[] {
  const tokens = tokenizeForScore(queryText)
  const ranked = candidates
    .map(candidate => ({ ...candidate, score: scoreExcerpt(tokens, candidate.text) }))
    .filter(candidate => candidate.score > 0)
    .sort((a, b) => b.score - a.score)
  return ranked.slice(0, topK).map(({ source, text }) => ({ source, text }))
}

async function getAgendaPdfExcerpts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  storagePath: string | null,
  queryText: string,
): Promise<ReferenceExcerpt[]> {
  if (!storagePath) return []
  const { data } = await supabase.storage.from('meeting-files').download(storagePath)
  if (!data) return []

  const parser = new PDFParse({ data: Buffer.from(await data.arrayBuffer()) })
  try {
    const extracted = await parser.getText()
    const pageCandidates = extracted.pages
      .map(page => ({
        source: `Agenda PDF page ${page.num}`,
        text: normalizeWhitespace(page.text),
      }))
      .filter(page => page.text.length > 0)
    return selectTopRelevantExcerpts(queryText, pageCandidates, 4)
  } finally {
    await parser.destroy()
  }
}

async function getCommitteeRagExcerpts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  committeeId: string | null | undefined,
  queryText: string,
): Promise<ReferenceExcerpt[]> {
  if (!committeeId) return []

  const { data: chunks, error } = await supabase
    .from('committee_rag_chunks')
    .select(`
      content,
      chunk_index,
      committee_rag_documents!inner(
        document_name,
        file_name
      )
    `)
    .eq('committee_id', committeeId)
    .limit(400)

  if (error || !chunks || chunks.length === 0) return []

  const candidates = chunks.map(chunk => {
    const doc = Array.isArray(chunk.committee_rag_documents)
      ? chunk.committee_rag_documents[0]
      : chunk.committee_rag_documents
    const sourceName = doc?.document_name || doc?.file_name || 'Committee RAG'
    const chunkNo = typeof chunk.chunk_index === 'number' ? chunk.chunk_index + 1 : 1
    return {
      source: `Committee RAG - ${sourceName} (chunk ${chunkNo})`,
      text: normalizeWhitespace(chunk.content ?? ''),
    }
  }).filter(candidate => candidate.text.length > 0)

  return selectTopRelevantExcerpts(queryText, candidates, 6)
}

async function resolveTranscriptIdForMeeting(
  supabase: Awaited<ReturnType<typeof createClient>>,
  meetingId: string,
  preferredTranscriptId?: string | null,
) {
  if (preferredTranscriptId) return preferredTranscriptId
  const { data: transcript } = await supabase
    .from('transcripts')
    .select('id')
    .eq('meeting_id', meetingId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return transcript?.id ?? null
}

export async function generateMinutesForAgenda(
  agendaId: string,
  config?: GenerationConfig,
  runtimeContext?: GenerationRuntimeContext,
) {
  uuidSchema.parse(agendaId)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  // Fetch agenda with meeting and committee
  const { data: agenda } = await supabase
    .from('agendas')
    .select('*, meetings(*, committees(*))')
    .eq('id', agendaId)
    .single()

  if (!agenda) throw new Error('Agenda not found')

  const meeting = agenda.meetings as unknown as {
    id: string
    organization_id: string
    meeting_rules: string | null
    committees: { id: string; slug: string; persona_prompt: string | null } | null
  }

  // Get persona
  const committeeSlug = meeting.committees?.slug ?? 'board'
  const persona = meeting.committees?.persona_prompt || getDefaultPersona(committeeSlug)

  const activeTranscriptId = runtimeContext?.transcriptId
    ?? await resolveTranscriptIdForMeeting(supabase, meeting.id, config?.transcriptId ?? null)

  // Get transcript segments for this agenda (transcript scoped when available)
  let segmentsQuery = supabase
    .from('transcript_segments')
    .select('content, speaker')
    .eq('agenda_id', agendaId)
    .order('sort_order')

  if (activeTranscriptId) {
    segmentsQuery = segmentsQuery.eq('transcript_id', activeTranscriptId)
  }

  const { data: segments } = await segmentsQuery

  if (!segments || segments.length === 0) {
    throw new Error('No transcript segments assigned to this agenda')
  }

  // Get glossary for this committee
  const { data: glossary } = await supabase
    .from('glossary')
    .select('acronym, full_meaning')
    .eq('committee_id', meeting.committees?.id ?? '')

  const committeeContext = runtimeContext?.committeeContext
    ?? await getCommitteeGenerationContext(supabase, meeting.committees?.id)
  const meetingRulesPrompt = runtimeContext?.meetingRulesPrompt
    ?? resolveMeetingRulesPrompt(config, meeting.meeting_rules)

  const candidateTemplateIds = [
    agenda.format_template_id,
    committeeContext.defaultFormatTemplateId,
  ].filter((value): value is string => Boolean(value))

  const templateMap = new Map<string, string>()
  if (candidateTemplateIds.length > 0) {
    const { data: templates } = await supabase
      .from('format_templates')
      .select('id, prompt_text')
      .in('id', candidateTemplateIds)

    ;(templates ?? []).forEach(template => {
      templateMap.set(template.id, template.prompt_text)
    })
  }

  const agendaFormatPrompt = agenda.format_template_id
    ? templateMap.get(agenda.format_template_id) ?? null
    : null
  const committeeDefaultFormatPrompt = committeeContext.defaultFormatTemplateId
    ? templateMap.get(committeeContext.defaultFormatTemplateId) ?? null
    : null
  const rawFormatPrompt = agendaFormatPrompt ?? committeeDefaultFormatPrompt ?? null
  const effectiveFormatPrompt = rawFormatPrompt ? stripHtmlToPlainText(rawFormatPrompt) : null

  const attachedSlidePath = typeof agenda.slide_pages === 'string' && agenda.slide_pages.trim()
    ? agenda.slide_pages.trim()
    : null

  const model = await resolveLanguageModelForOrganization(meeting.organization_id)
  const transcriptChunks = segments.map(s =>
    s.speaker ? `${s.speaker}: ${s.content}` : s.content
  )

  // === PROMPT 1: Context Cleaning ===
  const prompt1 = buildPrompt1_ContextCleaning({
    agendaNo: agenda.agenda_no,
    agendaTitle: agenda.title,
    presenter: agenda.presenter,
    transcriptChunks,
    glossary: glossary ?? [],
    agendaDeviationNote: config?.agendaDeviationPrompt || undefined,
    additionalInfo: agenda.additional_info || undefined,
  })

  const result1 = await generateText({
    model,
    system: persona,
    prompt: prompt1,
  })

  const cleanedTranscript = result1.text
  const [agendaPdfExcerpts, committeeRagExcerpts] = await Promise.all([
    getAgendaPdfExcerpts(supabase, attachedSlidePath, cleanedTranscript),
    getCommitteeRagExcerpts(supabase, meeting.committees?.id, cleanedTranscript),
  ])
  const referenceExcerpts = [...agendaPdfExcerpts, ...committeeRagExcerpts]

  // === PROMPT 2: Cross-Reference ===
  const prompt2 = buildPrompt2_CrossReference({
    agendaNo: agenda.agenda_no,
    agendaTitle: agenda.title,
    cleanedTranscript,
    slideContent: agendaPdfExcerpts.length > 0 ? 'Agenda PDF excerpts included below.' : null,
    referenceExcerpts,
  })

  const result2 = await generateText({
    model,
    system: persona,
    prompt: prompt2,
  })

  const crossRefAnalysis = result2.text

  // === PROMPT 3: Synthesis ===
  const prompt3 = buildPrompt3_Synthesis({
    agendaNo: agenda.agenda_no,
    agendaTitle: agenda.title,
    presenter: agenda.presenter,
    cleanedTranscript,
    crossRefAnalysis,
    formatPrompt: effectiveFormatPrompt,
    additionalInfo: agenda.additional_info || undefined,
    secretariatInstructions: committeeContext.minuteInstruction || undefined,
    ignoredAgendaNos: runtimeContext?.ignoredAgendaNos,
    meetingRulesPrompt,
    excludeDeckPoints: config?.excludeDeckPoints,
    languages: config?.languages,
  })

  const result3 = await generateText({
    model,
    system: persona,
    prompt: prompt3,
  })

  // Extract confidence markers
  const { cleanContent, markers } = extractConfidenceMarkers(result3.text)

  // === Auto-generate meeting summary (best-effort) ===
  let summaryPaper: string | null = null
  let summaryDiscussion: string | null = null
  let summaryHeated: string | null = null
  try {
    const summaryResult = await generateText({
      model,
      system: persona,
      prompt: `You are analyzing Agenda ${agenda.agenda_no}: "${agenda.title}".

CLEANED TRANSCRIPT:
---
${cleanedTranscript}
---

CROSS-REFERENCE ANALYSIS:
---
${crossRefAnalysis}
---

Generate exactly 3 sections in this JSON format. Each value is a string with the analysis.

{
  "paperSummary": "Summarize the key points from the presentation paper/deck for this agenda. Focus on the main data, findings, and recommendations presented. If no paper was referenced, state that briefly.",
  "discussionExplanation": "Explain the discussions that went BEYOND the paper — questions asked, clarifications sought, additional points raised by members that were NOT in the original paper. Do not repeat what is in the paper summary.",
  "heatedDiscussions": "Identify any contentious, heated, or particularly important debates. Highlight what the disagreement was about, who raised concerns, and what the tension points were. If the discussion was straightforward with no major debates, provide a brief note indicating this in a natural way."
}

Return ONLY the JSON object, no other text.`,
    })
    const jsonMatch = summaryResult.text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as {
        paperSummary?: string
        discussionExplanation?: string
        heatedDiscussions?: string
      }
      summaryPaper = parsed.paperSummary || null
      summaryDiscussion = parsed.discussionExplanation || null
      summaryHeated = parsed.heatedDiscussions || null
    }
  } catch {
    // Summary generation failed — minute still saves
  }

  // Check for existing minute to determine version
  const { data: existingMinute } = await supabase
    .from('minutes')
    .select('id, version')
    .eq('agenda_id', agendaId)
    .eq('is_current', true)
    .single()

  let minuteId = existingMinute?.id ?? null

  if (existingMinute) {
    // Save old version to minute_versions
    const { data: oldMinute } = await supabase
      .from('minutes').select('content, version').eq('id', existingMinute.id).single()

    if (oldMinute) {
      await supabase.from('minute_versions').insert({
        minute_id: existingMinute.id,
        content: oldMinute.content,
        version: oldMinute.version,
        change_summary: 'Regenerated by AI',
        changed_by: user.id,
      })
    }

    // Update existing minute
    await supabase.from('minutes').update({
      content: cleanContent,
      confidence_data: markers,
      prompt_1_output: cleanedTranscript,
      prompt_2_output: crossRefAnalysis,
      summary_paper: summaryPaper,
      summary_discussion: summaryDiscussion,
      summary_heated: summaryHeated,
      version: (existingMinute.version ?? 1) + 1,
    }).eq('id', existingMinute.id)
  } else {
    // Insert new minute
    const { data: inserted } = await supabase
      .from('minutes')
      .insert({
        agenda_id: agendaId,
        content: cleanContent,
        confidence_data: markers,
        prompt_1_output: cleanedTranscript,
        prompt_2_output: crossRefAnalysis,
        summary_paper: summaryPaper,
        summary_discussion: summaryDiscussion,
        summary_heated: summaryHeated,
        version: 1,
        is_current: true,
      })
      .select('id')
      .single()

    minuteId = inserted?.id ?? null
  }

  // Extract action items
  await extractAndSaveActionItems(agendaId, meeting.id, cleanContent, model, persona)

  // Audit log
  const { data: profile } = await supabase
    .from('profiles').select('organization_id').eq('id', user.id).single()

  if (profile) {
    await supabase.from('audit_logs').insert({
      organization_id: profile.organization_id,
      meeting_id: meeting.id,
      user_id: user.id,
      action: 'minutes_generated',
      details: { agenda_id: agendaId, agenda_no: agenda.agenda_no },
    })
  }

  return { content: cleanContent, markers, minuteId }
}

async function extractAndSaveActionItems(
  agendaId: string,
  meetingId: string,
  minuteContent: string,
  model: Awaited<ReturnType<typeof resolveLanguageModelForOrganization>>,
  persona: string,
) {
  const supabase = await createClient()

  const result = await generateText({
    model,
    system: persona,
    prompt: `Extract all action items from the following meeting minutes. Return them as a JSON array.
Each item should have: "description" (string), "pic" (string or null for Person In Charge), "due_date" (string or null in YYYY-MM-DD format).
If no action items exist, return an empty array [].

MINUTES:
---
${minuteContent}
---

Return ONLY the JSON array, no other text.`,
  })

  // Parse action items JSON
  try {
    const jsonMatch = result.text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return

    const items = JSON.parse(jsonMatch[0]) as {
      description: string
      pic: string | null
      due_date: string | null
    }[]

    // Clear existing action items for this agenda
    await supabase.from('action_items').delete().eq('agenda_id', agendaId)

    if (items.length > 0) {
      await supabase.from('action_items').insert(
        items.map((item, i) => ({
          agenda_id: agendaId,
          meeting_id: meetingId,
          description: item.description,
          pic: item.pic,
          due_date: item.due_date,
          sort_order: i,
        }))
      )
    }
  } catch {
    // Failed to parse — skip action items
  }
}

export async function generateAllMinutes(meetingId: string, config?: GenerationConfig): Promise<GenerateAllMinutesResult> {
  uuidSchema.parse(meetingId)
  const supabase = await createClient()

  let { data: meeting, error: meetingError } = await supabase
    .from('meetings')
    .select('committee_id, meeting_rules')
    .eq('id', meetingId)
    .single()
  if (meetingError && isMissingMeetingRulesColumn(meetingError)) {
    const fallback = await supabase
      .from('meetings')
      .select('committee_id')
      .eq('id', meetingId)
      .single()
    meeting = {
      committee_id: fallback.data?.committee_id ?? null,
      meeting_rules: '',
    }
    meetingError = fallback.error
  }
  if (meetingError) {
    throw new Error(meetingError.message)
  }

  const committeeContext = await getCommitteeGenerationContext(supabase, meeting?.committee_id ?? null)
  const meetingRulesPrompt = resolveMeetingRulesPrompt(config, meeting?.meeting_rules ?? null)

  const { data: agendas } = await supabase
    .from('agendas')
    .select('id, agenda_no, title, format_template_id, is_skipped')
    .eq('meeting_id', meetingId)
    .order('sort_order')

  if (!agendas) throw new Error('No agendas found')

  const activeTranscriptId = await resolveTranscriptIdForMeeting(supabase, meetingId, config?.transcriptId ?? null)
  const manualSkipped = new Set(config?.skippedAgendaIds ?? [])
  const dbSkipped = new Set(agendas.filter(a => a.is_skipped).map(a => a.id))
  const { ignoredAgendaIds, ignoredAgendaNos } = matchIgnoredAgendasFromInstruction(
    committeeContext.minuteInstruction,
    agendas,
  )
  const skipped = new Set([...manualSkipped, ...dbSkipped, ...ignoredAgendaIds])
  const skippedEntries: Array<{ agendaId: string; agendaNo: string; reason: string }> = []

  if (config?.requireCompleteFormatting) {
    const missingFormatting = agendas.filter(agenda => !skipped.has(agenda.id) && !agenda.format_template_id)
    if (missingFormatting.length > 0) {
      const list = missingFormatting
        .slice(0, 8)
        .map(agenda => `${agenda.agenda_no} ${agenda.title}`)
        .join(', ')
      throw new Error(`Format not complete: ${list}`)
    }
  }

  // Generate sequentially to maintain rolling context
  let generatedCount = 0
  for (const agenda of agendas) {
    if (skipped.has(agenda.id)) {
      skippedEntries.push({
        agendaId: agenda.id,
        agendaNo: agenda.agenda_no,
        reason: 'Skipped by instruction or user selection',
      })
      continue
    }

    try {
      await generateMinutesForAgenda(agenda.id, config, {
        committeeContext,
        ignoredAgendaNos,
        meetingRulesPrompt,
        transcriptId: activeTranscriptId,
      })
      generatedCount += 1
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.toLowerCase().includes('no transcript segments assigned to this agenda')) {
        skippedEntries.push({
          agendaId: agenda.id,
          agendaNo: agenda.agenda_no,
          reason: 'No chunk mapped',
        })
        continue
      }
      throw error
    }
  }

  // Update meeting status
  await supabase
    .from('meetings')
    .update({ status: 'in_progress' })
    .eq('id', meetingId)

  return {
    generatedCount,
    skippedCount: skippedEntries.length,
    skipped: skippedEntries,
  }
}
