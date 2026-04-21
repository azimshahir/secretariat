'use client'

import { useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  TextRun,
  UnderlineType,
} from 'docx'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { postJson } from '@/lib/api/client'
import { fetchTemplateBuffer } from './docx-template-engine'
import { buildMomFromTemplate } from './mom-template-engine'
import type { MomExactDocument } from '@/lib/mom-template-types'

type ExportFormat = 'docx' | 'pdf'
type DownloadMode = 'standard' | 'best-fit'

interface StandardAgendaItem {
  agendaNo: string
  title: string
  content: string | null
}

interface StandardMomBlock {
  kind: 'section-heading' | 'body' | 'numbered-body'
  text: string
  level?: 0 | 1 | 2
  listGroupId?: number
}

interface Props {
  meetingId: string
  meetingTitle: string
  meetingDate: string
  allDone: boolean
  disabled?: boolean
  instruction?: string
}

function sanitize(input: string) {
  return input.replace(/[^a-zA-Z0-9-_]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function isHeading(line: string) {
  return /^(AGENDA\s+\d|#{1,3}\s|MINUTE OF MEETING|MINUTES OF|ACTION ITEM)/i.test(line.trim())
}

function toFullMeetingDate(date: string) {
  return new Date(date).toLocaleDateString('en-MY', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function cleanInlineMarkdown(text: string) {
  return text
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeSectionHeading(text: string) {
  const normalized = cleanInlineMarkdown(text)
    .replace(/[.:]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()

  if (!normalized) return null
  if (normalized === 'NOTED AND DISCUSSED') return 'NOTED & DISCUSSED'
  if (normalized === 'NOTED & DISCUSSED') return 'NOTED & DISCUSSED'
  if (normalized === 'RESOLVED') return 'RESOLVED'
  if (normalized === 'ACTION BY') return 'ACTION BY'
  if (normalized === 'STATUS') return 'STATUS'
  if (normalized === 'DECISION') return 'DECISION'
  if (normalized === 'MATTERS ARISING') return 'MATTERS ARISING'
  if (normalized === 'CURRENT DEVELOPMENT') return 'CURRENT DEVELOPMENT'
  return null
}

function parseSectionHeadingWithRemainder(text: string) {
  const direct = normalizeSectionHeading(text)
  if (direct) return { heading: direct, remainder: '' }

  const match = cleanInlineMarkdown(text).match(/^([^:]+):\s*(.+)$/)
  if (!match) return null

  const heading = normalizeSectionHeading(match[1])
  if (!heading) return null

  return { heading, remainder: match[2].trim() }
}

function parseNumberedLine(text: string): { level: 0 | 1 | 2; text: string } | null {
  const normalized = cleanInlineMarkdown(text)
  const decimalMatch = normalized.match(/^(\d+)[.)]\s+(.+)$/)
  if (decimalMatch) return { level: 0, text: decimalMatch[2].trim() }

  const romanMatch = normalized.match(/^([ivxlcdm]+)[.)]\s+(.+)$/i)
  if (romanMatch && /^(i|ii|iii|iv|v|vi|vii|viii|ix|x)$/i.test(romanMatch[1])) {
    return { level: 2, text: romanMatch[2].trim() }
  }

  const alphaMatch = normalized.match(/^([a-z])[.)]\s+(.+)$/i)
  if (alphaMatch) return { level: 1, text: alphaMatch[2].trim() }

  return null
}

function isPresenterLine(text: string) {
  return /^presenter\s*:/i.test(cleanInlineMarkdown(text))
}

function isDuplicateAgendaHeading(text: string, agendaNo: string, title: string) {
  const normalized = cleanInlineMarkdown(text).toLowerCase()
  const agendaTitle = cleanInlineMarkdown(title).toLowerCase()
  return (
    normalized === `${agendaNo} ${agendaTitle}`.toLowerCase()
    || normalized === `agenda ${agendaNo}: ${agendaTitle}`.toLowerCase()
    || normalized === `agenda ${agendaNo} ${agendaTitle}`.toLowerCase()
  )
}

function buildAgendaHeadingText(agenda: StandardAgendaItem) {
  const title = cleanInlineMarkdown(agenda.title)
  return title ? `${agenda.agendaNo} ${title}` : agenda.agendaNo
}

function isSubagenda(agendaNo: string) {
  return /^\d+\.\d+/.test(agendaNo)
}

function normalizeStandardBlocks(
  content: string | null,
  agenda: StandardAgendaItem,
) {
  if (!content?.trim()) return []

  const lines = content.replace(/\r/g, '').split('\n')
  const blocks: StandardMomBlock[] = []
  let paragraphLines: string[] = []
  let currentListGroup = 0

  function flushParagraph() {
    const text = cleanInlineMarkdown(paragraphLines.join(' '))
    if (text) {
      blocks.push({ kind: 'body', text })
    }
    paragraphLines = []
  }

  function appendContentLine(line: string) {
    const numbered = parseNumberedLine(line)
    if (numbered) {
      flushParagraph()
      const previous = blocks[blocks.length - 1]
      const needsNewGroup = !previous || previous.kind !== 'numbered-body'
      if (needsNewGroup) currentListGroup += 1
      blocks.push({
        kind: 'numbered-body',
        text: numbered.text,
        level: numbered.level,
        listGroupId: currentListGroup,
      })
      return
    }

    paragraphLines.push(line)
  }

  for (const rawLine of lines) {
    const line = cleanInlineMarkdown(rawLine)
    if (!line) {
      flushParagraph()
      continue
    }

    if (isDuplicateAgendaHeading(line, agenda.agendaNo, agenda.title) || isPresenterLine(line)) {
      flushParagraph()
      continue
    }

    const heading = parseSectionHeadingWithRemainder(line)
    if (heading) {
      flushParagraph()
      blocks.push({ kind: 'section-heading', text: heading.heading })
      if (heading.remainder) appendContentLine(heading.remainder)
      continue
    }

    appendContentLine(line)
  }

  flushParagraph()
  return blocks
}

function buildStandardTextRun(text: string, options?: {
  bold?: boolean
  italics?: boolean
  underline?: boolean
  size?: number
  color?: string
}) {
  return new TextRun({
    text,
    bold: options?.bold,
    italics: options?.italics,
    underline: options?.underline ? { type: UnderlineType.SINGLE } : undefined,
    size: options?.size ?? 22,
    color: options?.color ?? '1F1F1F',
    font: 'Arial',
  })
}

async function buildStandardDocx(
  agendaItems: StandardAgendaItem[],
  title: string,
  date: string,
) {
  const displayDate = toFullMeetingDate(date)
  const detailLine = `${title} | ${displayDate}`
  const children: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 6, color: 'D9B450' },
      },
      spacing: { after: 120 },
      children: [buildStandardTextRun(title.toUpperCase(), {
        bold: true,
        size: 56,
        color: '1F3F73',
      })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      children: [buildStandardTextRun(detailLine, {
        italics: true,
        size: 22,
        color: '4A4A4A',
      })],
    }),
  ]

  const listGroupIds = new Set<number>()

  agendaItems.forEach((agenda, index) => {
    const blocks = normalizeStandardBlocks(agenda.content, agenda)
    const headingText = buildAgendaHeadingText(agenda)
    const subagenda = isSubagenda(agenda.agendaNo)

    children.push(new Paragraph({
      spacing: { before: index === 0 ? 120 : 220, after: 100 },
      children: [buildStandardTextRun(headingText, {
        bold: true,
        underline: subagenda,
        size: 22,
      })],
    }))

    blocks.forEach(block => {
      if (block.kind === 'section-heading') {
        children.push(new Paragraph({
          spacing: { before: 80, after: 60 },
          children: [buildStandardTextRun(block.text, { bold: true })],
        }))
        return
      }

      if (block.kind === 'numbered-body') {
        if (typeof block.listGroupId === 'number') {
          listGroupIds.add(block.listGroupId)
        }
        children.push(new Paragraph({
          spacing: { after: 80 },
          numbering: block.listGroupId
            ? {
                reference: `mom-standard-list-${block.listGroupId}`,
                level: block.level ?? 0,
              }
            : undefined,
          alignment: AlignmentType.JUSTIFIED,
          children: [buildStandardTextRun(block.text)],
        }))
        return
      }

      children.push(new Paragraph({
        spacing: { after: 120 },
        alignment: AlignmentType.JUSTIFIED,
        children: [buildStandardTextRun(block.text)],
      }))
    })
  })

  return Packer.toBlob(new Document({
    numbering: {
      config: Array.from(listGroupIds).map(groupId => ({
        reference: `mom-standard-list-${groupId}`,
        levels: [
          {
            level: 0,
            format: LevelFormat.DECIMAL,
            text: '%1.',
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: {
                indent: { left: 720, hanging: 260 },
              },
            },
          },
          {
            level: 1,
            format: LevelFormat.LOWER_LETTER,
            text: '%2)',
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: {
                indent: { left: 1080, hanging: 260 },
              },
            },
          },
          {
            level: 2,
            format: LevelFormat.LOWER_ROMAN,
            text: '%3.',
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: {
                indent: { left: 1440, hanging: 260 },
              },
            },
          },
        ],
      })),
    },
    sections: [{ children }],
  }))
}

