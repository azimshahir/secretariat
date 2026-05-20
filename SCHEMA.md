# Secretariat.my — Simplified Database Schema

## Overview

Changes needed to support new architecture:
1. Remove Google/Gemini references from CHECK constraints
2. Simplify checkpoint system (drop intermediate columns)
3. Update subscription tiers
4. No tables deleted — just columns dropped and constraints updated

---

## Tables: What Changes

### ✅ NO CHANGES NEEDED

```
  organizations          — untouched
  users / profiles       — untouched
  committees             — untouched
  meetings               — untouched
  agendas                — untouched
  transcripts            — untouched
  transcript_segments    — untouched
  minutes                — untouched (content column still stores final output)
  minute_versions        — untouched
  action_items           — untouched
  audit_logs             — untouched
  format_templates       — untouched
  glossary               — untouched
  minute_playbooks       — untouched
  minute_playbook_variants — untouched
  minute_mind_entries    — untouched
```

### 🟡 MODIFY

#### 1. `organization_ai_settings`

**Current**: Per-task provider/model columns for 4 AI tasks
```sql
  generate_mom_provider         -- 'anthropic' | 'openai' | 'google'
  generate_mom_model            -- model ID
  go_deeper_ask_provider        -- same
  go_deeper_ask_model           -- same
  go_deeper_agent_provider      -- same
  go_deeper_agent_model         -- same
  generate_itineraries_provider -- same
  generate_itineraries_model    -- same
```

**New**: Can simplify but SAFE approach is just update CHECK constraint
```sql
-- Migration: Remove 'google' from provider CHECK constraints
ALTER TABLE organization_ai_settings
  DROP CONSTRAINT IF EXISTS organization_ai_settings_generate_mom_provider_check;
ALTER TABLE organization_ai_settings
  ADD CONSTRAINT organization_ai_settings_generate_mom_provider_check
  CHECK (generate_mom_provider IN ('anthropic', 'openai'));

-- Repeat for other provider columns...

-- Update any rows currently using 'google' to 'anthropic'
UPDATE organization_ai_settings
  SET generate_mom_provider = 'anthropic',
      generate_mom_model = 'claude-sonnet-4-20250514'
  WHERE generate_mom_provider = 'google';
-- Repeat for other task columns...
```

#### 2. `organization_ai_plan_settings`

**Current**: Per plan tier, per task model overrides
**Change**: Same as above — remove 'google' from CHECK, migrate existing rows

```sql
-- Update any rows using Google models
UPDATE organization_ai_plan_settings
  SET provider = 'anthropic',
      model = 'claude-sonnet-4-20250514'
  WHERE provider = 'google';
```

#### 3. `mom_generation_drafts`

**Current columns that become unused**:
```sql
  prompt_1_output       TEXT     -- intermediate Prompt 1 result
  prompt_2_output       TEXT     -- intermediate Prompt 2 result
  summary_paper         TEXT     -- intermediate canonical report part
  summary_discussion    TEXT     -- intermediate canonical report part
  summary_heated        TEXT     -- intermediate canonical report part
  last_completed_stage  TEXT     -- 'prompt1' | 'prompt2' | 'summary' | 'final'
  last_error_stage      TEXT     -- which stage failed
  applied_memory_trace  JSONB   -- memory trace logging
```

**Safe approach**: Don't DROP columns yet (might break old data). Just stop writing to them.

**Future migration** (after v2 stable for 2 weeks):
```sql
ALTER TABLE mom_generation_drafts
  DROP COLUMN IF EXISTS prompt_1_output,
  DROP COLUMN IF EXISTS prompt_2_output,
  DROP COLUMN IF EXISTS summary_paper,
  DROP COLUMN IF EXISTS summary_discussion,
  DROP COLUMN IF EXISTS summary_heated,
  DROP COLUMN IF EXISTS last_error_stage,
  DROP COLUMN IF EXISTS applied_memory_trace;

-- Simplify stage to just status
-- last_completed_stage is redundant with status column
ALTER TABLE mom_generation_drafts
  DROP COLUMN IF EXISTS last_completed_stage;
```

#### 4. `minutes` table

**Current**: Has `applied_memory_trace JSONB` column
**Change**: Stop writing to it. Don't drop yet (backward compat).

---

## New Migration File

```sql
-- Migration: 20260520_simplify_ai_architecture.sql
-- Purpose: Remove Google provider, simplify for single-model architecture

-- ============================================
-- 1. Update organization_ai_settings
-- ============================================

-- Migrate Google rows to Anthropic
UPDATE organization_ai_settings
  SET generate_mom_provider = 'anthropic',
      generate_mom_model = 'claude-sonnet-4-20250514'
  WHERE generate_mom_provider = 'google';

UPDATE organization_ai_settings
  SET go_deeper_ask_provider = 'anthropic',
      go_deeper_ask_model = 'claude-sonnet-4-20250514'
  WHERE go_deeper_ask_provider = 'google';

UPDATE organization_ai_settings
  SET go_deeper_agent_provider = 'anthropic',
      go_deeper_agent_model = 'claude-sonnet-4-20250514'
  WHERE go_deeper_agent_provider = 'google';

UPDATE organization_ai_settings
  SET generate_itineraries_provider = 'anthropic',
      generate_itineraries_model = 'claude-sonnet-4-20250514'
  WHERE generate_itineraries_provider = 'google';

-- ============================================
-- 2. Update organization_ai_plan_settings
-- ============================================

UPDATE organization_ai_plan_settings
  SET provider = 'anthropic',
      model = 'claude-sonnet-4-20250514'
  WHERE provider = 'google';

-- ============================================
-- 3. No column drops yet (safe migration)
-- We stop WRITING to these columns in code,
-- but don't DROP them until v2 is stable.
-- ============================================

-- Columns to stop writing to (code change, not DB):
-- mom_generation_drafts.prompt_1_output
-- mom_generation_drafts.prompt_2_output
-- mom_generation_drafts.summary_paper
-- mom_generation_drafts.summary_discussion
-- mom_generation_drafts.summary_heated
-- mom_generation_drafts.last_completed_stage
-- mom_generation_drafts.last_error_stage
-- mom_generation_drafts.applied_memory_trace
-- minutes.applied_memory_trace
```

