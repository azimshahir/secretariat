'use client'

import { useState, useTransition } from 'react'
import { Save, Coins } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { updateBillingSettings } from './actions'

interface Props {
  initialCreditsPerHour: number
  initialCreditPriceRm: number
}

export function BillingSettings({ initialCreditsPerHour, initialCreditPriceRm }: Props) {
  const [creditsPerHour, setCreditsPerHour] = useState(String(initialCreditsPerHour))
  const [creditPriceRm, setCreditPriceRm] = useState(String(initialCreditPriceRm))
  const [pending, startTransition] = useTransition()

  const rate = Math.max(1, Math.trunc(Number(creditsPerHour) || 0))
  const price = Math.max(0, Number(creditPriceRm) || 0)

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Coins className="h-4 w-4 text-emerald-600" /> Credit & Billing Rates
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-zinc-500">
          Everything is paid with a single credit balance. Set how many credits one hour of
          transcription costs, and the price per credit for self-service top-ups.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-zinc-700 dark:text-zinc-300">
              Credits per transcription hour
            </span>
            <input
              type="number"
              min={1}
              step={1}
              value={creditsPerHour}
              onChange={e => setCreditsPerHour(e.target.value)}
              disabled={pending}
              className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-800"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-medium text-zinc-700 dark:text-zinc-300">
              Price per credit (RM)
            </span>
            <input
              type="number"
              min={0.01}
              step={0.01}
              value={creditPriceRm}
              onChange={e => setCreditPriceRm(e.target.value)}
              disabled={pending}
              className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-800"
            />
          </label>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
          1 hour transcription ≈ <span className="font-medium">{rate} credits</span> ·
          1 credit = <span className="font-medium">RM {price.toFixed(2)}</span> ·
          1 hour transcription ≈ <span className="font-medium">RM {(rate * price).toFixed(2)}</span>
        </div>

        <Button
          type="button"
          disabled={pending}
          onClick={() => {
            startTransition(async () => {
              try {
                await updateBillingSettings({
                  creditsPerTranscriptionHour: rate,
                  creditPriceRm: price,
                })
                toast.success('Billing rates saved')
              } catch (error) {
                toast.error(error instanceof Error ? error.message : 'Failed to save billing rates')
              }
            })
          }}
          className="gap-1.5"
        >
          <Save className="h-3.5 w-3.5" />
          {pending ? 'Saving...' : 'Save rates'}
        </Button>
      </CardContent>
    </Card>
  )
}
