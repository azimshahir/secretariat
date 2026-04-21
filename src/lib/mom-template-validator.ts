import 'server-only'

import { createHash } from 'node:crypto'
import JSZip from 'jszip'
import type {
  MomExactBlockKind,
  MomTemplateProfileSummary,
  MomTemplateValidation,
} from './mom-template-types'
import { MOM_TEMPLATE_VALIDATION_VERSION as VALIDATION_VERSION } from './mom-template-types'

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

interface ParagraphInfo {
  text: string
  xml: string
  style: string | null
  hasNumbering: boolean
  level: number | null
  hasBold: boolean
}

function extractParagraphs(xml: string): ParagraphInfo[] {
  return Array.from(xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)).map(match => {
    const paragraphXml = match[0]
    const text = normalizeWhitespace(
      Array.from(paragraphXml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g))
        .map(item => decodeXmlText(item[1] ?? ''))
        .join(''),
    )
    const style = paragraphXml.match(/<w:pStyle\b[^>]*w:val="([^"]+)"/)?.[1] ?? null
    const hasNumbering = /<w:numPr\b/i.test(paragraphXml)
    const levelText = paragraphXml.match(/<w:ilvl\b[^>]*w:val="(\d+)"/)?.[1] ?? null
    const level = levelText == null ? null : Number(levelText)
    const hasBold = /<w:b(?:\s|\/|>)/i.test(paragraphXml) && !/<w:b\b[^>]*w:val="(?:false|0)"/i.test(paragraphXml)

    return {
      text,
      xml: paragraphXml,
      style,
      hasNumbering,
      level,
      hasBold,
    }
  })
}

function findContentStart(paragraphs: ParagraphInfo[]) {
  const strongMarkers = [
    /^opening\s+remark/i,
    /^noting.*status/i,
    /^confirmation.*minutes/i,
    /^matters\s+arising/i,
    /^\d+(\.\d+)+\s+\S/i,
    /^agenda\s+\d/i,
  ]

  const firstStrongMarker = paragraphs.findIndex(paragraph =>
    paragraph.text && strongMarkers.some(marker => marker.test(paragraph.text)),
  )
  if (firstStrongMarker >= 0) return firstStrongMarker

  let lastAttendanceMarker = -1
  paragraphs.forEach((paragraph, index) => {
    const text = paragraph.text.toUpperCase()
    if (/^(PRESENT|IN ATTENDANCE|ABSENT|OTHER ATTENDEES|BY INVITATION)/.test(text)) {
      lastAttendanceMarker = index
    }
  })

  if (lastAttendanceMarker >= 0) {
    for (let index = lastAttendanceMarker + 1; index < paragraphs.length; index += 1) {
      const paragraph = paragraphs[index]
      if (!paragraph.text) continue
      if (/^\d+(\.\d+)+\s+\S/i.test(paragraph.text)) return index
      if ((paragraph.style ?? '').toLowerCase().startsWith('heading')) return index
      if (paragraph.text.length >= 50) return index
    }
  }

  const firstNumbered = paragraphs.findIndex(paragraph => paragraph.hasNumbering || /^\d+(\.\d+)+\s+\S/i.test(paragraph.text))
  if (firstNumbered >= 0) return firstNumbered

  return -1
}

function findContentEnd(paragraphs: ParagraphInfo[]) {
  for (let index = paragraphs.length - 1; index >= 0; index -= 1) {
    const text = paragraphs[index].text.toLowerCase()
    if (!text) continue
    if (
      text.includes('prepared by')
      || text.includes('confirmed as correct')
      || text.includes('confirmed by')
      || text.includes('approved by')
    ) {
      return index
    }
  }
  return paragraphs.length
}

