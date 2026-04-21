import { z } from 'zod'

interface ParsedAgendaRowDraft {
  agendaNo: string | null
  plannedTime: string | null
  title: string
  presenter: string | null
}

interface ParsedAgendaRow {
  agendaNo: string
  plannedTime: string | null
  title: string
  presenter: string | null
}

export interface ParseTemplateRowsResult {
  rows: ParsedAgendaRow[]
  skippedCount: number
  usedAiOcr: boolean
  warnings: string[]
}

export interface AgendaImportResult {
  importedCount: number
  skippedCount: number
  usedAiOcr: boolean
  warnings: string[]
}

export interface PresenterImportResult {
  updatedCount: number
  createdCount: number
  skippedCount: number
  usedAiOcr: boolean
  warnings: string[]
}

const OCR_ROW_SCHEMA = z.object({
  agendaNo: z.string().trim().min(1).nullable().optional(),
  plannedTime: z.string().trim().min(1).nullable().optional(),
  title: z.string().trim().min(1),
  presenter: z.string().trim().min(1).nullable().optional(),
})

const OCR_PAYLOAD_SCHEMA = z.union([
  z.array(OCR_ROW_SCHEMA),
  z.object({
    rows: z.array(OCR_ROW_SCHEMA),
    warnings: z.array(z.string()).optional(),
  }),
])

const MIN_PDF_TEXT_LENGTH_FOR_DIRECT_PARSE = 80

function uniqueStrings(values: string[]) {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))]
}

function toNonEmptyString(value: unknown) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

export function normalizeAgendaNo(value: string) {
  return value.trim().replace(/\s+/g, '').replace(/[)\]:-]+$/, '')
}

function isAgendaNo(value: string) {
  return /^\d+(?:\.\d+)?$/.test(normalizeAgendaNo(value))
}

export function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function isMetadataLine(value: string) {
  const normalized = normalizeHeader(value)
  if (!normalized) return true

  const exactHeaders = new Set([
    'agenda no',
    'agenda item',
    'owner',
    'presenter',
    'time',
    'department',
    'no',
    'title',
  ])

  if (exactHeaders.has(normalized)) return true
  if (normalized.includes('meeting agenda')) return true
  if (normalized.includes('presenter list')) return true
  if (normalized.includes('video conferencing')) return true
  if (normalized.includes('microsoft teams')) return true
  if (normalized.includes('uploaded by')) return true
  if (normalized.includes('confidential')) return true
  if (/^\d{1,2}\s*:\s*\d{2}\s*(am|pm|a m|p m)?$/.test(normalized)) return true
  if (/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(normalized)) return true
  return false
}

function parseRowsFromDelimitedLines(lines: string[]) {
  const rows: ParsedAgendaRowDraft[] = []

  lines.forEach(line => {
    const columns = line.includes('\t')
      ? line.split('\t').map(column => normalizeWhitespace(column)).filter(Boolean)
      : line.includes('|')
        ? line.split('|').map(column => normalizeWhitespace(column)).filter(Boolean)
        : []

    if (columns.length < 2) return
    const [agendaNo, maybeTime, maybeTitle, maybePresenter] = columns
    const hasExplicitTime = columns.length >= 4
    rows.push({
      agendaNo: agendaNo || null,
      plannedTime: hasExplicitTime ? (maybeTime || null) : null,
      title: hasExplicitTime ? (maybeTitle || '') : (maybeTime || ''),
      presenter: hasExplicitTime ? (maybePresenter || null) : (maybeTitle || null),
    })
  })

  return rows
}

function parseRowsFromSequentialTriplets(lines: string[]) {
  const rows: ParsedAgendaRowDraft[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!isAgendaNo(line)) continue

    const agendaNo = normalizeAgendaNo(line)
    let cursor = index + 1
    while (cursor < lines.length && isMetadataLine(lines[cursor])) cursor += 1
    if (cursor >= lines.length) continue

    const title = normalizeWhitespace(lines[cursor])
    if (!title || isMetadataLine(title) || isAgendaNo(title)) continue

    cursor += 1
    while (cursor < lines.length && isMetadataLine(lines[cursor])) cursor += 1

    let presenter: string | null = null
    if (cursor < lines.length && !isAgendaNo(lines[cursor]) && !isMetadataLine(lines[cursor])) {
      presenter = normalizeWhitespace(lines[cursor])
    }

    rows.push({
      agendaNo,
      plannedTime: null,
      title,
      presenter,
    })
  }

  return rows
}

