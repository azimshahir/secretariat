import JSZip from 'jszip'

export { formatSecondsToTimecode, parseTimecodeToSeconds } from './timecode'

export interface TranscriptTimelineCue {
  startSec: number
  endSec: number
  speaker: string | null
  text: string
  sortOrder: number
}

export type TranscriptTimelineAnchorKind =
  | 'agenda_start'
  | 'section_start'
  | 'break_start'
  | 'break_end'
  | 'meeting_end'

export interface TranscriptTimelineAnchor {
  kind: TranscriptTimelineAnchorKind
  startSec: number
  agendaNo?: string | null
  title?: string | null
  sourceText: string
}

export interface TranscriptTimelineStructure {
  cues: TranscriptTimelineCue[]
  anchors: TranscriptTimelineAnchor[]
  durationSec: number
}

type DocxTimeMode =
  | 'elapsed_only'
  | 'wall_clock_only'
  | 'mixed_safe'
  | 'mixed_ambiguous'

type DocxTimeReferenceKind =
  | 'elapsed_point'
  | 'elapsed_range'
  | 'wall_clock_point'
  | 'wall_clock_range'

interface DocxTimeReference {
  kind: DocxTimeReferenceKind
  startToken: string
  endToken?: string
}

interface ParsedClockToken {
  secondsOfDay: number
  hasMeridiem: boolean
}

interface AbsoluteClockContext {
  baselineSecondsOfDay: number | null
  lastSecondsOfDay: number | null
}

interface PendingCueDraft {
  startSec: number
  speaker: string | null
  textParts: string[]
}

interface DocxAgendaMarkerMatch {
  agendaNo: string
  title: string | null
  timeReference: DocxTimeReference | null
  consumedLines: number
}

