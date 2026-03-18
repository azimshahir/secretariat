import type { User } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'

export type ProvisionResult =
  | { status: 'ok' }
  | { status: 'recoverable_error'; code: 'profile_setup_failed'; message: string }
  | { status: 'fatal_error'; code: 'invalid_user' | 'config_missing'; message: string }

function toSafeDisplayName(user: User) {
  const fromMeta = typeof user.user_metadata?.full_name === 'string'
    ? user.user_metadata.full_name.trim()
    : ''
  const fromEmail = (user.email ?? 'User').split('@')[0].replace(/[._-]+/g, ' ').trim()
  return (fromMeta || fromEmail || 'User').slice(0, 120)
}

function toSlug(userId: string) {
  return `org-${userId.slice(0, 8)}`
}

function normalizeEmail(email: string | null | undefined) {
  return String(email ?? '').trim().toLowerCase()
}

export async function ensureUserProvisioned(user: User | null | undefined): Promise<ProvisionResult> {
  if (!user?.id) {
    return {
      status: 'fatal_error',
      code: 'invalid_user',
      message: 'Invalid authenticated user.',
    }
  }

  let admin: ReturnType<typeof createAdminClient>
  try {
    admin = createAdminClient()
  } catch {
    return {
      status: 'fatal_error',
      code: 'config_missing',
      message: 'Auth provisioning is not configured. Contact administrator.',
    }
  }

  try {
    const { data: existingProfile, error: checkError } = await admin
      .from('profiles')
      .select('id')
      .eq('id', user.id)
      .maybeSingle()
    if (checkError) throw new Error(checkError.message)
    if (existingProfile) return { status: 'ok' }

    const normalizedEmail = normalizeEmail(user.email)
    if (normalizedEmail) {
      const { data: pendingInvites, error: inviteError } = await admin
        .from('committee_invitations')
        .select('id, committee_id, organization_id, invited_by')
        .eq('email', normalizedEmail)
        .eq('status', 'pending')

      if (inviteError) throw new Error(inviteError.message)

      if ((pendingInvites ?? []).length > 0) {
        const organizationIds = Array.from(
          new Set((pendingInvites ?? []).map(invite => invite.organization_id))
        )

        if (organizationIds.length !== 1) {
          return {
            status: 'recoverable_error',
            code: 'profile_setup_failed',
            message: 'Multiple organization invitations were found for this email. Contact an administrator.',
          }
        }

        const fullName = toSafeDisplayName(user)
        const organizationId = organizationIds[0]

        const { error: profileError } = await admin.from('profiles').upsert(
          {
            id: user.id,
            organization_id: organizationId,
            full_name: fullName,
            role: 'cosec',
          },
          { onConflict: 'id' }
        )
        if (profileError) throw new Error(profileError.message)

        const uniqueCommitteeIds = Array.from(
          new Set((pendingInvites ?? []).map(invite => invite.committee_id))
        )

        if (uniqueCommitteeIds.length > 0) {
          const inviterByCommitteeId = new Map(
            (pendingInvites ?? []).map(invite => [invite.committee_id, invite.invited_by])
          )
          const { error: membershipError } = await admin
            .from('committee_memberships')
            .upsert(
              uniqueCommitteeIds.map(committeeId => ({
                committee_id: committeeId,
                user_id: user.id,
                role: 'operator',
                created_by: inviterByCommitteeId.get(committeeId) ?? user.id,
              })),
              { onConflict: 'committee_id,user_id' }
            )

          if (membershipError) throw new Error(membershipError.message)
        }

        const inviteIds = (pendingInvites ?? []).map(invite => invite.id)
        if (inviteIds.length > 0) {
          const { error: updateInviteError } = await admin
            .from('committee_invitations')
            .update({
              status: 'accepted',
              accepted_at: new Date().toISOString(),
            })
            .in('id', inviteIds)

          if (updateInviteError) throw new Error(updateInviteError.message)
        }

        return { status: 'ok' }
      }
    }

    const fullName = toSafeDisplayName(user)
    const orgSlug = toSlug(user.id)
    const orgName = `${fullName} Organization`

    const { data: organization, error: orgError } = await admin
      .from('organizations')
      .upsert({ slug: orgSlug, name: orgName }, { onConflict: 'slug' })
      .select('id')
      .single()
    if (orgError) throw new Error(orgError.message)

    const ADMIN_EMAIL = 'admin@secretariat.my'
    const isAdmin = normalizeEmail(user.email) === ADMIN_EMAIL

    const { error: profileError } = await admin.from('profiles').upsert(
      {
        id: user.id,
        organization_id: organization.id,
        full_name: fullName,
        role: isAdmin ? 'admin' : 'cosec',
      },
      { onConflict: 'id' }
    )
    if (profileError) throw new Error(profileError.message)

    return { status: 'ok' }
  } catch (error) {
    console.error('Provisioning failed', error)
    return {
      status: 'recoverable_error',
      code: 'profile_setup_failed',
      message: 'Profile setup failed. Please try again.',
    }
  }
}
