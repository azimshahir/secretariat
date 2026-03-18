'use client'

import { Textarea } from '@/components/ui/textarea'
import { getPersonaTemplate } from '@/lib/ai/persona-templates'
import { getSecretariatTemplate } from '@/lib/secretariat-templates'
import type { WizardState } from './wizard-types'
import { WizardRagUpload } from './wizard-rag-upload'

interface StepConfigurationProps {
  state: WizardState
  onChange: (updates: Partial<WizardState>) => void
}

export function StepConfiguration({ state, onChange }: StepConfigurationProps) {
  const isOthersIndustry = state.industry === 'Others'
  const hasCustomMeeting = !!state.customMeetingType && !state.selectedTemplateId && !state.selectedPersonaSlug

  let personaSummary: string | null = null
  let templateName = state.customMeetingType || 'Custom Committee'
  if (state.selectedTemplateId) {
    const t = getSecretariatTemplate(state.selectedTemplateId)
    personaSummary = t?.personaPrompt ?? null
    templateName = t?.name ?? templateName
  } else if (state.selectedPersonaSlug) {
    const p = getPersonaTemplate(state.selectedPersonaSlug)
    personaSummary = p?.persona_prompt ?? null
    templateName = p?.name ?? templateName
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs uppercase tracking-[0.24em] text-primary/65">Step 3</p>
        <h3 className="font-display text-2xl font-semibold tracking-[-0.04em] text-foreground">
          Configure your secretariat
        </h3>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
          Fine-tune the AI persona, invite operators, and optionally upload reference documents.
        </p>
      </div>

      {personaSummary && (
        <div className="rounded-[18px] border border-primary/15 bg-primary/5 p-4 space-y-2">
          <p className="text-xs uppercase tracking-[0.18em] text-primary/65">This Secretariat is expert in</p>
          <p className="text-sm leading-6 text-foreground">{templateName}</p>
          <p className="text-sm leading-6 text-muted-foreground">
            {personaSummary.slice(0, 300)}{personaSummary.length > 300 ? '...' : ''}
          </p>
        </div>
      )}

      <div className="space-y-2">
        <label htmlFor="enhance-note" className="text-sm font-medium">Enhance the persona (optional)</label>
        <Textarea id="enhance-note" value={state.enhanceNote}
          onChange={e => onChange({ enhanceNote: e.target.value })}
          placeholder="Add context about tone, specific regulatory references, recurring agenda themes..."
          className="min-h-[100px]" />
      </div>

      <div className="space-y-2">
        <label htmlFor="clarify-org" className="text-sm font-medium">
          Clarify your organization context{' '}
          {isOthersIndustry || hasCustomMeeting ? <span className="text-destructive">*</span> : '(optional)'}
        </label>
        <Textarea id="clarify-org" value={state.clarifyOrg}
          onChange={e => onChange({ clarifyOrg: e.target.value })}
          placeholder="Tell us about your organization structure, regulatory environment, or specific governance requirements..."
          className="min-h-[80px]" required={isOthersIndustry || hasCustomMeeting} />
      </div>

      <div className="space-y-2">
        <label htmlFor="invite-emails" className="text-sm font-medium">Invite operators (optional)</label>
        <Textarea id="invite-emails" value={state.inviteEmails}
          onChange={e => onChange({ inviteEmails: e.target.value })}
          placeholder="one.email@company.com, another.email@company.com" className="min-h-[80px]" />
        <p className="text-xs leading-5 text-muted-foreground">
          Each invite gives access only to this secretariat, not the whole organization.
        </p>
      </div>

      <WizardRagUpload files={state.ragFiles}
        onChange={ragFiles => onChange({ ragFiles })} />
    </div>
  )
}