const CLOCK_TOKEN_REGEX =
  /\b(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\b/i
const CLOCK_RANGE_REGEX =
  /(\d{1,2}:\d{2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?)\s*(?:-|–|—|->|-->|to)\s*(\d{1,2}:\d{2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?)/i
const VTT_RANGE_REGEX =
  /(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?)\s*-->\s*(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?)/i
const DOCX_INLINE_AGENDA_REGEX =
  /^[—–-]?\s*Agenda\s+([0-9]+(?:\.[0-9]+)?)\s*:?\s*(.*?)\s*[—–-]?$/i
const DOCX_AGENDA_ONLY_REGEX = /^AGENDA\s+([0-9]+(?:\.[0-9]+)?)$/i
const DOCX_SPEAKER_LINE_REGEX = /^([^:]{2,140}):\s*(.*)$/
const DOCX_TIME_SAFETY_MESSAGE =
  'This transcript mixes clock time and elapsed time in a way that cannot be mapped safely. Please use a timestamped transcript in HH:MM:SS format.'

function sanitizeText(value: string) {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#160;/g, ' ')
}

function extractXmlText(xmlFragment: string) {
  const textMatches = xmlFragment.match(/<w:t[^>]*>[\s\S]*?<\/w:t>/g) ?? []
  return sanitizeText(
    decodeXmlEntities(
      textMatches
        .map(match => match.replace(/<[^>]+>/g, ''))
        .join(' ')
    )
  )
}

function parseRelativeTimeToken(token: string): number | null {
  const normalized = token.trim().replace(',', '.')
  const parts = normalized.split(':')
  if (parts.length < 2 || parts.length > 3) return null

  const secondsPart = Number(parts[parts.length - 1])
  const minutesPart = Number(parts[parts.length - 2])
  const hoursPart = parts.length === 3 ? Number(parts[0]) : 0

  if (!Number.isFinite(secondsPart) || !Number.isFinite(minutesPart) || !Number.isFinite(hoursPart)) {
    return null
  }

  if (secondsPart < 0 || minutesPart < 0 || hoursPart < 0) return null
  return Math.floor(hoursPart * 3600 + minutesPart * 60 + secondsPart)
}

function normalizeWhitespace(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

function classifyDocxTimeToken(token: string): 'elapsed' | 'wall_clock' | 'invalid' {
  const normalized = normalizeWhitespace(token).toLowerCase()
  const hasMeridiem = /\b(a\.?m\.?|p\.?m\.?)\b/i.test(normalized)

  if (hasMeridiem) {
    return parseClockToken(normalized) ? 'wall_clock' : 'invalid'
  }

  if (/^\d{1,2}:\d{2}:\d{2}$/.test(normalized)) {
    return parseRelativeTimeToken(normalized) !== null ? 'elapsed' : 'invalid'
  }

  if (/^\d{1,2}:\d{2}$/.test(normalized)) {
    return parseClockToken(normalized) ? 'wall_clock' : 'invalid'
  }

  return 'invalid'
}

function extractDocxTimeReferenceFromLine(line: string): DocxTimeReference | null {
  const normalized = sanitizeText(line)
  if (!normalized) return null

  const rangeMatch = normalized.match(CLOCK_RANGE_REGEX)
  if (rangeMatch) {
    const startToken = rangeMatch[1]?.trim() ?? ''
    const endToken = rangeMatch[2]?.trim() ?? ''
    const startKind = classifyDocxTimeToken(startToken)
    const endKind = classifyDocxTimeToken(endToken)

    if (startKind === 'elapsed' && endKind === 'elapsed') {
      return {
        kind: 'elapsed_range',
        startToken,
        endToken,
      }
    }

    if (startKind === 'wall_clock' && endKind === 'wall_clock') {
      return {
        kind: 'wall_clock_range',
        startToken,
        endToken,
      }
    }

    return null
  }

  const tokenMatch = normalized.match(CLOCK_TOKEN_REGEX)
  if (!tokenMatch) return null
  const token = tokenMatch[0]?.trim() ?? ''
  const kind = classifyDocxTimeToken(token)
  if (kind === 'elapsed') {
    return {
      kind: 'elapsed_point',
      startToken: token,
    }
  }
  if (kind === 'wall_clock') {
    return {
      kind: 'wall_clock_point',
      startToken: token,
    }
  }
  return null
}

function extractStandaloneDocxTimeReference(line: string): DocxTimeReference | null {
  const normalized = sanitizeText(line)
  if (!normalized) return null

  const rangeMatch = normalized.match(CLOCK_RANGE_REGEX)
  if (rangeMatch && normalizeWhitespace(rangeMatch[0]) === normalizeWhitespace(normalized)) {
    return extractDocxTimeReferenceFromLine(normalized)
  }

  const tokenMatch = normalized.match(CLOCK_TOKEN_REGEX)
  if (tokenMatch && normalizeWhitespace(tokenMatch[0] ?? '') === normalizeWhitespace(normalized)) {
    return extractDocxTimeReferenceFromLine(normalized)
  }

  return null
}

function parseClockToken(token: string): ParsedClockToken | null {
  const match = token.trim().match(CLOCK_TOKEN_REGEX)
  if (!match) return null

  let hours = Number(match[1] ?? 0)
  const minutes = Number(match[2] ?? 0)
  const seconds = Number(match[3] ?? 0)
  const meridiem = (match[4] ?? '').toLowerCase().replace(/\./g, '')

  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return null
  }

  if (minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) {
    return null
  }

  const hasMeridiem = meridiem === 'am' || meridiem === 'pm'
  if (hasMeridiem) {
    if (hours === 12) {
      hours = meridiem === 'am' ? 0 : 12
    } else if (meridiem === 'pm') {
      hours += 12
    }
  }

  if (!hasMeridiem && hours === 24 && minutes === 0 && seconds === 0) {
    hours = 0
  }

  if (hours < 0 || hours >= 24) return null

  return {
    secondsOfDay: (hours * 3600) + (minutes * 60) + seconds,
    hasMeridiem,
  }
}

function resolveAbsoluteClockSeconds(
  token: string,
  context: AbsoluteClockContext,
): number | null {
  const parsed = parseClockToken(token)
  if (!parsed) return null

  const reference = context.lastSecondsOfDay ?? context.baselineSecondsOfDay
  if (parsed.hasMeridiem || reference === null) {
    return parsed.secondsOfDay
  }

  const candidates = [parsed.secondsOfDay]
  if (parsed.secondsOfDay < 12 * 3600) {
    candidates.push(parsed.secondsOfDay + (12 * 3600))
  } else {
    candidates.push(parsed.secondsOfDay - (12 * 3600))
  }

  const viable = candidates.filter(candidate => candidate >= reference - 120)
  if (viable.length > 0) {
    return viable.sort((left, right) => Math.abs(left - reference) - Math.abs(right - reference))[0] ?? null
  }

  return candidates.sort((left, right) => Math.abs(left - reference) - Math.abs(right - reference))[0] ?? null
}

function toRelativeSeconds(absoluteSeconds: number, baselineSecondsOfDay: number | null) {
  if (baselineSecondsOfDay === null) return absoluteSeconds
  if (absoluteSeconds >= baselineSecondsOfDay) {
    return absoluteSeconds - baselineSecondsOfDay
  }
  return (absoluteSeconds + (24 * 3600)) - baselineSecondsOfDay
}

function uniqueLines(lines: string[]) {
  const seen = new Set<string>()
  const unique: string[] = []
  for (const line of lines) {
    const normalized = sanitizeText(line)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    unique.push(normalized)
  }
  return unique
}

function inferWallClockBaselineSecondsOfDay(lines: string[]) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const agendaMarker = readAgendaMarkerFromLines(lines, index)
    if (agendaMarker?.timeReference?.kind === 'wall_clock_point' || agendaMarker?.timeReference?.kind === 'wall_clock_range') {
      const parsed = parseClockToken(agendaMarker.timeReference.startToken)
      if (parsed) return parsed.secondsOfDay
    }

    const timeReference = extractDocxTimeReferenceFromLine(line)
    if (timeReference?.kind === 'wall_clock_point' || timeReference?.kind === 'wall_clock_range') {
      const parsed = parseClockToken(timeReference.startToken)
      if (parsed) return parsed.secondsOfDay
    }
  }

  return null
}

function classifyDocxTimeMode(lines: string[]): DocxTimeMode {
  let elapsedSignals = 0
  let wallClockSignals = 0
  let conflictingSignals = 0

  for (const line of lines) {
    const normalized = sanitizeText(line)
    if (!normalized) continue

    const rangeMatch = normalized.match(CLOCK_RANGE_REGEX)
    if (rangeMatch) {
      const startKind = classifyDocxTimeToken(rangeMatch[1] ?? '')
      const endKind = classifyDocxTimeToken(rangeMatch[2] ?? '')
      if (startKind === 'invalid' || endKind === 'invalid') continue
      if (startKind !== endKind) {
        conflictingSignals += 1
        continue
      }
      if (startKind === 'elapsed') {
        elapsedSignals += 1
      } else {
        wallClockSignals += 1
      }
      continue
    }

    const tokenMatch = normalized.match(CLOCK_TOKEN_REGEX)
    if (!tokenMatch) continue

    const tokenKind = classifyDocxTimeToken(tokenMatch[0] ?? '')
    if (tokenKind === 'elapsed') {
      elapsedSignals += 1
    } else if (tokenKind === 'wall_clock') {
      wallClockSignals += 1
    }
  }

  if (conflictingSignals > 0) {
    return 'mixed_ambiguous'
  }
  if (elapsedSignals > 0 && wallClockSignals === 0) {
    return 'elapsed_only'
  }
  if (wallClockSignals > 0 && elapsedSignals === 0) {
    return inferWallClockBaselineSecondsOfDay(lines) !== null
      ? 'wall_clock_only'
      : 'mixed_ambiguous'
  }
  if (elapsedSignals > 0 && wallClockSignals > 0) {
    return inferWallClockBaselineSecondsOfDay(lines) !== null
      ? 'mixed_safe'
      : 'mixed_ambiguous'
  }

  return 'mixed_ambiguous'
}

async function extractDocxStructuralLines(buffer: ArrayBuffer) {
  const zip = await JSZip.loadAsync(buffer)
  const xml = await zip.file('word/document.xml')?.async('string')
  if (!xml) return []

  const tableLines: string[] = []
  for (const tableMatch of xml.matchAll(/<w:tbl\b[\s\S]*?<\/w:tbl>/g)) {
    const tableXml = tableMatch[0]
    for (const rowMatch of tableXml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)) {
      const cells = Array.from(rowMatch[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g))
        .map(match => extractXmlText(match[0]))
        .filter(Boolean)
      if (cells.length > 0) {
        tableLines.push(cells.join(' | '))
      }
    }
  }

  const paragraphOnlyXml = xml.replace(/<w:tbl\b[\s\S]*?<\/w:tbl>/g, ' ')
  const paragraphLines = paragraphOnlyXml
    .split(/<\/w:p>/)
    .map(fragment => extractXmlText(fragment))
    .filter(Boolean)

  return uniqueLines([...tableLines, ...paragraphLines])
}

