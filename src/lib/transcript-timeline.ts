import mammoth from 'mammoth'

export interface TranscriptTimelineCue {
  startSec: number
  endSec: number
  speaker: string | null
  text: string
  sortOrder: number
}

function sanitizeText(value: string) {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseTimeToken(token: string): number | null {
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

const VTT_RANGE_REGEX =
  /(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?)\s*-->\s*(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?)/i

function parseVttTimeline(content: string): TranscriptTimelineCue[] {
  const lines = content.replace(/\r/g, '').split('\n')
  const cues: TranscriptTimelineCue[] = []

  let index = 0
  while (index < lines.length) {
    const line = lines[index]?.trim() ?? ''
    const rangeMatch = line.match(VTT_RANGE_REGEX)
    if (!rangeMatch) {
      index += 1
      continue
    }

    const startSec = parseTimeToken(rangeMatch[1] ?? '')
    const endSec = parseTimeToken(rangeMatch[2] ?? '')
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

    cues.push({
      startSec,
      endSec,
      speaker,
      text,
      sortOrder: cues.length,
    })
    index += 1
  }

  return cues
}

const DOCX_RANGE_REGEX =
  /(\d{1,2}:\d{2}(?::\d{2})?)\s*(?:-|–|—|->|-->|to)\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*(.*)$/i
const DOCX_START_REGEX =
  /^(\d{1,2}:\d{2}(?::\d{2})?)\s*(?:-|–|—)?\s*(.*)$/i

function parseDocxTimeline(raw: string): TranscriptTimelineCue[] {
  const lines = raw
    .replace(/\r/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)

  const entries: Array<{ startSec: number; endSec: number | null; speaker: string | null; text: string }> = []

  for (const line of lines) {
    const rangeMatch = line.match(DOCX_RANGE_REGEX)
    if (rangeMatch) {
      const startSec = parseTimeToken(rangeMatch[1] ?? '')
      const endSec = parseTimeToken(rangeMatch[2] ?? '')
      const rest = (rangeMatch[3] ?? '').trim()
      if (startSec === null || endSec === null || endSec <= startSec) continue

      const speakerMatch = rest.match(/^([^:]{2,60}):\s*([\s\S]*)$/)
      entries.push({
        startSec,
        endSec,
        speaker: speakerMatch?.[1]?.trim() || null,
        text: sanitizeText(speakerMatch?.[2] ?? rest),
      })
      continue
    }

    const startMatch = line.match(DOCX_START_REGEX)
    if (!startMatch) continue
    const startSec = parseTimeToken(startMatch[1] ?? '')
    const rest = (startMatch[2] ?? '').trim()
    if (startSec === null || !rest) continue

    const speakerMatch = rest.match(/^([^:]{2,60}):\s*([\s\S]*)$/)
    entries.push({
      startSec,
      endSec: null,
      speaker: speakerMatch?.[1]?.trim() || null,
      text: sanitizeText(speakerMatch?.[2] ?? rest),
    })
  }

  if (entries.length === 0) return []

  const resolved = entries
    .sort((a, b) => a.startSec - b.startSec)
    .map((entry, index, all) => {
      const nextStart = all[index + 1]?.startSec ?? null
      const endSec = entry.endSec ?? (nextStart !== null && nextStart > entry.startSec ? nextStart : entry.startSec + 30)
      return {
        startSec: entry.startSec,
        endSec,
        speaker: entry.speaker,
        text: entry.text,
        sortOrder: index,
      }
    })
    .filter(cue => cue.endSec > cue.startSec && Boolean(cue.text))

  return resolved
}

export function formatSecondsToTimecode(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const seconds = safe % 60
  return [hours, minutes, seconds].map(value => String(value).padStart(2, '0')).join(':')
}

export function parseTimecodeToSeconds(value: string): number | null {
  const match = value.trim().match(/^(\d{1,2}):([0-5]\d):([0-5]\d)$/)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  const seconds = Number(match[3])
  return hours * 3600 + minutes * 60 + seconds
}

export async function parseTranscriptTimelineFromFile(file: File): Promise<TranscriptTimelineCue[]> {
  const name = file.name.toLowerCase()
  const ext = name.split('.').pop() ?? ''

  let cues: TranscriptTimelineCue[] = []
  if (ext === 'vtt') {
    cues = parseVttTimeline(await file.text())
  } else if (ext === 'docx') {
    const result = await mammoth.extractRawText({ buffer: Buffer.from(await file.arrayBuffer()) })
    cues = parseDocxTimeline(result.value)
  } else {
    throw new Error('Unsupported timeline source. Use .vtt or Teams .docx with timestamps.')
  }

  if (cues.length === 0) {
    throw new Error('No valid timestamps found. Please upload Microsoft Teams VTT or timestamped DOCX transcript.')
  }

  return cues
}
