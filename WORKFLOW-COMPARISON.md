# Secretariat.my — Workflow Comparison

## ══════════════════════════════════════════════════════════════
## CURRENT WORKFLOW (Before) — Per Agenda
## ══════════════════════════════════════════════════════════════

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        USER UPLOADS DOCUMENT                            │
│                    (Word/PDF transcript file)                            │
└─────────────────────────────┬───────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     AGENDA SEGMENTATION                                  │
│         AI call to split transcript into agenda chunks                   │
│                      (1 API call)                                        │
└─────────────────────────────┬───────────────────────────────────────────┘
                              │
                              ▼
┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐
│         ┌──────────────────────────────────────────────────┐            │
│         │          🔁 REPEAT FOR EACH AGENDA               │            │
│         │          (15 agendas = 15× this loop)            │            │
│         └──────────────────────────────────────────────────┘            │
│                                                                          │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  PROMPT 1: Context Cleaning                                       │  │
│  │  ─────────────────────────────────────────────────────────────    │  │
│  │  Input:  Full raw transcript chunk                                │  │
│  │        + Glossary (repeated)                                      │  │
│  │        + Committee rules (repeated)                               │  │
│  │        + Meeting rules (repeated)                                 │  │
│  │  Output: Cleaned transcript                                       │  │
│  │                                                                   │  │
│  │  → Save checkpoint to DB                                          │  │
│  │  → 1 API call │ ~3,000-8,000 tokens                              │  │
│  └───────────────────────────────────┬───────────────────────────────┘  │
│                                      │                                   │
│                                      ▼                                   │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  PROMPT 1.5: Transcript Refinement (Optional)                     │  │
│  │  ─────────────────────────────────────────────────────────────    │  │
│  │  Input:  Cleaned transcript (from P1)                             │  │
│  │        + Reference paper excerpts                                 │  │
│  │        + Glossary (repeated again)                                │  │
│  │        + Numeric verification rules                               │  │
│  │  Output: Refined transcript + verified numbers                    │  │
│  │                                                                   │  │
│  │  → Save checkpoint to DB                                          │  │
│  │  → 2-3 API calls │ ~5,000-12,000 tokens                          │  │
│  └───────────────────────────────────┬───────────────────────────────┘  │
│                                      │                                   │
│                                      ▼                                   │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  PROMPT 2: Cross-Reference Grounding                              │  │
│  │  ─────────────────────────────────────────────────────────────    │  │
│  │  Input:  Cleaned transcript (repeated full)                       │  │
│  │        + PDF/slide excerpts                                       │  │
│  │        + RAG context                                              │  │
│  │        + Glossary (repeated again)                                │  │
│  │        + Committee rules (repeated again)                         │  │
│  │  Output: Fact analysis + verified references                      │  │
│  │                                                                   │  │
│  │  → Save checkpoint to DB                                          │  │
│  │  → 1 API call │ ~5,000-15,000 tokens                             │  │
│  └───────────────────────────────────┬───────────────────────────────┘  │
│                                      │                                   │
│                                      ▼                                   │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  PROMPT 3a: Master Report Extraction                              │  │
│  │  ─────────────────────────────────────────────────────────────    │  │
│  │  Input:  Cleaned transcript (repeated full)                       │  │
│  │        + Cross-ref analysis (from P2)                             │  │
│  │        + All formatter rules                                      │  │
│  │        + Minute Mind entries                                      │  │
│  │        + Meeting rules (repeated again)                           │  │
│  │  Output: Structured JSON master report                            │  │
│  │                                                                   │  │
│  │  → Save checkpoint to DB                                          │  │
│  │  → 1 API call │ ~8,000-20,000 tokens                             │  │
│  └───────────────────────────────────┬───────────────────────────────┘  │
│                                      │                                   │
│                                      ▼                                   │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  PROMPT 3b: Playbook Variant Selection                            │  │
│  │  ─────────────────────────────────────────────────────────────    │  │
│  │  Input:  Transcript + analysis context                            │  │
│  │        + Playbook rules                                           │  │
│  │        + Available variants list                                  │  │
│  │  Output: Which template variant to use                            │  │
│  │                                                                   │  │
│  │  → 1 API call │ ~2,000-5,000 tokens                              │  │
│  └───────────────────────────────────┬───────────────────────────────┘  │
│                                      │                                   │
│                                      ▼                                   │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  PROMPT 3c: Template Extraction                                   │  │
│  │  ─────────────────────────────────────────────────────────────    │  │
│  │  Input:  Full context (everything above repeated)                 │  │
│  │        + Template skeleton                                        │  │
│  │        + Entry specifications                                     │  │
│  │        + Formatter memory                                         │  │
│  │  Output: Filled template with slots/lists                         │  │
│  │                                                                   │  │
│  │  → Save checkpoint to DB                                          │  │
│  │  → 1 API call │ ~10,000-25,000 tokens                            │  │
│  └───────────────────────────────────┬───────────────────────────────┘  │
│                                      │                                   │
│                                      ▼                                   │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  POST-PROCESSING                                                  │  │
│  │  ─────────────────────────────────────────────────────────────    │  │
│  │  • Extract action items (another AI call)                         │  │
│  │  • Save confidence markers to DB                                  │  │
│  │  • Save memory trace to DB                                        │  │
│  │  • Commit final minute to DB                                      │  │
│  │                                                                   │  │
│  │  → Save checkpoint to DB                                          │  │
│  │  → 1 API call │ ~2,000-5,000 tokens                              │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                          │
└ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘


