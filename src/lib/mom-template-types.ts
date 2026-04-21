export const MOM_TEMPLATE_VALIDATION_VERSION = 2

export type MomTemplateValidationStatus = 'exact_supported' | 'limited' | 'unsupported'

export type MomExactBlockKind =
  | 'agenda-heading'
  | 'section-heading'
  | 'numbered-body'
  | 'body'
  | 'body-bold'

export interface MomTemplateProfileSummary {
  templateMode: 'paragraph' | 'mixed' | 'table'
  contentZoneDetected: boolean
  contentParagraphCount: number
  numberingParagraphCount: number
  headerReplaceable: boolean
  footerReplaceable: boolean
  paragraphKinds: MomExactBlockKind[]
  unsupportedConstructs: string[]
}

export interface MomTemplateValidation {
  version?: number
  status: MomTemplateValidationStatus
  reasons: string[]
  validatedAt: string
  fingerprint: string
  profileSummary: MomTemplateProfileSummary
}

export interface MomExactRun {
  text: string
  bold: boolean
}

export interface MomExactBlock {
  kind: MomExactBlockKind
  level: 0 | 1 | 2
  runs: MomExactRun[]
}

export interface MomExactDocument {
  blocks: MomExactBlock[]
}

export function isCurrentMomTemplateValidation(
  validation: MomTemplateValidation | null | undefined,
) {
  return validation?.version === MOM_TEMPLATE_VALIDATION_VERSION
}
