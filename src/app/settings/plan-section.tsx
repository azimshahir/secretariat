import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CreditCard, Sparkles, Wallet } from 'lucide-react'
import { getSubscriptionPlan } from '@/lib/subscription/catalog'
import type { UserEntitlementSnapshot } from '@/lib/subscription/entitlements'

interface Props {
  plan: string | null | undefined
  entitlement: UserEntitlementSnapshot
  totalMeetings: number
}

const PLAN_BADGE_STYLES: Record<string, string> = {
  free: 'bg-zinc-100 text-zinc-700',
  basic: 'bg-sky-100 text-sky-700',
  pro: 'bg-emerald-100 text-emerald-700',
  premium: 'bg-amber-100 text-amber-700',
}

function formatHours(seconds: number) {
  const hours = seconds / 3600
  if (hours === 0) return '0 hrs'
  if (Number.isInteger(hours)) return `${hours} hrs`
  return `${hours.toFixed(1)} hrs`
}

export function PlanSection({ plan, entitlement, totalMeetings }: Props) {
  const details = getSubscriptionPlan(plan)
  const planBadgeClass = PLAN_BADGE_STYLES[details.tier] ?? PLAN_BADGE_STYLES.free
  const transcriptReviewsUsed = entitlement.usage.transcript_review_jobs
  const transcriptReviewsLimit = details.transcriptReviewJobs
  const transcriptionHoursUsed = entitlement.usage.transcription_seconds_used
  const transcriptionHoursLimit = details.transcriptionHours * 3600
  const extractMinuteSummary = details.extractMinuteMonthlyLimit == null
    ? 'Unlimited'
    : `${entitlement.usage.extract_minute_runs}/${details.extractMinuteMonthlyLimit}`

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Billing & Subscription</h2>
        <p className="text-sm text-muted-foreground">Your current plan, included usage, and remaining credits.</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <CreditCard className="h-4 w-4 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">Current Plan</CardTitle>
              <p className="text-xs text-muted-foreground">
                {details.label} • RM{details.priceRmMonthly}/month • {details.supportLabel}
              </p>
            </div>
          </div>
          <Badge className={planBadgeClass}>{details.label}</Badge>
        </CardHeader>

        <CardContent className="space-y-4">
          {entitlement.subscriptionSetupPending ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              Usage and credits will appear once the latest subscription database update is ready.
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border p-4">
              <p className="text-xs text-muted-foreground">Transcript reviews</p>
              <p className="mt-1 text-2xl font-semibold">
                {transcriptReviewsUsed}/{transcriptReviewsLimit}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Remaining: {entitlement.transcriptReviewJobsRemaining}
              </p>
            </div>

            <div className="rounded-lg border p-4">
              <p className="text-xs text-muted-foreground">Transcription hours</p>
              <p className="mt-1 text-2xl font-semibold">
                {details.transcriptionHours > 0
                  ? `${formatHours(transcriptionHoursUsed)} / ${formatHours(transcriptionHoursLimit)}`
                  : 'Not included'}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {details.transcriptionHours > 0
                  ? `Remaining included: ${formatHours(entitlement.transcriptionSecondsRemaining)}`
                  : 'Top up to unlock audio/video usage'}
              </p>
            </div>

            <div className="rounded-lg border p-4">
              <p className="text-xs text-muted-foreground">Credits left</p>
              <p className="mt-1 flex items-center gap-2 text-2xl font-semibold">
                <Wallet className="h-4 w-4 text-primary" />
                {entitlement.totalCreditsRemaining}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Included: {entitlement.includedCreditsRemaining} • Wallet: {entitlement.walletCreditsRemaining}
              </p>
            </div>

            <div className="rounded-lg border p-4">
              <p className="text-xs text-muted-foreground">Extract Minute</p>
              <p className="mt-1 text-2xl font-semibold">{extractMinuteSummary}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {details.extractMinuteMonthlyLimit == null
                  ? 'Available whenever you need it'
                  : `${entitlement.extractMinuteRunsRemaining ?? 0} runs remaining this month`}
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <div className="rounded-lg border border-dashed p-4">
              <p className="text-xs text-muted-foreground">Operators included</p>
              <p className="mt-1 text-base font-semibold">{details.operatorsLabel}</p>
            </div>
            <div className="rounded-lg border border-dashed p-4">
              <p className="text-xs text-muted-foreground">Secretariats</p>
              <p className="mt-1 text-base font-semibold">{details.committeeAllowanceLabel}</p>
            </div>
            <div className="rounded-lg border border-dashed p-4">
              <p className="text-xs text-muted-foreground">Meetings created</p>
              <p className="mt-1 text-base font-semibold">{totalMeetings}</p>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 p-4">
            <div>
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <Sparkles className="h-3.5 w-3.5" />
                Upgrade or top up manually
              </p>
              <p className="text-xs text-muted-foreground">
                View the Free, Basic, Pro, and Premium plans plus available top-up packs.
              </p>
            </div>
            <Button asChild>
              <Link href="/pricing">View pricing</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
