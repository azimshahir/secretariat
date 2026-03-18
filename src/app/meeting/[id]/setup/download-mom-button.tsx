'use client'

import { useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  Document, HeadingLevel, Packer, Paragraph, TextRun,
} from 'docx'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { formatMomForDownload } from '@/actions/download-mom'
import { fetchTemplateBuffer } from './docx-template-engine'
import { buildMomFromTemplate } from './mom-template-engine'

type ExportFormat = 'docx' | 'pdf'

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

export function DownloadMomButton({ meetingId, meetingTitle, meetingDate, allDone, disabled, instruction }: Props) {
  const [format, setFormat] = useState<ExportFormat>('docx')
  const [downloading, setDownloading] = useState(false)

  async function handleDownload() {
    setDownloading(true)
    try {
      const { text: formatted, templateUrl, meetingTitle: mTitle, formattedDate } = await formatMomForDownload(meetingId, instruction)
      const filename = `${sanitize(meetingTitle) || 'minutes'}.${format}`

      if (format === 'docx') {
        // If template DOCX exists, inject content into it (preserves original formatting)
        if (templateUrl) {
          try {
            const templateBuffer = await fetchTemplateBuffer(templateUrl)
            const blob = await buildMomFromTemplate(templateBuffer, formatted, {
              meetingTitle: mTitle,
              meetingDate: formattedDate,
            })
            downloadBlob(filename, blob)
          } catch {
            // Fallback to generic DOCX if template injection fails
            downloadBlob(filename, await buildFallbackDocx(formatted, meetingTitle, meetingDate))
          }
        } else {
          downloadBlob(filename, await buildFallbackDocx(formatted, meetingTitle, meetingDate))
        }
      } else {
        const bytes = await buildPdf(formatted, meetingTitle, meetingDate)
        const ab = new ArrayBuffer(bytes.byteLength)
        new Uint8Array(ab).set(bytes)
        downloadBlob(filename, new Blob([ab], { type: 'application/pdf' }))
      }
      toast.success(`MoM downloaded (${format.toUpperCase()})`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to download MoM')
    } finally {
      setDownloading(false)
    }
  }

  return (
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
        {downloading ? 'Generating MoM...' : 'Download MoM'}
      </Button>
    </div>
  )
}
