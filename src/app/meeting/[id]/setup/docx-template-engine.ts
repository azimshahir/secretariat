import JSZip from 'jszip'

const WORDPROCESSING_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

export type TemplateParagraphKind = 'title' | 'body' | 'value'

export interface TemplateParagraphData {
  text: string
  kind?: TemplateParagraphKind
}

export type TemplateCellContent = string | {
  paragraphs: TemplateParagraphData[]
}

interface TemplateData {
  meetingTitle: string
  meetingDate: string
  sectionTitle: string
  meetingReference?: string | null
  mode?: 'generic' | 'matter-arising'
  rows: TemplateCellContent[][] // each row = [col1, col2, ...]
}

/**
 * Build a DOCX by injecting data into an uploaded template.
 * Opens the template as a zip, manipulates word/document.xml,
 * replaces table data rows (cloning the first data row for formatting),
 * updates title/date text, and re-zips.
 */
export async function buildDocxFromTemplate(
  templateBuffer: ArrayBuffer,
  data: TemplateData,
): Promise<Blob> {
  const zip = await JSZip.loadAsync(templateBuffer)
  const docXml = await zip.file('word/document.xml')?.async('string')
  if (!docXml) throw new Error('Invalid DOCX: missing word/document.xml')

  const parser = new DOMParser()
  const doc = parser.parseFromString(docXml, 'application/xml')
  const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

  // --- Update title/date text before the table ---
  updateHeaderText(doc, ns, data)

  // --- Replace table data rows ---
  const tables = doc.getElementsByTagName('w:tbl')
  if (tables.length > 0) {
    replaceTableRows(tables[0], ns, data.rows)
  }

  // Serialize back
  const serializer = new XMLSerializer()
  const updatedXml = serializer.serializeToString(doc)
  zip.file('word/document.xml', updatedXml)

  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
}

function updateHeaderText(doc: Document, ns: string, data: TemplateData) {
  const tables = doc.getElementsByTagName('w:tbl')
  const firstTable = tables[0]

  // Collect all <w:t> elements that appear before the first table
  const allTextNodes = Array.from(doc.getElementsByTagName('w:t'))
  const headerTexts = firstTable
    ? allTextNodes.filter(node => firstTable.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING)
    : allTextNodes

  const formattedDate = formatDate(data.meetingDate)
  const datePatterns = [
    /\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}/i,
    /\d{1,2}\/\d{1,2}\/\d{4}/,
    /\d{4}-\d{2}-\d{2}/,
  ]
  const meetingReferencePattern = /\b\d{1,2}\/\d{2,4}\b/

  for (const textNode of headerTexts) {
    const text = textNode.textContent ?? ''

    if (data.mode === 'matter-arising' && data.meetingReference && meetingReferencePattern.test(text)) {
      textNode.textContent = text.replace(meetingReferencePattern, data.meetingReference)
      continue
    }

    // Replace date patterns
    for (const pattern of datePatterns) {
      if (pattern.test(text)) {
        textNode.textContent = text.replace(pattern, formattedDate)
        break
      }
    }

    // Replace meeting title if node contains a standalone meeting title label
    if (data.mode !== 'matter-arising' && (/meeting\s+no\./i.test(text) || /mesyuarat/i.test(text))) {
      textNode.textContent = data.meetingTitle
    }
  }
}

function replaceTableRows(table: Element, ns: string, rows: TemplateCellContent[][]) {
  const tableRows = Array.from(table.getElementsByTagName('w:tr'))
  if (tableRows.length < 2) return // Need at least header + 1 data row

  // Row 0 = header, Row 1 = template for data formatting
  const templateRow = tableRows[1]

  // Remove all existing data rows (keep header)
  for (let i = tableRows.length - 1; i >= 1; i--) {
    table.removeChild(tableRows[i])
  }

  // Clone template row for each data entry
  for (const rowData of rows) {
    const newRow = templateRow.cloneNode(true) as Element
    const cells = newRow.getElementsByTagName('w:tc')

    for (let c = 0; c < cells.length && c < rowData.length; c++) {
      setCellContent(cells[c], ns, rowData[c])
    }

    table.appendChild(newRow)
  }
}

function setCellContent(cell: Element, _ns: string, content: TemplateCellContent) {
  const paragraphTemplates = Array.from(cell.getElementsByTagName('w:p')).map(paragraph => (
    paragraph.cloneNode(true) as Element
  ))
  if (paragraphTemplates.length === 0) return

  while (cell.firstChild) {
    cell.removeChild(cell.firstChild)
  }

  const paragraphs = typeof content === 'string'
    ? String(content ?? '').split(/\r?\n/).map(line => ({ text: line, kind: 'value' as const }))
    : (content.paragraphs.length > 0 ? content.paragraphs : [{ text: '', kind: 'value' as const }])

  paragraphs.forEach(paragraphData => {
    const paragraph = cloneParagraphTemplate(paragraphTemplates, paragraphData.kind ?? 'value')
    setParagraphText(paragraph, paragraphData.text)
    cell.appendChild(paragraph)
  })
}

function cloneParagraphTemplate(paragraphTemplates: Element[], kind: TemplateParagraphKind) {
  const nonEmptyIndexes = paragraphTemplates
    .map((paragraph, index) => (hasVisibleText(paragraph) ? index : -1))
    .filter(index => index >= 0)

  const firstNonEmptyIndex = nonEmptyIndexes[0] ?? 0
  const firstBodyIndex = paragraphTemplates.findIndex((paragraph, index) => (
    index > firstNonEmptyIndex
    && (hasVisibleText(paragraph) || !paragraphHasUnderline(paragraph))
  ))
  const valueIndex = firstNonEmptyIndex

  let targetIndex = valueIndex
  if (kind === 'title') {
    targetIndex = firstNonEmptyIndex
  } else if (kind === 'body') {
    targetIndex = firstBodyIndex >= 0
      ? firstBodyIndex
      : Math.min(firstNonEmptyIndex + 1, paragraphTemplates.length - 1)
  }

  return paragraphTemplates[targetIndex].cloneNode(true) as Element
}

function hasVisibleText(paragraph: Element) {
  return Array.from(paragraph.getElementsByTagName('w:t'))
    .some(textNode => (textNode.textContent ?? '').trim().length > 0)
}

function paragraphHasUnderline(paragraph: Element) {
  return paragraph.getElementsByTagName('w:u').length > 0
}

function setParagraphText(paragraph: Element, text: string) {
  let textNodes = paragraph.getElementsByTagName('w:t')
  if (textNodes.length === 0) {
    const run = paragraph.ownerDocument.createElementNS(WORDPROCESSING_NS, 'w:r')
    const textNode = paragraph.ownerDocument.createElementNS(WORDPROCESSING_NS, 'w:t')
    run.appendChild(textNode)
    paragraph.appendChild(run)
    textNodes = paragraph.getElementsByTagName('w:t')
  }

  textNodes[0].textContent = text
  textNodes[0].setAttribute('xml:space', 'preserve')

  for (let i = textNodes.length - 1; i >= 1; i--) {
    const run = textNodes[i].parentNode
    if (run) run.removeChild(textNodes[i])
  }
}

function formatDate(dateStr: string) {
  try {
    return new Date(dateStr).toLocaleDateString('en-MY', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  } catch {
    return dateStr
  }
}

export async function fetchTemplateBuffer(signedUrl: string): Promise<ArrayBuffer> {
  const res = await fetch(signedUrl)
  if (!res.ok) throw new Error('Failed to fetch template file')
  return res.arrayBuffer()
}