╔═══════════════════════════════════════════════════════════════════════════╗
║                      CURRENT STATS (15 Agendas)                         ║
╠═══════════════════════════════════════════════════════════════════════════╣
║  API Calls:     90 - 120 calls per meeting                              ║
║  Tokens:        90,000 - 320,000 per meeting                            ║
║  DB Writes:     14 checkpoints × 15 agendas = 210 writes               ║
║  Time:          5 - 15 minutes per meeting                              ║
║  Files:         4,612 lines in one file + 6,000 lines supporting        ║
║  Cost (test):   ~RM50/day testing = RM150 in 3 days                     ║
╚═══════════════════════════════════════════════════════════════════════════╝


Why it breaks:

  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
  │  generate-   │◄───►│  mom-drafts  │────►│   minute-    │
  │  minutes.ts  │     │    .ts       │     │  template.ts │
  │  (4,612 ln)  │     │  (883 ln)    │     │  (1,502 ln)  │
  └──────┬───────┘     └──────────────┘     └──────┬───────┘
         │                                         │
         │  CIRCULAR!                              │
         ▼                                         ▼
  ┌──────────────┐                          ┌──────────────┐
  │  prompts.ts  │                          │ minute-mind  │
  │  (825 ln)    │                          │  (1,016 ln)  │
  └──────────────┘                          └──────────────┘

  Touch ANY of these 5 files → ripple effect everywhere
