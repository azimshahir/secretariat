# /generate-schema

Generate or update the Supabase database schema SQL migration file based on the current PSD.md requirements.

## Instructions
1. Read PSD.md and CLAUDE.md for the full data model requirements
2. Generate a Supabase-compatible SQL migration file at `supabase/migrations/`
3. Include RLS policies for every table
4. Include proper indexes for query performance
5. Follow Supabase naming conventions (snake_case)
6. Add comments on each table explaining its purpose
