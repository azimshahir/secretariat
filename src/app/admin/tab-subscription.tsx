'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { DollarSign, Users, TrendingUp, CalendarDays } from 'lucide-react'

interface PlanBreakdown { free: number; pro: number; max: number }
interface MonthlyMeetings { month: string; count: number }

interface Props {
  planBreakdown: PlanBreakdown
  totalUsers: number
  monthlyMeetings: MonthlyMeetings[]
  meetingsThisMonth: number
  totalMeetings: number
}

const PLAN_PRICE = { free: 0, pro: 149, max: 499 }
const PLAN_COLORS = {
  free: { bar: 'bg-zinc-400', badge: 'bg-zinc-100 text-zinc-700' },
  pro: { bar: 'bg-blue-500', badge: 'bg-blue-100 text-blue-700' },
  max: { bar: 'bg-amber-500', badge: 'bg-amber-100 text-amber-700' },
}

export function TabSubscription({ planBreakdown, totalUsers, monthlyMeetings, meetingsThisMonth, totalMeetings }: Props) {
  const mrr = planBreakdown.pro * PLAN_PRICE.pro + planBreakdown.max * PLAN_PRICE.max
  const paidUsers = planBreakdown.pro + planBreakdown.max
  const conversionRate = totalUsers > 0 ? Math.round((paidUsers / totalUsers) * 100) : 0
  const maxMeetings = Math.max(...monthlyMeetings.map(m => m.count), 1)

  const stats = [
    { label: 'Monthly Revenue', value: `RM ${mrr.toLocaleString()}`, sub: 'MRR', icon: DollarSign, color: 'text-emerald-600 bg-emerald-100' },
    { label: 'Paid Users', value: paidUsers, sub: `${conversionRate}% conversion`, icon: TrendingUp, color: 'text-blue-600 bg-blue-100' },
    { label: 'Meetings This Month', value: meetingsThisMonth, sub: `${totalMeetings} all time`, icon: CalendarDays, color: 'text-amber-600 bg-amber-100' },
    { label: 'Total Users', value: totalUsers, sub: `${planBreakdown.free} free`, icon: Users, color: 'text-purple-600 bg-purple-100' },
  ]

  return (
    <div className="space-y-6">
      {/* Revenue stats */}
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
        {/* User breakdown by plan */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Users by Plan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {(['free', 'pro', 'max'] as const).map(plan => {
              const count = planBreakdown[plan]
              const pct = totalUsers > 0 ? (count / totalUsers) * 100 : 0
              const revenue = count * PLAN_PRICE[plan]
              return (
                <div key={plan} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge className={PLAN_COLORS[plan].badge}>{plan.charAt(0).toUpperCase() + plan.slice(1)}</Badge>
                      <span className="text-sm font-medium">{count} users</span>
                    </div>
                    <span className="text-sm text-muted-foreground">
                      RM {revenue.toLocaleString()}/mo
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full ${PLAN_COLORS[plan].bar} transition-all`}
                      style={{ width: `${Math.max(pct, 2)}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-muted-foreground">{pct.toFixed(0)}% of total users</p>
                </div>
              )
            })}

            <div className="rounded-lg border p-3 mt-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Total MRR</span>
                <span className="text-lg font-semibold text-emerald-600">RM {mrr.toLocaleString()}</span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                Projected ARR: RM {(mrr * 12).toLocaleString()}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Meeting activity chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Meeting Activity (Last 6 Months)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-2 h-48">
              {monthlyMeetings.map(m => (
                <div key={m.month} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                  <span className="text-xs font-medium">{m.count}</span>
                  <div
                    className="w-full rounded-t-md bg-primary/80 transition-all hover:bg-primary min-h-[4px]"
                    style={{ height: `${(m.count / maxMeetings) * 100}%` }}
                  />
                  <span className="text-[10px] text-muted-foreground">{m.month}</span>
                </div>
              ))}
            </div>
            {monthlyMeetings.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">No meeting data yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Revenue breakdown table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Revenue Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left px-4 py-2.5 font-medium">Plan</th>
                  <th className="text-right px-4 py-2.5 font-medium">Users</th>
                  <th className="text-right px-4 py-2.5 font-medium">Price/User</th>
                  <th className="text-right px-4 py-2.5 font-medium">Monthly Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {(['free', 'pro', 'max'] as const).map(plan => (
                  <tr key={plan} className="hover:bg-muted/30">
                    <td className="px-4 py-2.5">
                      <Badge className={PLAN_COLORS[plan].badge}>
                        {plan.charAt(0).toUpperCase() + plan.slice(1)}
                      </Badge>
                    </td>
                    <td className="text-right px-4 py-2.5">{planBreakdown[plan]}</td>
                    <td className="text-right px-4 py-2.5 text-muted-foreground">
                      {PLAN_PRICE[plan] === 0 ? 'Free' : `RM ${PLAN_PRICE[plan]}`}
                    </td>
                    <td className="text-right px-4 py-2.5 font-medium">
                      RM {(planBreakdown[plan] * PLAN_PRICE[plan]).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t bg-muted/30">
                  <td className="px-4 py-2.5 font-medium" colSpan={3}>Total</td>
                  <td className="text-right px-4 py-2.5 font-semibold text-emerald-600">RM {mrr.toLocaleString()}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