function parseRowsFromNumberedLines(lines: string[]) {
  const rows: ParsedAgendaRowDraft[] = []
  const numberedLinePattern = /^(\d+(?:\.\d+)?)[)\].:-]?\s+(.+)$/

  lines.forEach(line => {
    const match = line.match(numberedLinePattern)
    if (!match) return
    const [, agendaNo, title] = match
    rows.push({
      agendaNo: normalizeAgendaNo(agendaNo),
      plannedTime: null,
      title: normalizeWhitespace(title),
      presenter: null,
    })
  })

  return rows
}

function parseRowsFromBestEffortLines(lines: string[]) {
  return lines
    .filter(line => !isMetadataLine(line) && !isAgendaNo(line))
    .map(line => ({
      agendaNo: null,
      plannedTime: null,
      title: normalizeWhitespace(line),
      presenter: null,
    }))
}

function parseRowsFromText(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map(line => normalizeWhitespace(line))
    .filter(Boolean)

  const warnings: string[] = []
  const drafts = [
    ...parseRowsFromDelimitedLines(lines),
    ...parseRowsFromSequentialTriplets(lines),
    ...parseRowsFromNumberedLines(lines),
  ]

  if (drafts.length === 0) {
    const bestEffort = parseRowsFromBestEffortLines(lines)
    warnings.push('Used best-effort parsing because structured rows were not found.')
    return { drafts: bestEffort, warnings }
  }

  return { drafts, warnings }
}

function finalizeParsedRows(drafts: ParsedAgendaRowDraft[]) {
  const rows: ParsedAgendaRow[] = []
  const warnings: string[] = []
  const seen = new Set<string>()
  let skippedCount = 0
  let autoAgendaCounter = 1

  drafts.forEach(draft => {
    const title = normalizeWhitespace(draft.title || '')
    if (!title || isMetadataLine(title)) {
      skippedCount += 1
      return
    }

    const normalizedNo = toNonEmptyString(draft.agendaNo)
    let agendaNo = normalizedNo ? normalizeAgendaNo(normalizedNo) : null

    if (agendaNo && !isAgendaNo(agendaNo)) {
      warnings.push(`Invalid agenda number "${agendaNo}" replaced with auto-numbering.`)
      agendaNo = null
    }

    if (!agendaNo) {
      agendaNo = `${autoAgendaCounter}.0`
      autoAgendaCounter += 1
    } else {
      const topLevel = Number.parseInt(agendaNo.split('.')[0] ?? '', 10)
      if (Number.isFinite(topLevel) && topLevel >= autoAgendaCounter) {
        autoAgendaCounter = topLevel + 1
      }
    }

    const presenter = toNonEmptyString(draft.presenter)
    const plannedTime = toNonEmptyString(draft.plannedTime)
    const dedupeKey = `${agendaNo}|${normalizeHeader(title)}`
    if (seen.has(dedupeKey)) {
      skippedCount += 1
      return
    }

    seen.add(dedupeKey)
    rows.push({
      agendaNo,
      plannedTime,
      title,
      presenter,
    })
  })

  return {
    rows,
    skippedCount,
    warnings,
  }
}

