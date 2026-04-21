'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { patchJson } from '@/lib/api/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SUBSCRIPTION_PLAN_ORDER, getSubscriptionPlan, normalizePlanTier } from '@/lib/subscription/catalog'
import type { UserSubscriptionUsageMonthly } from '@/lib/supabase/types'

interface OrgUser {
  id: string
  full_name: string
  email: string
  role: string
  plan: string
  credit_balance: number
  usage: UserSubscriptionUsageMonthly | null
  created_at: string
}

const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-red-100 text-red-700',
  cosec: 'bg-blue-100 text-blue-700',
  viewer: 'bg-zinc-100 text-zinc-700',
  auditor: 'bg-amber-100 text-amber-700',
}

function buildUsageSummary(usage: UserSubscriptionUsageMonthly | null) {
  if (!usage) {
    return 'No usage recorded this month'
  }

  return [
    `${usage.transcript_review_jobs} transcript jobs`,
    `${Math.round((usage.transcription_seconds_used ?? 0) / 60)} min transcription`,
    `${usage.go_deeper_agent_runs} agent`,
    `${usage.best_fit_mom_runs} best-fit`,
  ].join(' • ')
}

function UserRow({ user, currentUserId }: { user: OrgUser; currentUserId: string }) {
  const router = useRouter()
  const [currentRole, setCurrentRole] = useState(user.role)
  const [currentPlan, setCurrentPlan] = useState(normalizePlanTier(user.plan))
  const [creditDelta, setCreditDelta] = useState('10')
  const [creditReason, setCreditReason] = useState('')
  const [pending, startTransition] = useTransition()
  const isSelf = user.id === currentUserId
  const normalizedPlan = normalizePlanTier(user.plan)
  const usageSummary = useMemo(() => buildUsageSummary(user.usage), [user.usage])

  function refreshWithSuccess(message: string, after?: () => void) {
    router.refresh()
    toast.success(message)
    after?.()
  }

  function handleRoleChange(newRole: string) {
    startTransition(async () => {
      try {
        await patchJson<{ ok: true }>('/api/admin/users', {
          targetUserId: user.id,
          role: newRole,
        })
        setCurrentRole(newRole)
        refreshWithSuccess(`${user.full_name} is now ${newRole}`)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed')
      }
    })
  }

  function handlePlanChange(newPlan: string) {
    startTransition(async () => {
      try {
        await patchJson<{ ok: true }>('/api/admin/users', {
          targetUserId: user.id,
          plan: newPlan,
        })
        setCurrentPlan(normalizePlanTier(newPlan))
        refreshWithSuccess(`${user.full_name} moved to ${getSubscriptionPlan(newPlan).label}`)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed')
      }
    })
  }

  function handleAdjustCredits(direction: 'add' | 'deduct') {
    startTransition(async () => {
      try {
        const parsedDelta = Math.trunc(Number(creditDelta))
        if (!Number.isFinite(parsedDelta) || parsedDelta <= 0) {
          throw new Error('Enter a valid credit amount')
        }
        const reason = creditReason.trim()
        if (!reason) {
          throw new Error('Enter a reason for the credit adjustment')
        }

        await patchJson<{ ok: true; creditBalance: number }>('/api/admin/users', {
          targetUserId: user.id,
          creditAdjustment: direction === 'add' ? parsedDelta : -parsedDelta,
          creditReason: reason,
        })

        refreshWithSuccess(
          direction === 'add'
            ? `${parsedDelta} credits added to ${user.full_name}`
            : `${parsedDelta} credits deducted from ${user.full_name}`,
          () => {
            setCreditReason('')
          },
        )
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed')
      }
    })
  }

  return (
    <tr className="border-b border-border/50 align-top last:border-b-0">
      <td className="py-3 pr-4">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">{user.full_name}</p>
          {isSelf ? (
            <Badge className="bg-emerald-100 text-emerald-700">You</Badge>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">{user.email}</p>
      </td>
      <td className="py-3 pr-4">
        {isSelf ? (
          <Badge className={ROLE_COLORS[user.role] ?? ''}>{user.role}</Badge>
        ) : (
          <select
            value={currentRole}
            onChange={e => handleRoleChange(e.target.value)}
            disabled={pending}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs"
          >
            <option value="admin">admin</option>
            <option value="cosec">cosec</option>
            <option value="viewer">viewer</option>
            <option value="auditor">auditor</option>
          </select>
        )}
      </td>
      <td className="py-3 pr-4">
        <select
          value={currentPlan}
          onChange={e => handlePlanChange(e.target.value)}
          disabled={pending}
          className="h-8 rounded-md border border-border bg-background px-2 text-xs"
        >
          {SUBSCRIPTION_PLAN_ORDER.map(planTier => (
            <option key={planTier} value={planTier}>
              {getSubscriptionPlan(planTier).label}
            </option>
          ))}
        </select>
        {normalizePlanTier(user.plan) !== normalizedPlan ? null : (
          <p className="mt-2 text-[11px] text-muted-foreground">
            {getSubscriptionPlan(normalizedPlan).priceRmMonthly === 0
              ? 'Free tier'
              : `RM ${getSubscriptionPlan(normalizedPlan).priceRmMonthly}/mo`}
          </p>
        )}
      </td>
      <td className="py-3 pr-4">
        <p className="text-sm font-semibold">{user.credit_balance ?? 0}</p>
        <div className="mt-2 space-y-2">
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              value={creditDelta}
              onChange={event => setCreditDelta(event.target.value)}
              className="h-8 w-20 rounded-md border border-border bg-background px-2 text-xs"
              disabled={pending}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 px-2 text-[11px]"
              onClick={() => handleAdjustCredits('add')}
              disabled={pending}
            >
              Top up
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 px-2 text-[11px]"
              onClick={() => handleAdjustCredits('deduct')}
              disabled={pending}
            >
              Deduct
            </Button>
          </div>
          <input
            type="text"
            value={creditReason}
            onChange={event => setCreditReason(event.target.value)}
            placeholder="Reason for adjustment"
            className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
            disabled={pending}
          />
        </div>
      </td>
      <td className="py-3 pr-4">
        <p className="text-xs text-foreground">{usageSummary}</p>
        {user.usage ? (
          <p className="mt-1 text-[11px] text-muted-foreground">
            Credits used: {user.usage.credits_consumed} • Extract Minute: {user.usage.extract_minute_runs}
          </p>
        ) : null}
      </td>
      <td className="py-3 text-xs text-muted-foreground">
        {new Date(user.created_at).toLocaleDateString('en-MY')}
      </td>
    </tr>
  )
}

export function TabUsers({ users, currentUserId }: { users: OrgUser[]; currentUserId: string }) {
  const orderedUsers = useMemo(() => {
    const copy = [...users]
    copy.sort((left, right) => {
      const leftIsCurrent = left.id === currentUserId ? 1 : 0
      const rightIsCurrent = right.id === currentUserId ? 1 : 0
      if (leftIsCurrent !== rightIsCurrent) return rightIsCurrent - leftIsCurrent
      return new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
    })
    return copy
  }, [currentUserId, users])

  const currentUser = orderedUsers.find(user => user.id === currentUserId) ?? null
  const currentPlan = currentUser ? getSubscriptionPlan(currentUser.plan) : null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Organization Users</CardTitle>
        <p className="text-sm text-muted-foreground">
          Your own admin account is pinned at the top. AI testing follows your user plan:
          {' '}
          <span className="font-medium text-foreground">
            {currentPlan?.label ?? 'Free'}
          </span>
          .
        </p>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-sm">
          <thead>
            <tr className="border-b border-border/60 text-left text-[0.72rem] uppercase tracking-[0.22em] text-muted-foreground">
              <th className="py-3 pr-4">User</th>
              <th className="py-3 pr-4">Role</th>
              <th className="py-3 pr-4">Plan</th>
              <th className="py-3 pr-4">Credits</th>
              <th className="py-3 pr-4">This Month</th>
              <th className="py-3">Joined</th>
            </tr>
          </thead>
          <tbody>
            {orderedUsers.map(u => (
              <UserRow key={u.id} user={u} currentUserId={currentUserId} />
            ))}
          </tbody>
        </table>
        {orderedUsers.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">No users found.</p>
        )}
      </CardContent>
    </Card>
  )
}
