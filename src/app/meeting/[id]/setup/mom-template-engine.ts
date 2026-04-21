import JSZip from 'jszip'
import type { MomExactBlock, MomExactDocument, MomExactRun } from '@/lib/mom-template-types'

const NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

export interface MomTemplateOptions {
  meetingTitle: string
  meetingDate: string
  exactDocument?: MomExactDocument
}

interface ParagraphPrototypeMap {
  agendaHeading: Element | null
  sectionHeading: Element | null
  body: Element | null
  bodyBold: Element | null
  numbered: Record<0 | 1 | 2, Element | null>
}

export async function buildMomFromTemplate(
  templateBuffer: ArrayBuffer,
  contentText: string,
  options: MomTemplateOptions,
): Promise<Blob> {
  const zip = await JSZip.loadAsync(templateBuffer)
  const docXml = await zip.file('word/document.xml')?.async('string')
  if (!docXml) throw new Error('Invalid DOCX: missing word/document.xml')

  const parser = new DOMParser()
  const doc = parser.parseFromString(docXml, 'application/xml')
  const body = doc.getElementsByTagName('w:body')[0]
  if (!body) throw new Error('Invalid DOCX: missing w:body')

  const allNodes = Array.from(body.childNodes)
  const paragraphs = allNodes.filter(node => node.nodeName === 'w:p') as Element[]
  const sectPr = allNodes.find(node => node.nodeName === 'w:sectPr') as Element | undefined
  const contentStart = findContentStart(paragraphs)
  const contentEnd = findContentEnd(paragraphs)

  replaceHeaderFields(paragraphs, contentStart, options)
  await replaceHeaderFooterParts(zip, options)

  const prototypes = collectParagraphPrototypes(paragraphs, contentStart, contentEnd)
  const exactDocument = options.exactDocument ?? convertLegacyTextToExactDocument(contentText)

  for (let index = contentEnd - 1; index >= contentStart; index -= 1) {
    body.removeChild(paragraphs[index])
  }

  const insertBefore = contentEnd < paragraphs.length
    ? paragraphs[contentEnd]
    : (sectPr ?? null)

  exactDocument.blocks.forEach(block => {
    const paragraph = createParagraphForBlock(doc, block, prototypes)
    body.insertBefore(paragraph, insertBefore)
  })

  const serializer = new XMLSerializer()
  zip.file('word/document.xml', serializer.serializeToString(doc))
  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
}

function convertLegacyTextToExactDocument(contentText: string): MomExactDocument {
  const blocks: MomExactBlock[] = []

  contentText.split('\n').forEach(rawLine => {
    const trimmed = rawLine.trim()
    if (!trimmed) return

    const { bold, text } = parseBoldMarker(trimmed)
    const kind = inferLegacyBlockKind(text, bold)
    blocks.push({
      kind,
      level: kind === 'numbered-body'
        ? inferNumberingLevel(text)
        : 0,
      runs: [{ text, bold }],
    })
  })

  return { blocks }
}

function inferLegacyBlockKind(text: string, bold: boolean): MomExactBlock['kind'] {
  if (/^\d+(\.\d+)+\s+\S/i.test(text)) return 'agenda-heading'
  if (/^(noted\s*(&|and)\s*discussed|resolved|action by|status)/i.test(text)) return 'section-heading'
  if (/^\(?[0-9a-z]+[\.\)]\s+\S/i.test(text)) return 'numbered-body'
  if (bold) return 'body-bold'
  return 'body'
}

function inferNumberingLevel(text: string): 0 | 1 | 2 {
  if (/^[a-z][\.\)]\s+/i.test(text)) return 1
  if (/^[ivxlcdm]+[\.\)]\s+/i.test(text)) return 2
  return 0
}

function parseBoldMarker(line: string): { bold: boolean; text: string } {
  const match = line.match(/^\*\*(.+)\*\*$/)
  if (match) return { bold: true, text: match[1] }
  return { bold: false, text: line }
}

function findContentStart(paragraphs: Element[]): number {
  const markers = [
    /^opening\s+remark/i,
    /^noting.*status/i,
    /^confirmation.*minutes/i,
    /^matters\s+arising/i,
    /^agenda\s+\d/i,
  ]

  for (let index = 0; index < paragraphs.length; index += 1) {
    const text = getParaText(paragraphs[index]).trim()
    if (markers.some(marker => marker.test(text)) || /^\d+(\.\d+)+\s+\S/.test(text)) {
      return index
    }
  }

  let lastAttendanceHeader = -1
  for (let index = 0; index < paragraphs.length; index += 1) {
    const text = getParaText(paragraphs[index]).trim().toUpperCase()
    if (/^(OTHER ATTENDEES|IN ATTENDANCE|ABSENT|PRESENT)/.test(text)) {
      lastAttendanceHeader = index
    }
  }
  if (lastAttendanceHeader > 0) {
    for (let index = lastAttendanceHeader + 1; index < paragraphs.length; index += 1) {
      const text = getParaText(paragraphs[index]).trim()
      if (/^\d+(\.\d+)+\s+\S/.test(text)) return index
      if (getParaStyle(paragraphs[index]).startsWith('Heading') && text) return index
      if (text.length > 60) return index
    }
  }

  return Math.min(Math.max(10, Math.floor(paragraphs.length * 0.3)), paragraphs.length)
}

