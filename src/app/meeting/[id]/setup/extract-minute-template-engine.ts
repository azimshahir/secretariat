import JSZip from 'jszip'
import type {
  ExtractMinuteBodyItem,
  ExtractMinuteDownloadResult,
} from '@/lib/extract-minute-types'

const NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

function normalizeWhitespace(value: string) {
  return value
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function getDirectChildren(element: Element, tagName: string) {
  return Array.from(element.childNodes).filter(
    node => node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === tagName,
  ) as Element[]
}

function getDirectRows(table: Element) {
  return getDirectChildren(table, 'w:tr')
}

function getDirectCells(row: Element) {
  return getDirectChildren(row, 'w:tc')
}

function getParagraphText(paragraph: Element) {
  return Array.from(paragraph.getElementsByTagName('w:t'))
    .map(node => node.textContent ?? '')
    .join('')
}

function getCellText(cell: Element) {
  return normalizeWhitespace(
    Array.from(cell.getElementsByTagName('w:t'))
      .map(node => node.textContent ?? '')
      .join('\n'),
  )
}

function setParagraphText(paragraph: Element, text: string) {
  const textNodes = paragraph.getElementsByTagName('w:t')
  if (textNodes.length === 0) {
    const run = paragraph.ownerDocument.createElementNS(NS, 'w:r')
    const textNode = paragraph.ownerDocument.createElementNS(NS, 'w:t')
    textNode.setAttribute('xml:space', 'preserve')
    textNode.textContent = text
    run.appendChild(textNode)
    paragraph.appendChild(run)
    return
  }

  textNodes[0].textContent = text
  textNodes[0].setAttribute('xml:space', 'preserve')

  for (let index = textNodes.length - 1; index >= 1; index -= 1) {
    textNodes[index].parentNode?.removeChild(textNodes[index])
  }

  const runs = Array.from(paragraph.getElementsByTagName('w:r'))
  for (let index = runs.length - 1; index >= 1; index -= 1) {
    if (!runs[index].getElementsByTagName('w:t').length) {
      runs[index].parentNode?.removeChild(runs[index])
    }
  }
}

function paragraphHasBold(paragraph: Element) {
  const runProperties = paragraph.getElementsByTagName('w:rPr')
  for (let index = 0; index < runProperties.length; index += 1) {
    const boldTags = runProperties[index].getElementsByTagName('w:b')
    if (boldTags.length === 0) continue
    const value = boldTags[0].getAttribute('w:val')
    if (value !== 'false' && value !== '0') return true
  }
  return false
}

function cloneParagraphTemplate(paragraphTemplates: Element[], emphasis: ExtractMinuteBodyItem['emphasis']) {
  const visibleTemplates = paragraphTemplates.filter(paragraph => normalizeWhitespace(getParagraphText(paragraph)).length > 0)
  const boldTemplate = visibleTemplates.find(paragraphHasBold)
  const normalTemplate = visibleTemplates.find(paragraph => !paragraphHasBold(paragraph))
  const fallback = visibleTemplates[0] ?? paragraphTemplates[0]

  const template = emphasis === 'strong'
    ? (boldTemplate ?? fallback)
    : (normalTemplate ?? fallback)

  return ((template?.cloneNode(true) as Element | undefined)
    ?? (paragraphTemplates[0].cloneNode(true) as Element))
}

function setCellParagraphs(cell: Element, items: ExtractMinuteBodyItem[]) {
  const directParagraphs = getDirectChildren(cell, 'w:p')
  const paragraphTemplates = directParagraphs.length > 0
    ? directParagraphs.map(paragraph => paragraph.cloneNode(true) as Element)
    : [cell.ownerDocument.createElementNS(NS, 'w:p')]
  const cellProps = getDirectChildren(cell, 'w:tcPr')[0]?.cloneNode(true) as Element | undefined

  while (cell.firstChild) {
    cell.removeChild(cell.firstChild)
  }

  if (cellProps) {
    cell.appendChild(cellProps)
  }

  const safeItems = items.length > 0 ? items : [{ text: '', emphasis: 'normal' as const }]
  safeItems.forEach(item => {
    const paragraph = cloneParagraphTemplate(paragraphTemplates, item.emphasis)
    setParagraphText(paragraph, item.text)
    cell.appendChild(paragraph)
  })
}

function replaceLabelValue(text: string, value: string) {
  return text.replace(/^([^:]+:\s*).*$/i, `$1${value}`)
}

function replaceDatePatterns(text: string, formattedDate: string) {
  const patterns = [
    /\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}/gi,
    /\d{1,2}\/\d{1,2}\/\d{4}/g,
    /\d{4}-\d{2}-\d{2}/g,
  ]

  return patterns.reduce((value, pattern) => value.replace(pattern, formattedDate), text)
}