async function buildFallbackDocx(text: string, title: string, date: string) {
  const lines = text.split('\n')
  const children: Paragraph[] = [
    new Paragraph({ text: title, heading: HeadingLevel.TITLE }),
    new Paragraph({
      children: [new TextRun({
        text: new Date(date).toLocaleDateString('en-MY', { day: 'numeric', month: 'long', year: 'numeric' }),
        italics: true, color: '666666',
      })],
    }),
    new Paragraph({ text: '' }),
  ]

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) { children.push(new Paragraph({ text: '' })); continue }
    if (isHeading(trimmed)) {
      children.push(new Paragraph({ text: trimmed.replace(/^#+\s*/, ''), heading: HeadingLevel.HEADING_2 }))
    } else {
      children.push(new Paragraph({ text: trimmed }))
    }
  }

  return Packer.toBlob(new Document({ sections: [{ children }] }))
}

async function buildPdf(text: string, title: string, date: string) {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  const W = 595.28, H = 841.89, M = 50, LH = 15
  const maxW = W - M * 2
  let page = doc.addPage([W, H])
  let y = H - M

  const tw = bold.widthOfTextAtSize(title, 18)
  page.drawText(title, { x: Math.max(M, (W - tw) / 2), y, font: bold, size: 18, color: rgb(0.12, 0.25, 0.45) })
  y -= 22
  const fd = new Date(date).toLocaleDateString('en-MY', { day: 'numeric', month: 'long', year: 'numeric' })
  page.drawText(fd, { x: M, y, font, size: 10, color: rgb(0.4, 0.4, 0.4) })
  y -= 28

  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) { y -= LH * 0.5; continue }
    const head = isHeading(trimmed)
    const f = head ? bold : font
    const sz = head ? 12 : 10.5
    const words = trimmed.replace(/^#+\s*/, '').split(/\s+/)
    let cur = ''
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w
      if (f.widthOfTextAtSize(test, sz) > maxW && cur) {
        if (y < M + 20) { page = doc.addPage([W, H]); y = H - M }
        page.drawText(cur, { x: M, y, font: f, size: sz, color: rgb(0.1, 0.1, 0.1) })
        y -= LH
        cur = w
      } else { cur = test }
    }
    if (cur) {
      if (y < M + 20) { page = doc.addPage([W, H]); y = H - M }
      page.drawText(cur, { x: M, y, font: f, size: sz, color: rgb(0.1, 0.1, 0.1) })
      y -= LH
    }
    if (head) y -= 4
  }
  return doc.save()
}