async function parseRowsFromSpreadsheet(file: File) {
  const XLSX = await import('xlsx')
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const drafts: ParsedAgendaRowDraft[] = []

  const objectRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  objectRows.forEach(row => {
    const entries = Object.entries(row)
    const findValue = (...keywords: string[]) => {
      for (const [key, value] of entries) {
        const normalizedKey = normalizeHeader(key)
        if (keywords.some(keyword => normalizedKey.includes(keyword))) {
          return String(value ?? '').trim()
        }
      }
      return ''
    }

    const agendaNo = findValue('agenda no', 'no', 'number')
    const plannedTime = findValue('planned time', 'time')
    const title = findValue('agenda item', 'agenda title', 'title', 'agenda')
    const presenter = findValue('presenter', 'owner', 'pic')

    if (agendaNo || plannedTime || title || presenter) {
      drafts.push({
        agendaNo: agendaNo || null,
        plannedTime: plannedTime || null,
        title,
        presenter: presenter || null,
      })
    }
  })

  if (drafts.length === 0) {
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' })
    matrix.forEach(rawRow => {
      const columns = rawRow
        .map(cell => normalizeWhitespace(String(cell ?? '')))
        .filter(Boolean)

      if (columns.length === 0) return
      const [first, second, third] = columns
      if (isAgendaNo(first) && second) {
        const hasExplicitTime = columns.length >= 4
        drafts.push({
          agendaNo: first,
          plannedTime: hasExplicitTime ? (second || null) : null,
          title: hasExplicitTime ? (third || '') : second,
          presenter: hasExplicitTime ? (columns[3] || null) : (third || null),
        })
        return
      }

      drafts.push({
        agendaNo: null,
        plannedTime: null,
        title: first,
        presenter: second || null,
      })
    })
  }

  return { drafts, warnings: [] as string[] }
}

async function parseRowsFromDocLike(file: File) {
  const mammoth = (await import('mammoth')).default
  const lowerName = file.name.toLowerCase()
  const text = lowerName.endsWith('.docx')
    ? (await mammoth.extractRawText({ buffer: Buffer.from(await file.arrayBuffer()) })).value
    : await file.text()

  return parseRowsFromText(text)
}

async function extractTextFromPdf(file: File) {
  const { PDFParse } = await import('pdf-parse')
  const parser = new PDFParse({ data: Buffer.from(await file.arrayBuffer()) })
  try {
    const parsed = await parser.getText()
    return normalizeWhitespace(parsed.text ?? '')
  } finally {
    await parser.destroy()
  }
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

  const bracketObject = direct.match(/\{[\s\S]*\}/)?.[0]
  const bracketArray = direct.match(/\[[\s\S]*\]/)?.[0]
  if (bracketObject) candidates.push(bracketObject)
  if (bracketArray) candidates.push(bracketArray)

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch {
      continue
    }
  }

  return null
}

async function uploadPdfToOpenAi(apiKey: string, file: File) {
  const purposes = ['user_data', 'assistants']
  const failures: string[] = []

  for (const purpose of purposes) {
    const formData = new FormData()
    formData.append('purpose', purpose)
    formData.append('file', file, file.name || 'template.pdf')

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

  throw new Error(`File upload failed: ${failures.join(' | ')}`)
}

async function requestOcrRowsFromOpenAi(apiKey: string, fileId: string) {
  const model = process.env.PDF_IMPORT_OCR_MODEL || 'gpt-4.1-mini'
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: [
                'Extract agenda rows from this PDF.',
                'Return ONLY JSON (no markdown).',
                'Expected shape:',
                '{ "rows": [{ "agendaNo": "1.0" | null, "title": string, "presenter": string | null }], "warnings": string[] }',
                'If agendaNo is missing, set it to null.',
                'If presenter is missing, set it to null.',
              ].join('\n'),
            },
            {
              type: 'input_file',
              file_id: fileId,
            },
          ],
        },
      ],
      temperature: 0,
    }),
  })

  if (!response.ok) {
    throw new Error(`OCR request failed: ${await response.text()}`)
  }

  const payload = await response.json()
  const outputText = extractOutputTextFromOpenAiResponse(payload)
  if (!outputText) throw new Error('OCR response did not contain text output')

  const jsonPayload = extractJsonPayload(outputText)
  if (!jsonPayload) throw new Error('OCR response did not contain valid JSON')

  const validated = OCR_PAYLOAD_SCHEMA.parse(jsonPayload)
  if (Array.isArray(validated)) {
    return { rows: validated, warnings: [] as string[] }
  }
  return {
    rows: validated.rows,
    warnings: validated.warnings ?? [],
  }
}

