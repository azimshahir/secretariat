import { generateObject } from 'ai'
import JSZip from 'jszip'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { resolveLanguageModelForUserPlan } from '@/lib/ai/model-config'
import { getDefaultPersona } from '@/lib/ai/personas'
import { extractDocxText } from '@/lib/docx-utils'
import {
  assertExtractMinuteAllowed,
  recordExtractMinuteUsage,
} from '@/lib/subscription/entitlements'
import type {
  ExtractMinuteDownloadResult,
  ExtractMinuteTemplateSummary,
  ExtractMinuteSection,
  ExtractMinuteHeaderValues,
} from '@/lib/extract-minute-types'
import { uuidSchema } from '@/lib/validation'
import {
  hydrateTemplateGroups,
  TEMPLATE_SECTION_IDS,
  type LegacyItineraryTemplate,
} from '@/app/meeting/[id]/setup/settings-template-model'

const generatedBodyItemSchema = z.object({
  text: z.string().trim().min(1),
  emphasis: z.enum(['normal', 'strong']),
})

const generatedSectionSchema = z.object({
  label: z.string().trim().min(1),
  items: z.array(generatedBodyItemSchema).min(1),
})

const requiredNullableGeneratedHeaderValueSchema = z.union([
  z.string().trim().min(1),
  z.null(),
])

const generatedHeaderValuesSchema = z.object({
  documentTitle: z.string().trim().min(1),
  meetingLine: requiredNullableGeneratedHeaderValueSchema,
  agendaHeading: z.string().trim().min(1),
  presenterLine: requiredNullableGeneratedHeaderValueSchema,
  footerReference: requiredNullableGeneratedHeaderValueSchema,
})

const generatedExtractMinuteSchema = z.object({
  headerValues: generatedHeaderValuesSchema,
  sections: z.array(generatedSectionSchema).min(1),
})

const openAiTemplateSummarySchema = z.object({
  templateMode: z.enum(['table', 'paragraph']),
  headerTexts: z.array(z.string().trim()).default([]),
  footerTexts: z.array(z.string().trim()).default([]),
  sectionLabels: z.array(z.string().trim()).default([]),
  bodySample: z.string().trim().default(''),
})

const MIN_TEMPLATE_CONTENT_LENGTH = 80
const TEMPLATE_SUMMARY_CHAR_LIMIT = 4000

function isDocxTemplatePath(value: string | null | undefined) {
  return Boolean(value?.trim().toLowerCase().endsWith('.docx'))
}

function normalizeWhitespace(value: string) {
  return value
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function decodeXmlText(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
  }

function uniqueStrings(values: string[]) {
  return [...new Set(values.map(value => normalizeWhitespace(value)).filter(Boolean))]
}

function getXmlParagraphTexts(xml: string) {
  return Array.from(xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g))
    .map(match => {
      const text = Array.from(match[0].matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g))
        .map(item => decodeXmlText(item[1] ?? ''))
        .join('')
      return normalizeWhitespace(text)
    })
    .filter(Boolean)
}

function getTableRowsFromXml(xml: string) {
  return Array.from(xml.matchAll(/<w:tbl\b[\s\S]*?<\/w:tbl>/g)).map(tableMatch => ({
    rows: Array.from(tableMatch[0].matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)).map(rowMatch => ({
      cells: Array.from(rowMatch[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)).map(cellMatch => (
        getXmlParagraphTexts(cellMatch[0]).join('\n')
      )),
    })),
  }))
}

function looksLikeSectionLabel(value: string) {
  const normalized = normalizeWhitespace(value)
  if (!normalized) return false
  if (normalized.length > 80) return false
  if (/^agenda\b/i.test(normalized)) return false
  if (/^[A-Z0-9\s/&(),.-]+$/.test(normalized)) return true
  return /^(noted|discussed|resolved|action|action by|pic|owner|status|due date)/i.test(normalized)
}

function detectParagraphSectionLabels(paragraphs: string[]) {
  return uniqueStrings(
    paragraphs.filter(paragraph => {
      if (!paragraph) return false
      if (paragraph.length > 80) return false
      return looksLikeSectionLabel(paragraph) || /:\s*$/.test(paragraph)
    }),
  )
}