function extractMeetingReference(value: string) {
  const direct = value.match(/\b([A-Z]{2,}(?:[-/][A-Z0-9]+)*\s+\d{1,2}\/\d{4})\b/)
  if (direct?.[1]) return normalizeWhitespace(direct[1])

  const short = value.match(/\b([A-Z]{2,})\s*(\d{1,2}\/\d{4})\b/)
  if (!short) return null
  return `${short[1]} ${short[2]}`
}

function replaceMeetingReference(text: string, meetingReference: string | null) {
  if (!meetingReference) return text
  return text.replace(/\b[A-Z]{2,}(?:[-/][A-Z0-9]+)*\s+\d{1,2}\/\d{4}\b/g, meetingReference)
}

function replaceFooterReference(text: string, footerReference: string | null) {
  if (!footerReference) return text

  if (/\|\s*page\b/i.test(text)) {
    return text.replace(/^.*?(?=\|\s*page\b)/i, `${footerReference} `)
  }

  return text.replace(/\b[A-Z]{2,}(?:\/[A-Z]{2,})+\/\d{1,2}-\d{4}\b/i, footerReference)
}

function looksLikeExtractTitle(text: string) {
  return /extract/i.test(text) && /minutes?/i.test(text)
}

function looksLikeMeetingLine(text: string) {
  return /\|\s*/.test(text) || /meeting\s+no\.?/i.test(text) || /\b[A-Z]{2,}\s*\d{1,2}\/\d{4}\b/.test(text)
}

function looksLikeAgendaLine(text: string) {
  return /^agenda\b/i.test(text) || (/agenda/i.test(text) && /\d/.test(text))
}

function looksLikePresenterLine(text: string) {
  return /^(presenter|owner|presented by)\s*:/i.test(text)
}

function paragraphHasFields(paragraph: Element) {
  return paragraph.getElementsByTagName('w:fldChar').length > 0
    || paragraph.getElementsByTagName('w:instrText').length > 0
}

function updateParagraphByHeuristics(paragraph: Element, payload: ExtractMinuteDownloadResult) {
  const text = normalizeWhitespace(getParagraphText(paragraph))
  if (!text) return false

  const meetingReference = extractMeetingReference(payload.meetingTitle)
  let nextText: string | null = null

  if (looksLikeExtractTitle(text)) {
    nextText = payload.headerValues.documentTitle
  } else if (payload.headerValues.meetingLine && looksLikeMeetingLine(text)) {
    nextText = payload.headerValues.meetingLine
  } else if (looksLikeAgendaLine(text)) {
    nextText = payload.headerValues.agendaHeading
  } else if (payload.headerValues.presenterLine && looksLikePresenterLine(text)) {
    nextText = payload.headerValues.presenterLine
  } else if (/^date\s*:/i.test(text)) {
    nextText = replaceLabelValue(text, payload.formattedDate)
  } else if (payload.headerValues.footerReference && (/\|\s*page\b/i.test(text) || /\/\d{1,2}-\d{4}\b/.test(text))) {
    nextText = replaceFooterReference(text, payload.headerValues.footerReference)
  } else {
    const withDate = replaceDatePatterns(text, payload.formattedDate)
    const withMeetingRef = replaceMeetingReference(withDate, meetingReference)
    nextText = replaceFooterReference(withMeetingRef, payload.headerValues.footerReference)
  }

  if (nextText && nextText !== text) {
    setParagraphText(paragraph, nextText)
    return true
  }

  return false
}