function findContentEnd(paragraphs: Element[]): number {
  for (let index = paragraphs.length - 1; index >= 0; index -= 1) {
    const text = getParaText(paragraphs[index]).trim().toLowerCase()
    if (text.includes('prepared by') || text.includes('confirmed as correct') || text.includes('approved by')) {
      for (let probe = index - 1; probe >= 0; probe -= 1) {
        const value = getParaText(paragraphs[probe]).trim().toLowerCase()
        if (value.includes('closing') || value.includes('adjourned') || value.includes('meeting ended')) {
          return probe
        }
        if (value.length > 50) return probe + 1
      }
      return index
    }
  }
  return paragraphs.length
}

function collectParagraphPrototypes(paragraphs: Element[], start: number, end: number): ParagraphPrototypeMap {
  const prototypes: ParagraphPrototypeMap = {
    agendaHeading: null,
    sectionHeading: null,
    body: null,
    bodyBold: null,
    numbered: {
      0: null,
      1: null,
      2: null,
    },
  }

  for (let index = start; index < end; index += 1) {
    const paragraph = paragraphs[index]
    const text = getParaText(paragraph).trim()
    if (!text) continue

    const bold = hasRunBold(paragraph)
    const numberedLevel = getParagraphNumberingLevel(paragraph)

    if (!prototypes.agendaHeading && /^\d+(\.\d+)+\s+\S/.test(text)) {
      prototypes.agendaHeading = paragraph
    }

    if (numberedLevel != null && !prototypes.numbered[numberedLevel]) {
      prototypes.numbered[numberedLevel] = paragraph
    }

    if (
      !prototypes.sectionHeading
      && bold
      && text.length <= 90
      && (
        /^[A-Z0-9\s/&(),.-]+$/.test(text)
        || /^(noted|resolved|action by|status|decision)/i.test(text)
      )
    ) {
      prototypes.sectionHeading = paragraph
    }

    if (!prototypes.body && !bold && numberedLevel == null && text.length > 20) {
      prototypes.body = paragraph
    }

    if (!prototypes.bodyBold && bold && numberedLevel == null && text.length > 0) {
      prototypes.bodyBold = paragraph
    }
  }

  prototypes.body = prototypes.body
    ?? prototypes.numbered[0]
    ?? prototypes.agendaHeading
    ?? paragraphs[start]
    ?? paragraphs[0]
    ?? null
  prototypes.bodyBold = prototypes.bodyBold
    ?? prototypes.sectionHeading
    ?? prototypes.body
  prototypes.sectionHeading = prototypes.sectionHeading
    ?? prototypes.bodyBold
    ?? prototypes.body
  prototypes.agendaHeading = prototypes.agendaHeading
    ?? prototypes.sectionHeading
    ?? prototypes.bodyBold
    ?? prototypes.body
  prototypes.numbered[0] = prototypes.numbered[0]
    ?? prototypes.body
  prototypes.numbered[1] = prototypes.numbered[1]
    ?? prototypes.numbered[0]
    ?? prototypes.body
  prototypes.numbered[2] = prototypes.numbered[2]
    ?? prototypes.numbered[1]
    ?? prototypes.numbered[0]
    ?? prototypes.body

  return prototypes
}

function createParagraphForBlock(
  doc: XMLDocument,
  block: MomExactBlock,
  prototypes: ParagraphPrototypeMap,
) {
  const template = selectPrototype(block, prototypes)
  const paragraph = template
    ? template.cloneNode(true) as Element
    : doc.createElementNS(NS, 'w:p')

  if (block.kind === 'numbered-body' || block.kind === 'agenda-heading') {
    const numberingSource = block.kind === 'agenda-heading'
      ? (prototypes.agendaHeading && getParagraphNumberingLevel(prototypes.agendaHeading) != null
          ? prototypes.agendaHeading
          : (prototypes.numbered[0] ?? prototypes.numbered[block.level]))
      : (prototypes.numbered[block.level] ?? prototypes.numbered[0])
    if (numberingSource) {
      applyNumberingFromPrototype(paragraph, numberingSource)
    }
  } else {
    stripNumbering(paragraph)
  }

  setParagraphRuns(paragraph, block.runs, block.kind === 'body-bold' || block.kind === 'section-heading')
  return paragraph
}

