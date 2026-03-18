'use server'

import * as XLSX from 'xlsx'
import mammoth from 'mammoth'
import { PDFParse } from 'pdf-parse'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { uuidSchema } from '@/lib/validation'
import { assertFileSize } from '@/actions/file-upload/validation'

interface ParsedAgendaRowDraft {
  agendaNo: string | null
  title: string
  presenter: string | null
}

interface ParsedAgendaRow {
  agendaNo: string
  title: string
  presenter: string | null
}

interface ParseTemplateRowsResult {
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

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

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

function normalizeAgendaNo(value: string) {
  return value.trim().replace(/\s+/g, '').replace(/[)\]:-]+$/, '')
}

function isAgendaNo(value: string) {
  return /^\d+(?:\.\d+)?$/.test(normalizeAgendaNo(value))
}

function normalizeHeader(value: string) {
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
    const [agendaNo, title, presenter] = columns
    rows.push({
      agendaNo: agendaNo || null,
      title: title || '',
      presenter: presenter || null,
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
    const dedupeKey = `${agendaNo}|${normalizeHeader(title)}`
    if (seen.has(dedupeKey)) {
      skippedCount += 1
      return
    }

    seen.add(dedupeKey)
    rows.push({
      agendaNo,
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
    const title = findValue('agenda item', 'agenda title', 'title', 'agenda')
    const presenter = findValue('presenter', 'owner', 'pic')

    if (agendaNo || title || presenter) {
      drafts.push({
        agendaNo: agendaNo || null,
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
        drafts.push({
          agendaNo: first,
          title: second,
          presenter: third || null,
        })
        return
      }

      drafts.push({
        agendaNo: null,
        title: first,
        presenter: second || null,
      })
    })
  }

  return { drafts, warnings: [] as string[] }
}

async function parseRowsFromDocLike(file: File) {
  const lowerName = file.name.toLowerCase()
  const text = lowerName.endsWith('.docx')
    ? (await mammoth.extractRawText({ buffer: Buffer.from(await file.arrayBuffer()) })).value
    : await file.text()

  return parseRowsFromText(text)
}

async function extractTextFromPdf(file: File) {
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

async function parseTemplateRows(file: File): Promise<ParseTemplateRowsResult> {
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

function compareAgendaNo(a: string, b: string) {
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

async function recomputeSortOrderForMeeting(supabase: SupabaseClient, meetingId: string) {
  const { data: agendas, error } = await supabase
    .from('agendas')
    .select('id, agenda_no, title')
    .eq('meeting_id', meetingId)

  if (error || !agendas) throw new Error(error?.message ?? 'Failed to fetch agendas for sorting')

  const sorted = [...agendas].sort((a, b) => {
    const byNo = compareAgendaNo(a.agenda_no, b.agenda_no)
    if (byNo !== 0) return byNo
    return a.title.localeCompare(b.title)
  })

  await Promise.all(sorted.map((agenda, index) =>
    supabase
      .from('agendas')
      .update({ sort_order: index })
      .eq('id', agenda.id),
  ))
}

export async function importAgendaToCurrentAgenda(meetingId: string, file: File): Promise<AgendaImportResult> {
  uuidSchema.parse(meetingId)
  assertFileSize(file)

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const parsed = await parseTemplateRows(file)

  const { error: deleteError } = await supabase.from('agendas').delete().eq('meeting_id', meetingId)
  if (deleteError) throw new Error(deleteError.message)

  const agendas = parsed.rows.map((row, index) => ({
    meeting_id: meetingId,
    agenda_no: row.agendaNo,
    title: row.title,
    presenter: row.presenter,
    sort_order: index,
  }))

  const { error: insertError } = await supabase.from('agendas').insert(agendas)
  if (insertError) throw new Error(insertError.message)

  return {
    importedCount: agendas.length,
    skippedCount: parsed.skippedCount,
    usedAiOcr: parsed.usedAiOcr,
    warnings: parsed.warnings,
  }
}

export async function importPresenterListToCurrentAgenda(
  meetingId: string,
  file: File,
): Promise<PresenterImportResult> {
  uuidSchema.parse(meetingId)
  assertFileSize(file)

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const parsed = await parseTemplateRows(file)

  const { data: existingAgendas, error: existingError } = await supabase
    .from('agendas')
    .select('id, agenda_no, title, presenter, sort_order')
    .eq('meeting_id', meetingId)

  if (existingError) throw new Error(existingError.message)

  const agendas = existingAgendas ?? []
  const byNo = new Map(agendas.map(agenda => [normalizeAgendaNo(agenda.agenda_no), agenda]))
  const byTitle = new Map(agendas.map(agenda => [normalizeHeader(agenda.title), agenda]))
  let nextSortOrder = agendas.reduce((max, agenda) => Math.max(max, agenda.sort_order), -1) + 1

  let updatedCount = 0
  let createdCount = 0
  let skippedCount = parsed.skippedCount

  for (const row of parsed.rows) {
    const target = byNo.get(normalizeAgendaNo(row.agendaNo))
      ?? byTitle.get(normalizeHeader(row.title))

    if (target) {
      if (row.presenter && row.presenter !== target.presenter) {
        const { error } = await supabase
          .from('agendas')
          .update({ presenter: row.presenter })
          .eq('id', target.id)
        if (error) throw new Error(error.message)
        updatedCount += 1
      } else {
        skippedCount += 1
      }
      continue
    }

    const { data: created, error } = await supabase
      .from('agendas')
      .insert({
        meeting_id: meetingId,
        agenda_no: row.agendaNo,
        title: row.title,
        presenter: row.presenter,
        sort_order: nextSortOrder,
      })
      .select('id, agenda_no, title, presenter, sort_order')
      .single()

    if (error || !created) throw new Error(error?.message ?? 'Failed to create missing agenda row')

    createdCount += 1
    nextSortOrder += 1
    byNo.set(normalizeAgendaNo(created.agenda_no), created)
    byTitle.set(normalizeHeader(created.title), created)
  }

  if (updatedCount + createdCount === 0) {
    throw new Error('No presenter rows were imported. Check your template content.')
  }

  await recomputeSortOrderForMeeting(supabase, meetingId)

  return {
    updatedCount,
    createdCount,
    skippedCount,
    usedAiOcr: parsed.usedAiOcr,
    warnings: parsed.warnings,
  }
}