function summarizeTableRows(rows: { cells: string[] }[]) {
  return rows
    .slice(0, 10)
    .map(row => row.cells.map(cell => normalizeWhitespace(cell)).filter(Boolean).join(' | '))
    .filter(Boolean)
    .join('\n')
}

function buildTemplateSummaryFromDocx(params: {
  documentXml: string
  headerXmls: string[]
  footerXmls: string[]
  rawText: string
}): ExtractMinuteTemplateSummary {
  const documentParagraphs = getXmlParagraphTexts(params.documentXml)
  const tables = getTableRowsFromXml(params.documentXml)
  const firstStructuredTable = tables.find(table =>
    table.rows.some(row => row.cells.length >= 2 && row.cells.some(cell => normalizeWhitespace(cell).length > 0)),
  )

  const sectionLabels = firstStructuredTable
    ? uniqueStrings(
        firstStructuredTable.rows
          .map(row => normalizeWhitespace(row.cells[0] ?? ''))
          .filter(looksLikeSectionLabel),
      )
    : detectParagraphSectionLabels(documentParagraphs)

  const bodySample = firstStructuredTable
    ? summarizeTableRows(firstStructuredTable.rows)
    : normalizeWhitespace(
        documentParagraphs
          .slice(0, 18)
          .join('\n'),
      )

  const headerTexts = uniqueStrings(params.headerXmls.flatMap(getXmlParagraphTexts))
  const footerTexts = uniqueStrings(params.footerXmls.flatMap(getXmlParagraphTexts))
  const fallbackRawText = normalizeWhitespace(params.rawText)
  const combinedBodySample = bodySample || fallbackRawText.slice(0, TEMPLATE_SUMMARY_CHAR_LIMIT)
  const hasReadableContent = combinedBodySample.length >= MIN_TEMPLATE_CONTENT_LENGTH || sectionLabels.length > 0

  return {
    templateMode: firstStructuredTable ? 'table' : 'paragraph',
    headerTexts,
    footerTexts,
    sectionLabels,
    bodySample: combinedBodySample.slice(0, TEMPLATE_SUMMARY_CHAR_LIMIT),
    hasReadableContent,
  }
}

function isTemplateSummarySufficient(summary: ExtractMinuteTemplateSummary) {
  if (summary.bodySample.length >= MIN_TEMPLATE_CONTENT_LENGTH) return true
  return summary.sectionLabels.length > 0
}

function extractOutputTextFromOpenAiResponse(payload: unknown) {
  if (payload && typeof payload === 'object') {
    const row = payload as Record<string, unknown>
    if (typeof row.output_text === 'string' && row.output_text.trim()) {
      return row.output_text.trim()
    }

    if (Array.isArray(row.output)) {
      const chunks: string[] = []
      row.output.forEach(item => {
        if (!item || typeof item !== 'object') return
        const outputItem = item as Record<string, unknown>
        if (typeof outputItem.text === 'string' && outputItem.text.trim()) {
          chunks.push(outputItem.text.trim())
        }
        if (Array.isArray(outputItem.content)) {
          outputItem.content.forEach(contentItem => {
            if (!contentItem || typeof contentItem !== 'object') return
            const contentRow = contentItem as Record<string, unknown>
            if (typeof contentRow.text === 'string' && contentRow.text.trim()) {
              chunks.push(contentRow.text.trim())
            } else if (
              contentRow.text
              && typeof contentRow.text === 'object'
              && typeof (contentRow.text as Record<string, unknown>).value === 'string'
            ) {
              chunks.push(((contentRow.text as Record<string, unknown>).value as string).trim())
            }
          })
        }
      })
      return chunks.join('\n').trim()
    }
  }

  return null
}

function extractJsonPayload(text: string) {
  const direct = text.trim()
  const fenced = direct.match(/```json\s*([\s\S]*?)```/i)?.[1]
    ?? direct.match(/```([\s\S]*?)```/)?.[1]
  const candidates = [direct, fenced].filter(Boolean) as string[]
  const objectMatch = direct.match(/\{[\s\S]*\}/)?.[0]
  if (objectMatch) candidates.push(objectMatch)

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch {
      continue
    }
  }

  return null
}