function resolveDocxTimeReferenceStartSec(
  timeReference: DocxTimeReference | null,
  context: AbsoluteClockContext,
  baselineSecondsOfDay: number | null,
) {
  if (!timeReference) return null

  if (timeReference.kind === 'elapsed_point' || timeReference.kind === 'elapsed_range') {
    return parseRelativeTimeToken(timeReference.startToken)
  }

  const absoluteSeconds = resolveAbsoluteClockSeconds(timeReference.startToken, context)
  if (absoluteSeconds === null) return null
  context.lastSecondsOfDay = absoluteSeconds
  return toRelativeSeconds(absoluteSeconds, baselineSecondsOfDay)
}

function resolveDocxTimeReferenceEndSec(
  timeReference: DocxTimeReference | null,
  context: AbsoluteClockContext,
  baselineSecondsOfDay: number | null,
) {
  if (!timeReference) return null

  if (timeReference.kind === 'elapsed_range') {
    return parseRelativeTimeToken(timeReference.endToken ?? '')
  }
  if (timeReference.kind === 'elapsed_point') {
    return parseRelativeTimeToken(timeReference.startToken)
  }

  const token = timeReference.kind === 'wall_clock_range'
    ? timeReference.endToken ?? timeReference.startToken
    : timeReference.startToken
  const absoluteSeconds = resolveAbsoluteClockSeconds(token, context)
  if (absoluteSeconds === null) return null
  context.lastSecondsOfDay = absoluteSeconds
  return toRelativeSeconds(absoluteSeconds, baselineSecondsOfDay)
}

