'use client'

import { useEffect, useMemo, useRef, useTransition } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { postJson } from '@/lib/api/client'
import type { PersonaTemplate } from '@/lib/ai/persona-templates'
import { SECRETARIAT_FAMILIES, SECRETARIAT_TEMPLATES } from '@/lib/secretariat-templates'
import type { WizardState } from './wizard-types'
import { FamilyCards, TemplateCards, PersonaCards, SuggestionCards } from './meeting-type-cards'

interface StepMeetingTypeProps {
  state: WizardState
  onChange: (updates: Partial<WizardState>) => void
  personaTemplates: PersonaTemplate[]
}

export function StepMeetingType({ state, onChange, personaTemplates }: StepMeetingTypeProps) {
  const isBanking = state.industry === 'Banking'
  const isOthers = state.industry === 'Others'
  const [isPending, startTransition] = useTransition()
  const hasFetchedRef = useRef(false)

  const categoryTemplates = useMemo(
    () => (state.industry && !isBanking ? personaTemplates.filter(t => t.category === state.industry) : []),
    [state.industry, isBanking, personaTemplates]
  )

  const bankingTemplates = useMemo(
    () => (state.selectedFamilyId ? SECRETARIAT_TEMPLATES.filter(t => t.familyId === state.selectedFamilyId) : []),
    [state.selectedFamilyId]
  )

  useEffect(() => {
    if (isOthers && !hasFetchedRef.current && state.customIndustry.trim()) {
      hasFetchedRef.current = true
      startTransition(async () => {
        try {
          const result = await postJson<{
            ok: true
            suggestions: { name: string; description: string }[]
          }>('/api/secretariat-wizard/suggest-meeting-types', {
            industry: state.customIndustry,
          })
          onChange({ suggestedMeetingTypes: result.suggestions })
        } catch (error) {
          toast.error(
            error instanceof Error ? error.message : 'Failed to suggest meeting types',
          )
        }
      })
    }
    if (!isOthers) {
      hasFetchedRef.current = false
    }
  }, [isOthers, state.customIndustry, onChange])

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs uppercase tracking-[0.24em] text-primary/65">Step 2</p>
        <h3 className="font-display text-2xl font-semibold tracking-[-0.04em] text-foreground">
          {isBanking ? 'Choose the secretariat lane' : 'Choose the meeting type'}
        </h3>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
          {isBanking
            ? 'Start with the governance family, then pick the specific committee template.'
            : 'Select a pre-built persona or describe a custom meeting type.'}
        </p>
      </div>

      {isBanking && (
        <>
          <FamilyCards families={[...SECRETARIAT_FAMILIES]} selectedId={state.selectedFamilyId}
            onSelect={id => {
              const first = SECRETARIAT_TEMPLATES.find(t => t.familyId === id)
              onChange({ selectedFamilyId: id as typeof state.selectedFamilyId, selectedTemplateId: first?.id ?? null, selectedPersonaSlug: null })
            }} />
          {state.selectedFamilyId && (
            <TemplateCards templates={bankingTemplates} selectedId={state.selectedTemplateId}
              onSelect={id => onChange({ selectedTemplateId: id, selectedPersonaSlug: null })} />
          )}
        </>
      )}

      {!isBanking && !isOthers && categoryTemplates.length > 0 && (
        <PersonaCards templates={categoryTemplates} selectedSlug={state.selectedPersonaSlug}
          onSelect={slug => onChange({ selectedPersonaSlug: slug, selectedTemplateId: null, customMeetingType: '' })} />
      )}

      {isOthers && (
        <>
          {isPending && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Suggesting meeting types...
            </div>
          )}
          <SuggestionCards suggestions={state.suggestedMeetingTypes} selectedName={state.customMeetingType}
            onSelect={name => onChange({ customMeetingType: name, selectedTemplateId: null, selectedPersonaSlug: null })}
            customValue={state.customMeetingType}
            onCustomChange={val => onChange({ customMeetingType: val, selectedTemplateId: null, selectedPersonaSlug: null })} />
        </>
      )}
    </div>
  )
}