async function uploadTemplateToOpenAi(apiKey: string, buffer: ArrayBuffer, fileName: string) {
  const purposes = ['user_data', 'assistants']
  const failures: string[] = []

  for (const purpose of purposes) {
    const formData = new FormData()
    formData.append('purpose', purpose)
    formData.append(
      'file',
      new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
      fileName || 'extract-minute-template.docx',
    )

    const response = await fetch('https://api.openai.com/v1/files', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    })

    if (!response.ok) {
      failures.push(`[${purpose}] ${await response.text()}`)
      continue
    }

    const payload = await response.json() as { id?: string }
    if (payload.id) return payload.id
    failures.push(`[${purpose}] missing file id in upload response`)
  }

  throw new Error(`Template upload failed: ${failures.join(' | ')}`)
}

async function requestTemplateSummaryFromOpenAi(apiKey: string, fileId: string) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.EXTRACT_MINUTE_TEMPLATE_OCR_MODEL || 'gpt-4.1-mini',
      temperature: 0,
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: [
                'Analyze this Extract Minute DOCX template.',
                'Return ONLY JSON with this exact shape:',
                '{',
                '  "templateMode": "table" | "paragraph",',
                '  "headerTexts": string[],',
                '  "footerTexts": string[],',
                '  "sectionLabels": string[],',
                '  "bodySample": string',
                '}',
                'Identify the body structure, header/footer reference text, and section labels such as Noted / Resolved / Action By when present.',
                'Keep bodySample concise and representative.',
              ].join('\n'),
            },
            {
              type: 'input_file',
              file_id: fileId,
            },
          ],
        },
      ],
    }),
  })

  if (!response.ok) {
    throw new Error(`Template OCR request failed: ${await response.text()}`)
  }

  const payload = await response.json()
  const outputText = extractOutputTextFromOpenAiResponse(payload)
  if (!outputText) {
    throw new Error('Template OCR response did not contain text output')
  }

  const jsonPayload = extractJsonPayload(outputText)
  if (!jsonPayload) {
    throw new Error('Template OCR response did not contain valid JSON')
  }

  const parsed = openAiTemplateSummarySchema.parse(jsonPayload)
  return {
    templateMode: parsed.templateMode,
    headerTexts: uniqueStrings(parsed.headerTexts),
    footerTexts: uniqueStrings(parsed.footerTexts),
    sectionLabels: uniqueStrings(parsed.sectionLabels),
    bodySample: normalizeWhitespace(parsed.bodySample).slice(0, TEMPLATE_SUMMARY_CHAR_LIMIT),
    hasReadableContent: Boolean(
      normalizeWhitespace(parsed.bodySample).length >= MIN_TEMPLATE_CONTENT_LENGTH
      || parsed.sectionLabels.length > 0,
    ),
  } satisfies ExtractMinuteTemplateSummary
}

async function deleteOpenAiFile(apiKey: string, fileId: string) {
  await fetch(`https://api.openai.com/v1/files/${fileId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${apiKey}` },
  }).catch(() => undefined)
}

