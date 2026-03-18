// 3-Prompt Execution Engine for minute generation
// Runs PER AGENDA — each agenda gets its own pipeline

export function buildPrompt1_ContextCleaning(params: {
  agendaNo: string
  agendaTitle: string
  presenter: string | null
  transcriptChunks: string[]
  glossary: { acronym: string; full_meaning: string }[]
  agendaDeviationNote?: string
  additionalInfo?: string
}) {
  const glossaryRef = params.glossary.length > 0
    ? `\n\nGlossary reference (use exact spellings):\n${params.glossary.map(g => `- ${g.acronym}: ${g.full_meaning}`).join('\n')}`
    : ''

  return `TASK: Clean and structure the raw transcript for Agenda ${params.agendaNo}: "${params.agendaTitle}".
${params.presenter ? `Presenter: ${params.presenter}` : ''}

RAW TRANSCRIPT CHUNKS:
---
${params.transcriptChunks.join('\n\n')}
---

INSTRUCTIONS:
1. Fix spelling errors, grammatical issues, and filler words
2. Preserve the original meaning exactly — do NOT add information that was not said
3. Identify each speaker and attribute statements correctly
4. Extract key discussion points in chronological order
5. Identify any decisions made, objections raised, or action items mentioned
6. Flag any names, financial figures, or specific data points you are uncertain about by wrapping them in [[VERIFY: text]]
7. If ADDITIONAL CONTEXT exists, treat it as section-specific correction guidance (especially speaker corrections and terminology corrections)
${glossaryRef}

OUTPUT FORMAT:
Return a cleaned, structured summary with speaker attributions. Use clear paragraphs. Mark uncertain items with [[VERIFY: ...]].${params.additionalInfo ? `\n\nSECTION ADDITIONAL INFORMATION (HIGHEST PRIORITY FOR THIS AGENDA ONLY):\n${params.additionalInfo}` : ''}${params.agendaDeviationNote ? `\n\nUSER NOTE ABOUT AGENDA ORDER:\n${params.agendaDeviationNote}` : ''}`
}

export function buildPrompt2_CrossReference(params: {
  agendaNo: string
  agendaTitle: string
  cleanedTranscript: string
  slideContent: string | null
  referenceExcerpts?: Array<{ source: string; text: string }>
}) {
  const references = params.referenceExcerpts ?? []
  const hasDeck = Boolean(params.slideContent)
  const hasReferences = references.length > 0

  if (!hasDeck && !hasReferences) {
    return `TASK: No reference document was provided for Agenda ${params.agendaNo}: "${params.agendaTitle}".

CLEANED TRANSCRIPT:
---
${params.cleanedTranscript}
---

INSTRUCTIONS:
1. Treat ALL discussion points as "Outside Discussions" (verbal points not backed by reference materials)
2. List the key points discussed
3. Identify which points appear to be presenting data vs open discussion

OUTPUT: Return the analysis categorizing all points as verbal/outside discussions.`
  }

  const sourcesBlock = hasReferences
    ? `\nREFERENCE EXCERPTS (Agenda PDF + Committee RAG):\n---\n${references
      .map((reference, index) => `[Source ${index + 1}] ${reference.source}\n${reference.text}`)
      .join('\n\n')}\n---`
    : ''

  return `TASK: Cross-reference the transcript discussion with available references for Agenda ${params.agendaNo}: "${params.agendaTitle}".

CLEANED TRANSCRIPT:
---
${params.cleanedTranscript}
---

${hasDeck ? `SLIDE CONTENT:\n---\n${params.slideContent}\n---` : 'SLIDE CONTENT: Not available for this agenda.'}${sourcesBlock}

INSTRUCTIONS:
1. Match discussion points to specific references where applicable (agenda slides first, then committee RAG if relevant)
2. Identify "Outside Discussions" — verbal points NOT found in the references (questions, objections, additional context raised during discussion)
3. Note any figures or data from references that were specifically discussed or challenged
4. Flag any discrepancies between what was referenced and what was discussed
5. Do not invent facts from references that were never discussed in the transcript

OUTPUT: Return a structured analysis with:
- Points covered in references (with source reference)
- Outside Discussions (verbal only, not in references)
- Any discrepancies or challenges raised`
}