function updateParagraphTextRuns(paragraph: Element, payload: ExtractMinuteDownloadResult) {
  const text = normalizeWhitespace(getParagraphText(paragraph))
  if (!text) return false

  if (!paragraphHasFields(paragraph)) {
    return updateParagraphByHeuristics(paragraph, payload)
  }

  const meetingReference = extractMeetingReference(payload.meetingTitle)
  const textNodes = Array.from(paragraph.getElementsByTagName('w:t'))
  let changed = false

  textNodes.forEach(textNode => {
    const original = textNode.textContent ?? ''
    let next = replaceDatePatterns(original, payload.formattedDate)
    next = replaceMeetingReference(next, meetingReference)
    next = replaceFooterReference(next, payload.headerValues.footerReference)
    if (next !== original) {
      textNode.textContent = next
      textNode.setAttribute('xml:space', 'preserve')
      changed = true
    }
  })

  return changed
}

function updateBodyHeaderParagraphs(body: Element, payload: ExtractMinuteDownloadResult) {
  const paragraphs: Element[] = []

  for (const child of Array.from(body.childNodes)) {
    if (child.nodeType !== Node.ELEMENT_NODE) continue
    const element = child as Element
    if (element.tagName === 'w:tbl') break
    if (element.tagName === 'w:p') paragraphs.push(element)
  }

  const nonEmptyParagraphs = paragraphs.filter(paragraph => normalizeWhitespace(getParagraphText(paragraph)).length > 0)
  const replaced = new Set<Element>()

  nonEmptyParagraphs.forEach(paragraph => {
    if (updateParagraphByHeuristics(paragraph, payload)) {
      replaced.add(paragraph)
    }
  })

  const remainingParagraphs = nonEmptyParagraphs.filter(paragraph => !replaced.has(paragraph))
  if (remainingParagraphs.length > 0 && !nonEmptyParagraphs.some(paragraph => getParagraphText(paragraph) === payload.headerValues.documentTitle)) {
    setParagraphText(remainingParagraphs[0], payload.headerValues.documentTitle)
  }
  if (remainingParagraphs.length > 1 && payload.headerValues.meetingLine) {
    setParagraphText(remainingParagraphs[1], payload.headerValues.meetingLine)
  }
}

function replaceTableContent(table: Element, payload: ExtractMinuteDownloadResult) {
  const rows = getDirectRows(table)
  if (rows.length === 0) return false

  let headingRow: Element | null = null
  let contentStartIndex = -1
  let contentEndIndex = -1

  rows.forEach((row, index) => {
    const cells = getDirectCells(row)
    if (!headingRow && cells.length === 1) {
      const text = getCellText(cells[0])
      if (looksLikeAgendaLine(text) || /agenda/i.test(text) || index === 0) {
        headingRow = row
      }
    }

    if (cells.length >= 2) {
      if (contentStartIndex === -1) contentStartIndex = index
      if (contentEndIndex === -1 || index === contentEndIndex + 1) {
        contentEndIndex = index
      }
    } else if (contentStartIndex !== -1 && contentEndIndex !== -1 && index > contentEndIndex) {
      return
    }
  })

  if (headingRow) {
    const headingCell = getDirectCells(headingRow)[0]
    if (headingCell) {
      setCellParagraphs(headingCell, [{ text: payload.headerValues.agendaHeading, emphasis: 'strong' }])
    }
  }

  if (contentStartIndex === -1 || contentEndIndex === -1) {
    return false
  }

  const templateRow = rows[contentStartIndex]
  const insertionPoint = rows[contentEndIndex + 1] ?? null

  for (let index = contentEndIndex; index >= contentStartIndex; index -= 1) {
    table.removeChild(rows[index])
  }

  payload.sections.forEach(section => {
    const row = templateRow.cloneNode(true) as Element
    const cells = getDirectCells(row)
    if (cells[0]) {
      setCellParagraphs(cells[0], [{ text: section.label, emphasis: 'strong' }])
    }
    if (cells[1]) {
      setCellParagraphs(cells[1], section.items)
    }
    for (let index = 2; index < cells.length; index += 1) {
      setCellParagraphs(cells[index], [{ text: '', emphasis: 'normal' }])
    }
    table.insertBefore(row, insertionPoint)
  })

  return true
}