async function summarizeTemplateWithFallback(
  templateBuffer: ArrayBuffer,
  templateFileName: string,
): Promise<ExtractMinuteTemplateSummary> {
  const zip = await JSZip.loadAsync(templateBuffer)
  const documentXml = await zip.file('word/document.xml')?.async('string')
  if (!documentXml) {
    throw new Error('Extract Minute template could not be read. Re-upload the DOCX template and try again.')
  }

  const headerXmls = await Promise.all(
    Object.keys(zip.files)
      .filter(name => /^word\/header\d+\.xml$/i.test(name))
      .map(async name => zip.file(name)?.async('string') ?? ''),
  )

  const footerXmls = await Promise.all(
    Object.keys(zip.files)
      .filter(name => /^word\/footer\d+\.xml$/i.test(name))
      .map(async name => zip.file(name)?.async('string') ?? ''),
  )

  const rawText = await extractDocxText(templateBuffer)
  const directSummary = buildTemplateSummaryFromDocx({
    documentXml,
    headerXmls,
    footerXmls,
    rawText,
  })
  if (isTemplateSummarySufficient(directSummary)) {
    return directSummary
  }

  const mammoth = (await import('mammoth')).default
  const mammothText = normalizeWhitespace(
    (await mammoth.extractRawText({ buffer: Buffer.from(templateBuffer) })).value,
  )
  if (mammothText.length >= MIN_TEMPLATE_CONTENT_LENGTH) {
    return {
      ...directSummary,
      bodySample: mammothText.slice(0, TEMPLATE_SUMMARY_CHAR_LIMIT),
      hasReadableContent: true,
    }
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) {
    return directSummary
  }

  let fileId = ''
  try {
    fileId = await uploadTemplateToOpenAi(apiKey, templateBuffer, templateFileName)
    const aiSummary = await requestTemplateSummaryFromOpenAi(apiKey, fileId)
    return {
      templateMode: aiSummary.templateMode,
      headerTexts: uniqueStrings([...directSummary.headerTexts, ...aiSummary.headerTexts]),
      footerTexts: uniqueStrings([...directSummary.footerTexts, ...aiSummary.footerTexts]),
      sectionLabels: uniqueStrings([...directSummary.sectionLabels, ...aiSummary.sectionLabels]),
      bodySample: aiSummary.bodySample || directSummary.bodySample,
      hasReadableContent: aiSummary.hasReadableContent || directSummary.hasReadableContent,
    }
  } finally {
    if (fileId) await deleteOpenAiFile(apiKey, fileId)
  }
}

