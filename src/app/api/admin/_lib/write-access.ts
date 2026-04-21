import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import type { UserRole } from '@/lib/supabase/types'

export class AdminApiError extends Error {
  status: number
  code?: string

  constructor(status: number, message: string, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

function fail(status: number, message: string, code?: string): never {
  throw new AdminApiError(status, message, code)
}

export interface AdminOrgContext {
  adminSupabase: ReturnType<typeof createAdminClient>
  userId: string
  organizationId: string
  role: UserRole
}

export async function requireAdminOrgContext(): Promise<AdminOrgContext> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) fail(401, 'Unauthorized')

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('organization_id, role')
    .eq('id', user.id)
    .single()

  if (error || !profile) fail(401, 'Profile not found')
  if (profile.role !== 'admin') fail(403, 'Admin access required')

  return {
    adminSupabase: createAdminClient(),
    userId: user.id,
    organizationId: profile.organization_id,
    role: profile.role as UserRole,
  }
}

export function serializeAdminApiError(error: unknown, fallbackMessage: string) {
  if (error instanceof AdminApiError) {
    return {
      status: error.status,
      message: error.message,
      code: error.code,
    }
  }

  return {
    status: 500,
    message: error instanceof Error ? error.message : fallbackMessage,
    code: undefined,
  }
}
