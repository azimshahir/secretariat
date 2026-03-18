import JSZip from 'jszip'

const NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

export interface MomTemplateOptions {
  meetingTitle: string
  meetingDate: string
}

/**
 * Build MoM DOCX from template:
 * 1. Replace header fields (title, date) in-place — keeps original formatting
 * 2. Replace content zone — clones bold/non-bold paragraph variants from template
 * 3. LLM uses **markers** to indicate bold lines → engine picks matching template
 */
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
  const paragraphs = allNodes.filter(n => n.nodeName === 'w:p') as Element[]
  const sectPr = allNodes.find(n => n.nodeName === 'w:sectPr') as Element | undefined

  const contentStart = findContentStart(paragraphs)
  const contentEnd = findContentEnd(paragraphs)

  replaceHeaderFields(paragraphs, contentStart, options)

  const styleMap = collectStyleTemplates(paragraphs, contentStart, contentEnd)

  for (let i = contentEnd - 1; i >= contentStart; i--) {
    body.removeChild(paragraphs[i])
  }

  const insertBefore = contentEnd < paragraphs.length
    ? paragraphs[contentEnd]
    : (sectPr ?? null)

  for (const rawLine of contentText.split('\n')) {
    const { bold, text: line } = parseBoldMarker(rawLine)
    const styleName = detectStyle(line, bold)
    const templatePara = styleMap[styleName] ?? styleMap.list ?? styleMap.body
    if (templatePara) {
      const newP = templatePara.cloneNode(true) as Element
      stripNumbering(newP)
      setParagraphText(newP, line)
      body.insertBefore(newP, insertBefore)
    } else {
      const newP = doc.createElementNS(NS, 'w:p')
      if (line.trim()) {
        const run = doc.createElementNS(NS, 'w:r')
        const t = doc.createElementNS(NS, 'w:t')
        t.setAttribute('xml:space', 'preserve')
        t.textContent = line
        run.appendChild(t)
        newP.appendChild(run)
      }
      body.insertBefore(newP, insertBefore)
    }
  }

  const serializer = new XMLSerializer()
  zip.file('word/document.xml', serializer.serializeToString(doc))
  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
}

// ── Bold marker parsing ───────────────────────────────────────────────

function parseBoldMarker(line: string): { bold: boolean; text: string } {
  const match = line.match(/^\*\*(.+)\*\*$/)
  if (match) return { bold: true, text: match[1] }
  return { bold: false, text: line }
}

// ── Header field replacement ──────────────────────────────────────────

function replaceHeaderFields(paragraphs: Element[], contentStart: number, opts: MomTemplateOptions) {
  for (let i = 0; i < contentStart; i++) {
    const text = getParaText(paragraphs[i]).trim()
    if (!text) continue
    if (/MINUTES?\s+OF/i.test(text)) {
      setParagraphText(paragraphs[i], opts.meetingTitle)
    } else if (/^Date\s*:/i.test(text)) {
      setParagraphText(paragraphs[i], `Date:${opts.meetingDate}`)
    } else if (/^Time\s*:/i.test(text)) {
      setParagraphText(paragraphs[i], 'Time:??')
    } else if (/^Venue\s*:/i.test(text)) {
      setParagraphText(paragraphs[i], 'Venue:??')
    }
  }
}

// ── Style template collection (bold + non-bold variants) ──────────────

type StyleKey = 'body' | 'bodyBold' | 'list' | 'listBold' | 'noSpacing' | 'heading' | 'comment'
type StyleTemplateMap = Record<StyleKey, Element | null>

function collectStyleTemplates(paragraphs: Element[], start: number, end: number): StyleTemplateMap {
  const map: StyleTemplateMap = {
    body: null, bodyBold: null, list: null, listBold: null,
    noSpacing: null, heading: null, comment: null,
  }
  for (let i = start; i < end; i++) {
    const p = paragraphs[i]
    if (!getParaText(p).trim()) continue
    const style = getParaStyle(p)
    const bold = hasRunBold(p)
    if (style === 'ListParagraph') {
      if (bold && !map.listBold) map.listBold = p
      if (!bold && !map.list) map.list = p
    }
    if (style === 'none' || style === 'Normal') {
      if (bold && !map.bodyBold) map.bodyBold = p
      if (!bold && !map.body) map.body = p
    }
    if (!map.noSpacing && style === 'NoSpacing') map.noSpacing = p
    if (!map.heading && style === 'Heading1') map.heading = p
    if (!map.comment && style === 'CommentText') map.comment = p
  }
  // Fallbacks — ensure every slot has something
  if (!map.list) map.list = map.body
  if (!map.body) map.body = map.list
  if (!map.listBold) map.listBold = map.bodyBold ?? map.heading ?? map.list
  if (!map.bodyBold) map.bodyBold = map.listBold ?? map.body
  if (!map.noSpacing) map.noSpacing = map.list
  if (!map.heading) map.heading = map.listBold ?? map.list
  if (!map.comment) map.comment = map.list
  return map
}