function collectParagraphKinds(paragraphs: ParagraphInfo[]): MomExactBlockKind[] {
  const kinds = new Set<MomExactBlockKind>()

  paragraphs.forEach(paragraph => {
    const text = paragraph.text
    if (!text) return

    if (/^\d+(\.\d+)+\s+\S/i.test(text)) {
      kinds.add('agenda-heading')
      return
    }

    if (paragraph.hasNumbering) {
      kinds.add('numbered-body')
      return
    }

    const isSectionHeading = paragraph.hasBold
      && text.length <= 90
      && (
        /^[A-Z0-9\s/&(),.-]+$/.test(text)
        || /^(noted|discussed|resolved|action by|status|decision)/i.test(text)
      )

    if (isSectionHeading) {
      kinds.add('section-heading')
      return
    }

    if (paragraph.hasBold && text.length > 0) {
      kinds.add('body-bold')
    }

    if (text.length > 0) {
      kinds.add('body')
    }
  })

  return [...kinds]
}

function detectAgendaHeadingSupport(paragraphs: ParagraphInfo[]) {
  return paragraphs.some(paragraph => /^\d+(\.\d+)+\s+\S/i.test(paragraph.text))
}

function getHeaderFooterTexts(xmlValues: string[]) {
  return xmlValues
    .flatMap(extractParagraphs)
    .map(paragraph => paragraph.text)
    .filter(Boolean)
}

function buildFingerprint(parts: string[]) {
  return createHash('sha1').update(parts.join('\n---\n')).digest('hex')
}

function buildUnsupportedValidation(
  fileName: string | null | undefined,
  reasons: string[],
): MomTemplateValidation {
  return {
    version: VALIDATION_VERSION,
    status: 'unsupported',
    reasons,
    validatedAt: new Date().toISOString(),
    fingerprint: buildFingerprint([fileName ?? '']),
    profileSummary: {
      templateMode: 'paragraph',
      contentZoneDetected: false,
      contentParagraphCount: 0,
      numberingParagraphCount: 0,
      headerReplaceable: false,
      footerReplaceable: false,
      paragraphKinds: [],
      unsupportedConstructs: [],
    },
  }
}