function readAdjacentAgendaTimeReference(lines: string[], startIndex: number) {
  for (let offset = 1; offset <= 2; offset += 1) {
    const candidate = sanitizeText(lines[startIndex + offset] ?? '')
    if (!candidate) continue
    const timeReference = extractDocxTimeReferenceFromLine(candidate)
    if (timeReference) {
      return {
        timeReference,
        consumedLines: offset,
      }
    }
  }

  return null
}

function parseBreakAnchorFromLine(line: string, context: AbsoluteClockContext): TranscriptTimelineAnchor[] {
  if (!/\bbreak\b|\brehat\b/i.test(line)) return []

  const timeReference = extractDocxTimeReferenceFromLine(line)
  if (!timeReference) return []

  const startSec = resolveDocxTimeReferenceStartSec(
    timeReference,
    context,
    context.baselineSecondsOfDay,
  )
  const endSec = resolveDocxTimeReferenceEndSec(
    timeReference,
    context,
    context.baselineSecondsOfDay,
  )

  const anchors: TranscriptTimelineAnchor[] = []
  if (startSec !== null) {
    anchors.push({
      kind: 'break_start',
      startSec,
      sourceText: line,
    })
  }
  if (endSec !== null) {
    anchors.push({
      kind: 'break_end',
      startSec: endSec,
      sourceText: line,
    })
  }

  return anchors
}

