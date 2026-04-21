'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Coins, DollarSign, TrendingUp, Users } from 'lucide-react'
import { SUBSCRIPTION_PLAN_ORDER, getSubscriptionPlan } from '@/lib/subscription/catalog'
import type { PlanTier } from '@/lib/supabase/types'

interface MonthlyMeetings { month: string; count: number }

interface Props {
  planBreakdown: Record<PlanTier, number>
  totalWalletCredits: number
  totalCreditsConsumedThisMonth: number
  totalUsers: number
  monthlyMeetings: MonthlyMeetings[]
  meetingsThisMonth: number
  totalMeetings: number
}

const PLAN_COLORS = {
  free: { bar: 'bg-zinc-400', badge: 'bg-zinc-100 text-zinc-700' },
  basic: { bar: 'bg-sky-500', badge: 'bg-sky-100 text-sky-700' },
  pro: { bar: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-700' },
  premium: { bar: 'bg-amber-500', badge: 'bg-amber-100 text-amber-700' },
} satisfies Record<PlanTier, { bar: string; badge: string }>

export function TabSubscription({
  planBreakdown,
  totalWalletCredits,
  totalCreditsConsumedThisMonth,
  totalUsers,
  monthlyMeetings,
  meetingsThisMonth,
  totalMeetings,
}: Props) {
  const mrr = SUBSCRIPTION_PLAN_ORDER.reduce((sum, planTier) => (
    sum + (planBreakdown[planTier] * getSubscriptionPlan(planTier).priceRmMonthly)
  ), 0)
  const paidUsers = planBreakdown.basic + planBreakdown.pro + planBreakdown.premium
  const conversionRate = totalUsers > 0 ? Math.round((paidUsers / totalUsers) * 100) : 0
  const maxMeetings = Math.max(...monthlyMeetings.map(m => m.count), 1)

  const stats = [
    { label: 'Monthly Revenue', value: `RM ${mrr.toLocaleString()}`, sub: 'MRR', icon: DollarSign, color: 'text-emerald-600 bg-emerald-100' },
    { label: 'Paid Users', value: paidUsers, sub: `${conversionRate}% conversion`, icon: TrendingUp, color: 'text-blue-600 bg-blue-100' },
    { label: 'Wallet Credits', value: totalWalletCredits, sub: `${totalCreditsConsumedThisMonth} consumed this month`, icon: Coins, color: 'text-amber-600 bg-amber-100' },
    { label: 'Total Users', value: totalUsers, sub: `${planBreakdown.free} free`, icon: Users, color: 'text-purple-600 bg-purple-100' },
  ]

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map(s => (
          <Card key={s.label}>
            <CardContent className="flex items-center gap-4 py-5">
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${s.color}`}>
                <s.icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-2xl font-semibold tracking-tight">{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="text-[10px] text-muted-foreground/70">{s.sub}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Users by Plan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {SUBSCRIPTION_PLAN_ORDER.map(planTier => {
              const count = planBreakdown[planTier]
              const pct = totalUsers > 0 ? (count / totalUsers) * 100 : 0
              const plan = getSubscriptionPlan(planTier)
              const revenue = count * plan.priceRmMonthly
              return (
                <div key={planTier} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge className={PLAN_COLORS[planTier].badge}>{plan.label}</Badge>
                      <span className="text-sm font-medium">{count} users</span>
                    </div>
                    <span className="text-sm text-muted-foreground">
                      {plan.priceRmMonthly === 0 ? 'Free' : `RM ${revenue.toLocaleString()}/mo`}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full ${PLAN_COLORS[planTier].bar} transition-all`}
                      style={{ width: `${Math.max(pct, 2)}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    {pct.toFixed(0)}% of total users • {plan.operatorsLabel}
                  </p>
                </div>
              )
            })}

            <div className="mt-4 rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Total MRR</span>
                <span className="text-lg font-semibold text-emerald-600">RM {mrr.toLocaleString()}</span>
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Projected ARR: RM {(mrr * 12).toLocaleString()}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Meeting Activity (Last 6 Months)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex h-48 items-end gap-2">
              {monthlyMeetings.map(m => (
                <div key={m.month} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                  <span className="text-xs font-medium">{m.count}</span>
                  <div
                    className="min-h-[4px] w-full rounded-t-md bg-primary/80 transition-all hover:bg-primary"
                    style={{ height: `${(m.count / maxMeetings) * 100}%` }}
                  />
                  <span className="text-[10px] text-muted-foreground">{m.month}</span>
                </div>
              ))}
            </div>
            {monthlyMeetings.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No meeting data yet.</p>
            ) : null}
            <div className="mt-4 rounded-lg border p-3 text-sm text-muted-foreground">
              Meetings this month: <span className="font-semibold text-foreground">{meetingsThisMonth}</span>
              {' '}• All time: <span className="font-semibold text-foreground">{totalMeetings}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Revenue Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-2.5 text-left font-medium">Plan</th>
                  <th className="px-4 py-2.5 text-right font-medium">Users</th>
                  <th className="px-4 py-2.5 text-right font-medium">Price/User</th>
                  <th className="px-4 py-2.5 text-right font-medium">Monthly Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {SUBSCRIPTION_PLAN_ORDER.map(planTier => {
                  const plan = getSubscriptionPlan(planTier)
                  return (
                    <tr key={planTier} className="hover:bg-muted/30">
                      <td className="px-4 py-2.5">
                        <Badge className={PLAN_COLORS[planTier].badge}>
                          {plan.label}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-right">{planBreakdown[planTier]}</td>
                      <td className="px-4 py-2.5 text-right text-muted-foreground">
                        {plan.priceRmMonthly === 0 ? 'Free' : `RM ${plan.priceRmMonthly}`}
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium">
                        RM {(planBreakdown[planTier] * plan.priceRmMonthly).toLocaleString()}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t bg-muted/30">
                  <td className="px-4 py-2.5 font-medium" colSpan={3}>Total</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-emerald-600">RM {mrr.toLocaleString()}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