export async function validateMomTemplateBuffer(
  buffer: ArrayBuffer,
  fileName?: string | null,
): Promise<MomTemplateValidation> {
  const normalizedFileName = fileName?.trim() ?? ''
  if (!normalizedFileName.toLowerCase().endsWith('.docx')) {
    return buildUnsupportedValidation(normalizedFileName, [
      'Exact Word rendering requires a DOCX template.',
    ])
  }

  const zip = await JSZip.loadAsync(buffer)
  const documentXml = await zip.file('word/document.xml')?.async('string')
  if (!documentXml) {
    return buildUnsupportedValidation(normalizedFileName, [
      'The uploaded DOCX is missing word/document.xml.',
    ])
  }

  const headerXmls = await Promise.all(
    Object.keys(zip.files)
      .filter(path => /^word\/header\d+\.xml$/i.test(path))
      .sort()
      .map(async path => zip.file(path)?.async('string') ?? ''),
  )
  const footerXmls = await Promise.all(
    Object.keys(zip.files)
      .filter(path => /^word\/footer\d+\.xml$/i.test(path))
      .sort()
      .map(async path => zip.file(path)?.async('string') ?? ''),
  )
  const numberingXml = await zip.file('word/numbering.xml')?.async('string') ?? ''
  const paragraphs = extractParagraphs(documentXml)
  const contentStart = findContentStart(paragraphs)
  const contentEnd = findContentEnd(paragraphs)
  const contentParagraphs = contentStart >= 0
    ? paragraphs.slice(contentStart, Math.max(contentStart, contentEnd))
    : []
  const numberingParagraphCount = contentParagraphs.filter(paragraph => paragraph.hasNumbering).length
  const paragraphKinds = collectParagraphKinds(contentParagraphs)
  const hasExplicitAgendaHeadingPattern = detectAgendaHeadingSupport(contentParagraphs)
  const headerTexts = getHeaderFooterTexts(headerXmls)
  const footerTexts = getHeaderFooterTexts(footerXmls)
  const prefaceTexts = paragraphs.slice(0, Math.max(contentStart, 0)).map(paragraph => paragraph.text).filter(Boolean)
  const headerReplaceable = [...headerTexts, ...prefaceTexts].some(text =>
    /minutes?\s+of/i.test(text)
    || /^date\s*:/i.test(text)
    || /meeting\s+no\.?/i.test(text),
  )
  const footerReplaceable = footerTexts.some(text =>
    /\|\s*page\b/i.test(text)
    || /\b\d{1,2}\/\d{4}\b/.test(text)
    || /minutes?\s+of/i.test(text),
  )

  const unsupportedConstructs: string[] = []
  if (/<w:txbxContent\b/i.test(documentXml)) {
    unsupportedConstructs.push('Text boxes detected inside the document body.')
  }
  if (/<mc:AlternateContent\b/i.test(documentXml)) {
    unsupportedConstructs.push('AlternateContent blocks detected in the document body.')
  }
  if (!numberingXml.trim()) {
    unsupportedConstructs.push('No Word numbering definitions were found.')
  }

  const profileSummary: MomTemplateProfileSummary = {
    templateMode: /<w:tbl\b/i.test(documentXml) && contentParagraphs.length > 0 ? 'mixed' : /<w:tbl\b/i.test(documentXml) ? 'table' : 'paragraph',
    contentZoneDetected: contentStart >= 0 && contentParagraphs.length > 0,
    contentParagraphCount: contentParagraphs.filter(paragraph => paragraph.text).length,
    numberingParagraphCount,
    headerReplaceable,
    footerReplaceable,
    paragraphKinds,
    unsupportedConstructs,
  }

  const reasons: string[] = []
  if (!profileSummary.contentZoneDetected) {
    reasons.push('Could not detect a stable Minute of Meeting content zone.')
  }
  if (profileSummary.contentParagraphCount < 6) {
    reasons.push('The template content zone is too small to learn stable paragraph archetypes.')
  }
  if (!paragraphKinds.includes('body')) {
    reasons.push('No reusable normal body paragraph pattern was detected.')
  }
  if (numberingParagraphCount === 0) {
    reasons.push('No reusable numbered paragraph pattern was detected.')
  }
  if (!paragraphKinds.includes('section-heading') && !paragraphKinds.includes('body-bold')) {
    reasons.push('No reusable bold paragraph pattern was detected.')
  }
  if (unsupportedConstructs.length > 0) {
    reasons.push(...unsupportedConstructs)
  }
  if (!hasExplicitAgendaHeadingPattern) {
    reasons.push('No explicit agenda heading example was found, so agenda titles will be generated using the template numbering archetype.')
  }
  if (!headerReplaceable) {
    reasons.push('No replaceable meeting header fields were detected; the renderer will rely on generated title/body blocks instead.')
  }
  if (!footerReplaceable) {
    reasons.push('No replaceable footer reference was detected; footer text will be preserved as-is.')
  }

  let status: MomTemplateValidation['status'] = 'exact_supported'
  if (!profileSummary.contentZoneDetected || profileSummary.contentParagraphCount < 4) {
    status = 'unsupported'
  } else if (
    !paragraphKinds.includes('body')
    || numberingParagraphCount === 0
    || (!paragraphKinds.includes('section-heading') && !paragraphKinds.includes('body-bold'))
  ) {
    status = 'limited'
  }

  if (status === 'exact_supported') {
    reasons.unshift('Template passed exact numbering/body archetype checks.')
  }

  return {
    version: VALIDATION_VERSION,
    status,
    reasons,
    validatedAt: new Date().toISOString(),
    fingerprint: buildFingerprint([
      normalizedFileName,
      documentXml,
      ...headerXmls,
      ...footerXmls,
      numberingXml,
    ]),
    profileSummary,
  }
}
