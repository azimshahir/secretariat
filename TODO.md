# secretariat.my - Project Todo List

> **Constraint**: Max ~1,000 lines custom code | Per-file max 150 lines
> **Legend**: `[ ]` Pending | `[~]` In Progress | `[x]` Done

---

## Phase 1: Foundation

### 1. Initialize Next.js 15 Project
- [x] Run `npx create-next-app@latest` (TypeScript, Tailwind v4, App Router, ESLint)
- [x] Configure `tsconfig.json` strict mode
- [x] Install core dependencies:
  - `@supabase/supabase-js @supabase/ssr`
  - `ai @ai-sdk/anthropic @ai-sdk/openai`
  - `xlsx mammoth pdf-parse docx`
  - `zustand zod lucide-react`
- [x] Setup shadcn/ui (`npx shadcn@latest init`)
- [x] Copy `.env.example` values into `.env.local`

### 2. Setup Supabase & Database Schema
> Blocked by: #1
- [x] Install Supabase CLI
- [x] Run `supabase init`
- [x] Write SQL migration for all tables (14 tables created)
- [x] Write RLS policies for multi-tenant isolation
- [x] Add indexes for common queries
- [x] Run migration on Supabase Cloud (success)
- [x] Generate TypeScript types (`src/lib/supabase/types.ts`)

### 3. Implement Authentication
> Blocked by: #2
- [x] Setup Supabase Auth (email/password)
- [x] Create `src/lib/supabase/client.ts` (browser client)
- [x] Create `src/lib/supabase/server.ts` (server client)
- [x] Create `src/lib/supabase/middleware.ts` (protect routes)
- [x] Build login page (`src/app/login/page.tsx`)
- [x] Setup cookie-based session with `@supabase/ssr`
- [x] Auth callback route (`src/app/auth/callback/route.ts`)
- [x] Server actions: login, signup, signout
- [x] Build passes clean

---

## Phase 2: Core Pages

### 4. Build Dashboard (Command Center)
> Blocked by: #3
- [x] Top navbar: user profile, organization/committee switcher
- [x] "New Meeting" CTA button
- [x] Meeting data table (shadcn DataTable):
  - Columns: Meeting Title, Date, Committee, Status
  - Status badges with smart routing per status
- [x] Server-side data fetching from Supabase
- [x] Committee filter via URL param
- [x] Empty state for no meetings

### 5. Build Meeting Setup & Ingestion (Dropzone)
> Blocked by: #4
- [x] Step 1: Drag-drop zone for Excel agenda template (with parsing)
- [x] Step 2: Dropzone for Teams transcript (.docx/.vtt/.txt)
- [x] Step 3: Dropzone for slide deck PDF
- [x] Upload files to Supabase Storage
- [x] Parse Excel -> create agenda items in DB (with badge preview)
- [x] "Proceed to Mapping" navigation button
- [x] New Meeting creation page (`/meeting/new`)
- [x] Reusable Dropzone component with drag-drop, loading, success states
- [x] Audit log on meeting create + agenda upload

### 6. Build Semantic Mapper (Highlight & Assign)
> Blocked by: #5, #13
- [x] Left pane: Full transcript (scrollable, highlightable, speaker names)
- [x] Right pane: Agenda cards with assigned chunk count badges
- [x] Highlight text -> floating "Assign to Agenda" dropdown -> route to card
- [x] Remove assigned chunks (trash icon on hover)
- [x] Split/Merge text block functionality (future polish)
- [x] Speaker mapping popup (future polish)
- [x] "Generate Minutes" button -> updates status + routes to editor
- [x] Server actions: assignSegment, removeSegment, updateMeetingToGenerating
- [x] Optimistic UI updates for instant feedback

---

## Phase 3: AI Engine

### 7. Implement 3-Prompt Execution Engine
> Blocked by: #2
- [x] Create `src/lib/ai/prompts.ts`:
  - Prompt 1 (Context Cleaning): Clean transcript + extract key points
  - Prompt 2 (Cross-Reference): Analyze linked slide PDF for agenda
  - Prompt 3 (Synthesis): Generate Noted / Discussed / Action Items
- [x] Create `src/lib/ai/personas.ts`: ALCO, MRC, Board persona templates
- [x] Inject committee persona as system prompt prefix
- [x] Flag low-confidence items via [[VERIFY: ...]] markers -> confidence_data
- [x] Streaming chat API route (`/api/chat`) for dual-chatbot
- [x] Format prompt inheritance from format_templates
- [x] Auto-extract action items (PIC + due date) via AI
- [x] Version history: saves old minute before regeneration
- [x] `generateAllMinutes()` — sequential per-agenda pipeline
- [x] Audit logging on every generation

### 8. Build Agentic Editor (Core Workspace)
> Blocked by: #7, #6
- [x] Top bar: Format Prompt dropdown (rolling context)
- [x] Left pane: Rich-text editor with AI-generated minutes
  - Sections: Noted, Discussed, Action Items
  - Manually editable by CoSec
  - Low-confidence yellow highlighting
