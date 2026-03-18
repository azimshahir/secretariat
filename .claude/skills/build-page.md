# /build-page

Scaffold a new page following the project's architecture and coding standards.

## Instructions
1. Ask which page to build (Dashboard, Meeting Setup, Semantic Mapper, Agentic Editor, Export, Settings, Audit)
2. Read CLAUDE.md for file structure and coding standards
3. Read PSD.md for the specific page requirements
4. Generate the page with:
   - Server Component by default, "use client" only if interactive
   - Supabase data fetching via server client
   - shadcn/ui components for UI elements
   - Proper TypeScript types
   - Error boundary
5. Keep the file under 150 lines
6. Use Tailwind CSS for styling, enterprise-grade aesthetics
7. Use the `frontend-design` skill for UI-heavy components if needed
