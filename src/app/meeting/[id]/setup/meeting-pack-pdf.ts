import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { Agenda } from '@/lib/supabase/types'
import type { createClient } from '@/lib/supabase/server'
import {
  groupAgendasForMeetingPack,
  type MeetingPackConfig,
  type TopLevelBlockId,
} from './meeting-pack-model'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

interface BuildMeetingPackInput {
  supabase: SupabaseServerClient
  meetingTitle: string
  meetingDate: string
  agendas: Agenda[]
  config: MeetingPackConfig
}

function wrapText(text: string, maxChars = 95) {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''

  for (const word of words) {
    if (`${current} ${word}`.trim().length <= maxChars) {
      current = `${current} ${word}`.trim()
      continue
    }
    if (current) lines.push(current)
    current = word
  }

  if (current) lines.push(current)
  return lines
}

async function addTextPage(
  doc: PDFDocument,
  title: string,
  lines: string[] = [],
) {
  const page = doc.addPage([595.28, 841.89])
  const titleFont = await doc.embedFont(StandardFonts.HelveticaBold)
  const bodyFont = await doc.embedFont(StandardFonts.Helvetica)

  page.drawText(title, {
    x: 48,
    y: 790,
    size: 22,
    font: titleFont,
    color: rgb(0.09, 0.09, 0.11),
  })

  let cursorY = 750
  lines.forEach(line => {
    wrapText(line).forEach(part => {
      page.drawText(part, {
        x: 48,
        y: cursorY,
        size: 12,
        font: bodyFont,
        color: rgb(0.18, 0.18, 0.22),
      })
      cursorY -= 18
    })
    cursorY -= 8
  })
}

async function addDividerPage(
  doc: PDFDocument,
  agendaNo: string,
  title: string,
) {
  const W = 595.28
  const H = 841.89
  const page = doc.addPage([W, H])
  const labelFont = await doc.embedFont(StandardFonts.Helvetica)
  const titleFont = await doc.embedFont(StandardFonts.HelveticaBold)

  const labelText = `Agenda ${agendaNo}`
  const labelSize = 16
  const titleSize = 28
  const gap = 12

  const labelWidth = labelFont.widthOfTextAtSize(labelText, labelSize)
  const titleLines = wrapText(title, 40)
  const titleLineWidths = titleLines.map(l => titleFont.widthOfTextAtSize(l, titleSize))
  const totalHeight = labelSize + gap + titleSize * titleLines.length + 6 * (titleLines.length - 1)
  const startY = (H + totalHeight) / 2

  page.drawText(labelText, {
    x: (W - labelWidth) / 2,
    y: startY,
    size: labelSize,
    font: labelFont,
    color: rgb(0.35, 0.35, 0.4),
  })

  let cursorY = startY - labelSize - gap
  titleLines.forEach((line, i) => {
    page.drawText(line, {
      x: (W - titleLineWidths[i]) / 2,
      y: cursorY,
      size: titleSize,
      font: titleFont,
      color: rgb(0.09, 0.09, 0.11),
    })
    cursorY -= titleSize + 6
  })
}

async function appendPdfFromStorage(
  doc: PDFDocument,
  supabase: SupabaseServerClient,
  path: string,
  warnings: string[],
  label: string,
) {
  const { data, error } = await supabase.storage.from('meeting-files').download(path)
  if (error || !data) {
    warnings.push(`${label}: ${error?.message ?? 'File not found'}`)
    return 0
  }

  try {
    const bytes = new Uint8Array(await data.arrayBuffer())
    const source = await PDFDocument.load(bytes)
    const pageIndexes = source.getPageIndices()
    const pages = await doc.copyPages(source, pageIndexes)
    pages.forEach(page => doc.addPage(page))
    return pages.length
  } catch (e) {
    warnings.push(`${label}: ${e instanceof Error ? e.message : 'Failed to parse PDF'}`)
    return 0
  }
}

function getAgendaPdfPath(config: MeetingPackConfig, agenda: Agenda) {
  const override = config.agendaPdfOverrides.find(item => item.agendaId === agenda.id)
  return override?.pdfPath ?? agenda.slide_pages
}

