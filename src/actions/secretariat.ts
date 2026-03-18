'use server'

import { redirect } from 'next/navigation'

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { INDUSTRY_CATEGORIES } from '@/lib/ai/persona-templates'
import { parseInviteEmails } from '@/lib/secretariat-access'
import type { IndustryCategory } from '@/lib/supabase/types'
import { findOrCreateCommitteeFromTemplate, findOrCreateCustomCommittee } from './secretariat-committee'
import {
  ensureCommitteeMembership,
  inviteSecretariatOperator,
  logSecretariatAudit,
  revalidateSecretariatSurfaces,
} from './secretariat-invite'

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

async function requireSecretariatContext() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase
    .from('profiles').select('organization_id, role').eq('id', user.id).single()
  if (!profile) redirect('/login')
  return { supabase, user, profile }
}

async function runInvitesAndAudit(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string, userId: string, committeeId: string, slug: string,
  emails: string[], action: string, details: Record<string, unknown>,
) {
  await ensureCommitteeMembership({ admin, committeeId, userId, createdBy: userId })
  for (const email of emails) {
    await inviteSecretariatOperator({ admin, organizationId: orgId, committeeId, email, invitedBy: userId })
  }
  await logSecretariatAudit({ admin, organizationId: orgId, userId, action, details })
  await revalidateSecretariatSurfaces()
}

export async function createSecretariatWizard(params: {
  templateId?: string
  personaSlug?: string
  inviteEmails: string[]
  source: string
}) {
  const { user, profile } = await requireSecretariatContext()
  const admin = createAdminClient()
  const result = await findOrCreateCommitteeFromTemplate({
    admin, organizationId: profile.organization_id, userId: user.id,
    templateId: params.templateId ?? '', personaSlug: params.personaSlug,
  })
  await runInvitesAndAudit(
    admin, profile.organization_id, user.id, result.committeeId, result.slug,
    params.inviteEmails, result.created ? 'secretariat_created' : 'secretariat_joined',
    {
      committee_id: result.committeeId, committee_slug: result.slug,
      template_id: ('templateId' in result ? result.templateId : null) ?? params.personaSlug,
      source: params.source, invited_count: params.inviteEmails.length,
    },
  )
  return { committeeId: result.committeeId, slug: result.slug }
}

export async function createPersonalizedSecretariatWizard(params: {
  category: IndustryCategory
  committeeName: string
  promptNote: string | null
  inviteEmails: string[]
}) {
  if (!INDUSTRY_CATEGORIES.includes(params.category)) throw new Error('A valid industry category is required')
  if (!params.committeeName.trim()) throw new Error('Committee name is required')

  const { user, profile } = await requireSecretariatContext()
  const admin = createAdminClient()
  const result = await findOrCreateCustomCommittee({
    admin, organizationId: profile.organization_id, userId: user.id,
    category: params.category, committeeName: params.committeeName, promptNote: params.promptNote,
  })
  await runInvitesAndAudit(
    admin, profile.organization_id, user.id, result.committeeId, result.slug,
    params.inviteEmails, result.created ? 'secretariat_created' : 'secretariat_joined',
    {
      committee_id: result.committeeId, committee_slug: result.slug,
      source: 'personalized_wizard_flow', category: params.category,
      invited_count: params.inviteEmails.length,
    },
  )
  return { committeeId: result.committeeId, slug: result.slug }
}

export async function inviteSecretariatMember(formData: FormData) {
  const committeeId = String(formData.get('committeeId') ?? '').trim()
  const email = normalizeEmail(String(formData.get('email') ?? ''))
  if (!committeeId) throw new Error('Secretariat is required')
  if (!email || !email.includes('@')) throw new Error('A valid email is required')

  const { supabase, user, profile } = await requireSecretariatContext()
  const { data: committee, error } = await supabase
    .from('committees').select('id, name').eq('id', committeeId).single()
  if (error || !committee) throw new Error('Secretariat not found or not accessible')
  if (email === normalizeEmail(user.email ?? '')) throw new Error('You already have access to this secretariat')

  const admin = createAdminClient()
  await inviteSecretariatOperator({ admin, organizationId: profile.organization_id, committeeId, email, invitedBy: user.id })
  await logSecretariatAudit({
    admin, organizationId: profile.organization_id, userId: user.id,
    action: 'secretariat_invited', details: { committee_id: committeeId, invited_email: email },
  })
  await revalidateSecretariatSurfaces()
  return { ok: true }
}
