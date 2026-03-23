'use client'

import { useEffect, useMemo, useState } from 'react'
import { Download, FileText, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib'
import {
  AlignmentType,
  BorderStyle,
  Document as DocxDocument,
  Packer,
  Paragraph,
  ShadingType,
  Table as DocxTable,
  TableCell as DocxCell,
  TableRow as DocxRow,
  TextRun,
  WidthType,
} from 'docx'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { getTemplateSignedUrl } from '@/actions/itinerary-template'
import { generateItineraryContent } from '@/actions/generate-itinerary'
import type { Agenda } from '@/lib/supabase/types'
import { buildDocxFromTemplate, fetchTemplateBuffer } from './docx-template-engine'
import { DownloadMomButton } from './download-mom-button'
import { MeetingPackBuilder } from './meeting-pack-builder'
import type { MeetingPackConfig } from './meeting-pack-model'
import type { TemplateGroup, TemplateSection } from './settings-template-model'

type ExportFormat = 'pdf' | 'docx'

interface Props {
  groups: TemplateGroup[]
  meetingId: string
  meetingTitle: string
  meetingDate: string
  existingAgendas: Agenda[]
  committeeId: string | null
  meetingStatus: string
  initialMeetingPackConfig: MeetingPackConfig
}

function toSafeFileName(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function toDisplaySectionTitle(title: string) {
  return title.trim().toLowerCase() === 'summary of decision'
    ? 'Matter Arising for all'
    : title
}

function isMatterArisingSection(title: string) {
  const t = title.trim().toLowerCase()
  return t.includes('matter arising') || t.includes('summary of decision')
}

function inferFormatFromTemplate(section: TemplateSection): ExportFormat {
  const ext = section.templateFileName?.split('.').pop()?.trim().toLowerCase()
  return ext === 'docx' ? 'docx' : 'pdf'
}

function getTopTitle(meetingTitle: string, sectionTitle: string) {
  const prefix = meetingTitle.split(/meeting\s+no\./i)[0]?.trim() || meetingTitle
  return `${prefix.toUpperCase()} ${sectionTitle.toUpperCase()}`
}

function getTableData(section: TemplateSection, agendas: Agenda[]) {
  const normalized = toDisplaySectionTitle(section.title).trim().toLowerCase()
  if (normalized === 'agenda' || normalized === 'matter arising for all') {
    return {
      columns: ['Agenda No.', 'Agenda Item', 'Owner'],
      rows: agendas.map(agenda => [agenda.agenda_no, agenda.title, agenda.presenter ?? '']),
    }
  }
  if (normalized === 'presenter list') {
    return {
      columns: ['Agenda No.', 'Agenda Item', 'Presenter'],
      rows: agendas.map(agenda => [agenda.agenda_no, agenda.title, agenda.presenter ?? '']),
    }
  }
  return {
    columns: ['Agenda No.', 'Item', 'Owner'],
    rows: agendas.map(agenda => [agenda.agenda_no, agenda.title, agenda.presenter ?? '']),
  }
}

function wrapText(text: string, maxWidth: number, font: PDFFont, size: number) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean)
  if (words.length === 0) return ['']

  const lines: string[] = []
  let current = words[0]
  for (let i = 1; i < words.length; i += 1) {
    const next = `${current} ${words[i]}`
    if (font.widthOfTextAtSize(next, size) <= maxWidth) {
      current = next
    } else {
      lines.push(current)
      current = words[i]
    }
  }
  lines.push(current)
  return lines
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function downloadPdf(filename: string, bytes: Uint8Array) {
  const arrayBuffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(arrayBuffer).set(bytes)
  downloadBlob(filename, new Blob([arrayBuffer], { type: 'application/pdf' }))
}

async function buildSectionPdf(
  sectionTitle: string,
  meetingTitle: string,
  meetingDate: string,
  tableData: { columns: string[]; rows: string[][] },
) {
  const doc = await PDFDocument.create()
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique)

  const PAGE_WIDTH = 595.28
  const PAGE_HEIGHT = 841.89
  const MARGIN_X = 42
  const BOTTOM_MARGIN = 34
  const TABLE_WIDTH = PAGE_WIDTH - (MARGIN_X * 2)
  const colors = {
    navy: rgb(0.12, 0.25, 0.45),
    gold: rgb(0.85, 0.71, 0.33),
    border: rgb(0.69, 0.69, 0.69),
    text: rgb(0.19, 0.19, 0.19),
    rowBg: rgb(0.95, 0.95, 0.95),
  }

  const rows = tableData.rows

  const colWidths = tableData.columns.length === 3
    ? [Math.round(TABLE_WIDTH * 0.15), Math.round(TABLE_WIDTH * 0.65), Math.round(TABLE_WIDTH * 0.20)]
    : [Math.round(TABLE_WIDTH * 0.18), Math.round(TABLE_WIDTH * 0.82)]

  const lineHeight = 12
  const cellPadX = 6
  const cellPadY = 6

  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  let y = PAGE_HEIGHT

  const drawPageShell = () => {
    const topTitle = getTopTitle(meetingTitle, sectionTitle)
    const formattedDate = new Date(meetingDate).toLocaleDateString('en-MY', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })

    const titleSize = 22
    const titleWidth = bold.widthOfTextAtSize(topTitle, titleSize)
    page.drawText(topTitle, {
      x: (PAGE_WIDTH - titleWidth) / 2,
      y: PAGE_HEIGHT - 72,
      font: bold,
      size: titleSize,
      color: colors.navy,
    })

    page.drawLine({
      start: { x: MARGIN_X, y: PAGE_HEIGHT - 84 },
      end: { x: PAGE_WIDTH - MARGIN_X, y: PAGE_HEIGHT - 84 },
      thickness: 1.5,
      color: colors.gold,
    })

    const subtitle = `${meetingTitle}  |  ${formattedDate}`
    const subtitleSize = 10.5
    const subtitleWidth = italic.widthOfTextAtSize(subtitle, subtitleSize)
    page.drawText(subtitle, {
      x: (PAGE_WIDTH - subtitleWidth) / 2,
      y: PAGE_HEIGHT - 104,
      font: italic,
      size: subtitleSize,
      color: rgb(0.29, 0.29, 0.31),
    })

    y = PAGE_HEIGHT - 132
  }

  const measureRow = (cells: string[], font: PDFFont, fontSize = 10.5) => {
    const lineSets = cells.map((cell, index) => (
      wrapText(cell ?? '', colWidths[index] - (cellPadX * 2), font, fontSize)
    ))
    const maxLines = Math.max(...lineSets.map(lines => Math.max(lines.length, 1)), 1)
    return {
      lineSets,
      height: (maxLines * lineHeight) + (cellPadY * 2),
      font,
      fontSize,
    }
  }

  const drawMeasuredRow = (
    cells: string[],
    measured: ReturnType<typeof measureRow>,
    opts: { isHeader: boolean },
  ) => {
    let x = MARGIN_X
    for (let i = 0; i < cells.length; i += 1) {
      page.drawRectangle({
        x,
        y: y - measured.height,
        width: colWidths[i],
        height: measured.height,
        borderWidth: 1,
        borderColor: colors.border,
        color: opts.isHeader ? colors.navy : colors.rowBg,
      })

      measured.lineSets[i].forEach((line, lineIndex) => {
        page.drawText(line, {
          x: x + cellPadX,
          y: y - cellPadY - measured.fontSize - (lineIndex * lineHeight),
          font: measured.font,
          size: measured.fontSize,
          color: opts.isHeader ? rgb(1, 1, 1) : colors.text,
        })
      })

      x += colWidths[i]
    }
    y -= measured.height
  }

  const drawHeader = () => {
    const measured = measureRow(tableData.columns, bold, 11)
    if (y - measured.height < BOTTOM_MARGIN) {
      page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
      drawPageShell()
    }
    drawMeasuredRow(tableData.columns, measured, { isHeader: true })
  }

  drawPageShell()
  drawHeader()
  for (const row of rows) {
    const normalized = tableData.columns.map((_, index) => row[index] ?? '')
    const measured = measureRow(normalized, regular)
    if (y - measured.height < BOTTOM_MARGIN) {
      page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
      drawPageShell()
      drawHeader()
    }
    drawMeasuredRow(normalized, measured, { isHeader: false })
  }

  return doc.save()
}