function selectPrototype(block: MomExactBlock, prototypes: ParagraphPrototypeMap) {
  if (block.kind === 'agenda-heading') {
    return prototypes.agendaHeading
      ?? prototypes.numbered[0]
      ?? prototypes.sectionHeading
      ?? prototypes.bodyBold
      ?? prototypes.body
  }
  if (block.kind === 'section-heading') return prototypes.sectionHeading ?? prototypes.bodyBold ?? prototypes.body
  if (block.kind === 'body-bold') return prototypes.bodyBold ?? prototypes.sectionHeading ?? prototypes.body
  if (block.kind === 'numbered-body') return prototypes.numbered[block.level] ?? prototypes.numbered[0] ?? prototypes.body
  return prototypes.body ?? prototypes.numbered[0] ?? prototypes.agendaHeading
}

function replaceHeaderFields(paragraphs: Element[], contentStart: number, opts: MomTemplateOptions) {
  const meetingReference = deriveMeetingReference(opts.meetingTitle)

  for (let index = 0; index < contentStart; index += 1) {
    const text = getParaText(paragraphs[index]).trim()
    if (!text) continue

    if (/MINUTES?\s+OF/i.test(text)) {
      setParagraphRuns(paragraphs[index], [{ text: opts.meetingTitle, bold: hasRunBold(paragraphs[index]) }], hasRunBold(paragraphs[index]))
    } else if (/^Date\s*:/i.test(text)) {
      setParagraphRuns(paragraphs[index], [{ text: replaceLabelValue(text, opts.meetingDate), bold: false }], false)
    } else if (/\|\s*page\b/i.test(text)) {
      setParagraphRuns(paragraphs[index], [{ text: text.replace(/^.*?(?=\|\s*page\b)/i, `${meetingReference} `), bold: false }], false)
    } else if (/\b\d{1,2}\/\d{4}\b/.test(text)) {
      setParagraphRuns(paragraphs[index], [{ text: text.replace(/\b\d{1,2}\/\d{4}\b/g, meetingReference), bold: hasRunBold(paragraphs[index]) }], hasRunBold(paragraphs[index]))
    }
  }
}

async function replaceHeaderFooterParts(zip: JSZip, opts: MomTemplateOptions) {
  const targets = Object.keys(zip.files).filter(path => /^word\/(header|footer)\d+\.xml$/i.test(path))
  await Promise.all(targets.map(async path => {
    const xml = await zip.file(path)?.async('string')
    if (!xml) return

    const parser = new DOMParser()
    const doc = parser.parseFromString(xml, 'application/xml')
    const paragraphs = Array.from(doc.getElementsByTagName('w:p'))
    const meetingReference = deriveMeetingReference(opts.meetingTitle)

    paragraphs.forEach(paragraph => {
      const text = getParaText(paragraph).trim()
      if (!text) return

      if (/MINUTES?\s+OF/i.test(text)) {
        setParagraphRuns(paragraph, [{ text: opts.meetingTitle, bold: hasRunBold(paragraph) }], hasRunBold(paragraph))
      } else if (/^Date\s*:/i.test(text)) {
        setParagraphRuns(paragraph, [{ text: replaceLabelValue(text, opts.meetingDate), bold: false }], false)
      } else if (/\|\s*page\b/i.test(text)) {
        setParagraphRuns(paragraph, [{ text: text.replace(/^.*?(?=\|\s*page\b)/i, `${meetingReference} `), bold: false }], false)
      } else if (/\b\d{1,2}\/\d{4}\b/.test(text)) {
        setParagraphRuns(paragraph, [{ text: text.replace(/\b\d{1,2}\/\d{4}\b/g, meetingReference), bold: hasRunBold(paragraph) }], hasRunBold(paragraph))
      }
    })

    zip.file(path, new XMLSerializer().serializeToString(doc))
  }))
}

function replaceLabelValue(text: string, value: string) {
  return text.replace(/^([^:]+:\s*).*$/i, `$1${value}`)
}

function deriveMeetingReference(meetingTitle: string) {
  return meetingTitle.match(/\b\d{1,2}\/\d{4}\b/)?.[0] ?? meetingTitle
}

function getDirectChildren(element: Element, tagName: string) {
  return Array.from(element.childNodes).filter(
    node => node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === tagName,
  ) as Element[]
}

function getOrCreateParagraphPr(paragraph: Element) {
  const existing = getDirectChildren(paragraph, 'w:pPr')[0]
  if (existing) return existing
  const pPr = paragraph.ownerDocument.createElementNS(NS, 'w:pPr')
  paragraph.insertBefore(pPr, paragraph.firstChild)
  return pPr
}