function flattenSectionsToParagraphItems(payload: ExtractMinuteDownloadResult) {
  const items: ExtractMinuteBodyItem[] = []
  payload.sections.forEach(section => {
    items.push({ text: section.label, emphasis: 'strong' })
    section.items.forEach(item => items.push(item))
  })
  return items
}

function findParagraphContentStart(paragraphs: Element[]) {
  const markers = [
    /^(noted|discussed|resolved|decision|action items?)/i,
    /^(action by|pic|status|due date)\s*:/i,
    /^agenda\b/i,
  ]

  for (let index = 0; index < paragraphs.length; index += 1) {
    const text = normalizeWhitespace(getParagraphText(paragraphs[index]))
    if (!text) continue
    if (markers.some(marker => marker.test(text))) return index
  }

  return Math.min(Math.max(2, Math.floor(paragraphs.length * 0.25)), paragraphs.length)
}

function findParagraphContentEnd(paragraphs: Element[]) {
  for (let index = paragraphs.length - 1; index >= 0; index -= 1) {
    const text = normalizeWhitespace(getParagraphText(paragraphs[index])).toLowerCase()
    if (
      text.includes('prepared by')
      || text.includes('confirmed as correct')
      || text.includes('signed by')
    ) {
      return index
    }
  }

  return paragraphs.length
}

function replaceParagraphContent(body: Element, payload: ExtractMinuteDownloadResult) {
  const topLevelParagraphs = getDirectChildren(body, 'w:p')
  if (topLevelParagraphs.length === 0) return

  const contentStart = findParagraphContentStart(topLevelParagraphs)
  const contentEnd = findParagraphContentEnd(topLevelParagraphs)
  const insertBefore = topLevelParagraphs[contentEnd] ?? getDirectChildren(body, 'w:sectPr')[0] ?? null
  const paragraphTemplates = topLevelParagraphs
    .slice(contentStart, Math.max(contentStart + 1, contentEnd))
    .map(paragraph => paragraph.cloneNode(true) as Element)

  for (let index = contentEnd - 1; index >= contentStart; index -= 1) {
    body.removeChild(topLevelParagraphs[index])
  }

  const contentItems = flattenSectionsToParagraphItems(payload)
  contentItems.forEach(item => {
    const paragraph = cloneParagraphTemplate(
      paragraphTemplates.length > 0 ? paragraphTemplates : [body.ownerDocument.createElementNS(NS, 'w:p')],
      item.emphasis,
    )
    setParagraphText(paragraph, item.text)
    body.insertBefore(paragraph, insertBefore)
  })
}

function updateXmlPart(xml: string, payload: ExtractMinuteDownloadResult) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xml, 'application/xml')
  const paragraphs = Array.from(doc.getElementsByTagName('w:p'))
  paragraphs.forEach(paragraph => {
    updateParagraphTextRuns(paragraph, payload)
  })
  return new XMLSerializer().serializeToString(doc)
}

export async function buildExtractMinuteFromTemplate(
  templateBuffer: ArrayBuffer,
  payload: ExtractMinuteDownloadResult,
): Promise<Blob> {
  const zip = await JSZip.loadAsync(templateBuffer)
  const documentXml = await zip.file('word/document.xml')?.async('string')
  if (!documentXml) throw new Error('Invalid DOCX: missing word/document.xml')

  const parser = new DOMParser()
  const doc = parser.parseFromString(documentXml, 'application/xml')
  const body = doc.getElementsByTagName('w:body')[0]
  if (!body) throw new Error('Invalid DOCX: missing w:body')

  updateBodyHeaderParagraphs(body, payload)

  const firstTable = body.getElementsByTagName('w:tbl')[0]
  const tableReplaced = firstTable ? replaceTableContent(firstTable, payload) : false
  if (!tableReplaced) {
    replaceParagraphContent(body, payload)
  }

  const serializer = new XMLSerializer()
  zip.file('word/document.xml', serializer.serializeToString(doc))

  const relatedParts = Object.keys(zip.files).filter(
    name => /^word\/header\d+\.xml$/i.test(name) || /^word\/footer\d+\.xml$/i.test(name),
  )
  await Promise.all(relatedParts.map(async name => {
    const xml = await zip.file(name)?.async('string')
    if (!xml) return
    zip.file(name, updateXmlPart(xml, payload))
  }))

  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
}