export function buildPromptAgendaTimelineSegmentation(params: {
  meetingTitle: string
  agendaList: Array<{ id: string; agendaNo: string; title: string }>
  timeline: string
  agendaDeviationNote?: string
  meetingRulesPrompt?: string
}) {
  const agendaRows = params.agendaList
    .map(agenda => `- agendaId: ${agenda.id} | agendaNo: ${agenda.agendaNo} | title: ${agenda.title}`)
    .join('\n')

  return `TASK: Identify the time range in this meeting transcript timeline for each agenda item.

MEETING:
${params.meetingTitle}

AGENDAS (map only to these IDs):
${agendaRows}

TRANSCRIPT TIMELINE:
---
${params.timeline}
---

${params.agendaDeviationNote ? `USER NOTE ABOUT AGENDA ORDER:\n${params.agendaDeviationNote}\n` : ''}${params.meetingRulesPrompt ? `MEETING RULES (apply for this run; override committee defaults if conflict):\n${params.meetingRulesPrompt}\n` : ''}INSTRUCTIONS:
1. Read the full timeline and infer when each agenda started and ended.
2. Agenda labels may NOT be explicitly spoken. Infer section boundaries from topic shifts, presenter flow, chronology, and semantic continuity.
3. Respect MEETING RULES for terminology/context while inferring sections.
4. Return rows with agendaId + startSec + endSec + confidence + reason.
5. startSec/endSec are integers in seconds from meeting start.
6. Prefer non-overlapping ranges and keep chronological order.
7. Provide best-effort coverage for all agendas, even when confidence is low. Use lower confidence instead of returning nothing.
8. Never return agenda IDs outside the provided list.
9. Keep "reason" concise, max one sentence.

OUTPUT:
Return JSON object:
{
  "items": [
    {
      "agendaId": "uuid",
      "startSec": 0,
      "endSec": 120,
      "confidence": 0.0,
      "reason": "short rationale"
    }
  ]
}`
}