async function buildSectionDocx(
  sectionTitle: string,
  meetingTitle: string,
  meetingDate: string,
  tableData: { columns: string[]; rows: string[][] },
) {
  const displayTitle = sectionTitle
  const rows = tableData.rows
  const formattedDate = new Date(meetingDate).toLocaleDateString('en-MY', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  const navyHex = '1F3F73'
  const border = { style: BorderStyle.SINGLE, color: 'B1B1B1', size: 1 }
  const colWidths = tableData.columns.length === 3 ? [15, 65, 20] : [18, 82]

  const makeCell = (text: string, opts?: { header?: boolean; widthPct?: number }) => {
    const header = opts?.header ?? false
    return new DocxCell({
      width: {
        size: opts?.widthPct ?? 100 / tableData.columns.length,
        type: WidthType.PERCENTAGE,
      },
      borders: { top: border, bottom: border, left: border, right: border },
      shading: {
        type: ShadingType.CLEAR,
        color: 'auto',
        fill: header ? navyHex : 'F3F3F3',
      },
      children: [
        new Paragraph({
          alignment: AlignmentType.LEFT,
          children: [new TextRun({
            text: text || '',
            bold: header,
            color: header ? 'FFFFFF' : '303030',
            size: 22,
            font: 'Calibri',
          })],
        }),
      ],
    })
  }

  const headerRow = new DocxRow({
    children: tableData.columns.map((col, index) => makeCell(col, { header: true, widthPct: colWidths[index] })),
  })

  const bodyRows = rows.map(row => new DocxRow({
    children: tableData.columns.map((_, index) => makeCell(row[index] ?? '', { widthPct: colWidths[index] })),
  }))

  const doc = new DocxDocument({
    sections: [{
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          border: {
            bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D9B450' },
          },
          spacing: { after: 120 },
          children: [new TextRun({
            text: getTopTitle(meetingTitle, displayTitle),
            bold: true,
            size: 44,
            color: navyHex,
            font: 'Calibri',
          })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
          children: [new TextRun({
            text: `${meetingTitle}  |  ${formattedDate}`,
            italics: true,
            size: 24,
            color: '4A4A4A',
            font: 'Calibri',
          })],
        }),
        new DocxTable({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [headerRow, ...bodyRows],
        }),
      ],
    }],
  })

  return Packer.toBlob(doc)
}

