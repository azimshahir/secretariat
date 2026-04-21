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
  meetingRulesPrompt?: string
  hardRulesBlock?: string
  committeeFactsBlock?: string
}) {
  const glossaryRef = params.glossary.length > 0
    ? `\n\nGlossary reference (use exact spellings):\n${params.glossary.map(g => `- ${g.acronym}: ${g.full_meaning}`).join('\n')}`
    : ''
  const meetingRules = params.meetingRulesPrompt?.trim()
    ? `\n\nMEETING RULES (apply for this meeting; override committee defaults if conflict):\n${params.meetingRulesPrompt.trim()}`
    : ''
  const hardRules = params.hardRulesBlock?.trim()
    ? `\n\nMIND HARD RULES:\n${params.hardRulesBlock.trim()}`
    : ''
  const committeeFacts = params.committeeFactsBlock?.trim()
    ? `\n\nMIND STANDING FACTS AND TERMINOLOGY:\n${params.committeeFactsBlock.trim()}`
    : ''

  return `TASK: Prompt 1 - Refiner for Agenda ${params.agendaNo}: "${params.agendaTitle}".
${params.presenter ? `Presenter: ${params.presenter}` : ''}

RAW TRANSCRIPT CHUNKS:
---
${params.transcriptChunks.join('\n')}
---
${params.additionalInfo ? `\nSECTION ADDITIONAL INFORMATION (HIGHEST PRIORITY FOR THIS AGENDA ONLY):\n${params.additionalInfo}` : ''}${meetingRules}${hardRules}${committeeFacts}${params.agendaDeviationNote ? `\n\nUSER NOTE ABOUT AGENDA ORDER:\n${params.agendaDeviationNote}` : ''}${glossaryRef}

INSTRUCTIONS:
1. This stage cleans and normalizes the agenda transcript only. Do NOT write final minutes yet.
2. Preserve the original meaning exactly. Do NOT add information that was not said.
3. Preserve chronology and transcript structure. Keep one discussion line per transcript chunk whenever possible.
4. Do NOT summarize, compress, or rewrite the discussion into minute-style paragraphs.
5. Fix obvious transcription errors, filler words, and broken phrasing while preserving the original sequence of speakers.
6. Identify each speaker and attribute statements correctly.
7. When the rules or context clearly require role-based naming, normalize speaker labels to role-first naming such as "Head, CMRD", "Head, TD", "Head, ALM", "The Chairman", or "The Committee" instead of personal names.
8. Use SECTION ADDITIONAL INFORMATION, MEETING RULES, MIND HARD RULES, MIND STANDING FACTS, and Glossary entries to normalize terminology, abbreviations, Islamic-finance wording, and speaker labels.
9. Preserve objections, challenges, action items, and decisions in the order they were discussed.
10. Flag any names, financial figures, dates, or specific data points you are uncertain about by wrapping only the uncertain fragment in [[VERIFY: text]].
11. If the transcript is ambiguous, keep the ambiguity visible instead of guessing.

OUTPUT FORMAT:
Return only the cleaned transcript text as transcript-style lines.
Keep timestamps and speaker prefixes when they already exist.
Preferred line shape:
[00:12:34] Head, CMRD: statement text
Head, TD: statement text
If a line has no speaker label, keep only the spoken text for that line. Mark uncertain items with [[VERIFY: ...]].`
}

