export type ExtractMinuteTemplateMode = 'table' | 'paragraph'

export type ExtractMinuteItemEmphasis = 'normal' | 'strong'

export interface ExtractMinuteBodyItem {
  text: string
  emphasis: ExtractMinuteItemEmphasis
}

export interface ExtractMinuteSection {
  label: string
  items: ExtractMinuteBodyItem[]
}

export interface ExtractMinuteHeaderValues {
  documentTitle: string
  meetingLine: string | null
  agendaHeading: string
  presenterLine: string | null
  footerReference: string | null
}

export interface ExtractMinuteTemplateSummary {
  templateMode: ExtractMinuteTemplateMode
  headerTexts: string[]
  footerTexts: string[]
  sectionLabels: string[]
  bodySample: string
  hasReadableContent: boolean
}

export interface ExtractMinuteDownloadResult {
  templateUrl: string
  meetingTitle: string
  formattedDate: string
  agendaNo: string
  agendaTitle: string
  presenter: string | null
  templateMode: ExtractMinuteTemplateMode
  headerValues: ExtractMinuteHeaderValues
  sections: ExtractMinuteSection[]
}
