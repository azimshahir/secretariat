# Secretariat.my — New Single Prompt Design

## Overview

Replace the 6-8 prompt chain with ONE prompt per agenda.
Model: Claude Sonnet 4 via `generateObject()` with Zod schema.

---

## Architecture

```
  BEFORE: 6-8 calls per agenda
  ┌────────┐   ┌────────┐   ┌────────┐   ┌────────┐   ┌────────┐   ┌────────┐
  │Prompt 1│──►│Prmpt1.5│──►│Prompt 2│──►│Prompt3a│──►│Prompt3b│──►│Prompt3c│
  └────────┘   └────────┘   └────────┘   └────────┘   └────────┘   └────────┘

  AFTER: 1 call per agenda
  ┌──────────────────────────────────────────────────────────────────────────┐
  │                         ONE PROMPT                                       │
  │  System: persona + rules + template                                     │
  │  User:   transcript + references + instructions                         │
  │  Output: Zod structured object                                          │
  └──────────────────────────────────────────────────────────────────────────┘
```

---

## System Prompt

```typescript
function buildSystemPrompt(params: {
  committeeName: string;
  committeePersona: string;       // from persona-templates.ts
  glossary: { term: string; definition: string }[];
  formatterRules: string[];       // from Minute Mind
  hardRules: string[];            // from Minute Mind
  committeeFacts: string[];       // from Minute Mind
  templateFormat: string;         // the exact output structure to follow
}): string {
  return `
You are a professional Company Secretary minute writer for ${params.committeeName}.

${params.committeePersona}

## Your Task
Generate formal board/committee meeting minutes for ONE agenda item.
You will receive the transcript and reference papers. Produce structured minutes.

## Glossary
${params.glossary.map(g => `- ${g.term}: ${g.definition}`).join('\n')}

## Formatting Rules
${params.formatterRules.join('\n')}

## Hard Rules (Must Follow)
${params.hardRules.join('\n')}

## Committee Facts
${params.committeeFacts.join('\n')}

## Output Template
Follow this EXACT format structure:
${params.templateFormat}

## Quality Standards
- Use formal third-person language ("The Committee noted...", "It was resolved...")
- Preserve exact figures, percentages, dates from transcript and papers
- If a figure appears in the reference paper, use the paper's figure (more reliable)
- Flag uncertain names/figures with [[VERIFY: reason]]
- Action items must have: task, PIC (person in charge), deadline if mentioned
- Do NOT invent information not in the transcript or papers
`.trim();
}
```

**Token estimate for system prompt: ~500-1,500 tokens** (depending on glossary/rules size)

---

## User Prompt

```typescript
function buildUserPrompt(params: {
  agendaNo: string;
  agendaTitle: string;
  presenter: string;
  transcript: string;              // cleaned transcript for THIS agenda only
  paperExcerpts: string | null;    // reference paper for THIS agenda only
  additionalInfo: string | null;   // user-provided context
  meetingRules: string | null;     // meeting-specific rules
}): string {
  let prompt = `
## Agenda ${params.agendaNo}: ${params.agendaTitle}
Presented by: ${params.presenter}

## Transcript
${params.transcript}
`;

  if (params.paperExcerpts) {
    prompt += `
## Reference Paper / Slides
${params.paperExcerpts}
`;
  }

  if (params.additionalInfo) {
    prompt += `
## Additional Context
${params.additionalInfo}
`;
  }

  if (params.meetingRules) {
    prompt += `
## Meeting-Specific Rules
${params.meetingRules}
`;
  }

  prompt += `
Generate the minutes for this agenda item following the template format exactly.
`;

  return prompt.trim();
}
```

**Token estimate for user prompt: ~3,000-12,000 tokens** (depending on transcript length)

---

## Output Schema (Zod)