function parseMeetingEndAnchorFromLine(line: string, context: AbsoluteClockContext): TranscriptTimelineAnchor | null {
  if (!/(meeting ended|meeting adjourned|adjourned at|ended at|closed at)/i.test(line)) {
    return null
  }

  const timeReference = extractDocxTimeReferenceFromLine(line)
  if (!timeReference) return null
  const endSec = resolveDocxTimeReferenceEndSec(
    timeReference,
    context,
    context.baselineSecondsOfDay,
  )
  if (endSec === null) return null

  return {
    kind: 'meeting_end',
    startSec: endSec,
    sourceText: line,
  }
}

function readAgendaMarkerFromLines(lines: string[], index: number): DocxAgendaMarkerMatch | null {
  const current = lines[index] ?? ''
  const tableCells = current.split('|').map(value => sanitizeText(value)).filter(Boolean)
  const tableAgendaMatch = tableCells[0]?.match(DOCX_AGENDA_ONLY_REGEX)
  if (tableAgendaMatch) {
    return {
      agendaNo: tableAgendaMatch[1] ?? '',
      title: tableCells[1] || null,
      timeReference: tableCells[2] ? extractDocxTimeReferenceFromLine(tableCells.slice(2).join(' | ')) : null,
      consumedLines: 1,
    }
  }

  const inlineMatch = current.match(DOCX_INLINE_AGENDA_REGEX)
  if (inlineMatch) {
    const adjacentTime = readAdjacentAgendaTimeReference(lines, index)

    return {
      agendaNo: inlineMatch[1] ?? '',
      title: sanitizeText(inlineMatch[2] ?? '') || null,
      timeReference: adjacentTime?.timeReference ?? null,
      consumedLines: 1 + (adjacentTime?.consumedLines ?? 0),
    }
  }

  const agendaOnlyMatch = current.match(DOCX_AGENDA_ONLY_REGEX)
  if (!agendaOnlyMatch) return null

  const agendaNo = agendaOnlyMatch[1] ?? ''
  const next = sanitizeText(lines[index + 1] ?? '')

  let title: string | null = null
  let timeReference: DocxTimeReference | null = null
  let consumedLines = 1

  if (next && !next.match(CLOCK_TOKEN_REGEX) && !next.match(DOCX_AGENDA_ONLY_REGEX)) {
    title = next
    consumedLines += 1
  }

  const adjacentTime = readAdjacentAgendaTimeReference(lines, index)
  if (adjacentTime) {
    timeReference = adjacentTime.timeReference
    consumedLines = Math.max(consumedLines, 1 + adjacentTime.consumedLines)
  }

  return {
    agendaNo,
    title,
    timeReference,
    consumedLines,
  }
}

function isBoundaryDocxLine(line: string) {
  const normalized = sanitizeText(line)
  if (!normalized) return false
  const tableCells = normalized.split('|').map(value => sanitizeText(value)).filter(Boolean)
  if (tableCells[0]?.match(DOCX_AGENDA_ONLY_REGEX)) return true
  if (normalized.match(DOCX_INLINE_AGENDA_REGEX)) return true
  if (normalized.match(DOCX_AGENDA_ONLY_REGEX)) return true
  const timeReference = extractDocxTimeReferenceFromLine(normalized)
  if (timeReference?.kind === 'elapsed_range' || timeReference?.kind === 'wall_clock_range') return true
  if (extractStandaloneDocxTimeReference(normalized)) return true
  if (/^(meeting ended|meeting adjourned|adjourned at|ended at)/i.test(normalized)) return true
  if (/\bbreak\b|\brehat\b/i.test(normalized) && timeReference) return true
  return false
}

