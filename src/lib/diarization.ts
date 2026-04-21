interface DiarizedSegment {
  speaker?: string | null
  text?: string | null
  start?: number | null
  end?: number | null
}

interface DiarizedJsonResponse {
  text?: string
  segments?: DiarizedSegment[]
  utterances?: DiarizedSegment[]
}

interface JsonTranscriptResponse {
  text?: string
}

export interface MediaTranscriptionOptions {
  sttModel: string
  lexiconPrompt?: string
  useDiarizedStt?: boolean
}

export interface MediaTranscriptionResult {
  content: string
  rawContent: string
  diarizationApplied: boolean
  sttModel: string
}

function normalizeWhitespace(value: string) {
  return value
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function buildSpeakerTranscript(segments: DiarizedSegment[]) {
  const lines = segments
    .map(segment => {
      const text = typeof segment.text === 'string' ? normalizeWhitespace(segment.text) : ''
      if (!text) return null
      const speaker = typeof segment.speaker === 'string' && segment.speaker.trim()
        ? segment.speaker.trim()
        : null
      return speaker ? `${speaker}: ${text}` : text
    })
    .filter((line): line is string => Boolean(line))

  return lines.length > 0 ? lines.join('\n') : null
}

async function requestOpenAiTranscription(
  file: File,
  options: MediaTranscriptionOptions,
) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for audio/video transcription')

  const body = new FormData()
  body.append('file', file)
  body.append('model', options.sttModel)

  if (options.useDiarizedStt) {
    body.append('response_format', 'diarized_json')
  } else {
    body.append('response_format', 'json')
    if (options.lexiconPrompt?.trim()) {
      body.append('prompt', options.lexiconPrompt.trim())
    }
  }

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body,
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`OpenAI transcription failed: ${detail || response.statusText}`)
  }

  return response.json()
}

export async function transcribeMeetingMedia(
  file: File,
  options: MediaTranscriptionOptions,
): Promise<MediaTranscriptionResult> {
  if (options.useDiarizedStt) {
    const data = await requestOpenAiTranscription(file, options) as DiarizedJsonResponse
    const diarizedSegments = [...(data.segments ?? []), ...(data.utterances ?? [])]
      .filter(segment => typeof segment.text === 'string' && segment.text.trim())

    const diarizedTranscript = buildSpeakerTranscript(diarizedSegments)
    const rawTranscript = normalizeWhitespace(diarizedTranscript ?? data.text ?? '')

    if (!rawTranscript) {
      throw new Error('OpenAI diarized transcription returned empty transcript')
    }

    return {
      content: rawTranscript,
      rawContent: rawTranscript,
      diarizationApplied: diarizedSegments.length > 0,
      sttModel: options.sttModel,
    }
  }

  const data = await requestOpenAiTranscription(file, options) as JsonTranscriptResponse
  const rawTranscript = normalizeWhitespace(data.text ?? '')

  if (!rawTranscript) {
    throw new Error('OpenAI transcription returned empty transcript')
  }

  return {
    content: rawTranscript,
    rawContent: rawTranscript,
    diarizationApplied: false,
    sttModel: options.sttModel,
  }
}
