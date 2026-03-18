'use client'

import { useCallback, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, Check, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { StepConfiguration } from './step-configuration'
import { StepIndustry } from './step-industry'
import { StepMeetingType } from './step-meeting-type'
import { WizardProgress } from './wizard-progress'
import { submitWizard } from './wizard-submit'
import type { WizardProps, WizardState } from './wizard-types'

const INITIAL_STATE: WizardState = {
  step: 1, industry: null, customIndustry: '', detectedIndustry: null,
  selectedFamilyId: null, selectedTemplateId: null, selectedPersonaSlug: null,
  customMeetingType: '', suggestedMeetingTypes: [],
  enhanceNote: '', clarifyOrg: '', inviteEmails: '',
  ragFiles: [{ id: 'rag-1', category: 'TOR', customName: '', file: null }],
}

export function SecretariatWizard({ existingSecretariats, firstRun, personaTemplates }: WizardProps) {
  const router = useRouter()
  const [state, setState] = useState<WizardState>(INITIAL_STATE)
  const [isPending, startTransition] = useTransition()
  const onChange = useCallback((u: Partial<WizardState>) => setState(p => ({ ...p, ...u })), [])

  function canGoNext() {
    if (state.step === 1) return !!state.industry
    if (state.step === 2) {
      if (state.industry === 'Banking') return !!state.selectedTemplateId
      return !!(state.selectedPersonaSlug || state.customMeetingType.trim())
    }
    return true
  }

  function handleSubmit() {
    startTransition(async () => {
      try {
        const { slug } = await submitWizard(state)
        toast.success('Secretariat created successfully')
        router.push(`/secretariat/${slug}`)
      } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed to create secretariat') }
    })
  }

  return (
    <div className="grid gap-6">
      {/* Wizard steps */}
      <section className="rounded-[24px] border border-border/70 bg-white/92 p-5 shadow-[0_24px_70px_-42px_rgba(15,23,42,0.38)] backdrop-blur md:p-6">
        <WizardProgress currentStep={state.step} />
        {state.step === 1 && <StepIndustry state={state} onChange={onChange} />}
        {state.step === 2 && <StepMeetingType state={state} onChange={onChange} personaTemplates={personaTemplates} />}
        {state.step === 3 && <StepConfiguration state={state} onChange={onChange} />}
        <div className="mt-6 flex items-center justify-between border-t border-border/50 pt-5">
          <Button type="button" variant="outline" onClick={() => onChange({ step: (state.step - 1) as 1 | 2 | 3 })}
            disabled={state.step === 1 || isPending} className="gap-2 rounded-[14px]">
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          {state.step < 3 ? (
            <Button type="button" onClick={() => onChange({ step: (state.step + 1) as 1 | 2 | 3 })}
              disabled={!canGoNext() || isPending} className="gap-2 rounded-[14px]">
              Next <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button type="button" onClick={handleSubmit} disabled={isPending} className="gap-2 rounded-[14px]">
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Create Secretariat
            </Button>
          )}
        </div>
      </section>
    </div>
  )
}