async function deleteOpenAiFile(apiKey: string, fileId: string) {
  await fetch(`https://api.openai.com/v1/files/${fileId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${apiKey}` },
  }).catch(() => undefined)
}

async function parseRowsFromPdf(file: File) {
  const warnings: string[] = []
  let text = ''

  try {
    text = await extractTextFromPdf(file)
  } catch {
    text = ''
    warnings.push('PDF text extraction failed. Trying AI OCR fallback.')
  }

  if (text.length >= MIN_PDF_TEXT_LENGTH_FOR_DIRECT_PARSE) {
    const parsed = parseRowsFromText(text)
    if (parsed.drafts.length > 0) {
      return {
        drafts: parsed.drafts,
        warnings: [...warnings, ...parsed.warnings],
        usedAiOcr: false,
      }
    }
    warnings.push('PDF text was extracted but no structured agenda rows were found. Trying AI OCR fallback.')
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('Scanned PDF detected. Set OPENAI_API_KEY to enable OCR fallback, or upload DOCX/text-based PDF.')
  }

  let fileId = ''
  try {
    fileId = await uploadPdfToOpenAi(apiKey, file)
    const ocr = await requestOcrRowsFromOpenAi(apiKey, fileId)
    return {
      drafts: ocr.rows.map(row => ({
        agendaNo: row.agendaNo ?? null,
        plannedTime: row.plannedTime ?? null,
        title: row.title,
        presenter: row.presenter ?? null,
      })),
      warnings: [...warnings, ...ocr.warnings],
      usedAiOcr: true,
    }
  } catch (error) {
    throw new Error(
      `AI OCR failed for PDF import. ${
        error instanceof Error ? error.message : 'Unknown OCR error'
      }`,
    )
  } finally {
    if (fileId) await deleteOpenAiFile(apiKey, fileId)
  }
}

export async function parseTemplateRows(file: File): Promise<ParseTemplateRowsResult> {
  const lowerName = file.name.toLowerCase()
  let drafts: ParsedAgendaRowDraft[] = []
  let warnings: string[] = []
  let usedAiOcr = false

  if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls') || lowerName.endsWith('.csv')) {
    const parsed = await parseRowsFromSpreadsheet(file)
    drafts = parsed.drafts
    warnings = parsed.warnings
  } else if (lowerName.endsWith('.docx') || lowerName.endsWith('.txt')) {
    const parsed = await parseRowsFromDocLike(file)
    drafts = parsed.drafts
    warnings = parsed.warnings
  } else if (lowerName.endsWith('.pdf')) {
    const parsed = await parseRowsFromPdf(file)
    drafts = parsed.drafts
    warnings = parsed.warnings
    usedAiOcr = parsed.usedAiOcr
  } else {
    throw new Error('Unsupported file type. Use .docx, .txt, .xlsx, .xls, .csv, or .pdf')
  }

  const finalized = finalizeParsedRows(drafts)
  if (finalized.rows.length === 0) {
    throw new Error('No valid agenda rows found in template')
  }

  return {
    rows: finalized.rows,
    skippedCount: finalized.skippedCount,
    usedAiOcr,
    warnings: uniqueStrings([...warnings, ...finalized.warnings]),
  }
}

function agendaNoSortValue(value: string) {
  return normalizeAgendaNo(value)
    .split('.')
    .map(token => Number.parseInt(token, 10))
}

export function compareAgendaNo(a: string, b: string) {
  const aTokens = agendaNoSortValue(a)
  const bTokens = agendaNoSortValue(b)
  const maxLength = Math.max(aTokens.length, bTokens.length)

  for (let index = 0; index < maxLength; index += 1) {
    const aValue = aTokens[index] ?? 0
    const bValue = bTokens[index] ?? 0
    if (aValue !== bValue) return aValue - bValue
  }

  return 0
}