function buildCueFromPendingCue(
  pendingCue: PendingCueDraft | null,
  endSec: number | null,
  fallbackEndSec: number,
  sortOrder: number,
): TranscriptTimelineCue | null {
  if (!pendingCue) return null

  const text = sanitizeText(pendingCue.textParts.join(' '))
  if (!text) return null

  const resolvedEndSec = endSec !== null && endSec > pendingCue.startSec
    ? endSec
    : fallbackEndSec > pendingCue.startSec
      ? fallbackEndSec
      : pendingCue.startSec + 30

  return {
    startSec: pendingCue.startSec,
    endSec: resolvedEndSec,
    speaker: pendingCue.speaker,
    text,
    sortOrder,
  }
}

function parseVttTimelineStructure(content: string): TranscriptTimelineStructure {
  const lines = content.replace(/\r/g, '').split('\n')
  const cues: TranscriptTimelineCue[] = []
  const anchors: TranscriptTimelineAnchor[] = []

  let index = 0
  while (index < lines.length) {
    const line = lines[index]?.trim() ?? ''
    const rangeMatch = line.match(VTT_RANGE_REGEX)
    if (!rangeMatch) {
      index += 1
      continue
    }

    const startSec = parseRelativeTimeToken(rangeMatch[1] ?? '')
    const endSec = parseRelativeTimeToken(rangeMatch[2] ?? '')
    index += 1

    const textLines: string[] = []
    while (index < lines.length) {
      const cueLine = lines[index] ?? ''
      if (!cueLine.trim()) break
      textLines.push(cueLine.trim())
      index += 1
    }

    const raw = textLines.join(' ').trim()
    if (startSec === null || endSec === null || endSec <= startSec || !raw) {
      index += 1
      continue
    }

    const speakerMatch = raw.match(/^<v\s+([^>]+)>([\s\S]*)$/i)
    const labeledMatch = raw.match(/^([^:]{2,60}):\s*([\s\S]*)$/)
    const speaker = speakerMatch?.[1]?.trim() || labeledMatch?.[1]?.trim() || null
    const text = sanitizeText(speakerMatch?.[2] ?? labeledMatch?.[2] ?? raw)
    if (!text) {
      index += 1
      continue
    }

    const agendaMarker = text.match(/agenda\s+([0-9]+(?:\.[0-9]+)?)(?:\s*[:\-]\s*(.*?))?$/i)

    if (/\bbreak\b|\brehat\b/i.test(text)) {
      anchors.push({
        kind: 'break_start',
        startSec,
        sourceText: text,
      })
      anchors.push({
        kind: 'break_end',
        startSec: endSec,
        sourceText: text,
      })
    }

    if (/(meeting ended|meeting adjourned|adjourned at|ended at|closed at)/i.test(text)) {
      anchors.push({
        kind: 'meeting_end',
        startSec: endSec,
        sourceText: text,
      })
    }

    if (agendaMarker) {
      anchors.push({
        kind: agendaMarker[1]?.endsWith('.0') ? 'section_start' : 'agenda_start',
        agendaNo: agendaMarker[1] ?? '',
        title: sanitizeText(agendaMarker[2] ?? '') || null,
        startSec,
        sourceText: text,
      })
    }

    cues.push({
      startSec,
      endSec,
      speaker,
      text,
      sortOrder: cues.length,
    })
    index += 1
  }

  return {
    cues,
    anchors,
    durationSec: cues[cues.length - 1]?.endSec ?? 0,
  }
}

