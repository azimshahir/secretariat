/**
 * Single-prompt minute generation — replaces the old 6-8 prompt chain.
 *
 * Two modes:
 *  - Free-form: outputs { noted[], discussed[], resolved[], actionItems[] }
 *  - Template fill: outputs { slots[], lists[], actionItems[] }
 *
 * The mode is determined by whether a compiled template skeleton is provided.
 */

// ── Types ────────────────────────────────────────────────────────────

export interface MinutePromptContext {
  // Committee / persona
  committeeName: string
  committeePersona: string
  glossary: { acronym: string; full_meaning: string }[]

  // Minute Mind rules (pre-compiled blocks from minute-mind.ts)
  formatterRules: string | null
  hardRules: string | null
  committeeFacts: string | null

  // Meeting-level overrides
  meetingRules: string | null
}

export interface AgendaPromptInput {
  agendaNo: string
  agendaTitle: string
  presenter: string | null
  transcript: string
  paperExcerpts: string | null
  additionalInfo: string | null

  // Template (null = free-form mode)
  templateSkeleton: string | null
  templateEntryDescriptions: string | null
}

export interface MinutePromptPair {
  system: string
  user: string
}

// ── System prompt builder ────────────────────────────────────────────

export function buildMinuteSystemPrompt(ctx: MinutePromptContext): string {
  const glossaryBlock = ctx.glossary.length > 0
    ? `\n\nGLOSSARY (use exact spellings and full forms):\n${ctx.glossary.map(g => `- ${g.acronym}: ${g.full_meaning}`).join('\n')}`
    : ''

  const formatterBlock = ctx.formatterRules?.trim()
    ? `\n\nFORMATTER RULES (reusable formatting memory):\n${ctx.formatterRules.trim()}`
    : ''

  const hardRulesBlock = ctx.hardRules?.trim()
    ? `\n\nHARD RULES (must follow strictly):\n${ctx.hardRules.trim()}`
    : ''

  const factsBlock = ctx.committeeFacts?.trim()
    ? `\n\nSTANDING FACTS AND TERMINOLOGY:\n${ctx.committeeFacts.trim()}`
    : ''

  const meetingRulesBlock = ctx.meetingRules?.trim()
    ? `\n\nMEETING-SPECIFIC RULES (override defaults if conflict):\n${ctx.meetingRules.trim()}`
    : ''

  return `${ctx.committeePersona}

You are a professional Company Secretary minute writer for ${ctx.committeeName}.
Your task: generate formal board/committee meeting minutes for ONE agenda item.

WRITING STANDARDS:
- Use formal third-person language ("The Committee noted...", "It was resolved that...")
- Preserve exact figures, percentages, dates, and proper nouns from transcript and papers
- If a figure appears in BOTH the reference paper and transcript, prefer the paper's figure (more reliable source)
- Attribute discussion points to speakers using role titles (e.g. "Head, CMRD" not personal names) unless rules say otherwise
- Action items must include: task description, PIC (person in charge), and deadline if mentioned
- For any figure, name, date, or decision you are NOT confident about (unclear audio, conflicting
  sources, or inferred), add an entry to "verifyFlags" with the exact text and a short reason.
  Do not inline "[[VERIFY]]" markers in the minute body — use the verifyFlags field instead.
- Do NOT invent information not found in the transcript or reference papers
- Do NOT include pleasantries, small talk, or procedural chatter
- Keep the minute concise but complete — capture substance, not filler${glossaryBlock}${formatterBlock}${hardRulesBlock}${factsBlock}${meetingRulesBlock}`.trim()
}

// ── User prompt builder ──────────────────────────────────────────────

export function buildMinuteUserPrompt(input: AgendaPromptInput): string {
  const presenterLine = input.presenter
    ? `\nPresented by: ${input.presenter}`
    : ''

  const paperBlock = input.paperExcerpts?.trim()
    ? `\n\nREFERENCE PAPER / SLIDES:\n---\n${input.paperExcerpts.trim()}\n---`
    : ''

  const additionalBlock = input.additionalInfo?.trim()
    ? `\n\nADDITIONAL CONTEXT (highest priority for this agenda):\n${input.additionalInfo.trim()}`
    : ''

  const templateBlock = input.templateSkeleton?.trim()
    ? `\n\nTEMPLATE TO FOLLOW:\nFill the slots and lists in this exact template structure.\n---\n${input.templateSkeleton.trim()}\n---`
    : ''

  const templateEntriesBlock = input.templateEntryDescriptions?.trim()
    ? `\n\nTEMPLATE ENTRY SPECIFICATIONS:\n${input.templateEntryDescriptions.trim()}`
    : ''

  // Output format instruction depends on mode
  const outputInstruction = input.templateSkeleton?.trim()
    ? `\n\nGenerate the minute by filling each slot and list from the template above.
For each slot, provide the slot ID and generated value.
For each list, provide the list ID and generated items.
Also extract any action items discussed.`
    : `\n\nGenerate the minute in structured form:
- "noted": key points that were presented or reported
- "discussed": points raised during discussion by committee members
- "resolved": decisions, resolutions, or directives agreed upon
- "actionItems": tasks assigned with person in charge and deadline
Keep each array item as a single coherent point in formal minute language.`

  return `AGENDA ${input.agendaNo}: ${input.agendaTitle}${presenterLine}

TRANSCRIPT:
---
${input.transcript}
---${paperBlock}${additionalBlock}${templateBlock}${templateEntriesBlock}${outputInstruction}`
}

// ── Combined builder ─────────────────────────────────────────────────

export function buildMinutePrompt(
  ctx: MinutePromptContext,
  input: AgendaPromptInput,
): MinutePromptPair {
  return {
    system: buildMinuteSystemPrompt(ctx),
    user: buildMinuteUserPrompt(input),
  }
}
