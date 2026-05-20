# Secretariat.my — Execution Plan (Architecture Simplification)

## Goal
Collapse 6-8 prompt chain into 1 prompt per agenda, remove Gemini SDK, standardize on Claude Sonnet 4.

## Phases

---

## Phase 0: Preparation (Before touching any code)
**Time: 30 min | Risk: None**

- [ ] Backup current `.env.local`
- [ ] Create new branch: `feature/architecture-v2`
- [ ] Verify Supabase local dev is running (`supabase start`)
- [ ] Run existing app to confirm current state works
- [ ] Screenshot current /admin page for reference

---

## Phase 1: Remove Gemini SDK + Simplify Model Config
**Time: 1-2 hours | Risk: Low (removing, not rewriting)**

### Step 1.1: Remove @ai-sdk/google
```
npm uninstall @ai-sdk/google
```

### Step 1.2: Clean catalog.ts
- Remove `'google'` from `AiProvider` type
- Remove all Gemini models from `AI_PROVIDER_MODELS`
- Remove `'Google Gemini'` from `AI_PROVIDER_LABELS`
- Remove Gemini entries from `AI_MODEL_LABELS`
- Remove gemini check from `inferProviderFromModel()`

### Step 1.3: Clean model-config.ts
- Remove `import { google } from '@ai-sdk/google'`
- Remove `GOOGLE_GENERATIVE_AI_API_KEY` assertion from `assertProviderKey()`
- Remove `google()` call from `resolveModelById()`
- Hardcode default to `claude-sonnet-4-20250514`

### Step 1.4: Clean subscription/catalog.ts
- Remove all Gemini model IDs from `allowedModelIds` in every tier
- Update pricing tiers (see SCHEMA.md for new tier design)
- Update `cardHighlights` copy

### Step 1.5: Clean .env.example
- Remove `GOOGLE_GENERATIVE_AI_API_KEY`
- Update `AI_MODEL` default to `claude-sonnet-4-20250514`

### Step 1.6: Clean API routes
- `src/app/api/chat/route.ts` — remove `import { google }`, remove `google.tools.googleSearch()`

### Step 1.7: Test
- Run `npm run build` — fix any TypeScript errors
- Verify /admin page loads
- Verify chat still works (should fall back to Claude)

---

## Phase 2: Simplify Admin UI
**Time: 1-2 hours | Risk: Low**

### Step 2.1: Remove AI Model Matrix
- `src/app/admin/ai-model-settings.tsx` — replace "Plan AI Model Matrix" with simple display:
  ```
  AI Model: Claude Sonnet 4 (locked)
  Status: Active ✓
  ```
- Or delete entire component if not needed

### Step 2.2: Clean admin page
- `src/app/admin/page.tsx` — remove `aiConfigs`, `aiOptions` props
- `src/app/admin/admin-tabs.tsx` — simplify AI Model tab or remove
- `src/app/admin/actions.ts` — remove `updateOrganizationAiModels()` if no longer needed

### Step 2.3: Remove admin AI models API route
- Delete `src/app/api/admin/ai-models/route.ts`

### Step 2.4: Clean dual-chatbot.tsx
- Remove model selector dropdown
- Lock to Claude Sonnet 4

### Step 2.5: Test
- Verify /admin page works with simplified UI
- Verify chat works without model selector

---

## Phase 3: Design & Build New Single Prompt
**Time: 2-3 hours | Risk: Medium (core logic)**

> See PROMPT-DESIGN.md for full prompt specification

### Step 3.1: Create new prompt builder
- Create `src/lib/ai/generate-minute-prompt.ts` (~120 lines)
- Single function: `buildMinuteGenerationPrompt(params)`
- Returns `{ system: string, user: string }`

### Step 3.2: Create Zod output schema
- Create `src/lib/ai/minute-output-schema.ts` (~60 lines)
- Single schema for structured output: noted[], discussed[], resolved[], actionItems[]
- Schema matches template structure

### Step 3.3: Test prompt in isolation
- Create a test script that:
  1. Loads a real agenda's transcript from DB
  2. Calls Claude Sonnet 4 with new prompt
  3. Validates output against Zod schema
  4. Compare quality with old 6-prompt output
- Run 3-5 agendas to verify quality

---

## Phase 4: Rewrite Generation Orchestrator
**Time: 3-4 hours | Risk: High (core rewrite)**

### Step 4.1: Create new generation function
- Create `src/lib/meeting-generation/generate-minute-v2.ts` (~150 lines)
- Single function: `generateMinuteForAgenda(params)`
- Flow:
  ```
  Load context (transcript, rules, template, references)
       ↓
  Build prompt (system + user)
       ↓
  Call generateObject() with Zod schema — 1 API call
       ↓
  Post-process (apply template, extract action items)
       ↓
  Save to DB (1 write)
  ```

