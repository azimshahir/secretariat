import { createPersonalizedSecretariatWizard, createSecretariatWizard } from '@/actions/secretariat'
import { logCustomIndustryRequest } from '@/actions/secretariat-wizard'
import { uploadCommitteeRagDocument } from '@/app/meeting/[id]/setup/rag-actions'
import { parseInviteEmails } from '@/lib/secretariat-access'
import type { IndustryCategory } from '@/lib/supabase/types'
import type { WizardState } from './wizard-types'

export async function submitWizard(state: WizardState): Promise<{ committeeId: string; slug: string }> {
  const isOthers = state.industry === 'Others'
  const hasCustom = !!state.customMeetingType && !state.selectedTemplateId && !state.selectedPersonaSlug

  if ((isOthers || hasCustom) && !state.clarifyOrg.trim()) {
    throw new Error('Please clarify your organization context for custom selections.')
  }

  if (isOthers || hasCustom) {
    await logCustomIndustryRequest({
      customIndustry: state.industry === 'Others' ? state.customIndustry : undefined,
      detectedIndustry: state.detectedIndustry ?? undefined,
      customMeetingType: hasCustom ? state.customMeetingType : undefined,
      selectedIndustry: state.industry ?? undefined,
      selectedMeetingType: state.selectedPersonaSlug ?? state.customMeetingType ?? undefined,
    })
  }

  const inviteEmails = parseInviteEmails(state.inviteEmails)
  let committeeId: string
  let slug: string

  if (hasCustom) {
    const name = state.customMeetingType.trim() || 'Custom Committee'
    const note = [state.enhanceNote, state.clarifyOrg].filter(Boolean).join('\n\n') || null
    const r = await createPersonalizedSecretariatWizard({
      category: (state.industry ?? 'Others') as IndustryCategory, committeeName: name, promptNote: note, inviteEmails,
    })
    committeeId = r.committeeId
    slug = r.slug
  } else {
    const r = await createSecretariatWizard({
      templateId: state.selectedTemplateId ?? undefined, personaSlug: state.selectedPersonaSlug ?? undefined,
      inviteEmails, source: 'standard_wizard_flow',
    })
    committeeId = r.committeeId
    slug = r.slug
  }

  for (const rag of state.ragFiles.filter(f => f.file)) {
    if (!rag.file) continue
    const docName = rag.category === 'Others' ? rag.customName.trim() || rag.category : rag.category
    await uploadCommitteeRagDocument(committeeId, rag.category, docName, rag.file)
  }

  return { committeeId, slug }
}
