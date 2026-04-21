function stripVtt(vtt: string) {
  return vtt
    .replace(/^WEBVTT.*$/gim, '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !/^\d+$/.test(line) && !/^\d{2}:\d{2}:\d{2}\.\d{3}\s-->\s\d{2}:\d{2}:\d{2}\.\d{3}/.test(line))
    .join('\n')
}

function buildSpeakerMap(transcript: string) {
  const matches = transcript.match(/^(Speaker\s*[A-Z0-9]+|[\w'. -]{2,40}):/gim) ?? []
  const unique = [...new Set(matches.map(item => item.replace(':', '').trim()))]
  return Object.fromEntries(unique.map(key => [key, key]))
}

export interface MediaTranscriptProcessingOptions {
  sttModel: string
  lexiconPrompt?: string
  useDiarizedStt?: boolean
}

export async function extractTranscript(
  file: File,
  options?: { media?: MediaTranscriptProcessingOptions },
) {
  const name = file.name.toLowerCase()
  const ext = name.split('.').pop() ?? ''
  let content = ''
  let rawContent: string | null = null
  let diarizationApplied = false
  let processingMetadata: Record<string, unknown> = {}

  if (ext === 'docx') {
    const mammoth = (await import('mammoth')).default
    const result = await mammoth.extractRawText({ buffer: Buffer.from(await file.arrayBuffer()) })
    content = result.value.trim()
  } else if (ext === 'vtt') {
    content = stripVtt(await file.text())
  } else if (ext === 'txt') {
    content = (await file.text()).trim()
  } else if (file.type.startsWith('audio/') || file.type.startsWith('video/')) {
    const mediaOptions = options?.media
    if (!mediaOptions) {
      throw new Error('Media transcript options are required for audio/video transcription')
    }
    const { transcribeMeetingMedia } = await import('@/lib/diarization')
    const media = await transcribeMeetingMedia(file, mediaOptions)
    content = media.content
    rawContent = media.rawContent
    diarizationApplied = media.diarizationApplied
    processingMetadata = {
      sttModel: media.sttModel,
      diarizationApplied: media.diarizationApplied,
    }
  } else {
    throw new Error('Unsupported transcript file. Use .docx/.vtt/.txt/audio/video')
  }

  if (!content) throw new Error('Transcript content is empty')
  return {
    content,
    rawContent,
    speakerMap: buildSpeakerMap(content),
    sourceExt: ext || file.type,
    diarizationApplied,
    processingMetadata,
  }
}

export async function extractSlideText(file: File) {
  const { PDFParse } = await import('pdf-parse')
  const parser = new PDFParse({ data: Buffer.from(await file.arrayBuffer()) })
  try {
    const text = await parser.getText()
    return text.pages.map(page => `Page ${page.num}\n${page.text.trim()}`).join('\n\n').trim()
  } finally {
    await parser.destroy()
  }
}
