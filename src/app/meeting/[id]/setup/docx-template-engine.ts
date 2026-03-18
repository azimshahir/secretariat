import JSZip from 'jszip'

interface TemplateData {
  meetingTitle: string
  meetingDate: string
  sectionTitle: string
  rows: string[][] // each row = [col1, col2, ...]
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

  for (const textNode of headerTexts) {
    const text = textNode.textContent ?? ''

    // Replace date patterns
    for (const pattern of datePatterns) {
      if (pattern.test(text)) {
        textNode.textContent = text.replace(pattern, formattedDate)
        break
      }
    }

    // Replace meeting title if node contains "meeting" keyword
    if (/meeting\s+no\./i.test(text) || /mesyuarat/i.test(text)) {
      textNode.textContent = data.meetingTitle
    }
  }
}

function replaceTableRows(table: Element, ns: string, rows: string[][]) {
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
      setCellText(cells[c], ns, rowData[c])
    }

    table.appendChild(newRow)
  }
}

function setCellText(cell: Element, _ns: string, text: string) {
  // Find all <w:t> elements in the cell and set text on the first one,
  // clear the rest. This preserves <w:rPr> formatting on the first run.
  const textNodes = cell.getElementsByTagName('w:t')
  if (textNodes.length === 0) return

  textNodes[0].textContent = text
  // Preserve space attribute so leading/trailing spaces aren't trimmed
  textNodes[0].setAttribute('xml:space', 'preserve')

  // Clear remaining <w:t> nodes (merged runs)
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
