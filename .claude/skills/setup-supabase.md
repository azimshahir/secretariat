# /setup-supabase

Initialize or reset the local Supabase development environment.

## Instructions
1. Check if Supabase CLI is installed, if not guide user to install it
2. Run `supabase init` if not already initialized
3. Run `supabase start` to start local containers
4. Apply all migrations from `supabase/migrations/`
5. Seed the database with sample committee data (ALCO, MRC)
6. Print the local Supabase URL and anon key for .env.local
7. Verify RLS policies are active on all tables