```

---

## ══════════════════════════════════════════════════════════════
## NEW WORKFLOW (Proposed) — Per Agenda
## ══════════════════════════════════════════════════════════════

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        USER UPLOADS DOCUMENT                            │
│                    (Word/PDF transcript file)                            │
└─────────────────────────────┬───────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                  STEP 1: PREP (One-time, shared)                         │
│  ─────────────────────────────────────────────────────────────────────  │
│                                                                          │
│  • Parse document → extract raw text                                    │
│  • Split by agenda (regex/keyword, NO AI needed)                        │
│  • Load committee rules + glossary + template (cache in memory)         │
│  • Load reference papers per agenda                                     │
│                                                                          │
│  → 0 API calls │ Pure code logic                                        │
│  → Shared context object built ONCE, reused for all agendas             │
└─────────────────────────────┬───────────────────────────────────────────┘
                              │
                              ▼
┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐
│         ┌──────────────────────────────────────────────────┐            │
│         │     🔁 FOR EACH AGENDA (can run in parallel!)    │            │
│         └──────────────────────────────────────────────────┘            │
│                                                                          │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  STEP 2: SINGLE PROMPT — Generate Minutes                         │  │
│  │  ─────────────────────────────────────────────────────────────    │  │
│  │                                                                   │  │
│  │  System:  Committee persona + format rules (from cache)           │  │
│  │                                                                   │  │
│  │  User:    "Here is the transcript for Agenda 3:                   │  │
│  │            [transcript chunk — only this agenda's portion]        │  │
│  │                                                                   │  │
│  │            Reference paper excerpts:                              │  │
│  │            [paper excerpts — only relevant sections]              │  │
│  │                                                                   │  │
│  │            Template to follow:                                    │  │
│  │            [template — the exact format to output]                │  │
│  │                                                                   │  │
│  │            Generate the minute in this exact format."             │  │
│  │                                                                   │  │
│  │  Output:  Structured minute (Noted / Discussed / Action Items)    │  │
│  │                                                                   │  │
│  │  → 1 API call │ ~5,000-15,000 tokens                             │  │
│  │  → generateObject() with Zod schema                              │  │
│  │  → No checkpoint needed (single call = atomic)                   │  │
│  └───────────────────────────────────┬───────────────────────────────┘  │
│                                      │                                   │
│                                      ▼                                   │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  STEP 3: SAVE                                                     │  │
│  │  ─────────────────────────────────────────────────────────────    │  │
│  │                                                                   │  │
│  │  • Save generated minute to DB                                    │  │
│  │  • Action items already extracted in Step 2 output schema         │  │
│  │                                                                   │  │
│  │  → 0 API calls │ 1 DB write                                      │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                          │
└ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                  STEP 4: POST (Optional, user-triggered)                 │
│  ─────────────────────────────────────────────────────────────────────  │
│                                                                          │
│  User reviews in editor → requests changes via chat                     │
│  "Tukar format bahagian ni" / "Add detail pasal LCR"                   │
│                                                                          │
│  → Only THEN use another AI call (on-demand, not upfront)               │
└─────────────────────────────────────────────────────────────────────────┘


╔═══════════════════════════════════════════════════════════════════════════╗
║                      NEW STATS (15 Agendas)                             ║
╠═══════════════════════════════════════════════════════════════════════════╣
║  API Calls:     15 calls per meeting (1 per agenda)                     ║
║  Tokens:        75,000 - 150,000 per meeting                            ║
║  DB Writes:     15 (1 per agenda, no checkpoints)                       ║
║  Time:          30 sec - 2 minutes (parallel execution)                 ║
║  Files:         ~300 lines total generation logic                       ║
║  Cost (test):   ~RM10-15/day testing                                    ║
╚═══════════════════════════════════════════════════════════════════════════╝
```

---

## ══════════════════════════════════════════════════════════════
## SIDE-BY-SIDE COMPARISON
## ══════════════════════════════════════════════════════════════

```
                    BEFORE                          AFTER
              ┌──────────────────┐           ┌──────────────────┐
              │                  │           │                  │
  Calls/mtg   │   90-120 calls   │           │    15 calls      │   ▼ 85%
              │                  │           │                  │
              ├──────────────────┤           ├──────────────────┤
              │                  │           │                  │
  Tokens/mtg  │  90K-320K tokens │           │   75K-150K       │   ▼ 55%
              │                  │           │                  │
              ├──────────────────┤           ├──────────────────┤
              │                  │           │                  │
  DB Writes   │   210 writes     │           │    15 writes     │   ▼ 93%
              │                  │           │                  │
              ├──────────────────┤           ├──────────────────┤
              │                  │           │                  │
  Time        │   5-15 min       │           │   30s - 2 min    │   ▼ 85%
              │                  │           │                  │
              ├──────────────────┤           ├──────────────────┤
              │                  │           │                  │
  Code        │  10,932 lines    │           │   ~300 lines     │   ▼ 97%
              │                  │           │                  │
              ├──────────────────┤           ├──────────────────┤
              │                  │           │                  │
  Cost/day    │   ~RM50/day      │           │   ~RM10-15/day   │   ▼ 70%
              │                  │           │                  │
              └──────────────────┘           └──────────────────┘
```

