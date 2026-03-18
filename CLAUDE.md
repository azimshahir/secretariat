# secretariat.my - Project Intelligence File

## Project Overview
**secretariat.my** is an "Agentic Doer" platform that automates board/committee meeting minutes for enterprise banks, GLICs, and public listed companies. It replaces manual minute-taking with AI-driven, agenda-specific minute generation.

Target users: Company Secretaries (CoSec) and Legal & Compliance Operations (LCO).

## Tech Stack
- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript (strict mode)
- **Database & Auth**: Supabase (PostgreSQL + Auth + Storage + RLS)
- **AI Engine**: Vercel AI SDK (`ai` package)
- **Core LLM**: Anthropic Claude (primary), OpenAI (fallback/BYO-Model ready)
- **Speech-to-Text**: OpenAI Whisper API
- **UI Components**: shadcn/ui + Tailwind CSS v4
- **File Processing**: `xlsx` (Excel parsing), `mammoth` (DOCX parsing), `pdf-parse` (PDF extraction)
- **Export**: `docx` (generate Word docs), `@react-pdf/renderer` (PDF export)
- **State Management**: Zustand (minimal global state)
- **Deployment**: Vercel (frontend) + Supabase (backend)

## Architecture Principles

### Code Budget: Max ~1,000 Lines of Custom Code
This project MUST stay lean. Every line of custom code must earn its place.
- **Per-file limit**: No file should exceed 150 lines. Split if approaching.
- **Leverage frameworks**: Use Supabase RLS instead of custom auth middleware. Use shadcn/ui instead of custom components. Use Vercel AI SDK hooks instead of custom streaming logic.
- **No premature abstraction**: Write direct code. Only abstract after 3+ duplications.
- **Use server actions**: Prefer Next.js Server Actions over separate API route files.

### File Structure
```
src/
  app/
    layout.tsx              # Root layout with auth provider
    page.tsx                # Dashboard (Command Center)
    meeting/
      new/page.tsx          # Meeting Setup & Ingestion (Dropzone)
      [id]/
        map/page.tsx        # Semantic Mapper (Highlight & Assign)
        editor/page.tsx     # Agentic Editor (Core Workspace)
        export/page.tsx     # Export & Finalization
    settings/page.tsx       # Committee Settings & Persona Management
    audit/page.tsx          # Compliance & Audit Trail
    login/page.tsx          # Auth page
  components/
    ui/                     # shadcn/ui components (auto-generated, excluded from line count)
    transcript-viewer.tsx   # Transcript display with highlight support
    agenda-cards.tsx        # Agenda block cards
    dual-chatbot.tsx        # Ask + Change chatbot tabs
    minute-editor.tsx       # Rich text minute editor
  lib/
    supabase/
      client.ts             # Supabase browser client
      server.ts             # Supabase server client
      middleware.ts          # Auth middleware
    ai/
      prompts.ts            # 3-Prompt engine (Context Clean, Cross-Ref, Synthesis)
      personas.ts           # Committee persona templates
    utils.ts                # Shared utilities
  actions/
    meeting.ts              # Server actions for meeting CRUD
    ai-generate.ts          # Server actions for AI generation
    file-upload.ts          # Server actions for file processing
```

### Database Schema (Supabase)
Key tables:
- `organizations` - Bank/company profiles
- `users` - CoSec users (linked to Supabase Auth)
- `committees` - ALCO, MRC, Board profiles with persona prompts
- `meetings` - Meeting records with status tracking
- `agendas` - Agenda items per meeting
- `transcripts` - Raw transcript storage (auto-purge after 30 days)
- `transcript_segments` - Mapped transcript chunks to agendas
- `minutes` - AI-generated minutes per agenda
- `minute_versions` - Version history for audit trail
- `action_items` - Extracted action items
- `audit_logs` - Immutable activity log
- `format_templates` - Saved format prompts
- `glossary` - Custom acronyms/jargon per committee

### Security Requirements (Bank-Grade)
- ALL database access via Supabase RLS policies - no exceptions
- Zero data in client-side localStorage for sensitive content
- File uploads go to Supabase Storage with signed URLs (expiry: 1 hour)
- Raw media files MUST be purged after transcription completes
- Auto-purge transcripts & slides 30 days after meeting finalized
- API keys NEVER in client-side code
- All AI calls through server actions only

### AI Engine Rules
- The 3-Prompt engine runs PER AGENDA, not per meeting
- Prompt 1 (Context Cleaning): Clean transcript + extract key points
- Prompt 2 (Cross-Reference): Analyze linked slides for that agenda
- Prompt 3 (Synthesis): Generate Noted/Discussed/Action Items format
- Low-confidence items (names, figures) must be flagged with confidence scores
- Streaming responses via Vercel AI SDK `useChat` hook
- Committee persona injected as system prompt prefix

### Coding Standards
- Use `"use server"` directives for all server actions
- Use `"use client"` only when absolutely necessary (interactive components)
- Prefer Server Components by default
- All database queries use Supabase client with proper typing
- Error boundaries on every page
- Malay + English comments acceptable (team is Malaysian)
- Use `zod` for all form validation and API input validation

### Git Workflow
- Branch naming: `feature/page-name` or `fix/description`
- Commit messages in English, imperative mood
- Never commit `.env.local` or any secrets

### Testing Approach
- Focus on integration tests for AI prompt chains
- Use Supabase local dev (`supabase start`) for DB testing
- Manual QA for UI interactions (highlight, drag-drop)

## Key Domain Terms
- **CoSec**: Company Secretary
- **LCO**: Legal & Compliance Operations
- **ALCO**: Asset Liability Committee
- **MRC**: Management Risk Committee
- **LCR**: Liquidity Coverage Ratio
- **NSFR**: Net Stable Funding Ratio
- **OPR**: Overnight Policy Rate
- **PIC**: Person In Charge
- **BYO-Model**: Bring Your Own Model (private LLM hosting)
- **BYOS**: Bring Your Own Storage
- **RLS**: Row Level Security (Supabase)
