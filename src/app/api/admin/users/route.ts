import { NextResponse } from 'next/server'
import type { PlanTier, UserRole } from '@/lib/supabase/types'
import { normalizePlanTier } from '@/lib/subscription/catalog'
import { adjustUserCreditWallet } from '@/lib/subscription/entitlements'
import { getSubscriptionSchemaCompatibility } from '@/lib/subscription/schema-compat'
import { requireAdminOrgContext, serializeAdminApiError } from '../_lib/write-access'

const VALID_ROLES: UserRole[] = ['admin', 'cosec', 'viewer', 'auditor']
const VALID_PLANS: PlanTier[] = ['free', 'basic', 'pro', 'premium']

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as {
      targetUserId?: string
      role?: string
      plan?: string
      creditAdjustment?: number
      creditReason?: string
    }
    const context = await requireAdminOrgContext()
    const targetUserId = String(body.targetUserId ?? '').trim()

    if (!targetUserId) {
      return NextResponse.json(
        { ok: false, message: 'Target user is required' },
        { status: 400 },
      )
    }
    if (targetUserId === context.userId && body.role) {
      return NextResponse.json(
        { ok: false, message: 'Cannot change your own role' },
        { status: 400 },
      )
    }

    const subscriptionCompatibility = await getSubscriptionSchemaCompatibility({
      organizationId: context.organizationId,
      adminSupabase: context.adminSupabase,
    })

    const targetQuery = subscriptionCompatibility.profilesCreditBalanceAvailable
      ? context.adminSupabase.from('profiles').select('id, organization_id, role, plan, credit_balance')
      : context.adminSupabase.from('profiles').select('id, organization_id, role, plan')
    const { data: target, error: targetError } = await targetQuery
      .eq('id', targetUserId)
      .maybeSingle()

    if (targetError) {
      throw new Error(targetError.message)
    }
    if (!target || target.organization_id !== context.organizationId) {
      return NextResponse.json(
        { ok: false, message: 'User not found' },
        { status: 404 },
      )
    }

    if (body.role) {
      if (!VALID_ROLES.includes(body.role as UserRole)) {
        return NextResponse.json(
          { ok: false, message: 'Invalid role' },
          { status: 400 },
        )
      }

      const { error } = await context.adminSupabase
        .from('profiles')
        .update({ role: body.role })
        .eq('id', targetUserId)
      if (error) throw new Error('Failed to update role')

      await context.adminSupabase.from('audit_logs').insert({
        organization_id: context.organizationId,
        user_id: context.userId,
        action: 'user_role_updated',
        details: {
          target_user_id: targetUserId,
          old_role: target.role,
          new_role: body.role,
        },
      })

      return NextResponse.json({ ok: true })
    }

    if (body.plan) {
      const normalizedPlan = normalizePlanTier(body.plan)
      if (!VALID_PLANS.includes(normalizedPlan)) {
        return NextResponse.json(
          { ok: false, message: 'Invalid plan' },
          { status: 400 },
        )
      }

      const { error } = await context.adminSupabase
        .from('profiles')
        .update({ plan: normalizedPlan })
        .eq('id', targetUserId)
      if (error) throw new Error('Failed to update plan')

      await context.adminSupabase.from('audit_logs').insert({
        organization_id: context.organizationId,
        user_id: context.userId,
        action: 'user_plan_updated',
        details: {
          target_user_id: targetUserId,
          old_plan: target.plan,
          new_plan: normalizedPlan,
        },
      })

      return NextResponse.json({ ok: true })
    }

    if (typeof body.creditAdjustment === 'number' && Number.isFinite(body.creditAdjustment)) {
      const deltaCredits = Math.trunc(body.creditAdjustment)
      const reason = String(body.creditReason ?? '').trim()

      if (!subscriptionCompatibility.profilesCreditBalanceAvailable || !subscriptionCompatibility.creditLedgerAvailable) {
        return NextResponse.json(
          { ok: false, message: 'This action needs the latest subscription database update', code: 'subscription_schema_not_ready' },
          { status: 503 },
        )
      }

      if (deltaCredits === 0) {
        return NextResponse.json(
          { ok: false, message: 'Credit adjustment must be greater than zero or less than zero' },
          { status: 400 },
        )
      }

      if (!reason) {
        return NextResponse.json(
          { ok: false, message: 'A credit adjustment reason is required' },
          { status: 400 },
        )
      }

      const nextBalance = await adjustUserCreditWallet({
        targetUserId,
        organizationId: context.organizationId,
        deltaCredits,
        reason,
        createdBy: context.userId,
        adminSupabase: context.adminSupabase,
      })

      await context.adminSupabase.from('audit_logs').insert({
        organization_id: context.organizationId,
        user_id: context.userId,
        action: deltaCredits >= 0 ? 'user_credits_topped_up' : 'user_credits_deducted',
        details: {
          target_user_id: targetUserId,
          delta_credits: deltaCredits,
          reason,
          previous_balance: subscriptionCompatibility.profilesCreditBalanceAvailable
            ? ((target as { credit_balance?: number | null }).credit_balance ?? 0)
            : 0,
          next_balance: nextBalance,
        },
      })

      return NextResponse.json({ ok: true, creditBalance: nextBalance })
    }

    return NextResponse.json(
      { ok: false, message: 'No update payload was provided' },
      { status: 400 },
    )
  } catch (error) {
    const { status, message, code } = serializeAdminApiError(
      error,
      'Failed to update user settings',
    )
    return NextResponse.json({ ok: false, message, code }, { status })
  }
}