function formatDate(dateValue: string) {
  const date = new Date(dateValue)
  if (Number.isNaN(date.getTime())) return dateValue
  return date.toLocaleDateString('en-MY', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function extractMeetingReference(value: string) {
  const direct = value.match(/\b([A-Z]{2,}(?:[-/][A-Z0-9]+)*\s+\d{1,2}\/\d{4})\b/)
  if (direct?.[1]) return normalizeWhitespace(direct[1])

  const short = value.match(/\b([A-Z]{2,})\s*(\d{1,2}\/\d{4})\b/)
  if (!short) return null
  return `${short[1]} ${short[2]}`
}

function buildFooterReference(params: {
  meetingReference: string | null
  footerTexts: string[]
}) {
  if (!params.meetingReference) return null

  const meetingMatch = params.meetingReference.match(/^([A-Z]{2,}(?:[-/][A-Z0-9]+)*)\s+(\d{1,2})\/(\d{4})$/)
  if (!meetingMatch) return null

  const [, prefix, monthOrRun, year] = meetingMatch
  const templatePrefix = params.footerTexts
    .map(text => text.match(/\b([A-Z]{2,}(?:\/[A-Z]{2,})+)\b/)?.[1] ?? null)
    .find(Boolean)

  if (templatePrefix) {
    return `${templatePrefix}/${monthOrRun}-${year}`
  }

  return `${prefix}/EXM/${monthOrRun}-${year}`
}

function buildDefaultHeaderValues(params: {
  meetingTitle: string
  formattedDate: string
  agendaNo: string
  agendaTitle: string
  presenter: string | null
  templateSummary: ExtractMinuteTemplateSummary
}) {
  const meetingReference = extractMeetingReference(params.meetingTitle)
  const meetingLine = meetingReference
    ? `${meetingReference} | ${params.formattedDate}`
    : `${params.meetingTitle} | ${params.formattedDate}`

  return {
    documentTitle: `Extract of Minutes - ${params.meetingTitle}`,
    meetingLine,
    agendaHeading: `Agenda ${params.agendaNo}: ${params.agendaTitle}`,
    presenterLine: params.presenter ? `Presenter: ${params.presenter}` : null,
    footerReference: buildFooterReference({
      meetingReference,
      footerTexts: params.templateSummary.footerTexts,
    }),
  } satisfies ExtractMinuteHeaderValues
}

function renderTemplateSummary(summary: ExtractMinuteTemplateSummary) {
  return [
    `Template mode: ${summary.templateMode}`,
    `Header text samples: ${summary.headerTexts.length > 0 ? summary.headerTexts.join(' | ') : '(none detected)'}`,
    `Footer text samples: ${summary.footerTexts.length > 0 ? summary.footerTexts.join(' | ') : '(none detected)'}`,
    `Section labels: ${summary.sectionLabels.length > 0 ? summary.sectionLabels.join(' | ') : '(not clearly detected)'}`,
    'Template body sample:',
    summary.bodySample || '(empty)',
  ].join('\n')
}

function mergeGeneratedHeaderValues(
  generated: z.infer<typeof generatedHeaderValuesSchema>,
  fallback: ExtractMinuteHeaderValues,
) {
  return {
    documentTitle: generated.documentTitle?.trim() || fallback.documentTitle,
    meetingLine: generated.meetingLine?.trim() || fallback.meetingLine,
    agendaHeading: generated.agendaHeading?.trim() || fallback.agendaHeading,
    presenterLine: generated.presenterLine?.trim() || fallback.presenterLine,
    footerReference: generated.footerReference?.trim() || fallback.footerReference,
  } satisfies ExtractMinuteHeaderValues
}

function mergeGeneratedSections(
  generatedSections: z.infer<typeof generatedSectionSchema>[],
  templateSummary: ExtractMinuteTemplateSummary,
): ExtractMinuteSection[] {
  const cleanedSections = generatedSections
    .map<ExtractMinuteSection>(section => ({
      label: normalizeWhitespace(section.label),
      items: section.items
        .map<ExtractMinuteSection['items'][number]>(item => ({
          text: normalizeWhitespace(item.text),
          emphasis: item.emphasis === 'strong' ? 'strong' : 'normal',
        }))
        .filter(item => item.text.length > 0),
    }))
    .filter(section => section.label && section.items.length > 0)

  if (cleanedSections.length > 0) {
    return cleanedSections
  }

  return templateSummary.sectionLabels.map(label => ({
    label,
    items: [{ text: '', emphasis: 'normal' as const }],
  }))
}

function collectExtractMinuteErrorMessages(error: unknown, seen = new Set<unknown>()): string[] {
  if (!error || seen.has(error)) return []
  seen.add(error)

  if (error instanceof Error) {
    const messages = [error.message].filter(Boolean)
    const cause = 'cause' in error ? (error as Error & { cause?: unknown }).cause : undefined
    return [...messages, ...collectExtractMinuteErrorMessages(cause, seen)]
  }

  if (typeof error === 'string') return [error]

  if (typeof error === 'object') {
    const row = error as Record<string, unknown>
    const messages: string[] = []

    if (typeof row.message === 'string' && row.message.trim()) {
      messages.push(row.message.trim())
    }
    if (typeof row.error === 'string' && row.error.trim()) {
      messages.push(row.error.trim())
    }
    if (typeof row.cause !== 'undefined') {
      messages.push(...collectExtractMinuteErrorMessages(row.cause, seen))
    }

    return messages
  }

  return [String(error)]
}

function isExtractMinuteStructuredOutputFailure(error: unknown) {
  const message = collectExtractMinuteErrorMessages(error).join(' | ')

  return (
    /invalid schema for response format/i.test(message)
    || /structured output/i.test(message)
    || /response format/i.test(message)
    || /no object generated/i.test(message)
    || /failed to parse object/i.test(message)
    || /did not match schema/i.test(message)
    || /schema validation/i.test(message)
  )
}

function toExtractMinuteStructuredOutputError() {
  return new Error('Extract Minute could not be generated due to an AI formatting issue. Please try again.')
}

export async function prepareExtractMinuteForDownload(
  meetingId: string,
  agendaId: string,
  minuteContentOverride?: string,
): Promise<ExtractMinuteDownloadResult> {
  uuidSchema.parse(meetingId)
  uuidSchema.parse(agendaId)

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const [{ data: meeting }, { data: agenda }] = await Promise.all([
    supabase
      .from('meetings')
      .select('id, title, meeting_date, organization_id, committee_id, meeting_rules, template_section_overrides, committees(id, slug, persona_prompt)')
      .eq('id', meetingId)
      .single(),
    supabase
      .from('agendas')
      .select('id, meeting_id, agenda_no, title, presenter, is_skipped')
      .eq('id', agendaId)
      .eq('meeting_id', meetingId)
      .single(),
  ])

  if (!meeting) throw new Error('Meeting not found')
  if (!agenda) throw new Error('Agenda not found')
  if (agenda.is_skipped) throw new Error('Extract Minute is not available for agendas marked as Not Minuted')

  const entitlement = await assertExtractMinuteAllowed({
    userId: user.id,
    organizationId: meeting.organization_id,
  })

  const overrideContent = minuteContentOverride?.trim() ?? ''
  let minuteContent = overrideContent

  if (!minuteContent) {
    const { data: minutes, error: minuteError } = await supabase
      .from('minutes')
      .select('content')
      .eq('agenda_id', agendaId)
      .eq('is_current', true)
      .order('updated_at', { ascending: false })
      .order('generated_at', { ascending: false })
      .limit(1)

    if (minuteError) {
      throw new Error(minuteError.message)
    }

    minuteContent = minutes?.[0]?.content?.trim() ?? ''
  }

  if (!minuteContent) {
    throw new Error('No minute content is available for this agenda yet')
  }

  const committee = meeting.committees as unknown as {
    id: string
    slug: string
    persona_prompt: string | null
  } | null

  let effectiveGroups = hydrateTemplateGroups({
    minuteInstruction: typeof meeting.meeting_rules === 'string' ? meeting.meeting_rules : '',
    persistedGroups: Array.isArray(meeting.template_section_overrides) ? meeting.template_section_overrides : [],
  })

  if (committee?.id) {
    const [{ data: settings }, { data: itineraryTemplates }] = await Promise.all([
      supabase
        .from('committee_generation_settings')
        .select('minute_instruction, template_sections')
        .eq('committee_id', committee.id)
        .maybeSingle(),
      supabase
        .from('itinerary_templates')
        .select('section_key, storage_path, file_name')
        .eq('committee_id', committee.id),
    ])

    effectiveGroups = hydrateTemplateGroups({
      minuteInstruction: typeof meeting.meeting_rules === 'string' && meeting.meeting_rules.trim().length > 0
        ? meeting.meeting_rules
        : settings?.minute_instruction ?? '',
      itineraryTemplates: (itineraryTemplates ?? []) as LegacyItineraryTemplate[],
      persistedGroups: Array.isArray(meeting.template_section_overrides) && meeting.template_section_overrides.length > 0
        ? meeting.template_section_overrides
        : settings?.template_sections ?? [],
    })
  }

  const extractSection = effectiveGroups
    .flatMap(group => group.sections)
    .find(section => section.id === TEMPLATE_SECTION_IDS.extractMinute)

  if (!extractSection?.templateStoragePath) {
    throw new Error('Upload an Extract Minute DOCX template in Settings > Itineraries first')
  }
  if (!isDocxTemplatePath(extractSection.templateStoragePath) && !isDocxTemplatePath(extractSection.templateFileName)) {
    throw new Error('Extract Minute requires a DOCX template in Settings > Itineraries')
  }

  const { data: fileData, error: templateDownloadError } = await supabase.storage
    .from('meeting-files')
    .download(extractSection.templateStoragePath)
  if (templateDownloadError) {
    throw new Error(templateDownloadError.message)
  }
  if (!fileData) {
    throw new Error('Extract Minute template file could not be loaded')
  }

  const templateBuffer = await fileData.arrayBuffer()
  const templateSummary = await summarizeTemplateWithFallback(
    templateBuffer,
    extractSection.templateFileName || extractSection.templateStoragePath.split('/').pop() || 'extract-minute-template.docx',
  )
  if (!templateSummary.hasReadableContent) {
    throw new Error('Extract Minute template could not be read. Re-upload the DOCX template and try again.')
  }

  const { data: signedUrlData, error: signedUrlError } = await supabase.storage
    .from('meeting-files')
    .createSignedUrl(extractSection.templateStoragePath, 3600)
  if (signedUrlError || !signedUrlData?.signedUrl) {
    throw new Error(signedUrlError?.message ?? 'Failed to prepare the Extract Minute template download')
  }

  const formattedDate = formatDate(meeting.meeting_date)
  const persona = committee?.persona_prompt || getDefaultPersona(committee?.slug ?? 'board')
  const model = await resolveLanguageModelForUserPlan(
    meeting.organization_id,
    entitlement.planTier,
    'generate_itineraries',
  )
  const fallbackHeaderValues = buildDefaultHeaderValues({
    meetingTitle: meeting.title,
    formattedDate,
    agendaNo: agenda.agenda_no,
    agendaTitle: agenda.title,
    presenter: agenda.presenter ?? null,
    templateSummary,
  })

  let object: z.infer<typeof generatedExtractMinuteSchema>
  try {
    const result = await generateObject({
      model,
      schema: generatedExtractMinuteSchema,
      system: persona,
      prompt: `You are preparing an Extract Minute document for exactly one agenda item.

CURRENT MEETING
- Title: ${meeting.title}
- Date: ${formattedDate}
- Agenda No: ${agenda.agenda_no}
- Agenda Title: ${agenda.title}
- Presenter: ${agenda.presenter ?? 'TBC'}

TEMPLATE SUMMARY
${renderTemplateSummary(templateSummary)}

${extractSection.prompt.trim() ? `SECRETARIAT INSTRUCTIONS:\n${extractSection.prompt.trim()}\n` : ''}SOURCE MINUTE CONTENT FOR THIS AGENDA ONLY
---
${minuteContent}
---

TASK
- Generate an agenda-specific Extract Minute that follows the uploaded template as closely as possible.
- Replace the old agenda context with the current meeting, current date, current agenda number/title, and current presenter.
- Preserve every decision, instruction, PIC, due date, status, and action from the source minute content.
- Do not summarize away important content and do not invent facts.
- Return section labels in the same order and wording style as the template whenever they are detectable.
- If the template is table-based, each section should map cleanly into one table row: label on the left, section content on the right.
- If the template is paragraph-based, still keep section ordering and phrasing consistent with the template.
- Keep references, header phrasing, and footer reference style aligned with the template samples.

OUTPUT RULES
- Return structured JSON only via the schema.
- "headerValues.documentTitle" should be the main title line shown in the document body/header.
- "headerValues.meetingLine" should capture the meeting/date reference line if the template uses one; otherwise null.
- "headerValues.agendaHeading" should be the agenda heading that belongs above or inside the main body container.
- "headerValues.presenterLine" should be a presenter/owner line only when the template supports it; otherwise null.
- "headerValues.footerReference" should be the current meeting reference/footer code only when the template uses one; otherwise null.
- Every section item must include "emphasis" with either "normal" or "strong".
- Each section item should be a final sentence or paragraph-ready line with no markdown, bullets, or numbering unless the template wording clearly requires it.`,
    })
    object = result.object
  } catch (error) {
    const errorMessage = collectExtractMinuteErrorMessages(error).join(' | ')
    console.error('[Extract Minute] Generation failed', {
      meetingId,
      agendaId,
      error: errorMessage || String(error),
    })

    if (isExtractMinuteStructuredOutputFailure(error)) {
      throw toExtractMinuteStructuredOutputError()
    }
    throw error
  }

  await recordExtractMinuteUsage({
    userId: user.id,
    organizationId: meeting.organization_id,
    meetingId: meeting.id,
  })

  return {
    templateUrl: signedUrlData.signedUrl,
    meetingTitle: meeting.title,
    formattedDate,
    agendaNo: agenda.agenda_no,
    agendaTitle: agenda.title,
    presenter: agenda.presenter ?? null,
    templateMode: templateSummary.templateMode,
    headerValues: mergeGeneratedHeaderValues(object.headerValues, fallbackHeaderValues),
    sections: mergeGeneratedSections(object.sections, templateSummary),
  }
}
