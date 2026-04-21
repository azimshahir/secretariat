import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import type { UserRole } from '@/lib/supabase/types'
import { SubscriptionLimitError } from '@/lib/subscription/entitlements'
import { normalizePlanTier } from '@/lib/subscription/catalog'
import type { PlanTier } from '@/lib/supabase/types'

export class CommitteeGenerationApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

interface WriteContext {
  adminSupabase: ReturnType<typeof createAdminClient>
  userId: string
  organizationId: string
  role: UserRole
  planTier: PlanTier
}

function fail(status: number, message: string): never {
  throw new CommitteeGenerationApiError(status, message)
}

async function requireBaseWriteContext(): Promise<WriteContext> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) fail(401, 'Unauthorized')

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('organization_id, role, plan')
    .eq('id', user.id)
    .single()

  if (profileError || !profile) {
    fail(401, 'Profile not found')
  }

  return {
    adminSupabase: createAdminClient(),
    userId: user.id,
    organizationId: profile.organization_id,
    role: profile.role as UserRole,
    planTier: normalizePlanTier(profile.plan),
  }
}

async function assertCommitteeWriteAccess(context: WriteContext, committeeId: string) {
  const { data: committee, error: committeeError } = await context.adminSupabase
    .from('committees')
    .select('id, organization_id')
    .eq('id', committeeId)
    .maybeSingle()

  if (committeeError) {
    throw new Error(committeeError.message)
  }
  if (!committee || committee.organization_id !== context.organizationId) {
    fail(404, 'Committee not found or inaccessible')
  }

  if (context.role === 'admin') return

  const { data: membership, error: membershipError } = await context.adminSupabase
    .from('committee_memberships')
    .select('id')
    .eq('committee_id', committeeId)
    .eq('user_id', context.userId)
    .maybeSingle()

  if (membershipError) {
    throw new Error(membershipError.message)
  }
  if (!membership) {
    fail(403, 'You do not have access to manage this committee')
  }
}

async function assertCommitteeReadAccess(context: WriteContext, committeeId: string) {
  const { data: committee, error: committeeError } = await context.adminSupabase
    .from('committees')
    .select('id, organization_id')
    .eq('id', committeeId)
    .maybeSingle()

  if (committeeError) {
    throw new Error(committeeError.message)
  }
  if (!committee || committee.organization_id !== context.organizationId) {
    fail(404, 'Committee not found or inaccessible')
  }

  if (context.role === 'admin' || context.role === 'auditor') return

  const { data: membership, error: membershipError } = await context.adminSupabase
    .from('committee_memberships')
    .select('id')
    .eq('committee_id', committeeId)
    .eq('user_id', context.userId)
    .maybeSingle()

  if (membershipError) {
    throw new Error(membershipError.message)
  }
  if (!membership) {
    fail(403, 'You do not have access to view this committee')
  }
}

export async function requireWritableCommitteeContext(committeeId: string) {
  const context = await requireBaseWriteContext()
  await assertCommitteeWriteAccess(context, committeeId)
  return {
    ...context,
    committeeId,
  }
}

export async function requireReadableCommitteeContext(committeeId: string) {
  const context = await requireBaseWriteContext()
  await assertCommitteeReadAccess(context, committeeId)
  return {
    ...context,
    committeeId,
  }
}

export async function requireWritableMeetingContext(meetingId: string) {
  const context = await requireBaseWriteContext()

  const { data: meeting, error: meetingError } = await context.adminSupabase
    .from('meetings')
    .select('id, organization_id, committee_id')
    .eq('id', meetingId)
    .maybeSingle()

  if (meetingError) {
    throw new Error(meetingError.message)
  }
  if (!meeting || meeting.organization_id !== context.organizationId) {
    fail(404, 'Meeting not found or inaccessible')
  }

  if (!meeting.committee_id) {
    if (context.role !== 'admin') {
      fail(403, 'You do not have access to manage this meeting')
    }
    return {
      ...context,
      meetingId,
      committeeId: null as string | null,
    }
  }

  await assertCommitteeWriteAccess(context, meeting.committee_id)

  return {
    ...context,
    meetingId,
    committeeId: meeting.committee_id,
  }
}

export async function requireSetupMeetingContext(meetingId: string) {
  const context = await requireBaseWriteContext()

  const { data: meeting, error: meetingError } = await context.adminSupabase
    .from('meetings')
    .select('id, organization_id, committee_id')
    .eq('id', meetingId)
    .maybeSingle()

  if (meetingError) {
    throw new Error(meetingError.message)
  }
  if (!meeting || meeting.organization_id !== context.organizationId) {
    fail(404, 'Meeting not found or inaccessible')
  }

  return {
    ...context,
    meetingId,
    committeeId: meeting.committee_id ?? null,
  }
}

export async function assertMeetingAgendaEditable(
  adminSupabase: ReturnType<typeof createAdminClient>,
  meetingId: string,
) {
  const { data: meeting, error } = await adminSupabase
    .from('meetings')
    .select('agenda_locked_at')
    .eq('id', meetingId)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  if (meeting?.agenda_locked_at) {
    fail(409, 'Step 1 is done. Reverse to Pending to edit the agenda again.')
  }
}

export function serializeCommitteeGenerationApiError(error: unknown, fallbackMessage: string) {
  if (error instanceof CommitteeGenerationApiError) {
    return {
      status: error.status,
      message: error.message,
    }
  }

  if (error instanceof SubscriptionLimitError) {
    return {
      status: error.status,
      message: error.message,
    }
  }

  return {
    status: 500,
    message: error instanceof Error ? error.message : fallbackMessage,
  }
}
