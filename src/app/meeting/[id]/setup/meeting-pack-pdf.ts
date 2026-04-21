import {
  PDFDocument,
  type PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  type PDFRef,
  StandardFonts,
  rgb,
} from 'pdf-lib'
import type { Agenda } from '@/lib/supabase/types'
import type { createClient } from '@/lib/supabase/server'
import { resolveAgendaPdfSource } from '@/lib/agenda-pdf'
import {
  type AgendaPackSection,
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

interface AppendPdfResult {
  count: number
  firstPageRef: PDFRef | null
}

interface BookmarkNode {
  title: string
  pageRef: PDFRef | null
  children: BookmarkNode[]
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

  return page.ref
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

  return page.ref
}

async function appendPdfFromStorage(
  doc: PDFDocument,
  supabase: SupabaseServerClient,
  path: string,
  warnings: string[],
  label: string,
): Promise<AppendPdfResult> {
  const { data, error } = await supabase.storage.from('meeting-files').download(path)
  if (error || !data) {
    warnings.push(`${label}: ${error?.message ?? 'File not found'}`)
    return { count: 0, firstPageRef: null }
  }

  try {
    const bytes = new Uint8Array(await data.arrayBuffer())
    const source = await PDFDocument.load(bytes)
    const pageIndexes = source.getPageIndices()
    const pages = await doc.copyPages(source, pageIndexes)
    pages.forEach(page => doc.addPage(page))
    return { count: pages.length, firstPageRef: pages[0]?.ref ?? null }
  } catch (e) {
    warnings.push(`${label}: ${e instanceof Error ? e.message : 'Failed to parse PDF'}`)
    return { count: 0, firstPageRef: null }
  }
}

function getAgendaPdfPath(config: MeetingPackConfig, agenda: Agenda, agendas: Agenda[]) {
  const override = config.agendaPdfOverrides.find(item => item.agendaId === agenda.id)
  return override?.pdfPath ?? resolveAgendaPdfSource(agendas, agenda.id).path
}

function getAgendaBookmarkTitle(agenda: Agenda) {
  return `${agenda.agenda_no} ${agenda.title}`.trim()
}

function setBookmarkPageRef(target: BookmarkNode | undefined, pageRef: PDFRef | null) {
  if (!target || !pageRef || target.pageRef) return
  target.pageRef = pageRef
}

function buildBookmarkNodesForSections(
  sectionLookup: Map<string, AgendaPackSection>,
  topLevelOrder: TopLevelBlockId[],
  targetsByHeadingId: Map<string, BookmarkNode>,
) {
  const ordered: BookmarkNode[] = []
  const seenHeadingIds = new Set<string>()

  for (const block of topLevelOrder) {
    if (!block.startsWith('section:')) continue
    const headingId = block.slice('section:'.length)
    if (seenHeadingIds.has(headingId)) continue
    seenHeadingIds.add(headingId)

    const target = targetsByHeadingId.get(headingId)
    if (!target) continue

    const visibleChildren = target.children
      .filter(child => child.pageRef)
      .map(child => ({ ...child, pageRef: child.pageRef, children: [] }))

    const pageRef = target.pageRef ?? visibleChildren[0]?.pageRef ?? null
    if (!pageRef) continue

    ordered.push({
      title: target.title,
      pageRef,
      children: visibleChildren,
    })
  }

  if (ordered.length > 0) return ordered

  for (const [headingId, section] of sectionLookup) {
    if (seenHeadingIds.has(headingId)) continue
    const target = targetsByHeadingId.get(headingId)
    if (!target) continue
    const visibleChildren = target.children
      .filter(child => child.pageRef)
      .map(child => ({ ...child, pageRef: child.pageRef, children: [] }))
    const pageRef = target.pageRef ?? visibleChildren[0]?.pageRef ?? null
    if (!pageRef) continue

    ordered.push({
      title: target.title || getAgendaBookmarkTitle(section.heading),
      pageRef,
      children: visibleChildren,
    })
  }

  return ordered
}

function createOutlineLevel(
  doc: PDFDocument,
  parentRef: PDFRef,
  nodes: BookmarkNode[],
  warnings: string[],
) {
  const created: Array<{ ref: PDFRef; dict: PDFDict; span: number }> = []

  for (const node of nodes) {
    if (!node.pageRef) continue

    try {
      const dict = doc.context.obj({
        Title: PDFHexString.fromText(node.title),
        Parent: parentRef,
        Dest: [node.pageRef, PDFName.of('Fit')],
      })
      const ref = doc.context.register(dict)
      const childTree = createOutlineLevel(doc, ref, node.children, warnings)
      if (childTree) {
        dict.set(PDFName.of('First'), childTree.firstRef)
        dict.set(PDFName.of('Last'), childTree.lastRef)
        dict.set(PDFName.of('Count'), PDFNumber.of(childTree.visibleCount))
      }
      created.push({
        ref,
        dict,
        span: 1 + (childTree?.visibleCount ?? 0),
      })
    } catch (error) {
      warnings.push(`Bookmark ${node.title}: ${error instanceof Error ? error.message : 'Failed to create bookmark'}`)
    }
  }

  if (created.length === 0) return null

  for (let index = 0; index < created.length; index += 1) {
    const current = created[index]
    const prev = created[index - 1]
    const next = created[index + 1]
    if (prev) current.dict.set(PDFName.of('Prev'), prev.ref)
    if (next) current.dict.set(PDFName.of('Next'), next.ref)
  }

  return {
    firstRef: created[0].ref,
    lastRef: created[created.length - 1].ref,
    visibleCount: created.reduce((sum, item) => sum + item.span, 0),
  }
}

function attachOutlineBookmarks(
  doc: PDFDocument,
  rootNodes: BookmarkNode[],
  warnings: string[],
) {
  if (rootNodes.length === 0) return

  try {
    const outlinesDict = doc.context.obj({ Type: 'Outlines' })
    const outlinesRef = doc.context.register(outlinesDict)
    const outlineTree = createOutlineLevel(doc, outlinesRef, rootNodes, warnings)
    if (!outlineTree) return

    outlinesDict.set(PDFName.of('First'), outlineTree.firstRef)
    outlinesDict.set(PDFName.of('Last'), outlineTree.lastRef)
    outlinesDict.set(PDFName.of('Count'), PDFNumber.of(outlineTree.visibleCount))

    doc.catalog.set(PDFName.of('Outlines'), outlinesRef)
    doc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'))
  } catch (error) {
    warnings.push(`Bookmarks: ${error instanceof Error ? error.message : 'Failed to build bookmark outline'}`)
  }
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
  const groupedSections = groupAgendasForMeetingPack(agendas)
  const excludedAgendaIds = new Set(config.excludedAgendaIds ?? [])
  const sectionLookup = new Map(groupedSections.map(s => [s.heading.id, s]))
  const bookmarkTargetsByHeadingId = new Map<string, BookmarkNode>()
  const bookmarkTargetsByItemId = new Map<string, BookmarkNode>()

  groupedSections.forEach(section => {
    const children = section.items.map(item => {
      const childTarget: BookmarkNode = {
        title: getAgendaBookmarkTitle(item),
        pageRef: null,
        children: [],
      }
      bookmarkTargetsByItemId.set(item.id, childTarget)
      return childTarget
    })

    bookmarkTargetsByHeadingId.set(section.heading.id, {
      title: getAgendaBookmarkTitle(section.heading),
      pageRef: null,
      children,
    })
  })

  async function addFixedSection(block: Extract<TopLevelBlockId, 'front_page' | 'confidentiality' | 'end_notes'>) {
    const path = config.fixedSections[block].pdfPath
    if (path) {
      const copied = await appendPdfFromStorage(doc, supabase, path, warnings, block)
      totalPages += copied.count
      if (copied.count > 0) return
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

  async function insertDivider(agendaNo: string, title: string, customPdfPath: string | null) {
    if (customPdfPath) {
      const copied = await appendPdfFromStorage(doc, supabase, customPdfPath, warnings, `Divider: ${title}`)
      totalPages += copied.count
      if (copied.count > 0) return copied.firstPageRef
    }
    const pageRef = await addDividerPage(doc, agendaNo, title)
    totalPages += 1
    return pageRef
  }

  async function addSectionBlock(headingId: string) {
    const section = sectionLookup.get(headingId)
    if (!section) return
    const sectionTarget = bookmarkTargetsByHeadingId.get(headingId)

    if (config.includeSectionDividerPages) {
      const dividerRef = await insertDivider(section.heading.agenda_no, section.heading.title, config.sectionDividerPdfPath)
      setBookmarkPageRef(sectionTarget, dividerRef ?? null)
    }

    const includeSectionHeading = !excludedAgendaIds.has(section.heading.id)
    const sectionPdfPath = includeSectionHeading ? getAgendaPdfPath(config, section.heading, agendas) : null
    if (sectionPdfPath) {
      const copied = await appendPdfFromStorage(
        doc, supabase, sectionPdfPath, warnings,
        `Agenda ${section.heading.agenda_no} ${section.heading.title}`,
      )
      totalPages += copied.count
      setBookmarkPageRef(sectionTarget, copied.firstPageRef)
    }

    for (const item of section.items) {
      if (excludedAgendaIds.has(item.id)) continue
      const itemTarget = bookmarkTargetsByItemId.get(item.id)
      if (config.includeSubsectionDividerPages) {
        const dividerRef = await insertDivider(item.agenda_no, item.title, config.subsectionDividerPdfPath)
        setBookmarkPageRef(itemTarget, dividerRef ?? null)
      }
      const itemPdfPath = getAgendaPdfPath(config, item, agendas)
      if (!itemPdfPath) {
        setBookmarkPageRef(sectionTarget, itemTarget?.pageRef ?? null)
        continue
      }
      const copied = await appendPdfFromStorage(
        doc, supabase, itemPdfPath, warnings,
        `Agenda ${item.agenda_no} ${item.title}`,
      )
      totalPages += copied.count
      setBookmarkPageRef(itemTarget, copied.firstPageRef)
      setBookmarkPageRef(sectionTarget, itemTarget?.pageRef ?? null)
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
        totalPages += copied.count
        if (copied.count > 0) continue
      }

      await addTextPage(doc, customSection.title, ['No PDF attached for this custom section.'])
      totalPages += 1
    }
  }

  if (totalPages === 0) throw new Error('No pages available for Meeting Pack')

  if (config.includeBookmarks) {
    const rootNodes = buildBookmarkNodesForSections(
      sectionLookup,
      config.topLevelOrder,
      bookmarkTargetsByHeadingId,
    )
    attachOutlineBookmarks(doc, rootNodes, warnings)
  }

  const bytes = await doc.save()
  return { bytes, warnings }
}