```typescript
import { z } from 'zod';

// Core output schema for generateObject()
export const minuteOutputSchema = z.object({
  
  // The noted section — what was presented/reported
  noted: z.array(z.object({
    content: z.string().describe('A single noted point in formal minute language'),
    source: z.enum(['paper', 'transcript', 'both']).describe('Where this info came from'),
  })).describe('Key points that were noted/presented to the committee'),

  // The discussed section — what members discussed
  discussed: z.array(z.object({
    content: z.string().describe('A discussion point in formal minute language'),
    speakers: z.array(z.string()).optional().describe('Members who raised this point'),
  })).describe('Discussion points raised by committee members'),

  // The resolved section — decisions made
  resolved: z.array(z.object({
    content: z.string().describe('The resolution/decision in formal minute language'),
  })).describe('Resolutions or decisions made by the committee'),

  // Action items — extracted tasks
  actionItems: z.array(z.object({
    task: z.string().describe('What needs to be done'),
    pic: z.string().describe('Person in charge'),
    deadline: z.string().optional().describe('Deadline if mentioned'),
  })).describe('Action items with person responsible'),

  // Confidence flags
  verifyFlags: z.array(z.object({
    text: z.string().describe('The uncertain text'),
    reason: z.string().describe('Why this needs verification'),
  })).optional().describe('Items that need human verification'),

});

export type MinuteOutput = z.infer<typeof minuteOutputSchema>;
```

**Token estimate for output: ~1,000-3,000 tokens**

---

## Alternative: Template-Aware Schema

If the agenda uses a compiled template (playbook), use a template-filling schema instead:

```typescript
export const templateFillOutputSchema = z.object({
  
  // Fill template slots (paragraphs, fields)
  slots: z.array(z.object({
    id: z.string().describe('The slot ID from the template'),
    value: z.string().describe('The generated content for this slot'),
  })),

  // Fill template lists (bullet points, numbered items)
  lists: z.array(z.object({
    id: z.string().describe('The list ID from the template'),
    items: z.array(z.string()).describe('Generated list items'),
  })),

  // Action items (always extracted regardless of template)
  actionItems: z.array(z.object({
    task: z.string(),
    pic: z.string(),
    deadline: z.string().optional(),
  })),

  // Confidence flags
  verifyFlags: z.array(z.object({
    text: z.string(),
    reason: z.string(),
  })).optional(),

});
```

**Decision**: Use `minuteOutputSchema` for agendas WITHOUT templates, `templateFillOutputSchema` for agendas WITH compiled templates. The orchestrator picks based on whether a playbook is assigned.

---

## Generation Function

```typescript
// src/lib/ai/generate-minute-prompt.ts

import { generateObject } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { minuteOutputSchema, templateFillOutputSchema } from './minute-output-schema';

export async function generateMinuteForAgenda(params: {
  // Agenda info
  agendaNo: string;
  agendaTitle: string;
  presenter: string;
  
  // Content
  transcript: string;
  paperExcerpts: string | null;
  additionalInfo: string | null;
  
  // Committee context (cached, shared across agendas)
  committeeName: string;
  committeePersona: string;
  glossary: { term: string; definition: string }[];
  formatterRules: string[];
  hardRules: string[];
  committeeFacts: string[];
  meetingRules: string | null;
  
  // Template (if using playbook)
  templateFormat: string | null;
  templateEntries: TemplateEntry[] | null;  // for templateFillOutputSchema
  
}): Promise<MinuteOutput | TemplateFillOutput> {

  const system = buildSystemPrompt({
    committeeName: params.committeeName,
    committeePersona: params.committeePersona,
    glossary: params.glossary,
    formatterRules: params.formatterRules,
    hardRules: params.hardRules,
    committeeFacts: params.committeeFacts,
    templateFormat: params.templateFormat ?? DEFAULT_TEMPLATE,
  });

  const user = buildUserPrompt({
    agendaNo: params.agendaNo,
    agendaTitle: params.agendaTitle,
    presenter: params.presenter,
    transcript: params.transcript,
    paperExcerpts: params.paperExcerpts,
    additionalInfo: params.additionalInfo,
    meetingRules: params.meetingRules,
  });

  // Pick schema based on whether template is compiled
  const schema = params.templateEntries 
    ? templateFillOutputSchema 
    : minuteOutputSchema;

  const { object } = await generateObject({
    model: anthropic('claude-sonnet-4-20250514'),
    system,
    prompt: user,
    schema,
  });

  return object;
}
```

---

## Batch Generation (Parallel)