export function buildPrompt3_Synthesis(params: {
  agendaNo: string
  agendaTitle: string
  presenter: string | null
  cleanedTranscript: string
  crossRefAnalysis: string
  formatPrompt: string | null
  additionalInfo?: string
  secretariatInstructions?: string
  ignoredAgendaNos?: string[]
  meetingRulesPrompt?: string
  userHighlights?: string
  excludeDeckPoints?: boolean
  languages?: string[]
}) {
  const hasFormatTemplate = Boolean(params.formatPrompt)
  const formatInstruction = hasFormatTemplate
    ? `\n\nFORMAT TEMPLATE (YOU MUST REPLICATE THIS EXACT FORMAT — same headings, same structure, same style, same bullet patterns, same spacing. DO NOT deviate or invent your own structure):\n---\n${params.formatPrompt}\n---`
    : ''

  const langNote = params.languages && params.languages.length > 0
    ? `\nMeeting language(s): ${params.languages.join(', ')}. The transcript may contain mixed-language content — preserve key terms in their original language where appropriate.`
    : ''
  const secretariatInstructions = params.secretariatInstructions?.trim()
    ? `\n\nGLOBAL SECRETARIAT INSTRUCTIONS:\n${params.secretariatInstructions.trim()}`
    : ''
  const meetingRulesPrompt = params.meetingRulesPrompt?.trim() || params.userHighlights?.trim()
  const meetingRules = meetingRulesPrompt
    ? `\n\nMEETING RULES (HIGH PRIORITY FOR THIS RUN - overrides global instructions if conflicting):\n${meetingRulesPrompt}`
    : ''
  const ignoredAgendasNote = params.ignoredAgendaNos && params.ignoredAgendaNos.length > 0
    ? `\n\nAGENDAS MARKED TO IGNORE FOR THIS RUN: ${params.ignoredAgendaNos.join(', ')}`
    : ''

  return `TASK: Generate the final corporate board meeting minutes for Agenda ${params.agendaNo}: "${params.agendaTitle}".
${params.presenter ? `Presenter: ${params.presenter}` : ''}${langNote}

CLEANED TRANSCRIPT:
---
${params.cleanedTranscript}
---

CROSS-REFERENCE ANALYSIS:
---
${params.crossRefAnalysis}
---
${formatInstruction}
${secretariatInstructions}
${meetingRules}
${params.additionalInfo?.trim()
    ? `\n\nSECTION ADDITIONAL INFORMATION (HIGHEST PRIORITY FOR THIS AGENDA ONLY):\n${params.additionalInfo.trim()}`
    : ''}
${ignoredAgendasNote}

INSTRUCTIONS:
0. Priority order for constraints:
   - First: SECTION ADDITIONAL INFORMATION (agenda-specific override)
   - Second: MEETING RULES (run-specific override)
   - Third: GLOBAL SECRETARIAT INSTRUCTIONS (committee baseline)
${hasFormatTemplate ? `1. **CRITICAL: You MUST follow the FORMAT TEMPLATE above EXACTLY.** Copy the exact same section headings, bullet style, numbering pattern, spacing, and paragraph structure. Do NOT use your own format. The template is the ONLY acceptable output structure.
2. Fill in the template structure with the actual content from the transcript and cross-reference analysis.
3. Use formal, third-person corporate language (e.g., "The Committee noted that..." not "We noted...")` : `1. Generate minutes in standard Malaysian corporate format
2. Structure the output into these sections:
   a) **NOTED** — Key information presented and acknowledged by the committee
   b) **DISCUSSED** — Points of discussion, questions raised, clarifications given, and any objections
   c) **RESOLVED/DECIDED** — Any formal decisions or resolutions made (if applicable)
   d) **ACTION ITEMS** — Specific tasks assigned with PIC (Person In Charge) and due dates if mentioned
3. Use formal, third-person corporate language (e.g., "The Committee noted that..." not "We noted...")
4. Include Outside Discussions naturally within the DISCUSSED section`}
5. For any names, financial figures, or specific data you are uncertain about, wrap them in [[VERIFY: text]]
6. Do NOT fabricate any information — only include what was actually discussed
7. If a Proposer and Seconder were mentioned for any resolution, include them${params.excludeDeckPoints ? '\n8. EXCLUDE any points that are already stated in the presentation decks — only include discussion points, decisions, and action items that go beyond the deck content' : ''}
9. Apply section-specific speaker correction hints from SECTION ADDITIONAL INFORMATION whenever provided

OUTPUT: Return the formatted minutes ready for the Company Secretary to review.`
}

// Confidence data extraction from [[VERIFY: ...]] markers
export function extractConfidenceMarkers(content: string): {
  cleanContent: string
  markers: { offset: number; length: number; original: string; score: number; reason: string }[]
} {
  const markers: { offset: number; length: number; original: string; score: number; reason: string }[] = []
  let cleanContent = content
  let match: RegExpExecArray | null

  const regex = /\[\[VERIFY:\s*(.*?)\]\]/g
  // First pass: collect all markers with their positions
  const tempContent = content
  let offsetAdjust = 0

  const allMatches: { index: number; fullMatch: string; innerText: string }[] = []
  while ((match = regex.exec(tempContent)) !== null) {
    allMatches.push({ index: match.index, fullMatch: match[0], innerText: match[1] })
  }

  // Replace markers and track positions
  for (const m of allMatches) {
    const adjustedIndex = m.index - offsetAdjust
    markers.push({
      offset: adjustedIndex,
      length: m.innerText.length,
      original: m.fullMatch,
      score: 0.5,
      reason: 'AI flagged for verification',
    })
    cleanContent = cleanContent.replace(m.fullMatch, m.innerText)
    offsetAdjust += m.fullMatch.length - m.innerText.length
  }

  return { cleanContent, markers }
}