---

## Subscription Tiers — New Schema

### Current (`subscription/catalog.ts`)

```
  free:    RM 0    — 4 models allowed, credit-based
  basic:   RM 29   — 5 models allowed, credit-based
  pro:     RM 39   — 7 models allowed, credit-based
  premium: RM 99   — all models, credit-based
```

### New

```
  free:    RM 0    — 2 meetings/month, 1 committee
  pro:     RM 79   — 15 meetings/month, 3 committees
  unlimited: RM 149 — unlimited meetings, unlimited committees
```

### Schema Changes

```typescript
// New subscription/catalog.ts structure

export type SubscriptionTier = 'free' | 'pro' | 'unlimited';

export interface SubscriptionPlanDefinition {
  tier: SubscriptionTier;
  label: string;
  priceRmMonthly: number;
  meetingsPerMonth: number | null;  // null = unlimited
  committeesAllowed: number | null; // null = unlimited
  supportsAudioUpload: boolean;
  supportLabel: string;
  cardHighlights: string[];
}

export const SUBSCRIPTION_PLANS: Record<SubscriptionTier, SubscriptionPlanDefinition> = {
  free: {
    tier: 'free',
    label: 'Free',
    priceRmMonthly: 0,
    meetingsPerMonth: 2,
    committeesAllowed: 1,
    supportsAudioUpload: false,
    supportLabel: 'Community',
    cardHighlights: [
      '2 meetings/month',
      '1 committee',
      'Word transcript upload',
      'Export to DOCX',
    ],
  },
  pro: {
    tier: 'pro',
    label: 'Pro',
    priceRmMonthly: 79,
    meetingsPerMonth: 15,
    committeesAllowed: 3,
    supportsAudioUpload: true,
    supportLabel: 'Email support',
    cardHighlights: [
      '15 meetings/month',
      '3 committees',
      'Word + audio upload',
      'Custom committee templates',
      'Export DOCX + PDF',
    ],
  },
  unlimited: {
    tier: 'unlimited',
    label: 'Unlimited',
    priceRmMonthly: 149,
    meetingsPerMonth: null,
    committeesAllowed: null,
    supportsAudioUpload: true,
    supportLabel: 'Priority support',
    cardHighlights: [
      'Unlimited meetings',
      'Unlimited committees',
      'All features',
      'Priority generation queue',
    ],
  },
};
```

### What's REMOVED from subscription logic
- `allowedModelIds` — no model selection, everyone uses Claude Sonnet 4
- `includedCredits` — replaced by meetings/month count
- `bestFitCreditsPerRun` — no credit system
- `transcriptReviewJobs` — simplified
- `extractMinuteMonthlyLimit` — replaced by meetingsPerMonth
- Top-up packs — removed (meetings/month is the limit)

### Database migration for subscriptions
```sql
-- No schema change needed for profiles table
-- The tier column already stores 'free'|'basic'|'pro'|'premium'
-- We just need to handle the tier rename in code:
--   'basic' → mapped to 'free' (grandfathered)
--   'premium' → mapped to 'unlimited' (grandfathered)
-- 
-- OR add a migration to rename:
UPDATE profiles SET plan_tier = 'pro' WHERE plan_tier = 'basic';
UPDATE profiles SET plan_tier = 'pro' WHERE plan_tier = 'pro';
UPDATE profiles SET plan_tier = 'unlimited' WHERE plan_tier = 'premium';
```

---

## Tables Summary

```
  ┌─────────────────────────────────┬──────────────┬────────────────────┐
  │ Table                           │ Action       │ Details            │
  ├─────────────────────────────────┼──────────────┼────────────────────┤
  │ organizations                   │ No change    │                    │
  │ users / profiles                │ Tier rename  │ basic→free etc     │
  │ committees                      │ No change    │                    │
  │ meetings                        │ No change    │                    │
  │ agendas                         │ No change    │                    │
  │ transcripts                     │ No change    │                    │
  │ transcript_segments             │ No change    │                    │
  │ minutes                         │ Stop writing │ applied_memory_    │
  │                                 │ to 1 column  │ trace              │
  │ minute_versions                 │ No change    │                    │
  │ action_items                    │ No change    │                    │
  │ audit_logs                      │ No change    │                    │
  │ format_templates                │ No change    │                    │
  │ glossary                        │ No change    │                    │
  │ minute_playbooks                │ No change    │                    │
  │ minute_playbook_variants        │ No change    │                    │
  │ minute_mind_entries             │ No change    │                    │
  │ organization_ai_settings        │ Migrate rows │ google→anthropic   │
  │ organization_ai_plan_settings   │ Migrate rows │ google→anthropic   │
  │ mom_generation_drafts           │ Stop writing │ 8 columns unused   │
  │ mom_generation_batches          │ No change    │                    │
  │ user_subscription_usage_monthly │ Review       │ Credit logic       │
  │ user_credit_ledger              │ Review       │ May simplify       │
  └─────────────────────────────────┴──────────────┴────────────────────┘

  Migration risk: LOW
  - No tables dropped
  - No columns dropped (yet)
  - Only data updates (google → anthropic)
  - Code changes stop writing to unused columns
  - Column drops happen in Phase 6 after v2 is stable
```
