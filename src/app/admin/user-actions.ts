'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import type { UserRole, PlanTier } from '@/lib/supabase/types'
import { normalizePlanTier } from '@/lib/subscription/catalog'
import { adjustUserCreditWallet } from '@/lib/subscription/entitlements'

const VALID_ROLES: UserRole[] = ['admin', 'cosec', 'viewer', 'auditor']
const VALID_PLANS: PlanTier[] = ['free', 'basic', 'pro', 'premium']

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')
  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, role')
    .eq('id', user.id)
    .single()
  if (!profile || profile.role !== 'admin') throw new Error('Admin access required')
  return { supabase, userId: user.id, organizationId: profile.organization_id }
}

export async function updateUserRole(targetUserId: string, newRole: string) {
  const { supabase, userId, organizationId } = await requireAdmin()
  if (!VALID_ROLES.includes(newRole as UserRole)) throw new Error('Invalid role')
  if (targetUserId === userId) throw new Error('Cannot change your own role')

  // Verify target user is in the same org
  const { data: target } = await supabase
    .from('profiles')
    .select('id, organization_id, role')
    .eq('id', targetUserId)
    .single()
  if (!target || target.organization_id !== organizationId) throw new Error('User not found')

  const { error } = await supabase
    .from('profiles')
    .update({ role: newRole })
    .eq('id', targetUserId)
  if (error) throw new Error('Failed to update role')

  await supabase.from('audit_logs').insert({
    organization_id: organizationId,
    user_id: userId,
    action: 'user_role_updated',
    details: { target_user_id: targetUserId, old_role: target.role, new_role: newRole },
  })

  revalidatePath('/admin')
}

export async function updateUserPlan(targetUserId: string, newPlan: string) {
  const { supabase, userId, organizationId } = await requireAdmin()
  const normalizedPlan = normalizePlanTier(newPlan)
  if (!VALID_PLANS.includes(normalizedPlan)) throw new Error('Invalid plan')

  const { data: target } = await supabase
    .from('profiles')
    .select('id, organization_id, plan')
    .eq('id', targetUserId)
    .single()
  if (!target || target.organization_id !== organizationId) throw new Error('User not found')

  const { error } = await supabase
    .from('profiles')
    .update({ plan: normalizedPlan })
    .eq('id', targetUserId)
  if (error) throw new Error('Failed to update plan')

  await supabase.from('audit_logs').insert({
    organization_id: organizationId,
    user_id: userId,
    action: 'user_plan_updated',
    details: { target_user_id: targetUserId, old_plan: target.plan, new_plan: normalizedPlan },
  })

  revalidatePath('/admin')
}

export async function adjustUserCredits(targetUserId: string, deltaCredits: number, reason: string) {
  const { supabase, userId, organizationId } = await requireAdmin()
  await adjustUserCreditWallet({
    targetUserId,
    organizationId,
    deltaCredits,
    reason,
    createdBy: userId,
  })
  revalidatePath('/admin')
}
