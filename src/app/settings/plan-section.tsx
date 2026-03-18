import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { CreditCard, Zap } from 'lucide-react'

const PLAN_DETAILS: Record<string, { label: string; meetings: number | 'Unlimited'; recording: string; badge: string }> = {
  free: { label: 'Free', meetings: 3, recording: '30 min', badge: 'bg-zinc-100 text-zinc-700' },
  pro: { label: 'Pro', meetings: 30, recording: '3 hours', badge: 'bg-blue-100 text-blue-700' },
  max: { label: 'Max', meetings: 'Unlimited', recording: 'Unlimited', badge: 'bg-amber-100 text-amber-700' },
}

interface Props {
  plan: string
  meetingsThisMonth: number
  totalMeetings: number
}

export function PlanSection({ plan, meetingsThisMonth, totalMeetings }: Props) {
  const details = PLAN_DETAILS[plan] ?? PLAN_DETAILS.free
  const isLimited = typeof details.meetings === 'number'
  const usage = isLimited ? meetingsThisMonth / (details.meetings as number) : 0

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Billing & Subscription</h2>
        <p className="text-sm text-muted-foreground">Manage your plan and view usage.</p>
      </div>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <CreditCard className="h-4 w-4 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">Current Plan</CardTitle>
              <p className="text-xs text-muted-foreground">Your active subscription</p>
            </div>
          </div>
          <Badge className={details.badge}>{details.label}</Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border p-4 space-y-2">
              <p className="text-xs text-muted-foreground">Meetings this month</p>
              <p className="text-2xl font-semibold">
                {meetingsThisMonth}{isLimited ? `/${details.meetings}` : ''}
              </p>
              {isLimited && (
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${usage > 0.8 ? 'bg-red-500' : 'bg-primary'}`}
                    style={{ width: `${Math.min(usage * 100, 100)}%` }}
                  />
                </div>
              )}
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-xs text-muted-foreground">Max recording length</p>
              <p className="text-2xl font-semibold">{details.recording}</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-xs text-muted-foreground">Total meetings (all time)</p>
              <p className="text-2xl font-semibold">{totalMeetings}</p>
            </div>
          </div>

          {plan === 'free' && (
            <div className="flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 p-4">
              <div>
                <p className="text-sm font-medium flex items-center gap-1.5"><Zap className="h-3.5 w-3.5" /> Upgrade your plan</p>
                <p className="text-xs text-muted-foreground">Unlock unlimited meetings, longer recordings, and priority support.</p>
              </div>
              <Button asChild>
                <Link href="/pricing">Upgrade</Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