export function buildPrompt2_CrossReference(params: {
  agendaNo: string
  agendaTitle: string
  cleanedTranscript: string
  slideContent: string | null
  referenceGuidance?: string
  agendaReferenceExcerpts?: Array<{ source: string; text: string }>
  committeeRagExcerpts?: Array<{ source: string; text: string }>
  meetingRulesPrompt?: string
  hardRulesBlock?: string
  committeeFactsBlock?: string
}) {
  const agendaReferences = params.agendaReferenceExcerpts ?? []
  const committeeRagReferences = params.committeeRagExcerpts ?? []
  const hasDeck = Boolean(params.slideContent)
  const hasAgendaReferences = agendaReferences.length > 0
  const hasCommitteeRag = committeeRagReferences.length > 0
  const meetingRules = params.meetingRulesPrompt?.trim()
    ? `\n\nMEETING RULES:\n${params.meetingRulesPrompt.trim()}`
    : ''
  const hardRules = params.hardRulesBlock?.trim()
    ? `\n\nMIND HARD RULES:\n${params.hardRulesBlock.trim()}`
    : ''
  const committeeFacts = params.committeeFactsBlock?.trim()
    ? `\n\nMIND STANDING FACTS AND TERMINOLOGY:\n${params.committeeFactsBlock.trim()}`
    : ''

  if (!hasDeck && !hasAgendaReferences && !hasCommitteeRag) {
    return `TASK: Prompt 2 - Fact Grounding for Agenda ${params.agendaNo}: "${params.agendaTitle}".

CLEANED TRANSCRIPT:
---
${params.cleanedTranscript}
---
${meetingRules}${hardRules}${committeeFacts}

INSTRUCTIONS:
1. No agenda reference paper or committee reference context is available for this agenda.
2. Treat the transcript as the only evidence source.
3. Separate what appears to be presented material from what appears to be discussion or challenge.
4. Preserve any uncertainty or ambiguity instead of guessing.

OUTPUT: Return the analysis categorizing all points as transcript-backed verbal discussion only.`
  }

  const agendaReferenceBlock = hasAgendaReferences
    ? `\nAGENDA REFERENCE PAPER / AGENDA PDF EXCERPTS (PRIMARY FACTUAL AUTHORITY):\n---\n${agendaReferences
      .map((reference, index) => `[Source ${index + 1}] ${reference.source}\n${reference.text}`)
      .join('\n\n')}\n---`
    : ''
  const committeeRagBlock = hasCommitteeRag
    ? `\nCOMMITTEE RAG EXCERPTS (SUPPORTING BANK CONTEXT ONLY):\n---\n${committeeRagReferences
      .map((reference, index) => `[Committee Context ${index + 1}] ${reference.source}\n${reference.text}`)
      .join('\n\n')}\n---`
    : ''

  return `TASK: Prompt 2 - Fact Grounding for Agenda ${params.agendaNo}: "${params.agendaTitle}".

CLEANED TRANSCRIPT:
---
${params.cleanedTranscript}
---

${params.referenceGuidance ? `REFERENCE GUIDANCE:\n${params.referenceGuidance}\n\n` : ''}${hasDeck ? `SLIDE CONTENT:\n---\n${params.slideContent}\n---` : 'SLIDE CONTENT: Not available for this agenda.'}${agendaReferenceBlock}${committeeRagBlock}${meetingRules}${hardRules}${committeeFacts}

INSTRUCTIONS:
1. Treat agenda reference paper / agenda PDF excerpts as the primary factual authority for figures, dates, proposal details, policy names, and paper-backed statements.
2. Treat the transcript as the authority for who said what, discussion flow, objections, questions, and decision dynamics.
3. Use committee RAG only to clarify bank-specific terminology, product names, frameworks, policy context, and institutional background. Do NOT let committee RAG override agenda-specific paper facts.
4. If the transcript conflicts with the agenda reference paper on a number, date, or named fact, prefer the agenda paper but explicitly record the discrepancy.
5. Identify "Outside Discussions" - verbal points not found in the agenda paper.
6. Note which paper-backed facts were specifically discussed, challenged, or clarified.
7. Do not invent facts from the agenda paper or committee RAG that were never discussed or presented.
8. If REFERENCE GUIDANCE says the PDF came from a section header, use only the parts that clearly belong to Agenda ${params.agendaNo} and ignore unrelated sub-items from the same header deck.

OUTPUT: Return a structured analysis with:
- Paper-backed facts discussed (with source reference)
- Outside Discussions (verbal only, not in the paper)
- Committee-context clarifications used, if any
- Any discrepancies or challenges raised`
}

