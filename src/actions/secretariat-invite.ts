'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

export async function ensureCommitteeMembership(params: {
  admin: ReturnType<typeof createAdminClient>
  committeeId: string; userId: string; createdBy: string
}) {
  const { error } = await params.admin.from('committee_memberships').upsert(
    { committee_id: params.committeeId, user_id: params.userId, role: 'operator', created_by: params.createdBy },
    { onConflict: 'committee_id,user_id' }
  )
  if (error) throw new Error(error.message)
}

export async function logSecretariatAudit(params: {
  admin: ReturnType<typeof createAdminClient>
  organizationId: string; userId: string; action: string; details: Record<string, unknown>
}) {
  const { error } = await params.admin.from('audit_logs').insert({
    organization_id: params.organizationId, user_id: params.userId,
    action: params.action, details: params.details,
  })
  if (error) throw new Error(error.message)
}

export async function findExistingAuthUserByEmail(
  admin: ReturnType<typeof createAdminClient>, email: string
) {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 })
  if (error) throw new Error(error.message)
  return data.users.find(u => normalizeEmail(u.email ?? '') === email) ?? null
}

export async function inviteSecretariatOperator(params: {
  admin: ReturnType<typeof createAdminClient>
  organizationId: string; committeeId: string; email: string; invitedBy: string
}) {
  const email = normalizeEmail(params.email)
  if (!email) return

  const existingAuthUser = await findExistingAuthUserByEmail(params.admin, email)
  const now = new Date().toISOString()

  if (existingAuthUser) {
    const { data: profile, error: pe } = await params.admin.from('profiles')
      .select('id, organization_id').eq('id', existingAuthUser.id).maybeSingle()
    if (pe) throw new Error(pe.message)
    if (profile?.organization_id && profile.organization_id !== params.organizationId) {
      throw new Error(`${email} already belongs to another organization and cannot be invited here.`)
    }
    if (profile?.id) {
      await ensureCommitteeMembership({
        admin: params.admin, committeeId: params.committeeId,
        userId: profile.id, createdBy: params.invitedBy,
      })
      const { error: ie } = await params.admin.from('committee_invitations').upsert(
        { committee_id: params.committeeId, organization_id: params.organizationId,
          email, invited_by: params.invitedBy, status: 'accepted', accepted_at: now },
        { onConflict: 'committee_id,email' }
      )
      if (ie) throw new Error(ie.message)
      return
    }
  }

  const { error: ie } = await params.admin.from('committee_invitations').upsert(
    { committee_id: params.committeeId, organization_id: params.organizationId,
      email, invited_by: params.invitedBy, status: 'pending', accepted_at: null },
    { onConflict: 'committee_id,email' }
  )
  if (ie) throw new Error(ie.message)

  const base = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.NEXT_PUBLIC_APP_URL
  const redirectTo = base ? `${base.replace(/\/$/, '')}/login` : undefined

  const { error: invErr } = await params.admin.auth.admin.inviteUserByEmail(
    email, redirectTo ? { redirectTo } : undefined
  )
  if (invErr) throw new Error(invErr.message)
}

export async function revalidateSecretariatSurfaces() {
  revalidatePath('/')
  revalidatePath('/settings')
  revalidatePath('/meeting/new')
  revalidatePath('/secretariat/new')
}