export async function buildMeetingPackPdf({
  supabase,
  meetingTitle,
  meetingDate,
  agendas,
  config,
}: BuildMeetingPackInput) {
  const doc = await PDFDocument.create()
  const warnings: string[] = []
  let totalPages = 0

  async function addFixedSection(block: Extract<TopLevelBlockId, 'front_page' | 'confidentiality' | 'end_notes'>) {
    const path = config.fixedSections[block].pdfPath
    if (path) {
      const copied = await appendPdfFromStorage(doc, supabase, path, warnings, block)
      totalPages += copied
      if (copied > 0) return
    }

    if (block === 'front_page') {
      await addTextPage(doc, 'Meeting Pack', [
        meetingTitle,
        `Meeting Date: ${meetingDate}`,
      ])
      totalPages += 1
      return
    }

    if (block === 'confidentiality') {
      await addTextPage(doc, 'Confidentiality Statements', [
        'This meeting pack is confidential and intended solely for authorized recipients.',
        'Do not distribute, copy, or disclose any content without prior approval from the secretariat.',
      ])
      totalPages += 1
      return
    }

    await addTextPage(doc, 'End of Meeting Notes', [
      'This marks the end of the meeting pack.',
      'Please refer to the secretariat for any amendments or supplementary documents.',
    ])
    totalPages += 1
  }

  const sectionLookup = new Map(
    groupAgendasForMeetingPack(agendas).map(s => [s.heading.id, s]),
  )

  async function insertDivider(agendaNo: string, title: string, customPdfPath: string | null) {
    if (customPdfPath) {
      const copied = await appendPdfFromStorage(doc, supabase, customPdfPath, warnings, `Divider: ${title}`)
      totalPages += copied
      if (copied > 0) return
    }
    await addDividerPage(doc, agendaNo, title)
    totalPages += 1
  }

  async function addSectionBlock(headingId: string) {
    const section = sectionLookup.get(headingId)
    if (!section) return

    if (config.includeSectionDividerPages) {
      await insertDivider(section.heading.agenda_no, section.heading.title, config.sectionDividerPdfPath)
    }

    const sectionPdfPath = getAgendaPdfPath(config, section.heading)
    if (sectionPdfPath) {
      totalPages += await appendPdfFromStorage(
        doc, supabase, sectionPdfPath, warnings,
        `Agenda ${section.heading.agenda_no} ${section.heading.title}`,
      )
    }

    for (const item of section.items) {
      if (config.includeSubsectionDividerPages) {
        await insertDivider(item.agenda_no, item.title, config.subsectionDividerPdfPath)
      }
      const itemPdfPath = getAgendaPdfPath(config, item)
      if (!itemPdfPath) continue
      totalPages += await appendPdfFromStorage(
        doc, supabase, itemPdfPath, warnings,
        `Agenda ${item.agenda_no} ${item.title}`,
      )
    }
  }

  for (const block of config.topLevelOrder) {
    if (block === 'front_page' || block === 'confidentiality' || block === 'end_notes') {
      await addFixedSection(block)
      continue
    }

    if (block.startsWith('section:')) {
      await addSectionBlock(block.slice('section:'.length))
      continue
    }

    // Backward compat: old 'agenda' block expands all sections in order
    if ((block as string) === 'agenda') {
      for (const [headingId] of sectionLookup) {
        await addSectionBlock(headingId)
      }
      continue
    }

    if (block.startsWith('custom:')) {
      const customId = block.slice('custom:'.length)
      const customSection = config.customSections.find(section => section.id === customId)
      if (!customSection) continue

      if (customSection.pdfPath) {
        const copied = await appendPdfFromStorage(doc, supabase, customSection.pdfPath, warnings, customSection.title)
        totalPages += copied
        if (copied > 0) continue
      }

      await addTextPage(doc, customSection.title, ['No PDF attached for this custom section.'])
      totalPages += 1
    }
  }

  if (totalPages === 0) throw new Error('No pages available for Meeting Pack')

  const bytes = await doc.save()
  return { bytes, warnings }
}