function applyNumberingFromPrototype(paragraph: Element, prototype: Element) {
  const sourcePPr = getDirectChildren(prototype, 'w:pPr')[0]
  const sourceNumPr = sourcePPr ? getDirectChildren(sourcePPr, 'w:numPr')[0] : null
  if (!sourceNumPr) return

  const targetPPr = getOrCreateParagraphPr(paragraph)
  const existing = getDirectChildren(targetPPr, 'w:numPr')[0]
  if (existing) {
    targetPPr.removeChild(existing)
  }
  targetPPr.appendChild(sourceNumPr.cloneNode(true))
}

function stripNumbering(paragraph: Element) {
  const pPr = getDirectChildren(paragraph, 'w:pPr')[0]
  if (!pPr) return
  const numPr = getDirectChildren(pPr, 'w:numPr')[0]
  if (numPr) {
    pPr.removeChild(numPr)
  }
}

function getParagraphNumberingLevel(paragraph: Element): 0 | 1 | 2 | null {
  const pPr = getDirectChildren(paragraph, 'w:pPr')[0]
  const numPr = pPr ? getDirectChildren(pPr, 'w:numPr')[0] : null
  if (!numPr) return null
  const ilvl = getDirectChildren(numPr, 'w:ilvl')[0]?.getAttribute('w:val')
  if (ilvl === '1') return 1
  if (ilvl === '2') return 2
  return 0
}

function setParagraphRuns(paragraph: Element, runs: MomExactRun[], forceAllBold = false) {
  const templates = getRunTemplates(paragraph)

  getDirectChildren(paragraph, 'w:r').forEach(run => {
    paragraph.removeChild(run)
  })
  getDirectChildren(paragraph, 'w:hyperlink').forEach(link => {
    paragraph.removeChild(link)
  })

  const safeRuns = runs.length > 0 ? runs : [{ text: '', bold: forceAllBold }]
  safeRuns.forEach(runData => {
    const template = (forceAllBold || runData.bold)
      ? (templates.bold ?? templates.normal)
      : (templates.normal ?? templates.bold)
    const nextRun = template
      ? template.cloneNode(true) as Element
      : paragraph.ownerDocument.createElementNS(NS, 'w:r')

    setRunText(nextRun, runData.text)
    setRunBold(nextRun, forceAllBold || runData.bold)
    paragraph.appendChild(nextRun)
  })
}

function getRunTemplates(paragraph: Element) {
  const directRuns = getDirectChildren(paragraph, 'w:r')
  const normal = directRuns.find(run => !runHasBold(run)) ?? directRuns[0] ?? null
  const bold = directRuns.find(run => runHasBold(run)) ?? normal
  return { normal, bold }
}

function setRunText(run: Element, text: string) {
  Array.from(run.childNodes).forEach(child => {
    if ((child as Element).tagName !== 'w:rPr') {
      run.removeChild(child)
    }
  })

  const textNode = run.ownerDocument.createElementNS(NS, 'w:t')
  textNode.setAttribute('xml:space', 'preserve')
  textNode.textContent = text
  run.appendChild(textNode)
}

function setRunBold(run: Element, bold: boolean) {
  let rPr = getDirectChildren(run, 'w:rPr')[0]
  if (!rPr && bold) {
    rPr = run.ownerDocument.createElementNS(NS, 'w:rPr')
    run.insertBefore(rPr, run.firstChild)
  }

  if (!rPr) return

  const boldNode = getDirectChildren(rPr, 'w:b')[0]
  if (bold) {
    if (!boldNode) {
      rPr.appendChild(run.ownerDocument.createElementNS(NS, 'w:b'))
    } else {
      boldNode.removeAttribute('w:val')
    }
    return
  }

  if (boldNode) {
    rPr.removeChild(boldNode)
  }
}

function runHasBold(run: Element) {
  const rPr = getDirectChildren(run, 'w:rPr')[0]
  const boldNode = rPr ? getDirectChildren(rPr, 'w:b')[0] : null
  if (!boldNode) return false
  const value = boldNode.getAttribute('w:val')
  return value !== 'false' && value !== '0'
}

function hasRunBold(paragraph: Element) {
  return getDirectChildren(paragraph, 'w:r').some(runHasBold)
}

function getParaText(paragraph: Element) {
  return Array.from(paragraph.getElementsByTagName('w:t')).map(node => node.textContent ?? '').join('')
}

function getParaStyle(paragraph: Element) {
  return paragraph.getElementsByTagName('w:pStyle')[0]?.getAttribute('w:val') ?? 'none'
}