- [x] Right pane: Dual-Chatbot component (see #9)
- [x] Streaming word-by-word generation
- [x] Previous / Next Agenda navigation buttons

### 9. Build Dual-Chatbot Component
> Blocked by: #7
- [x] Tab 1 - Chatbot ASK:
  - RAG query on transcript + slides
  - E.g., "What was the exact LCR percentage mentioned?"
  - [x] Uses Vercel AI SDK `useChat`
- [x] Tab 2 - Chatbot CHANGE:
  - Agentic targeted editing
  - User selects text on left pane -> types command
  - E.g., "Change to passive voice", "Summarize this section"
  - AI updates ONLY the targeted section (no full regeneration)
  - [x] Uses Vercel AI SDK `useChat` with streaming

---

## Phase 4: Export & Settings

### 10. Build Export & Finalization
> Blocked by: #8
- [x] Full document preview (all agendas compiled)
- [x] Auto-generated Action Item Summary table:
  - Columns: No. Agenda | Tugasan | PIC (Person In Charge)
- [x] Export as Word (.docx) using `docx` library
- [x] Export as PDF
- [x] "Finalize" button -> mark meeting status, start purge timer

### 11. Build Committee Settings & Persona Management
> Blocked by: #3
- [x] Committee Profile Builder:
  - Create profiles (ALCO, MRC, Board of Directors)
  - System Persona textbox (ALM jargon, LCR/NSFR context)
- [x] Format Prompt Library:
  - Save/name structural prompt templates
  - E.g., "Standard Approval Paper Format" (with Proposer & Seconder)
- [x] Glossary & Jargon Manager:
  - Table: Acronym | Full Meaning
  - AI references globally for zero spelling errors

### 12. Build Compliance & Audit Trail
> Blocked by: #3
- [x] Immutable Activity Log:
  - Chronological table of every critical action
  - Who uploaded, when AI triggered, who finalized
  - Section 49 Companies Act 2016 compliance
- [x] Version Control History:
  - Save previous versions when finalized minutes are re-edited
  - Diff view between versions for auditors/CRO

---

## Phase 5: Infrastructure & Processing

### 13. Implement File Processing Pipeline
> Blocked by: #2
- [x] Excel parsing (`xlsx`): Extract Agenda No., Title, Presenter
- [x] DOCX parsing (`mammoth`): Extract Teams transcript + speaker labels
- [x] PDF parsing (`pdf-parse`): Extract slide content per page
- [x] Audio/video -> Whisper API: Transcription + speaker diarization
- [x] All processing via server actions
- [x] Raw files purged from temp storage after processing

### 14. Implement Auto-Purge Mechanism
> Blocked by: #13
- [x] Ephemeral processing: delete raw audio/video immediately after Whisper STT
- [x] Supabase cron job (pg_cron): delete transcripts + slides 30 days after finalized
- [x] Only final minutes + audit logs remain permanently
- [x] Logging of purge events to audit trail

---

## Phase 6: Hardening & Polish

### 15. Security Hardening & RLS Testing
> Blocked by: #14, #12
- [x] Verify RLS policies on ALL tables (multi-tenant isolation)
- [x] Confirm no API keys in client-side code
- [x] File uploads use signed URLs (1-hour expiry)
- [x] No sensitive data in localStorage
- [x] All AI calls through server actions only
- [x] Input validation with zod on all forms/endpoints
- [x] Run `/audit-security` skill for full checklist (implemented as local custom skill)

### 16. UI Polish & Enterprise Aesthetics
> Blocked by: #10, #11
- [x] Professional color scheme (bank-grade, not flashy)
- [x] Loading states with streaming text animation
- [x] Low-confidence yellow highlighting on AI content
- [x] Responsive dual-pane layouts
- [x] Proper empty states for all pages
- [x] Toast notifications for async operations
- [x] Keyboard shortcuts for power users

---

## Dependency Flow

```
#1 Init Project
 └─> #2 Supabase Schema
      ├─> #3 Auth
      │    ├─> #4 Dashboard
      │    │    └─> #5 Dropzone ──────────┐
      │    ├─> #11 Settings ──────────────┤
      │    └─> #12 Audit Trail            │
      ├─> #7 AI Engine                    │
      │    ├─> #9 Dual Chatbot           │
      │    └──────────────────┐           │
      └─> #13 File Processing │           │
           ├─> #14 Auto-Purge │           │
           └─────────┐        │           │
                     #6 Semantic Mapper <─┘
                      │        │
                      └─> #8 Agentic Editor
                           └─> #10 Export
                                │     │
      #15 Security <── #14,#12  │     │
      #16 UI Polish <── #10, #11
```

---

## Quick Reference

| Phase | Tasks | Focus |
|-------|-------|-------|
| Foundation | #1-#3 | Project setup, DB, auth |
| Core Pages | #4-#6 | Dashboard, upload, mapping |
| AI Engine | #7-#9 | Prompts, editor, chatbot |
| Export & Settings | #10-#12 | Export, config, audit |
| Infrastructure | #13-#14 | File processing, purge |
| Hardening | #15-#16 | Security, polish |
