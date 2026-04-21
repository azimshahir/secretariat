import { createHash } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'

const TRUNCATION_NOTICE = '\n\n[Context truncated for speed]\n\n'

export function trimContextBlock(text: string, maxChars: number) {
  const normalized = text.trim()
  if (!normalized || normalized.length <= maxChars) {
    return normalized
  }

  const separatorBudget = TRUNCATION_NOTICE.length
  const headLength = Math.max(0, Math.floor((maxChars - separatorBudget) * 0.55))
  const tailLength = Math.max(0, maxChars - separatorBudget - headLength)

  if (headLength <= 0 || tailLength <= 0) {
    return `${normalized.slice(0, Math.max(0, maxChars - separatorBudget)).trimEnd()}${TRUNCATION_NOTICE.trim()}`
  }

  return [
    normalized.slice(0, headLength).trimEnd(),
    TRUNCATION_NOTICE.trim(),
    normalized.slice(-tailLength).trimStart(),
  ].join('\n\n')
}

function buildSlideCachePath(meetingId: string, slidePath: string) {
  const digest = createHash('sha1').update(slidePath).digest('hex')
  return `${meetingId}/processed/go-deeper-slide-${digest}.txt`
}

function buildParsedSlideText(parsed: {
  text?: string | null
  pages?: Array<{ num: number; text: string }>
}) {
  const directText = parsed.text?.trim()
  if (directText) return directText

  const pages = parsed.pages ?? []
  return pages
    .map(page => `Page ${page.num}\n${page.text.trim()}`)
    .join('\n\n')
    .trim()
}

export async function getCachedAgendaSlideText(params: {
  meetingId: string
  slidePath: string
  onTiming?: (name: string, durationMs: number) => void
}) {
  const admin = createAdminClient()
  const cachePath = buildSlideCachePath(params.meetingId, params.slidePath)

  try {
    const cacheLookupStartedAt = Date.now()
    const { data: cachedFile, error: cacheReadError } = await admin.storage
      .from('meeting-files')
      .download(cachePath)
    params.onTiming?.('slide_cache_lookup_ms', Date.now() - cacheLookupStartedAt)

    if (!cacheReadError && cachedFile) {
      const cachedText = (await cachedFile.text()).trim()
      if (cachedText) {
        return {
          text: cachedText,
          source: 'cache' as const,
        }
      }
    }
  } catch {
    // Ignore cache lookup failures and fall back to parsing the original PDF.
  }

  try {
    const slideDownloadStartedAt = Date.now()
    const { data: slideFile, error: slideDownloadError } = await admin.storage
      .from('meeting-files')
      .download(params.slidePath)
    params.onTiming?.('slide_pdf_download_ms', Date.now() - slideDownloadStartedAt)

    if (slideDownloadError || !slideFile) {
      return {
        text: '',
        source: 'missing' as const,
      }
    }

    const slideParseStartedAt = Date.now()
    const slideBuffer = Buffer.from(await slideFile.arrayBuffer())
    const { PDFParse } = await import('pdf-parse')
    const parser = new PDFParse({ data: slideBuffer })

    let parsedText = ''
    try {
      const parsed = await parser.getText()
      parsedText = buildParsedSlideText(parsed)
    } finally {
      await parser.destroy()
    }
    params.onTiming?.('slide_pdf_parse_ms', Date.now() - slideParseStartedAt)

    if (!parsedText) {
      return {
        text: '',
        source: 'parsed' as const,
      }
    }

    try {
      const cacheWriteStartedAt = Date.now()
      const { error: cacheWriteError } = await admin.storage
        .from('meeting-files')
        .upload(cachePath, Buffer.from(parsedText, 'utf8'), {
          upsert: true,
          contentType: 'text/plain; charset=utf-8',
        })
      params.onTiming?.('slide_cache_write_ms', Date.now() - cacheWriteStartedAt)

      if (cacheWriteError) {
        console.warn('[go-deeper-chat] failed to persist slide cache', {
          slidePath: params.slidePath,
          cachePath,
          message: cacheWriteError.message,
        })
      }
    } catch (cacheWriteError) {
      console.warn('[go-deeper-chat] failed to write slide cache', {
        slidePath: params.slidePath,
        cachePath,
        message: cacheWriteError instanceof Error ? cacheWriteError.message : 'Unknown cache write error',
      })
    }

    return {
      text: parsedText,
      source: 'parsed' as const,
    }
  } catch (error) {
    console.warn('[go-deeper-chat] slide extraction failed', {
      slidePath: params.slidePath,
      message: error instanceof Error ? error.message : 'Unknown slide extraction error',
    })
    return {
      text: '',
      source: 'failed' as const,
    }
  }
}