export function buildPromptAgendaTimelineSegmentation(params: {
  meetingTitle: string
  agendaList: Array<{ id: string; agendaNo: string; title: string }>
  timeline: string
  agendaDeviationNote?: string
  meetingRulesPrompt?: string
  knownAnchors?: Array<{
    agendaNo: string
    title: string
    startSec: number
    endSec: number
    source: 'explicit' | 'suggested'
  }>
  timelineScopeNote?: string
}) {
  const agendaRows = params.agendaList
    .map(agenda => `- agendaId: ${agenda.id} | agendaNo: ${agenda.agendaNo} | title: ${agenda.title}`)
    .join('\n')
  const knownAnchors = params.knownAnchors && params.knownAnchors.length > 0
    ? `\nKNOWN TIMELINE ANCHORS (already mapped, do not remap them):\n${params.knownAnchors
      .map(anchor => `- ${anchor.agendaNo} ${anchor.title} | ${anchor.source} | ${anchor.startSec}-${anchor.endSec}`)
      .join('\n')}\n`
    : ''

  return `TASK: Identify transcript time ranges only for the unresolved agenda items listed below.

MEETING:
${params.meetingTitle}

UNRESOLVED AGENDAS (map only to these IDs):
${agendaRows}
${knownAnchors}${params.timelineScopeNote ? `TIMELINE WINDOW NOTE:\n${params.timelineScopeNote}\n` : ''}

TRANSCRIPT TIMELINE:
---
${params.timeline}
---

${params.agendaDeviationNote ? `USER NOTE ABOUT AGENDA ORDER:\n${params.agendaDeviationNote}\n` : ''}${params.meetingRulesPrompt ? `MEETING RULES (apply for this run; override committee defaults if conflict):\n${params.meetingRulesPrompt}\n` : ''}INSTRUCTIONS:
1. Read the transcript window and infer time ranges only for the unresolved agendas.
2. Treat KNOWN TIMELINE ANCHORS as fixed context. Do not remap them or invent conflicts with them.
3. Agenda labels may NOT be explicitly spoken. Infer section boundaries from topic shifts, presenter flow, chronology, and semantic continuity inside this window only.
4. Respect MEETING RULES for terminology/context while inferring sections.
5. Return rows with agendaId + startSec + endSec + confidence + reason.
6. startSec/endSec are integers in seconds from meeting start.
7. Prefer non-overlapping ranges and keep chronological order.
8. Only return an agenda if the transcript window gives a plausible bounded mapping. Do not guess wildly just to fill every row.
9. Never return agenda IDs outside the provided list.
10. Keep "reason" concise, max one sentence.

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
  mindInstructionBlock?: string
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
${params.mindInstructionBlock ? `\n\nRELEVANT MIND INSTRUCTIONS:\n${params.mindInstructionBlock}` : ''}
${ignoredAgendasNote}

INSTRUCTIONS:
0. Priority order for constraints:
   - First: SECTION ADDITIONAL INFORMATION (agenda-specific override)
   - Second: AGENDA MIND
   - Third: MEETING RULES (run-specific override)
   - Fourth: MEETING MIND
   - Fifth: COMMITTEE MIND
   - Sixth: GLOBAL SECRETARIAT INSTRUCTIONS (committee baseline)
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

export function buildPrompt3_MasterReportExtraction(params: {
  agendaNo: string
  agendaTitle: string
  presenter: string | null
  cleanedTranscript: string
  crossRefAnalysis: string
  additionalInfo?: string
  secretariatInstructions?: string
  ignoredAgendaNos?: string[]
  meetingRulesPrompt?: string
  excludeDeckPoints?: boolean
  languages?: string[]
  formatterRuleBlock?: string
  hardRulesBlock?: string
  committeeFactsBlock?: string
}) {
  const langNote = params.languages && params.languages.length > 0
    ? `\nMeeting language(s): ${params.languages.join(', ')}. Use UK English for the final report while preserving critical governance terms in their original language where appropriate.`
    : ''
  const secretariatInstructions = params.secretariatInstructions?.trim()
    ? `\n\nGLOBAL SECRETARIAT INSTRUCTIONS:\n${params.secretariatInstructions.trim()}`
    : ''
  const meetingRules = params.meetingRulesPrompt?.trim()
    ? `\n\nMEETING RULES (HIGH PRIORITY FOR THIS RUN):\n${params.meetingRulesPrompt.trim()}`
    : ''
  const formatterRules = params.formatterRuleBlock?.trim()
    ? `\n\nREUSABLE FORMATTER MEMORY:\n${params.formatterRuleBlock.trim()}`
    : ''
  const hardRules = params.hardRulesBlock?.trim()
    ? `\n\nMIND HARD RULES:\n${params.hardRulesBlock.trim()}`
    : ''
  const committeeFacts = params.committeeFactsBlock?.trim()
    ? `\n\nMIND STANDING FACTS AND TERMINOLOGY:\n${params.committeeFactsBlock.trim()}`
    : ''
  const ignoredAgendasNote = params.ignoredAgendaNos && params.ignoredAgendaNos.length > 0
    ? `\n\nAGENDAS MARKED TO IGNORE FOR THIS RUN: ${params.ignoredAgendaNos.join(', ')}`
    : ''

  return `TASK: Prompt 3 - Master Report extraction for Agenda ${params.agendaNo}: "${params.agendaTitle}".
${params.presenter ? `Presenter: ${params.presenter}` : ''}${langNote}

CLEANED TRANSCRIPT:
---
${params.cleanedTranscript}
---

FACT GROUNDING ANALYSIS:
---
${params.crossRefAnalysis}
---${secretariatInstructions}${meetingRules}${formatterRules}${params.additionalInfo?.trim()
    ? `\n\nSECTION ADDITIONAL INFORMATION (HIGHEST PRIORITY FOR THIS AGENDA ONLY):\n${params.additionalInfo.trim()}`
    : ''}${hardRules}${committeeFacts}${ignoredAgendasNote}

CONSTRAINT PRIORITY:
1. Agenda-specific instructions / additional info
2. Meeting Rules
3. Agenda Mind hard rules
4. Meeting Mind hard rules
5. Committee Mind hard rules
6. Persona baseline

FACTUAL GROUNDING PRIORITY:
1. Agenda reference paper / agenda PDF facts captured in the FACT GROUNDING ANALYSIS
2. Transcript evidence for who said what, what was challenged, and what was decided
3. Committee RAG only for supporting bank context or terminology
4. Mind standing facts only for short committee facts or terminology, never to override agenda-paper facts

INSTRUCTIONS:
1. Produce the canonical five-part report for this agenda.
2. The five sections are:
   - paperSummary
   - discussionExplanation
   - noted
   - discussed
   - resolved
3. paperSummary must summarize the paper, deck, proposal, or verbally presented material as a concise narrative paragraph.
4. discussionExplanation must explain the rationale, analytical framing, and important discussion dynamics beyond merely repeating the paper summary.
5. noted must contain only key facts, data points, or acknowledgements that were noted without substantial debate.
6. discussed must contain the actual deliberations, questions, clarifications, objections, and justifications raised during the agenda.
7. resolved must contain final decisions, approvals, action items, PICs, due dates, proposer/seconder details, and follow-up tasks when explicitly stated.
8. Apply the hard rules directly in the writing: role-based naming, UK English, Islamic-finance wording, amount/date precision, and any no-pronoun or no-question-word requirements whenever those rules are present.
9. Use REUSABLE FORMATTER MEMORY to preserve recurring committee-level opener conventions and section framing when they fit this agenda, but never let formatter memory override transcript or agenda-paper facts.
10. Use formal, neutral, executive-level corporate language.
11. Do NOT fabricate content. If a section has no reliable evidence, return an empty array for list sections or a brief truthful sentence for narrative sections.
12. Keep noted, discussed, and resolved as clean item text only. Do NOT prepend bullets, numbering, or labels inside the items themselves.${params.excludeDeckPoints ? '\n13. Exclude points already stated in the presentation decks unless they were actively discussed, challenged, decided, or assigned as action items.' : ''}

OUTPUT:
Return JSON only in this exact shape:
{
  "paperSummary": "string",
  "discussionExplanation": "string",
  "noted": ["string"],
  "discussed": ["string"],
  "resolved": ["string"]
}`
}

export function buildPrompt3_StrictTemplateExtraction(params: {
  agendaNo: string
  agendaTitle: string
  presenter: string | null
  cleanedTranscript: string
  crossRefAnalysis: string
  canonicalReportBlock?: string
  templateSkeleton: string
  templateEntries: Array<{
    id: string
    kind: 'slot' | 'list'
    prefix?: string
    listStyle?: 'bullet' | 'numeric-dot' | 'numeric-paren' | 'alpha-dot' | 'alpha-paren'
    sampleValue?: string
    sampleItems?: string[]
    context: string
    guidance?: string
    formatterPattern?: string
    baseFormatFormulaPattern?: string
    sourceConstraint?: 'paper' | 'transcript'
    sourceNote?: string
  }>
  additionalInfo?: string
  secretariatInstructions?: string
  mindInstructionBlock?: string
  formatterRuleBlock?: string
  ignoredAgendaNos?: string[]
  meetingRulesPrompt?: string
  agendaPaperExcerpts?: Array<{ source: string; text: string }>
  excludeDeckPoints?: boolean
  languages?: string[]
  hardRulesBlock?: string
  committeeFactsBlock?: string
  activeResolutionVariantKey?: 'default' | 'with_action' | 'without_action' | null
  activeResolutionVariantLabel?: string | null
  activeResolutionVariantSource?: 'manual' | 'auto' | null
}) {
  const langNote = params.languages && params.languages.length > 0
    ? `\nMeeting language(s): ${params.languages.join(', ')}. Preserve critical governance terms in their original language where appropriate.`
    : ''
  const secretariatInstructions = params.secretariatInstructions?.trim()
    ? `\n\nGLOBAL SECRETARIAT INSTRUCTIONS:\n${params.secretariatInstructions.trim()}`
    : ''
  const mindInstructions = params.mindInstructionBlock?.trim()
    ? `\n\nRELEVANT MIND INSTRUCTIONS:\n${params.mindInstructionBlock.trim()}`
    : ''
  const formatterInstructions = params.formatterRuleBlock?.trim()
    ? `\n\nREUSABLE FORMATTER MEMORY:\n${params.formatterRuleBlock.trim()}`
    : ''
  const meetingRulesPrompt = params.meetingRulesPrompt?.trim()
  const meetingRules = meetingRulesPrompt
    ? `\n\nMEETING RULES (HIGH PRIORITY FOR THIS RUN - overrides global instructions if conflicting):\n${meetingRulesPrompt}`
    : ''
  const ignoredAgendasNote = params.ignoredAgendaNos && params.ignoredAgendaNos.length > 0
    ? `\n\nAGENDAS MARKED TO IGNORE FOR THIS RUN: ${params.ignoredAgendaNos.join(', ')}`
    : ''
  const hasPaperConstrainedEntries = params.templateEntries.some(e => e.sourceConstraint === 'paper')
  const paperExcerpts = params.agendaPaperExcerpts ?? []
  const agendaPaperVerbatimBlock = hasPaperConstrainedEntries && paperExcerpts.length > 0
    ? `\n\nAGENDA PAPER ORIGINAL TEXT (VERBATIM SOURCE FOR paper-CONSTRAINED ENTRIES):\n---\n${paperExcerpts
      .map((excerpt, index) => `[Source ${index + 1}] ${excerpt.source}\n${excerpt.text}`)
      .join('\n\n')}\n---`
    : ''
  const entryBlock = params.templateEntries
    .map(entry => {
      if (entry.kind === 'slot') {
        return [
          `- id: ${entry.id}`,
          '  type: slot',
          `  prefix: ${entry.prefix ?? ''}`,
          `  context: ${entry.context || 'none'}`,
          `  sourceConstraint: ${entry.sourceConstraint || 'none'}`,
          `  sourceNote: ${entry.sourceNote || 'none'}`,
          `  guidance: ${entry.guidance || 'none'}`,
          `  formatterPattern: ${entry.formatterPattern || 'none'}`,
          `  baseFormatFormulaPattern: ${entry.baseFormatFormulaPattern || 'none'}`,
          `  sample: ${entry.sampleValue ?? ''}`,
        ].join('\n')
      }

      return [
        `- id: ${entry.id}`,
        '  type: list',
        `  listStyle: ${entry.listStyle ?? 'bullet'}`,
        `  context: ${entry.context || 'none'}`,
        `  sourceConstraint: ${entry.sourceConstraint || 'none'}`,
        `  sourceNote: ${entry.sourceNote || 'none'}`,
        `  guidance: ${entry.guidance || 'none'}`,
        `  formatterPattern: ${entry.formatterPattern || 'none'}`,
        `  baseFormatFormulaPattern: ${entry.baseFormatFormulaPattern || 'none'}`,
        `  sampleItems: ${(entry.sampleItems ?? []).join(' | ')}`,
      ].join('\n')
    })
    .join('\n')
  const activeResolutionVariantBlock = params.activeResolutionVariantLabel
    ? `\n\nACTIVE RESOLUTION BRANCH:\n- variantKey: ${params.activeResolutionVariantKey ?? 'default'}\n- label: ${params.activeResolutionVariantLabel}\n- selectedBy: ${params.activeResolutionVariantSource === 'manual' ? 'manual override' : 'deterministic auto selection'}\n- Treat this branch as locked exact scaffolding. Preserve its literal structure and fill only the dynamic slot/list values.${params.activeResolutionVariantKey === 'without_action'
      ? '\n- This branch is for decision or closure wording only. Do NOT include Action By, PIC, Person in Charge, Owner, Due Date, Deadline, or any follow-up task lines.'
      : params.activeResolutionVariantKey === 'with_action'
        ? '\n- This branch may include Action By, PIC, owner, due date, deadline, or explicit follow-up task lines when they are supported by evidence.\n- Do NOT use closure-only wording such as "Status: Closed.", "Closed.", "Noted as presented.", or "No further action" in this branch. Use neutral decision wording instead.'
        : '\n- This branch means no separate RESOLVED block should be inserted.'}`
    : ''

  return `TASK: Fill the exact minute template slots for Agenda ${params.agendaNo}: "${params.agendaTitle}".
${params.presenter ? `Presenter: ${params.presenter}` : ''}${langNote}

CLEANED TRANSCRIPT:
---
${params.cleanedTranscript}
---

CROSS-REFERENCE ANALYSIS:
---
${params.crossRefAnalysis}
---
${secretariatInstructions}
${meetingRules}
${formatterInstructions}
${mindInstructions}
${params.additionalInfo?.trim()
    ? `\n\nSECTION ADDITIONAL INFORMATION (HIGHEST PRIORITY FOR THIS AGENDA ONLY):\n${params.additionalInfo.trim()}`
    : ''}
${params.hardRulesBlock ? `\n\nMIND HARD RULES:\n${params.hardRulesBlock}` : ''}
${params.committeeFactsBlock ? `\n\nMIND STANDING FACTS AND TERMINOLOGY:\n${params.committeeFactsBlock}` : ''}
${ignoredAgendasNote}
${params.canonicalReportBlock ? `\n\n${params.canonicalReportBlock}` : ''}
${activeResolutionVariantBlock}${agendaPaperVerbatimBlock}

EXACT TEMPLATE SKELETON:
---
${params.templateSkeleton}
---

TEMPLATE ENTRIES:
${entryBlock}

INSTRUCTIONS:
0. Priority order for constraints:
   - First: SECTION ADDITIONAL INFORMATION (agenda-specific override)
   - Second: MEETING RULES (run-specific override)
   - Third: AGENDA MIND HARD RULES
   - Fourth: REUSABLE FORMATTER MEMORY
   - Fifth: MEETING MIND HARD RULES
   - Sixth: COMMITTEE MIND HARD RULES
   - Seventh: GLOBAL SECRETARIAT INSTRUCTIONS (committee baseline)
1. Do NOT rewrite the full minutes.
2. Only provide values for the template entry IDs.
3. For "slot" entries, return only the content that should appear AFTER the fixed prefix.
4. For "list" entries, return item texts only. Do NOT include bullets, numbering, or labels.
5. If a slot has no reliable supporting content, return an empty string. Do not invent filler wording or "Nil." unless it is already part of the saved literal template text.
6. If a list has no reliable supporting content, return an empty array.
7. Keep formal, third-person corporate language.
8. Do NOT fabricate any information.
9. If names, figures, or specific facts are uncertain, wrap only the uncertain fragment in [[VERIFY: text]].
10. Treat each entry's sampleValue or sampleItems as a structural example of what kind of content belongs there. Do NOT copy previous-minute wording verbatim unless the current agenda evidence genuinely supports the same sentence.
11. Do NOT repeat a slot's fixed prefix inside the slot value. For example, if the prefix is already "Action By:", return only the value after it.
12. For list entries, return plain item text only. Do NOT include bullets, numbering, alphabet labels, section headings, or repeated prefixes.
13. Treat NOTED, DISCUSSED, and RESOLVED in the CANONICAL FIVE-PART REPORT as internal semantic buckets only. The saved exact template remains the visible output structure.
14. If the exact template combines, renames, or embeds NOTED, DISCUSSED, or RESOLVED content without literal headings, map the content into that saved structure naturally.
15. Do NOT insert literal section headings such as NOTED, DISCUSSED, or RESOLVED unless the exact template skeleton already contains them.
16. Use the CANONICAL FIVE-PART REPORT as the primary synthesized content source. Use the transcript, fact-grounding analysis, agenda PDF facts, and RELEVANT MIND INSTRUCTIONS to write fresh agenda-specific content. Template sample prose is not evidence and must not be pasted as final content.
17. Treat REUSABLE FORMATTER MEMORY as committee-level structure guidance for where certain opener lines, section conventions, or formatting patterns usually belong. Use it to guide placement and tone, but never copy it blindly and never let it override transcript or agenda-paper facts.
18. If an entry has a formatterPattern, treat it as the preferred reusable sentence scaffold for that specific slot. Keep the sentence shape closely, replace placeholders such as [Role] or [subject] with current-agenda evidence, and do not move that pattern to a different slot.
19. If an entry has a baseFormatFormulaPattern, treat it as a recognized opening formula from the saved Base Format. Keep that sentence pattern closely, but fill it only with current-agenda facts. Never copy old role labels, subject names, or figures from the template sample.
20. When multiple opening discussion entries in the saved Base Format use recognized opening formulas, preserve that opening sequence as closely as the evidence allows. Do not replace those opening formula entries with generic discussion prose unless the evidence for that specific formula is genuinely unavailable.
21. If an entry has sourceConstraint = paper, reproduce the agenda paper text as close to verbatim as possible. Use the AGENDA PAPER ORIGINAL TEXT section as the primary verbatim source. Preserve exact figures, percentages, ratings, scores, dates, and named values from the paper. Keep the paper's sentence structure and wording — do NOT paraphrase, summarize, or rewrite in your own words. Only adjust minimally for grammar or formatting fit within the template slot. Do NOT fill that entry from transcript-only discussion content.
22. If an entry has sourceConstraint = transcript, use transcript-primary evidence for that entry. You may use the agenda paper only to correct terminology, acronyms, role naming, and clearly grounded figures or dates.
23. If an entry has no sourceConstraint, default to transcript-primary evidence while still using agenda-paper facts to normalize obvious terminology or factual labels when clearly grounded.
24. If an entry has sourceNote, treat it as a specific instruction for how to use the source. For example, "replace the previous figure with this month figure" means you must find the current figures in the AGENDA PAPER ORIGINAL TEXT and use those exact figures. A note like "Take from 1.0 Executive Summary" means use only that section of the paper. Always follow the sourceNote instruction literally.
25. Respect each entry's guidance note strictly. Guidance can limit a section to PDF-backed content, discussion-only content, or other source constraints.
26. Never return bracket guidance notes like [This part is from the discussions] or the [RESOLUTION_PATH] token as extracted content.
27. Preserve decisions, action items, PICs, due dates, proposer/seconder details, and objections whenever explicitly stated.${params.excludeDeckPoints ? '\n28. Exclude points already stated in the presentation decks unless they were actively discussed, challenged, decided, or assigned as action items.' : ''}
28. Do NOT invent agenda-objective opener lines such as "To deliberate...", "To discuss...", or "under Agenda ${params.agendaNo}" inside extracted slot/list values unless the exact template skeleton already contains that wording as a literal.
29. Never return a standalone role fragment such as "The Committee", "The Chairman", or "Head, XYZ" as a complete slot or list item. Always return the full sentence or leave it empty.
${params.activeResolutionVariantLabel ? `\n30. The active RESOLVED branch is fixed to "${params.activeResolutionVariantLabel}". Do not invent a different RESOLVED structure, heading order, closure sentence, or follow-up layout.${params.activeResolutionVariantKey === 'without_action'
  ? '\n31. For Decision / Closure Only, output decision or closure wording only. Never output Action, Action By, PIC, owner, due date, deadline, or explicit follow-up tasks in this branch.\n32. If the evidence supports a decision but your first instinct is to leave the branch empty, write the best grounded decision sentence that fits the saved branch instead of leaving the RESOLVED slots blank.'
  : params.activeResolutionVariantKey === 'with_action'
    ? '\n31. For Decision + Follow-up, preserve any supported follow-up task text even when the exact template uses labels such as "Action:", "Action By:", "PIC:", "Owner:", or no dedicated owner field at all.\n32. Do NOT invent a literal "Action By:", "PIC:", "Owner:", or "Person in Charge:" line unless that field already exists in the exact branch template as fixed text.\n33. If the exact branch template contains owner-specific fields such as "Action By:", "PIC:", "Owner:", or "Person in Charge:" and the evidence clearly identifies an owner, fill those owner values. If no owner is clearly stated, keep the follow-up task in the available action/prose slots and leave owner-specific fields empty.\n34. If the exact branch template has a generic follow-up container such as "Action:", use it for the task text even when no owner is available.\n35. If the exact branch template has no dedicated owner or action field, keep the follow-up in the existing RESOLVED prose or list structure instead of suppressing it.\n36. Do NOT output closure-only wording such as "Status: Closed.", "Closed.", "Noted as presented.", or "No further action" in this branch. Use neutral decision wording instead.\n37. Do not leave the chosen RESOLVED branch empty when grounded decision or follow-up evidence exists. Put the best supported decision sentence and follow-up text into the saved branch structure.'
    : ''}` : ''}

OUTPUT:
Return JSON only in this shape:
{
  "slots": [
    { "id": "slot_1", "value": "text without the fixed prefix" }
  ],
  "lists": [
    { "id": "list_1", "items": ["item text only"] }
  ]
}`
}

export function buildPrompt3_PlaybookVariantSelection(params: {
  agendaNo: string
  agendaTitle: string
  presenter: string | null
  cleanedTranscript: string
  crossRefAnalysis: string
  playbookMode?: 'resolution_paths' | 'legacy_full'
  availableVariantKeys: string[]
  additionalInfo?: string
  meetingRulesPrompt?: string
  ignoredAgendaNos?: string[]
  mindInstructionBlock?: string
}) {
  const meetingRules = params.meetingRulesPrompt?.trim()
    ? `\n\nMEETING RULES:\n${params.meetingRulesPrompt.trim()}`
    : ''
  const ignoredAgendasNote = params.ignoredAgendaNos && params.ignoredAgendaNos.length > 0
    ? `\n\nAGENDAS MARKED TO IGNORE FOR THIS RUN: ${params.ignoredAgendaNos.join(', ')}`
    : ''

  if (params.playbookMode === 'legacy_full') {
    return `TASK: Choose the best minute playbook variant for Agenda ${params.agendaNo}: "${params.agendaTitle}".
${params.presenter ? `Presenter: ${params.presenter}` : ''}

CLEANED TRANSCRIPT:
---
${params.cleanedTranscript}
---

CROSS-REFERENCE ANALYSIS:
---
${params.crossRefAnalysis}
---${params.additionalInfo?.trim()
    ? `\n\nSECTION ADDITIONAL INFORMATION:\n${params.additionalInfo.trim()}`
    : ''}${params.mindInstructionBlock ? `\n\nRELEVANT MIND INSTRUCTIONS:\n${params.mindInstructionBlock}` : ''}${meetingRules}${ignoredAgendasNote}

AVAILABLE VARIANTS:
- ${params.availableVariantKeys.join('\n- ')}

INSTRUCTIONS:
1. Choose "with_action" only when there is an explicit action item, Action / Action By / PIC / owner / due date / deadline field, or a clear follow-up task/resolution that should be rendered as an action.
2. Choose "without_action" when the agenda has a decision, closure, confirmation, deferment, or resolution outcome but no explicit action item to assign.
3. Choose "default" when the evidence is ambiguous, mixed, or the other variants are unavailable.
4. Do not invent actions.
5. Use SECTION ADDITIONAL INFORMATION and RELEVANT MIND INSTRUCTIONS when they clarify whether this agenda usually carries action lines.

OUTPUT:
Return JSON only:
{
  "variantKey": "default",
  "reason": "short explanation"
}`
  }

  return `TASK: Choose the best Resolution Path for Agenda ${params.agendaNo}: "${params.agendaTitle}".
${params.presenter ? `Presenter: ${params.presenter}` : ''}

CLEANED TRANSCRIPT:
---
${params.cleanedTranscript}
---

CROSS-REFERENCE ANALYSIS:
---
${params.crossRefAnalysis}
---${params.additionalInfo?.trim()
    ? `\n\nSECTION ADDITIONAL INFORMATION:\n${params.additionalInfo.trim()}`
    : ''}${params.mindInstructionBlock ? `\n\nRELEVANT MIND INSTRUCTIONS:\n${params.mindInstructionBlock}` : ''}${meetingRules}${ignoredAgendasNote}

AVAILABLE VARIANTS:
- ${params.availableVariantKeys.join('\n- ')}

VARIANT MEANING:
- "default" = No RESOLVED section should be inserted.
- "without_action" = Insert the Decision / Closure Only RESOLVED block.
- "with_action" = Insert the Decision + Follow-up RESOLVED block.

INSTRUCTIONS:
1. Choose "with_action" only when there is an explicit action item, Action / Action By / PIC / owner / due date / deadline field, or a clear follow-up task/resolution that should be rendered as follow-up.
2. Choose "without_action" when there is a decision, closure, confirmation, deferment, or resolution outcome but no explicit follow-up action to assign.
3. Choose "default" when there is no reliable evidence that a RESOLVED block should appear at all.
4. Do not invent actions or resolutions.
5. Use SECTION ADDITIONAL INFORMATION and RELEVANT MIND INSTRUCTIONS when they clarify whether this agenda usually includes a RESOLVED section.

OUTPUT:
Return JSON only:
{
  "variantKey": "default",
  "reason": "short explanation"
}`
}

export function buildMeetingTranscriptCleanupPrompt(params: {
  meetingTitle: string
  committeeName: string | null
  rawTranscript: string
  agendaList: Array<{ agendaNo: string; title: string; presenter?: string | null }>
  glossary: Array<{ acronym: string; fullMeaning: string }>
  speakerNames: string[]
}) {
  const agendaBlock = params.agendaList.length > 0
    ? params.agendaList
        .map(agenda => `- ${agenda.agendaNo}: ${agenda.title}${agenda.presenter ? ` (Presenter: ${agenda.presenter})` : ''}`)
        .join('\n')
    : '- No agenda list available yet'
  const glossaryBlock = params.glossary.length > 0
    ? params.glossary.map(item => `- ${item.acronym}: ${item.fullMeaning}`).join('\n')
    : '- No committee glossary entries available'
  const speakerBlock = params.speakerNames.length > 0
    ? params.speakerNames.map(name => `- ${name}`).join('\n')
    : '- No confirmed speaker names available'

  return `TASK: Clean this meeting transcript while preserving it as a transcript, not a summary.

MEETING:
- Title: ${params.meetingTitle}
- Committee: ${params.committeeName ?? 'Unknown committee'}

KNOWN AGENDA LIST:
${agendaBlock}

COMMITTEE GLOSSARY (use exact spellings when the evidence supports them):
${glossaryBlock}

KNOWN SPEAKERS:
${speakerBlock}

RAW TRANSCRIPT:
---
${params.rawTranscript}
---

INSTRUCTIONS:
1. Preserve chronology and transcript structure.
2. Keep speaker labels if they already exist.
3. Correct obvious speech-to-text errors, committee acronyms, and named entities using the agenda list and glossary.
4. Do NOT summarize or compress the discussion into minutes.
5. Do NOT invent content that was not said.
6. If a name, acronym, or figure is uncertain, keep the spoken content but wrap the uncertain fragment in [[VERIFY: text]].
7. Preserve mixed-language meeting terms when appropriate.
8. Output only the cleaned transcript text.`
}

export function buildGroundedTranscriptRefinementPrompt(params: {
  agendaNo: string
  agendaTitle: string
  presenter: string | null
  cleanedTranscript: string
  referenceGuidance?: string
  referenceExcerpts: Array<{ source: string; text: string }>
}) {
  const references = params.referenceExcerpts.length > 0
    ? params.referenceExcerpts
        .map((reference, index) => `[Source ${index + 1}] ${reference.source}\n${reference.text}`)
        .join('\n\n')
    : 'No agenda PDF or committee RAG references were available.'

  return `TASK: Refine this cleaned transcript for Agenda ${params.agendaNo}: "${params.agendaTitle}" using the attached agenda references.
${params.presenter ? `Presenter: ${params.presenter}` : ''}

CLEANED TRANSCRIPT:
---
${params.cleanedTranscript}
---

${params.referenceGuidance ? `REFERENCE GUIDANCE:\n${params.referenceGuidance}\n\n` : ''}REFERENCE EXCERPTS:
---
${references}
---

INSTRUCTIONS:
1. Keep the result as a transcript-style discussion record, not a minute summary.
2. Preserve the same line-oriented transcript structure. Do NOT collapse multiple transcript lines into narrative paragraphs.
3. Keep timestamps and speaker prefixes that are already present unless a correction is clearly required.
4. Treat the references as a conservative terminology dictionary for acronyms, Islamic-finance terms, product names, department labels, role labels, dates, and clearly grounded figures.
5. Correct agenda-specific terminology, names, product labels, and figures only when the references strongly support the correction and the correction clearly matches the spoken context.
6. Fix clear transcript drift such as misheard acronyms or terms when the intended wording is obvious from the references, but keep the spoken meaning intact.
7. If the references are relevant but the evidence is weak or ambiguous, do NOT silently change the text. Keep the original wording and wrap the uncertain fragment in [[VERIFY: text]].
8. Do not introduce facts from the references that were never actually discussed, and do not rewrite discussion lines into paper-summary prose.
9. Preserve chronological order and speaker labels when available.
10. Output only the refined transcript text.`
}

export function buildNumericTranscriptReviewPrompt(params: {
  agendaNo: string
  agendaTitle: string
  transcript: string
  referenceExcerpts: Array<{ source: string; text: string }>
}) {
  const references = params.referenceExcerpts
    .map((reference, index) => `[Source ${index + 1}] ${reference.source}\n${reference.text}`)
    .join('\n\n')

  return `TASK: Review this agenda transcript only for likely numeric discrepancies for Agenda ${params.agendaNo}: "${params.agendaTitle}".

TRANSCRIPT:
---
${params.transcript}
---

REFERENCE EXCERPTS:
---
${references}
---

INSTRUCTIONS:
1. Focus only on numbers, percentages, basis points, ratios, dates, and monetary values.
2. Correct a value only when the reference evidence is strong and clearly matches the spoken topic.
3. If the evidence is weak or there are multiple plausible values, keep the transcript wording and wrap the fragment in [[VERIFY: text]] instead of changing it.
4. Do not rewrite unaffected text.
5. Preserve the existing transcript line structure, timestamps, and speaker prefixes.
6. Output only the reviewed transcript text.`
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
