# secretariat.my - Setup Guide & Recommendations

## VS Code Extensions (Install These)

| Extension | Why |
|-----------|-----|
| **Tailwind CSS IntelliSense** | Autocomplete for Tailwind classes |
| **ESLint** | Code quality enforcement |
| **Prettier** | Consistent formatting |
| **Supabase** | Database explorer & SQL support |
| **Error Lens** | Inline error highlighting |
| **Pretty TypeScript Errors** | Readable TS errors |
| **GitLens** | Git blame & history (useful for audit trail dev) |

## Auth Setup (Dev)

For local/dev signup testing with immediate access:

1. Go to Supabase Dashboard -> `Authentication` -> `Providers` -> `Email`
2. Set `Confirm email` to **OFF** (dev project only)
3. Keep `Enable signup` as **ON**

Expected behavior:
- `Sign Up` shows inline success/error instantly
- Successful signup auto-signs in and redirects to dashboard (`/`)

Common signup/login errors:
- `Email already exists`: use `Sign In` instead
- `Email not confirmed`: only happens when confirm email is still ON
- `Too many attempts`: wait a short while and retry (rate limit)

## Hydration Mismatch Troubleshooting

If you see a hydration warning with unexpected attributes like `fdprocessedid`, verify in an Incognito window first.

Why this matters:
- Some browser extensions inject DOM attributes before React hydrates.
- This creates server/client attribute mismatch warnings even when app code is correct.

Recommended check:
1. Reproduce in current browser profile (extensions enabled).
2. Re-test same route in Incognito (extensions disabled).
3. If warning disappears in Incognito, treat it as environment/extension noise, not an app SSR bug.

## Required Migrations (Before Testing New Features)

When pulling new features, apply the latest SQL migrations to the same Supabase project used in `.env.local`.

Minimum required tables for current setup flow:
- `public.committee_generation_settings` (from `20260227100000_committee_generation_settings.sql`)
- `public.itinerary_templates` (from `20260228000000_itinerary_templates.sql`)

If migration is missing, setup pages may fail or show fallback behavior only.

## MCP Servers (Configure in Claude Code)

### 1. Supabase MCP (Already Connected)
- **Purpose**: Direct SQL queries, schema inspection, RLS policy testing
- **Usage**: Query meeting data, test RLS policies, inspect schema during development

### 2. Filesystem MCP
- **Purpose**: File operations for processing uploads (Excel, DOCX, PDF)
- **Config**: Point to project directory
- **Note**: Useful during file processing pipeline development

### 3. Puppeteer/Browser MCP (Optional)
- **Purpose**: Visual testing of the dual-pane UI, screenshot comparisons
- **When**: During UI polish phase

## Custom Slash Commands (Skills Created)

| Command | Purpose |
|---------|---------|
| `/generate-schema` | Generate/update Supabase SQL migration from PSD requirements |
| `/setup-supabase` | Initialize local Supabase dev environment |
| `/test-prompts` | Test the 3-Prompt AI engine with sample banking data |
| `/audit-security` | Run bank-grade security audit checklist |
| `/build-page` | Scaffold a new page following project architecture |

## Built-in Slash Commands to Use Frequently

| Command | When to Use |
|---------|-------------|
| `/commit` | After completing each page/feature |
| `/review` | Before merging any PR |
| `/init` | If you need to reinitialize project config |

## NPM Packages Needed

### Core
```
next react react-dom
typescript @types/react @types/node
```

### Database & Auth
```
@supabase/supabase-js @supabase/ssr
```

### AI
```
ai @ai-sdk/anthropic @ai-sdk/openai
```

### UI
```
tailwindcss @tailwindcss/postcss
class-variance-authority clsx tailwind-merge
lucide-react
```
(+ shadcn/ui components installed via CLI)

### File Processing
```
xlsx                    # Excel agenda parsing
mammoth                 # DOCX transcript parsing
pdf-parse               # PDF slide extraction
```

### Export
```
docx                    # Generate Word documents
```

### Validation
```
zod                     # Schema validation
```

### State
```
zustand                 # Minimal global state (for transcript highlight state)
```

## Architecture Decision: Why These Choices

| Decision | Reason |
|----------|--------|
| **Supabase over custom backend** | Auth + DB + Storage + RLS in one. Saves ~500 lines of custom auth/middleware code |
| **Server Actions over API routes** | Fewer files, automatic type safety, built-in security |
| **shadcn/ui over custom components** | Pre-built, accessible, customizable. Not counted in line budget |
| **Zustand over Redux** | 5 lines to setup vs 50. Only need it for transcript highlight state |
| **Vercel AI SDK** | Built-in streaming, multi-provider support (Claude + OpenAI). 3 lines for a streaming chat |
| **Tailwind v4 over CSS modules** | Faster to write, consistent with shadcn/ui, zero CSS files |