### Step 4.2: Create new batch generation
- `generateAllMinutes(params)` — runs all agendas in parallel using `Promise.all()`
- Add concurrency limit (max 5 parallel) to avoid rate limits

### Step 4.3: Wire up to existing API routes
- `src/app/api/meeting/[id]/agenda-generate/route.ts` — point to new function
- `src/app/api/meeting/[id]/mom-drafts/batch/route.ts` — point to new batch function

### Step 4.4: Test with real meeting data
- Generate minutes for a full meeting (10+ agendas)
- Compare output quality with old system
- Measure token usage and timing
- Verify action items extracted correctly

---

## Phase 5: Simplify Checkpoint System
**Time: 1-2 hours | Risk: Low**

### Step 5.1: Simplify mom-drafts.ts
- Remove 4-stage checkpoint (`prompt1/prompt2/summary/final`)
- Replace with simple status: `pending/running/done/failed`
- Remove `prompt_1_output`, `prompt_2_output` from checkpoint payload

### Step 5.2: Simplify types.ts
- Remove `MomDraftCompletedStage` type
- Simplify `MomDraftCheckpointPayload` — remove intermediate outputs
- Simplify `GenerateMinuteDraftPayload` — remove prompt1Output, prompt2Output

### Step 5.3: Database migration
- See SCHEMA.md for migration details
- Drop unused columns from `mom_generation_drafts`
- Remove 'google' from CHECK constraints

---

## Phase 6: Cleanup Dead Code
**Time: 1-2 hours | Risk: Low**

### Step 6.1: Mark old files as deprecated (don't delete yet)
- `src/lib/ai/prompts.ts` — old multi-prompt builders
- `src/lib/meeting-generation/generate-minutes.ts` — old orchestrator
- Add `@deprecated` JSDoc comments + `// TODO: Remove after v2 is stable`

### Step 6.2: Remove unused files (after v2 is verified stable)
- `src/lib/meeting-generation/minute-mind.ts` (if Mind rules folded into single prompt)
- `src/lib/meeting-generation/source-policy.ts`
- `src/lib/meeting-generation/transcript-intelligence.ts` (if not using Whisper refinement)
- `src/lib/ai/ask-chat-model.ts` (if model selector removed)

### Step 6.3: Verify line counts
- Target: no file > 150 lines
- Target: total generation logic < 500 lines

---

## Phase 7: Update Pricing & Subscription
**Time: 1 hour | Risk: Low**

### Step 7.1: Update subscription/catalog.ts
- New tiers: Free (RM0), Pro (RM79), Unlimited (RM149)
- Remove model allowlists (single model, no selection)
- Update limits (meetings/month instead of credits)

### Step 7.2: Update pricing page
- Reflect new tiers
- Update copy to match per-user individual model

### Step 7.3: Database migration for subscription changes
- Update any subscription-related tables
- Migrate existing user data if needed

---

## Phase 8: Final Verification
**Time: 2-3 hours | Risk: None**

- [ ] Full meeting generation test (10+ agendas)
- [ ] Token usage measurement (should be ~75K-150K per meeting)
- [ ] Cost calculation verification (should be ~RM2-5 per meeting)
- [ ] All pages load without errors
- [ ] Export to DOCX works
- [ ] Audit trail still records correctly
- [ ] No TypeScript errors (`npm run build`)
- [ ] No console errors in browser

---

## Timeline Summary

```
  Phase 0: Preparation                     30 min
  Phase 1: Remove Gemini + Clean Config    1-2 hours
  Phase 2: Simplify Admin UI              1-2 hours
  Phase 3: Design New Prompt              2-3 hours    ← Most important
  Phase 4: Rewrite Orchestrator           3-4 hours    ← Most risky
  Phase 5: Simplify Checkpoints           1-2 hours
  Phase 6: Cleanup Dead Code              1-2 hours
  Phase 7: Update Pricing                 1 hour
  Phase 8: Final Verification             2-3 hours
  ──────────────────────────────────────────────────
  Total:                                  ~13-19 hours
  Realistic:                              2-3 days
```

## Dependency Order

```
  Phase 0 → Phase 1 → Phase 2 (can parallel)
                 ↓
            Phase 3 → Phase 4 → Phase 5
                                   ↓
                              Phase 6 → Phase 7 → Phase 8
```

Phase 1+2 can run in parallel (independent changes).
Phase 3 MUST complete before Phase 4 (prompt drives orchestrator).
Phase 6+7 can run in parallel after Phase 5.