export function DownloadMomButton({
  meetingId,
  meetingTitle,
  meetingDate,
  allDone,
  disabled,
  instruction,
}: Props) {
  const [format, setFormat] = useState<ExportFormat>('docx')
  const [mode, setMode] = useState<DownloadMode>('standard')
  const [downloading, setDownloading] = useState(false)

  async function handleDownload() {
    setDownloading(true)
    try {
      const {
        text: formatted,
        templateUrl,
        meetingTitle: mTitle,
        formattedDate,
        exactDocument,
        standardAgendaItems,
      } = await postJson<{
        ok: true
        text: string
        templateUrl: string | null
        meetingTitle: string
        formattedDate: string
        exactDocument: MomExactDocument | null
        standardAgendaItems: StandardAgendaItem[] | null
      }>(`/api/meeting/${meetingId}/download-mom`, {
        instruction,
        format,
        mode,
      })
      const filename = `${sanitize(meetingTitle) || 'minutes'}.${format}`

      if (format === 'docx') {
        if (mode === 'best-fit' && templateUrl) {
          try {
            const templateBuffer = await fetchTemplateBuffer(templateUrl)
            const blob = await buildMomFromTemplate(templateBuffer, formatted, {
              meetingTitle: mTitle,
              meetingDate: formattedDate,
              exactDocument: exactDocument ?? undefined,
            })
            downloadBlob(filename, blob)
          } catch {
            if (standardAgendaItems) {
              downloadBlob(filename, await buildStandardDocx(standardAgendaItems, mTitle, meetingDate))
            } else {
              downloadBlob(filename, await buildFallbackDocx(formatted, meetingTitle, meetingDate))
            }
          }
        } else if (mode === 'standard' && standardAgendaItems) {
          downloadBlob(filename, await buildStandardDocx(standardAgendaItems, mTitle, meetingDate))
        } else if (exactDocument) {
          downloadBlob(filename, await buildFallbackDocx(formatted, mTitle, formattedDate))
        } else {
          downloadBlob(filename, await buildFallbackDocx(formatted, meetingTitle, meetingDate))
        }
      } else {
        const bytes = await buildPdf(formatted, meetingTitle, meetingDate)
        const ab = new ArrayBuffer(bytes.byteLength)
        new Uint8Array(ab).set(bytes)
        downloadBlob(filename, new Blob([ab], { type: 'application/pdf' }))
      }
      toast.success(
        `${mode === 'best-fit' ? 'Best-fit' : 'Standard'} MoM downloaded (${format.toUpperCase()})`,
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to download MoM')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2 rounded-full border border-border/70 bg-background/90 px-3 py-1.5">
        <span className={`text-xs ${mode === 'standard' ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
          Standard
        </span>
        <Switch
          id="mom-best-fit-toggle"
          checked={mode === 'best-fit'}
          onCheckedChange={checked => setMode(checked ? 'best-fit' : 'standard')}
          aria-label="Toggle Best fit to attached MoM"
        />
        <span className={`text-xs ${mode === 'best-fit' ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
          Best fit to attached MoM
        </span>
      </div>
      <p className="max-w-xs text-right text-[11px] leading-4 text-muted-foreground">
        {mode === 'best-fit'
          ? 'Uses the attached MoM DOCX as the styling guide and tries to follow it as closely as possible.'
          : 'Uses Secretariat’s own DOCX layout, numbering, and headings without relying on the attached template.'}
      </p>
      <div className="flex items-center gap-2">
        <Select value={format} onValueChange={v => setFormat(v as ExportFormat)}>
          <SelectTrigger className="h-9 w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="docx">DOCX</SelectItem>
            <SelectItem value="pdf">PDF</SelectItem>
          </SelectContent>
        </Select>
        <Button
          onClick={() => { void handleDownload() }}
          disabled={disabled || !allDone || downloading}
          className="gap-2"
        >
          {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {downloading
            ? (mode === 'best-fit' ? 'Generating Best-fit MoM...' : 'Generating Standard MoM...')
            : 'Download MoM'}
        </Button>
      </div>
    </div>
  )
}