function parseDocxTimelineStructureFromLines(
  lines: string[],
  timeMode: DocxTimeMode = classifyDocxTimeMode(lines),
  baselineSecondsOfDay = inferWallClockBaselineSecondsOfDay(lines),
): TranscriptTimelineStructure {
  const cues: TranscriptTimelineCue[] = []
  const anchors: TranscriptTimelineAnchor[] = []
  if (timeMode === 'mixed_ambiguous') {
    throw new Error(DOCX_TIME_SAFETY_MESSAGE)
  }
  if (timeMode === 'wall_clock_only' && baselineSecondsOfDay === null) {
    throw new Error(DOCX_TIME_SAFETY_MESSAGE)
  }
  const clockContext: AbsoluteClockContext = {
    baselineSecondsOfDay,
    lastSecondsOfDay: baselineSecondsOfDay,
  }

  let pendingCue: PendingCueDraft | null = null

  const flushPendingCue = (nextStartSec: number | null) => {
    const cue = buildCueFromPendingCue(
      pendingCue,
      nextStartSec,
      nextStartSec ?? ((pendingCue?.startSec ?? 0) + 30),
      cues.length,
    )
    if (cue) {
      cues.push(cue)
    }
    pendingCue = null
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = sanitizeText(lines[index] ?? '')
    if (!line) continue

    const agendaMarker = readAgendaMarkerFromLines(lines, index)
    if (agendaMarker) {
      const startSec = resolveDocxTimeReferenceStartSec(
        agendaMarker.timeReference,
        clockContext,
        baselineSecondsOfDay,
      )
      const resolvedStartSec = startSec !== null
        ? startSec
        : cues[cues.length - 1]?.endSec ?? 0

      flushPendingCue(resolvedStartSec)
      anchors.push({
        kind: agendaMarker.agendaNo.endsWith('.0') ? 'section_start' : 'agenda_start',
        agendaNo: agendaMarker.agendaNo,
        title: agendaMarker.title,
        startSec: resolvedStartSec,
        sourceText: line,
      })
      index += agendaMarker.consumedLines - 1
      continue
    }

    const breakAnchors = parseBreakAnchorFromLine(line, clockContext)
    if (breakAnchors.length > 0) {
      flushPendingCue(breakAnchors[0]?.startSec ?? null)
      anchors.push(...breakAnchors)
      continue
    }

    const meetingEndAnchor = parseMeetingEndAnchorFromLine(line, clockContext)
    if (meetingEndAnchor) {
      flushPendingCue(meetingEndAnchor.startSec)
      anchors.push(meetingEndAnchor)
      continue
    }

    const standaloneTimeReference = extractStandaloneDocxTimeReference(line)
    if (standaloneTimeReference) {
      const startSec = resolveDocxTimeReferenceStartSec(
        standaloneTimeReference,
        clockContext,
        baselineSecondsOfDay,
      )
      if (startSec === null) continue
      flushPendingCue(startSec)

      let speaker: string | null = null
      let consumedSpeakerLine = false
      const nextLine = sanitizeText(lines[index + 1] ?? '')
      const speakerMatch = nextLine.match(DOCX_SPEAKER_LINE_REGEX)
      if (speakerMatch) {
        speaker = sanitizeText(speakerMatch[1] ?? '') || null
        const initialText = sanitizeText(speakerMatch[2] ?? '')
        pendingCue = {
          startSec,
          speaker,
          textParts: initialText ? [initialText] : [],
        }
        consumedSpeakerLine = true
      } else {
        pendingCue = {
          startSec,
          speaker: null,
          textParts: [],
        }
      }

      if (consumedSpeakerLine) {
        index += 1
      }
      continue
    }

    if (pendingCue) {
      if (!isBoundaryDocxLine(line)) {
        pendingCue.textParts.push(line)
        continue
      }

      flushPendingCue(null)
      index -= 1
      continue
    }
  }

  flushPendingCue(null)

  const durationSec = Math.max(
    cues[cues.length - 1]?.endSec ?? 0,
    anchors[anchors.length - 1]?.startSec ?? 0,
  )

  return {
    cues,
    anchors,
    durationSec,
  }
}

function parseDocxAnchorsFromStandaloneLines(
  lines: string[],
  baselineSecondsOfDay: number | null,
): TranscriptTimelineAnchor[] {
  const anchors: TranscriptTimelineAnchor[] = []
  const clockContext: AbsoluteClockContext = {
    baselineSecondsOfDay,
    lastSecondsOfDay: baselineSecondsOfDay,
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = sanitizeText(lines[index] ?? '')
    if (!line) continue

    const agendaMarker = readAgendaMarkerFromLines(lines, index)
    if (agendaMarker) {
      const startSec = resolveDocxTimeReferenceStartSec(
        agendaMarker.timeReference,
        clockContext,
        baselineSecondsOfDay,
      )
      if (startSec === null) {
        index += agendaMarker.consumedLines - 1
        continue
      }

      anchors.push({
        kind: agendaMarker.agendaNo.endsWith('.0') ? 'section_start' : 'agenda_start',
        agendaNo: agendaMarker.agendaNo,
        title: agendaMarker.title,
        startSec,
        sourceText: line,
      })
      index += agendaMarker.consumedLines - 1
      continue
    }
  }

  return anchors
}

