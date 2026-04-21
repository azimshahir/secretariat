import type {
  MinutePlaybookRecord,
  MinutePlaybookMode,
  MinutePlaybookScope,
  MinutePlaybookVariantKey,
} from '@/lib/meeting-generation/minute-playbooks'

export interface AgendaFormattingVariantState {
  id: string | null
  variantKey: MinutePlaybookVariantKey
  label: string
  templateId: string | null
  templateName: string | null
  promptText: string
  compiledTemplateVersion: number | null
  isCompiled: boolean
}

export interface CommitteePlaybookOption {
  playbookId: string
  name: string
  scope: MinutePlaybookScope
  isReusable: boolean
  playbookMode: MinutePlaybookMode
  resolutionPathsEnabled: boolean
  hasResolutionAnchor: boolean
  defaultVariantKey: MinutePlaybookVariantKey
  variants: AgendaFormattingVariantState[]
}

export interface SavedAgendaFormatting {
  agendaId: string
  playbookId: string | null
  playbookName: string
  playbookScope: MinutePlaybookScope
  playbookMode: MinutePlaybookMode
  resolutionPathsEnabled: boolean
  hasResolutionAnchor: boolean
  templateId: string
  templateName: string
  promptText: string
  additionalInfo: string
  compiledTemplateVersion: number
  isCompiled: boolean
  variantOverrideId: string | null
  variantOverrideKey: MinutePlaybookVariantKey | null
  defaultVariantKey: MinutePlaybookVariantKey
  variants: AgendaFormattingVariantState[]
}

export interface AgendaFormattingState {
  agendaId: string
  playbookId: string | null
  playbookName: string | null
  playbookScope: MinutePlaybookScope | null
  playbookMode: MinutePlaybookMode
  resolutionPathsEnabled: boolean
  hasResolutionAnchor: boolean
  templateId: string | null
  templateName: string | null
  promptText: string
  additionalInfo: string
  compiledTemplateVersion: number | null
  isCompiled: boolean
  variantOverrideId: string | null
  variantOverrideKey: MinutePlaybookVariantKey | null
  defaultVariantKey: MinutePlaybookVariantKey | null
  variants: AgendaFormattingVariantState[]
  availablePlaybooks: CommitteePlaybookOption[]
}

export type SettingsMinutePlaybook = MinutePlaybookRecord
