function normalizeTranscriptWhitespace(value: string) {
  return value
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const TRANSCRIPT_TIMESTAMP_PREFIX_PATTERN = /^\[\d{2}:\d{2}:\d{2}\]\s+/
const TRANSCRIPT_SPEAKER_PREFIX_PATTERN = /^(?:\[\d{2}:\d{2}:\d{2}\]\s+)?[^:\n]{2,80}:\s+\S/

function compactTranscriptLineContent(value: string | null | undefined) {
  return (value ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .join(' ')
    .trim()
}

function isSeparatorLine(value: string) {
  return /^[-*_]{3,}$/.test(value.trim())
}

function isTranscriptPreambleLine(value: string) {
  const line = value.trim()
  if (!line) return false

  return [
    /^(?:sure|certainly|absolutely|of course)[,!.]?\s+(?:here(?:'s| is)|below is)\b.*\b(?:cleaned|refined)\b.*\btranscript\b/i,
    /^(?:here(?:'s| is)|below is)\b.*\b(?:cleaned|refined)\b.*\btranscript\b/i,
    /^(?:based on|using)\s+your provided context[:.]?$/i,
    /^(?:cleaned|refined)\s+transcript[:.]?$/i,
    /^ai-cleaned transcript[:.]?$/i,
  ].some(pattern => pattern.test(line))
}

function stripLeadingTranscriptPreamble(lines: string[]) {
  let index = 0

  while (index < lines.length) {
    const line = lines[index]?.trim() ?? ''
    if (!line || isSeparatorLine(line) || isTranscriptPreambleLine(line)) {
      index += 1
      continue
    }
    break
  }

  return lines.slice(index)
}

export function sanitizeTranscriptOutput(value: string | null | undefined) {
  if (!value) return ''

  const withoutVerifyMarkers = value.replace(/\[\[VERIFY:\s*([\s\S]*?)\]\]/gi, '$1')
  const withoutMarkdownBold = withoutVerifyMarkers
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')

  const lines = stripLeadingTranscriptPreamble(
    withoutMarkdownBold
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map(line => line.replace(/[ \t]+$/g, '')),
  ).filter((line, index, source) => {
    const trimmed = line.trim()
    if (!isSeparatorLine(trimmed)) return true
    return index !== 0 && index !== source.length - 1
  })

  return normalizeTranscriptWhitespace(lines.join('\n'))
}

export function formatTranscriptStartTimestamp(seconds: number | null | undefined) {
  if (seconds == null) return ''

  const safe = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const remainingSeconds = safe % 60

  return [hours, minutes, remainingSeconds]
    .map(value => String(value).padStart(2, '0'))
    .join(':')
}

export function buildStructuredTranscriptLine(params: {
  content: string | null | undefined
  speaker?: string | null
  startOffset?: number | null
}) {
  const content = compactTranscriptLineContent(params.content)
  if (!content) return ''

  const timestamp = formatTranscriptStartTimestamp(params.startOffset)
  const speaker = params.speaker?.trim() ?? ''

  if (timestamp && speaker) {
    return `[${timestamp}] ${speaker}: ${content}`
  }
  if (timestamp) {
    return `[${timestamp}] ${content}`
  }
  if (speaker) {
    return `${speaker}: ${content}`
  }
  return content
}

function analyzeTranscriptShape(value: string) {
  const lines = sanitizeTranscriptOutput(value)
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)

  const timestampLines = lines.filter(line => TRANSCRIPT_TIMESTAMP_PREFIX_PATTERN.test(line)).length
  const speakerLines = lines.filter(line => TRANSCRIPT_SPEAKER_PREFIX_PATTERN.test(line)).length
  const markerLines = lines.filter(line => (
    TRANSCRIPT_TIMESTAMP_PREFIX_PATTERN.test(line)
    || TRANSCRIPT_SPEAKER_PREFIX_PATTERN.test(line)
  )).length
  const paragraphLikeLines = lines.filter(line => (
    line.length >= 180
    && !TRANSCRIPT_SPEAKER_PREFIX_PATTERN.test(line)
    && !TRANSCRIPT_TIMESTAMP_PREFIX_PATTERN.test(line)
  )).length

  return {
    nonEmptyLines: lines.length,
    timestampLines,
    speakerLines,
    markerLines,
    paragraphLikeLines,
  }
}

export function validateStructuredTranscriptShape(params: {
  sourceTranscript: string
  candidateTranscript: string
}) {
  const source = analyzeTranscriptShape(params.sourceTranscript)
  if (source.nonEmptyLines === 0) {
    return { isValid: true as const, reason: null }
  }

  const shouldEnforceLineShape = source.nonEmptyLines >= 2
    && source.markerLines >= Math.max(2, Math.ceil(source.nonEmptyLines * 0.5))
  if (!shouldEnforceLineShape) {
    return { isValid: true as const, reason: null }
  }

  const candidate = analyzeTranscriptShape(params.candidateTranscript)
  const minimumLineCount = Math.max(2, Math.ceil(source.nonEmptyLines * 0.5))
  if (candidate.nonEmptyLines < minimumLineCount) {
    return {
      isValid: false as const,
      reason: `output collapsed from ${source.nonEmptyLines} lines to ${candidate.nonEmptyLines}`,
    }
  }

  const minimumMarkerCount = Math.max(2, Math.ceil(source.markerLines * 0.5))
  if (candidate.markerLines < minimumMarkerCount) {
    return {
      isValid: false as const,
      reason: `output kept only ${candidate.markerLines} structured lines from ${source.markerLines}`,
    }
  }

  if (candidate.markerLines < Math.max(2, Math.ceil(candidate.nonEmptyLines * 0.5))) {
    return {
      isValid: false as const,
      reason: 'output no longer looks like a line-based transcript',
    }
  }

  if (source.timestampLines > 0) {
    const minimumTimestampCount = Math.max(1, Math.ceil(source.timestampLines * 0.5))
    if (candidate.timestampLines < minimumTimestampCount) {
      return {
        isValid: false as const,
        reason: `output dropped timestamps from ${source.timestampLines} lines to ${candidate.timestampLines}`,
      }
    }
  }

  if (candidate.paragraphLikeLines > 0 && candidate.speakerLines < candidate.nonEmptyLines) {
    return {
      isValid: false as const,
      reason: 'output introduced paragraph-style transcript blocks',
    }
  }

  return { isValid: true as const, reason: null }
}