async function parseDocxTimelineStructure(buffer: ArrayBuffer): Promise<TranscriptTimelineStructure> {
  const structuralLines = await extractDocxStructuralLines(buffer)
  const mammoth = (await import('mammoth')).default
  const rawText = await mammoth.extractRawText({ buffer: Buffer.from(buffer) })
  const rawLines = rawText.value
    .replace(/\r/g, '\n')
    .split('\n')
    .map(line => sanitizeText(line))
    .filter(Boolean)

  const combinedLines = uniqueLines([...structuralLines, ...rawLines])
  const timeMode = classifyDocxTimeMode(combinedLines)
  if (timeMode === 'mixed_ambiguous') {
    throw new Error(DOCX_TIME_SAFETY_MESSAGE)
  }

  const baselineSecondsOfDay = inferWallClockBaselineSecondsOfDay(combinedLines)
  if (timeMode === 'wall_clock_only' && baselineSecondsOfDay === null) {
    throw new Error(DOCX_TIME_SAFETY_MESSAGE)
  }

  const rawStructure = parseDocxTimelineStructureFromLines(rawLines, timeMode, baselineSecondsOfDay)
  const structuralAnchors = parseDocxAnchorsFromStandaloneLines(
    structuralLines,
    baselineSecondsOfDay,
  )

  const mergedAnchors = uniqueLines([
    ...rawStructure.anchors.map(anchor => `${anchor.kind}|${anchor.agendaNo ?? ''}|${anchor.startSec}|${anchor.title ?? ''}`),
    ...structuralAnchors.map(anchor => `${anchor.kind}|${anchor.agendaNo ?? ''}|${anchor.startSec}|${anchor.title ?? ''}`),
  ]).map((key) => {
    const [kind, agendaNo, startSecValue, title] = key.split('|')
    return {
      kind: kind as TranscriptTimelineAnchorKind,
      agendaNo: agendaNo || null,
      title: title || null,
      startSec: Number(startSecValue),
      sourceText: title || agendaNo || key,
    } satisfies TranscriptTimelineAnchor
  })

  return {
    cues: rawStructure.cues,
    anchors: mergedAnchors.sort((left, right) => left.startSec - right.startSec),
    durationSec: Math.max(
      rawStructure.durationSec,
      structuralAnchors[structuralAnchors.length - 1]?.startSec ?? 0,
    ),
  }
}

export async function parseTranscriptTimelineStructureFromFile(
  file: File,
): Promise<TranscriptTimelineStructure> {
  const name = file.name.toLowerCase()
  const ext = name.split('.').pop() ?? ''

  let structure: TranscriptTimelineStructure
  if (ext === 'vtt') {
    structure = parseVttTimelineStructure(await file.text())
  } else if (ext === 'docx') {
    structure = await parseDocxTimelineStructure(await file.arrayBuffer())
  } else {
    throw new Error('Unsupported timeline source. Use .vtt or Teams .docx with timestamps.')
  }

  if (structure.cues.length === 0 && structure.anchors.length === 0) {
    throw new Error('No valid timestamps found. Please upload Microsoft Teams VTT or timestamped DOCX transcript.')
  }

  return structure
}

export async function parseTranscriptTimelineFromFile(file: File): Promise<TranscriptTimelineCue[]> {
  const structure = await parseTranscriptTimelineStructureFromFile(file)
  if (structure.cues.length === 0) {
    throw new Error('No valid transcript cues found. Please upload Microsoft Teams VTT or timestamped DOCX transcript.')
  }
  return structure.cues
}