/** Check if any run in the paragraph has <w:b> (bold) */
function hasRunBold(p: Element): boolean {
  const rPrs = p.getElementsByTagName('w:rPr')
  for (let i = 0; i < rPrs.length; i++) {
    const b = rPrs[i].getElementsByTagName('w:b')
    if (b.length > 0) {
      const val = b[0].getAttribute('w:val')
      if (val !== 'false' && val !== '0') return true
    }
  }
  return false
}

// ── Content type detection ─────────────────────────────────────────────

function detectStyle(line: string, bold: boolean): StyleKey {
  const t = line.trim()
  if (!t) return 'list'
  if (/^(NOTED\s*(&|AND)\s*DISCUSSED)/i.test(t)) return 'heading'
  if (/^Action\s+By:/i.test(t)) return 'noSpacing'
  if (/^Status:/i.test(t)) return bold ? 'listBold' : 'list'
  if (/^RESOLVED/i.test(t)) return bold ? 'listBold' : 'list'
  if (/^\d+\.\d+\s*\S/.test(t)) return bold ? 'bodyBold' : 'body'
  return bold ? 'listBold' : 'list'
}

// ── Content zone detection ─────────────────────────────────────────────

function findContentStart(paragraphs: Element[]): number {
  const markers = [
    /^opening\s+remark/i, /^noting.*status/i, /^confirmation.*minutes/i,
    /^matters\s+arising/i, /^agenda\s+\d/i,
  ]
  for (let i = 0; i < paragraphs.length; i++) {
    const text = getParaText(paragraphs[i]).trim()
    for (const m of markers) { if (m.test(text)) return i }
  }
  let lastAttendeeHeader = -1
  for (let i = 0; i < paragraphs.length; i++) {
    const text = getParaText(paragraphs[i]).trim().toUpperCase()
    if (/^(OTHER ATTENDEES|IN ATTENDANCE|ABSENT|PRESENT)/.test(text)) lastAttendeeHeader = i
  }
  if (lastAttendeeHeader > 0) {
    for (let i = lastAttendeeHeader + 1; i < paragraphs.length; i++) {
      const text = getParaText(paragraphs[i]).trim()
      if (getParaStyle(paragraphs[i]) === 'Heading1' && text) return i
      if (/^\d+\.\d+/.test(text)) return i
      if (text.length > 60) return i
    }
  }
  return Math.min(Math.max(10, Math.floor(paragraphs.length * 0.3)), paragraphs.length)
}

function findContentEnd(paragraphs: Element[]): number {
  for (let i = paragraphs.length - 1; i >= 0; i--) {
    const text = getParaText(paragraphs[i]).trim().toLowerCase()
    if (text.includes('prepared by') || text.includes('confirmed as correct')) {
      for (let j = i - 1; j >= 0; j--) {
        const t = getParaText(paragraphs[j]).trim().toLowerCase()
        if (t.includes('closing') || t.includes('adjourned') || t.includes('meeting ended')) return j
        if (t.length > 50) return j + 1
      }
      return i
    }
  }
  return paragraphs.length
}

// ── Helpers ────────────────────────────────────────────────────────────

function stripNumbering(p: Element) {
  const numPrs = p.getElementsByTagName('w:numPr')
  for (let i = numPrs.length - 1; i >= 0; i--) {
    numPrs[i].parentNode?.removeChild(numPrs[i])
  }
}

function setParagraphText(p: Element, text: string) {
  const textNodes = p.getElementsByTagName('w:t')
  if (textNodes.length === 0) {
    let run = p.getElementsByTagName('w:r')[0]
    if (!run) { run = p.ownerDocument.createElementNS(NS, 'w:r'); p.appendChild(run) }
    const t = p.ownerDocument.createElementNS(NS, 'w:t')
    t.setAttribute('xml:space', 'preserve')
    t.textContent = text
    run.appendChild(t)
    return
  }
  textNodes[0].textContent = text
  textNodes[0].setAttribute('xml:space', 'preserve')
  for (let i = textNodes.length - 1; i >= 1; i--) textNodes[i].parentNode?.removeChild(textNodes[i])
  const runs = Array.from(p.getElementsByTagName('w:r'))
  for (let i = runs.length - 1; i >= 1; i--) {
    if (!runs[i].getElementsByTagName('w:t').length) runs[i].parentNode?.removeChild(runs[i])
  }
}

function getParaText(p: Element) {
  return Array.from(p.getElementsByTagName('w:t')).map(t => t.textContent ?? '').join('')
}

function getParaStyle(p: Element): string {
  return p.getElementsByTagName('w:pStyle')[0]?.getAttribute('w:val') ?? 'none'
}
