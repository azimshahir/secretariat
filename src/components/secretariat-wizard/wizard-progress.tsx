'use client'

import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

const STEPS = [
  { num: 1, label: 'Industry' },
  { num: 2, label: 'Meeting Type' },
  { num: 3, label: 'Configuration' },
] as const

interface WizardProgressProps {
  currentStep: number
}

export function WizardProgress({ currentStep }: WizardProgressProps) {
  return (
    <div className="mb-6 flex items-center justify-center gap-0">
      {STEPS.map((s, i) => (
        <div key={s.num} className="flex items-center">
          <div className="flex items-center gap-2">
            <div className={cn(
              'flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors',
              currentStep === s.num ? 'bg-primary text-primary-foreground'
                : currentStep > s.num ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
            )}>
              {currentStep > s.num ? <Check className="h-4 w-4" /> : s.num}
            </div>
            <span className={cn('hidden text-sm font-medium sm:inline',
              currentStep === s.num ? 'text-foreground' : 'text-muted-foreground')}>
              {s.label}
            </span>
          </div>
          {i < STEPS.length - 1 && (
            <div className={cn('mx-3 h-px w-8 sm:w-12', currentStep > s.num ? 'bg-primary/30' : 'bg-border')} />
          )}
        </div>
      ))}
    </div>
  )
}