---

## ══════════════════════════════════════════════════════════════
## FILE STRUCTURE: BEFORE vs AFTER
## ══════════════════════════════════════════════════════════════

```
BEFORE (19 files, 10,932 lines)          AFTER (4 files, ~300 lines)
─────────────────────────────────         ──────────────────────────────
src/lib/meeting-generation/               src/lib/ai/
├── generate-minutes.ts    (4,612)        ├── generate-minute.ts    (~120)
├── minute-template.ts     (1,502)        │     One function:
├── minute-mind.ts         (1,016)        │     generateMinuteForAgenda()
├── agenda-segmentation.ts   (950)        │
├── mom-drafts.ts            (883)        ├── prompts.ts             (~80)
├── prompts.ts               (825)        │     buildSystemPrompt()
├── minute-playbooks.ts      (274)        │     buildUserPrompt()
├── source-policy.ts         (216)        │
├── transcript-intel.ts      (116)        └── schemas.ts             (~60)
├── resolved-outcome.ts       (?)              Zod output schema
├── ... 9 more files           (?)
│
├── TOTAL: 10,932 lines                  TOTAL: ~300 lines
└── Circular dependencies: YES           Circular dependencies: NO
```

---

## ══════════════════════════════════════════════════════════════
## WHY THE NEW WORKFLOW WORKS
## ══════════════════════════════════════════════════════════════

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│  KEY INSIGHT: Modern LLMs (Claude 4, Gemini 2.5) are smart enough      │
│  to do ALL of this in ONE call:                                          │
│                                                                          │
│    ✓ Clean messy transcript                                             │
│    ✓ Cross-reference with paper                                         │
│    ✓ Extract key decisions                                              │
│    ✓ Format into template                                               │
│    ✓ Identify action items                                              │
│                                                                          │
│  You DON'T need 6 separate prompts to "break down" the task.           │
│  That was 2023-era thinking when models were weaker.                    │
│                                                                          │
│  One well-structured prompt with:                                       │
│    • Clear system persona                                               │
│    • Transcript chunk (only this agenda)                                │
│    • Paper reference (only relevant pages)                              │
│    • Template format (exact output structure)                           │
│    • Zod schema (structured output guarantee)                           │
│                                                                          │
│  = Same quality, 85% less cost, 97% less code                          │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## ══════════════════════════════════════════════════════════════
## WHAT TO KILL vs WHAT TO KEEP
## ══════════════════════════════════════════════════════════════

```
  ❌ KILL (unnecessary complexity)        ✅ KEEP (actual value)
  ──────────────────────────────          ──────────────────────────
  ❌ 6-prompt chain                       ✅ Committee persona/rules
  ❌ Checkpoint system                    ✅ Template format structure
  ❌ Minute Mind (1,016 lines)            ✅ Glossary injection
  ❌ Playbook variant selection           ✅ Paper cross-reference
  ❌ Confidence markers                   ✅ Action item extraction
  ❌ Memory trace logging                 ✅ Zod structured output
  ❌ Transcript intelligence              ✅ Editor for manual tweaks
  ❌ Resolved outcome mode                ✅ Export to DOCX
  ❌ Source policy system                 ✅ Supabase RLS + auth
  ❌ mom_generation_drafts table          ✅ Version history
  ❌ 71 API routes                        ✅ Server actions (lean)
```