```typescript
// src/lib/meeting-generation/generate-minute-v2.ts

export async function generateAllMinutesForMeeting(params: {
  supabase: SupabaseClient;
  meetingId: string;
  userId: string;
}): Promise<BatchResult> {

  // 1. Load shared context ONCE
  const meeting = await loadMeetingContext(params.supabase, params.meetingId);
  const { committee, glossary, formatterRules, hardRules, committeeFacts } = meeting;

  // 2. Load all agendas
  const agendas = await loadAgendasForMeeting(params.supabase, params.meetingId);

  // 3. Generate in parallel (max 5 concurrent)
  const results = await pMap(agendas, async (agenda) => {
    
    // Load per-agenda data
    const transcript = await loadTranscriptForAgenda(params.supabase, agenda.id);
    const paperExcerpts = await loadPaperExcerptsForAgenda(params.supabase, agenda.id);
    
    // Generate
    const output = await generateMinuteForAgenda({
      agendaNo: agenda.agenda_no,
      agendaTitle: agenda.title,
      presenter: agenda.presenter,
      transcript,
      paperExcerpts,
      additionalInfo: agenda.additional_info,
      committeeName: committee.name,
      committeePersona: committee.persona,
      glossary,
      formatterRules,
      hardRules,
      committeeFacts,
      meetingRules: meeting.meeting_rules,
      templateFormat: agenda.templateFormat,
      templateEntries: agenda.templateEntries,
    });

    // Save to DB
    await saveMinuteToDb(params.supabase, {
      agendaId: agenda.id,
      meetingId: params.meetingId,
      content: renderMinuteContent(output),
      actionItems: output.actionItems,
      verifyFlags: output.verifyFlags,
      userId: params.userId,
    });

    return { agendaId: agenda.id, status: 'done' };

  }, { concurrency: 5 });

  return { results, generatedCount: results.length };
}
```

---

## Token Budget Per Agenda

```
  ┌────────────────────────────────────────────────────┐
  │                                                    │
  │  System prompt:        500 - 1,500 tokens          │
  │  User prompt:        3,000 - 12,000 tokens         │
  │  ─────────────────────────────────────────         │
  │  Total input:        3,500 - 13,500 tokens         │
  │                                                    │
  │  Output:             1,000 - 3,000 tokens          │
  │                                                    │
  │  ─────────────────────────────────────────         │
  │  Total per agenda:   4,500 - 16,500 tokens         │
  │                                                    │
  │  Per meeting (10 agendas):                         │
  │    45,000 - 165,000 tokens                         │
  │                                                    │
  │  Cost (Claude Sonnet 4):                           │
  │    Input:  ~RM 0.60 - 1.75                         │
  │    Output: ~RM 0.65 - 1.95                         │
  │    Total:  ~RM 1.25 - 3.70 per meeting             │
  │                                                    │
  └────────────────────────────────────────────────────┘
```

---

## What We Keep From Old System

```
  ✅ KEEP (fold into single prompt)
  ─────────────────────────────────
  • Committee persona          → system prompt prefix
  • Glossary                   → system prompt section
  • Minute Mind rules          → system prompt sections (formatter, hard rules, facts)
  • Template format            → system prompt "Output Template" section
  • Paper cross-referencing    → user prompt "Reference Paper" section
  • Confidence markers         → output schema verifyFlags
  • Action item extraction     → output schema actionItems
  
  ❌ REMOVE (no longer needed)
  ─────────────────────────────────
  • Prompt 1 (Context Cleaning)         — Claude can handle raw transcript directly
  • Prompt 1.5 (Transcript Refinement)  — folded into main prompt instructions
  • Prompt 2 (Cross-Reference)          — folded into main prompt with papers
  • Prompt 3a (Master Report)           — intermediate step eliminated
  • Prompt 3b (Variant Selection)       — rule-based or folded into prompt
  • Checkpoint system                   — single call = atomic, no checkpoints
  • Memory trace logging                — unnecessary complexity
  • Source policy system                 — simplified to paper/transcript source hint
```

---

## Quality Safeguards

Since we're going from 6 prompts to 1, quality relies on:

1. **Strong system prompt** — detailed persona + rules + template = Claude knows exactly what to produce
2. **Zod schema** — `generateObject()` guarantees structured output, no parsing needed
3. **Paper excerpts in context** — Claude cross-references naturally when papers are in the prompt
4. **Post-generation review** — user reviews in editor, can use "Refine" button for specific agendas
5. **Verify flags** — uncertain items flagged in output, shown in editor UI
