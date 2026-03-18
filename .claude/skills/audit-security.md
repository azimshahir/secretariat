# /audit-security

Run a security audit checklist against the codebase for bank-grade compliance.

## Instructions
1. Scan all files for potential security issues:
   - API keys or secrets in client-side code
   - Missing RLS policies on Supabase tables
   - Direct database access without server actions
   - localStorage usage for sensitive data
   - Missing input validation (zod schemas)
   - Unprotected API routes
2. Verify the auto-purge mechanism for raw files
3. Check that all file uploads use signed URLs with expiry
4. Verify audit logging is active for critical operations
5. Report findings with severity levels (Critical/High/Medium/Low)
