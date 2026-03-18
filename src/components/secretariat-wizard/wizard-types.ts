import type { IndustryCategory } from '@/lib/supabase/types'
import type { PersonaTemplate } from '@/lib/ai/persona-templates'
import type { SecretariatFamilyId } from '@/lib/secretariat-templates'

export interface RagDraft {
  id: string
  category: 'TOR' | 'Policy' | 'Framework' | 'Manual' | 'Books' | 'Others'
  customName: string
  file: File | null
}

export interface WizardState {
  step: 1 | 2 | 3
  // Step 1
  industry: IndustryCategory | null
  customIndustry: string
  detectedIndustry: string | null
  // Step 2
  selectedFamilyId: SecretariatFamilyId | null
  selectedTemplateId: string | null
  selectedPersonaSlug: string | null
  customMeetingType: string
  suggestedMeetingTypes: { name: string; description: string }[]
  // Step 3
  enhanceNote: string
  clarifyOrg: string
  inviteEmails: string
  ragFiles: RagDraft[]
}

export interface ExistingSecretariat {
  slug: string
  name: string
}

export interface WizardProps {
  existingSecretariats: ExistingSecretariat[]
  firstRun: boolean
  personaTemplates: PersonaTemplate[]
}
