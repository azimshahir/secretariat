'use client'

import { useTransition } from 'react'
import { Building2, Factory, Fuel, Heart, HelpCircle, Loader2, Search } from 'lucide-react'
import { toast } from 'sonner'

import { postJson } from '@/lib/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { IndustryCategory } from '@/lib/supabase/types'
import { cn } from '@/lib/utils'
import type { WizardState } from './wizard-types'

const INDUSTRIES: { id: IndustryCategory; label: string; desc: string; icon: typeof Building2 }[] = [
  { id: 'Banking', label: 'Banking', desc: 'Banks, financial institutions, and insurance companies.', icon: Building2 },
  { id: 'Construction & Property', label: 'Construction & Property', desc: 'Developers, contractors, and property management.', icon: Factory },
  { id: 'Oil & Gas', label: 'Oil & Gas', desc: 'Energy companies, upstream/downstream operations.', icon: Fuel },
  { id: 'NGOs & Foundations', label: 'NGOs & Foundations', desc: 'Non-profits, charitable trusts, and foundations.', icon: Heart },
  { id: 'Others', label: 'Others', desc: "Any other industry — we'll help classify it.", icon: HelpCircle },
]

interface StepIndustryProps {
  state: WizardState
  onChange: (updates: Partial<WizardState>) => void
}

export function StepIndustry({ state, onChange }: StepIndustryProps) {
  const [isPending, startTransition] = useTransition()

  function handleDetect() {
    if (!state.customIndustry.trim()) { toast.error('Please enter your industry first'); return }
    startTransition(async () => {
      try {
        const result = await postJson<{ ok: true; industry: string }>(
          '/api/secretariat-wizard/detect-industry',
          { customName: state.customIndustry },
        )
        onChange({ detectedIndustry: result.industry })
        toast.success(`Detected: ${result.industry}`)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to detect industry')
      }
    })
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs uppercase tracking-[0.24em] text-primary/65">Step 1</p>
        <h3 className="font-display text-2xl font-semibold tracking-[-0.04em] text-foreground">Choose your industry</h3>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
          Select the industry that best matches your organization. This determines the available meeting types and persona templates.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {INDUSTRIES.map(ind => {
          const selected = state.industry === ind.id
          const Icon = ind.icon
          return (
            <button key={ind.id} type="button"
              onClick={() => onChange({
                industry: ind.id, selectedFamilyId: null, selectedTemplateId: null,
                selectedPersonaSlug: null, customMeetingType: '', suggestedMeetingTypes: [],
              })}
              className={cn(
                'rounded-[18px] border px-4 py-4 text-left transition-all duration-200',
                selected
                  ? 'border-primary/30 bg-primary text-primary-foreground shadow-[0_18px_45px_-28px_rgba(8,98,98,0.72)]'
                  : 'border-border/70 bg-[linear-gradient(180deg,rgba(248,250,252,0.95),rgba(255,255,255,0.98))] hover:-translate-y-0.5 hover:border-primary/20 hover:bg-secondary/60'
              )}>
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-2">
                  <p className="font-medium">{ind.label}</p>
                  <p className={cn('text-sm leading-6', selected ? 'text-primary-foreground/82' : 'text-muted-foreground')}>
                    {ind.desc}
                  </p>
                </div>
                <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px]',
                  selected ? 'bg-white/14 text-white' : 'bg-primary/8 text-primary')}>
                  <Icon className="h-4 w-4" />
                </span>
              </div>
            </button>
          )
        })}
      </div>

      {state.industry === 'Others' && (
        <div className="rounded-[18px] border border-border/70 bg-secondary/30 p-4 space-y-3">
          <label htmlFor="custom-industry" className="text-sm font-medium">Describe your industry</label>
          <div className="flex gap-2">
            <Input id="custom-industry" value={state.customIndustry}
              onChange={e => onChange({ customIndustry: e.target.value })}
              placeholder="e.g. Telecommunications, Healthcare, Education..." className="flex-1" />
            <Button type="button" variant="outline" onClick={handleDetect}
              disabled={isPending || !state.customIndustry.trim()} className="gap-2">
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Detect
            </Button>
          </div>
          {state.detectedIndustry && (
            <p className="text-sm text-muted-foreground">
              Closest match: <span className="font-medium text-foreground">{state.detectedIndustry}</span>
            </p>
          )}
        </div>
      )}
    </div>
  )
}