export function ItinerariesTab({
  groups,
  meetingId,
  meetingTitle,
  meetingDate,
  existingAgendas,
  committeeId,
  meetingStatus,
  initialMeetingPackConfig,
}: Props) {
  const sections = useMemo(() => {
    const itineraryGroup = groups.find(group => group.id === 'itineraries')
    return itineraryGroup?.sections ?? []
  }, [groups])

  const allDone = useMemo(() => {
    const active = existingAgendas.filter(a => !a.is_skipped)
    return active.length > 0 && active.every(a => a.minute_status === 'done')
  }, [existingAgendas])
  const [downloadingSectionId, setDownloadingSectionId] = useState<string | null>(null)
  const [isDownloadingAll, setIsDownloadingAll] = useState(false)
  const [formatBySection, setFormatBySection] = useState<Record<string, ExportFormat>>({})
  const [instructionBySection, setInstructionBySection] = useState<Record<string, string>>({})
  const [momInstruction, setMomInstruction] = useState('')

  useEffect(() => {
    setFormatBySection(previous => {
      const next = { ...previous }
      sections.forEach(section => {
        if (!next[section.id]) next[section.id] = inferFormatFromTemplate(section)
      })
      return next
    })
  }, [sections])

  const getFormat = (section: TemplateSection) => formatBySection[section.id] ?? inferFormatFromTemplate(section)

  async function resolveTemplateDocx(section: TemplateSection): Promise<ArrayBuffer | null> {
    // Priority 1: in-memory file (just uploaded, not yet reloaded)
    if (section.templateFile) {
      return section.templateFile.arrayBuffer()
    }
    // Priority 2: persisted in Supabase Storage
    if (section.templateStoragePath) {
      const signedUrl = await getTemplateSignedUrl(section.templateStoragePath)
      return fetchTemplateBuffer(signedUrl)
    }
    return null
  }

  async function runSectionDownload(section: TemplateSection, silent = false) {
    const displayTitle = toDisplaySectionTitle(section.title)
    const selectedFormat = getFormat(section)
    const filename = `${toSafeFileName(`${meetingTitle}-${displayTitle}` || 'itinerary')}.${selectedFormat}`

    setDownloadingSectionId(section.id)
    try {
      // AI-enhanced content (fallback to raw DB data if AI fails)
      let tableData: { columns: string[]; rows: string[][] }
      const extraInstruction = instructionBySection[section.id]?.trim() ?? ''
      const fullPrompt = extraInstruction
        ? `${section.prompt}\n\nADDITIONAL INSTRUCTIONS FROM USER:\n${extraInstruction}`
        : section.prompt
      try {
        const result = await generateItineraryContent(meetingId, section.title, fullPrompt)
        tableData = {
          columns: result.columns,
          rows: result.rows.length > 0 ? result.rows : [['—', 'No data available', '—']],
        }
      } catch {
        const raw = getTableData(section, existingAgendas)
        tableData = {
          columns: raw.columns,
          rows: raw.rows.length > 0 ? raw.rows : [['—', 'No data available', '—']],
        }
      }

      if (selectedFormat === 'docx') {
        const templateBlob = await resolveTemplateDocx(section)
        if (templateBlob) {
          const blob = await buildDocxFromTemplate(templateBlob, {
            meetingTitle,
            meetingDate,
            sectionTitle: displayTitle,
            rows: tableData.rows,
          })
          downloadBlob(filename, blob)
        } else {
          const blob = await buildSectionDocx(displayTitle, meetingTitle, meetingDate, tableData)
          downloadBlob(filename, blob)
        }
      } else {
        const bytes = await buildSectionPdf(displayTitle, meetingTitle, meetingDate, tableData)
        downloadPdf(filename, bytes)
      }
      if (!silent) toast.success(`${displayTitle} downloaded (${selectedFormat.toUpperCase()})`)
      return true
    } catch (error) {
      if (!silent) toast.error(error instanceof Error ? error.message : `Failed to download ${displayTitle}`)
      return false
    } finally {
      setDownloadingSectionId(current => (current === section.id ? null : current))
    }
  }

  async function handleDownload(section: TemplateSection) {
    await runSectionDownload(section)
  }

  async function handleDownloadAll() {
    setIsDownloadingAll(true)
    try {
      let successCount = 0
      for (const section of sections) {
        const ok = await runSectionDownload(section, true)
        if (ok) successCount += 1
      }
      toast.success(`Downloaded ${successCount} itinerary file${successCount === 1 ? '' : 's'}`)
    } finally {
      setIsDownloadingAll(false)
    }
  }

  return (
    <div className="space-y-6">
      <MeetingPackBuilder
        meetingId={meetingId}
        meetingTitle={meetingTitle}
        meetingDate={meetingDate}
        agendas={existingAgendas}
        initialConfig={initialMeetingPackConfig}
      />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div className="space-y-1.5">
            <CardTitle>Download Minute of Meeting</CardTitle>
            <CardDescription>
              {allDone
                ? 'All agendas are done. Generate and download the formatted MoM.'
                : 'Mark all agendas as Done in the Generate MoM tab to enable download.'}
            </CardDescription>
          </div>
          <DownloadMomButton
            meetingId={meetingId}
            meetingTitle={meetingTitle}
            meetingDate={meetingDate}
            allDone={allDone}
            instruction={momInstruction}
          />
        </CardHeader>
        <CardContent>
          <Textarea
            placeholder="Additional instructions for MoM generation (optional)..."
            className="min-h-[60px] resize-y text-xs"
            value={momInstruction}
            onChange={e => setMomInstruction(e.target.value)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div className="space-y-1.5">
            <CardTitle>Itineraries</CardTitle>
            <CardDescription>Choose PDF or DOCX, then download each itinerary based on current Agenda content.</CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            className="gap-2"
            onClick={() => { void handleDownloadAll() }}
            disabled={sections.length === 0 || isDownloadingAll}
          >
            {isDownloadingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {isDownloadingAll ? 'Downloading...' : 'Download all'}
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {sections.length === 0 ? (
            <p className="text-sm text-zinc-500">No itineraries configured in Settings yet.</p>
          ) : (
            sections.map(section => (
              <div key={section.id} className="space-y-2 rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">{toDisplaySectionTitle(section.title)}</p>
                    <p className="text-xs text-zinc-500">
                      {isMatterArisingSection(section.title) && meetingStatus !== 'finalized'
                        ? 'Submit finalized MoM first to enable download'
                        : section.noTemplateNeeded ? 'No Template Needed' : (section.templateFileName ?? 'No template uploaded')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Select
                      value={getFormat(section)}
                      onValueChange={value => setFormatBySection(current => ({
                        ...current,
                        [section.id]: value as ExportFormat,
                      }))}
                    >
                      <SelectTrigger className="h-8 w-24">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pdf">PDF</SelectItem>
                        <SelectItem value="docx">DOCX</SelectItem>
                      </SelectContent>
                    </Select>

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => { void handleDownload(section) }}
                      disabled={
                        isDownloadingAll
                        || downloadingSectionId === section.id
                        || (isMatterArisingSection(section.title) && meetingStatus !== 'finalized')
                      }
                    >
                      {downloadingSectionId === section.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <FileText className="h-3.5 w-3.5" />
                      )}
                      {downloadingSectionId === section.id ? 'Generating...' : 'Download'}
                    </Button>
                  </div>
                </div>
                <Textarea
                  placeholder="Additional instructions for AI generation (optional)..."
                  className="min-h-[60px] resize-y text-xs"
                  value={instructionBySection[section.id] ?? ''}
                  onChange={e => setInstructionBySection(prev => ({ ...prev, [section.id]: e.target.value }))}
                />
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
