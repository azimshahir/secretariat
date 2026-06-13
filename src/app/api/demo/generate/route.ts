import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { transcribeMeetingMedia } from '@/lib/diarization'
import { generateDemoMinute, countWords, extractTemplateSample } from '@/lib/ai/demo-minute'

export const runtime = 'nodejs'
export const maxDuration = 120

// ── Quotas ────────────────────────────────────────────────────────────
const MONTHLY_SECONDS_LIMIT = 10 * 60 // 10 minutes of audio/video per month
const MONTHLY_WORDS_LIMIT = 2000 // 2,000 words of text per month
const PER_UPLOAD_SECONDS_CAP = 5 * 60 // 5 minutes per single upload
const PER_UPLOAD_WORDS_CAP = 2000
const MAX_MEDIA_BYTES = 12 * 1024 * 1024 // ~12MB hard cap (pre-processing cost guard)
const MAX_TEXT_BYTES = 2 * 1024 * 1024 // 2MB for .txt/.docx

function currentPeriod() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function limitResponse(message: string) {
  return NextResponse.json({ error: 'LimitReached', message }, { status: 429 })
}

export async function POST(req: Request) {
  try {
    const ip = (req.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim()
    const period = currentPeriod()

    const form = await req.formData()
    const file = form.get('file')
    const templateFile = form.get('template')
    const clientId = (form.get('clientId') as string | null)?.trim() || null
    const durationSeconds = Math.max(0, Math.round(Number(form.get('durationSeconds') ?? 0)))

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: 'BadRequest', message: 'No file uploaded.' },
        { status: 400 },
      )
    }

    const isMedia = file.type.startsWith('audio/') || file.type.startsWith('video/')
    const name = file.name.toLowerCase()
    const isDocx = name.endsWith('.docx')
    const isTxt = name.endsWith('.txt')

    if (!isMedia && !isDocx && !isTxt) {
      return NextResponse.json(
        { error: 'BadRequest', message: 'Unsupported file. Use audio/video, .docx or .txt.' },
        { status: 400 },
      )
    }

    // ── File-size hard cap (cost guard, before any processing) ──────────
    if (isMedia && file.size > MAX_MEDIA_BYTES) {
      return NextResponse.json(
        { error: 'FileTooLarge', message: 'Recording is too large for the free demo (max ~12MB / 5 minutes). Please sign up to process full meetings.' },
        { status: 413 },
      )
    }
    if (!isMedia && file.size > MAX_TEXT_BYTES) {
      return NextResponse.json(
        { error: 'FileTooLarge', message: 'Transcript file is too large for the free demo. Please sign up to process larger documents.' },
        { status: 413 },
      )
    }

    const supabase = createAdminClient()

    // ── Read current month usage for this IP OR client (take the max) ───
    const [{ data: ipRows }, { data: clientRows }] = await Promise.all([
      supabase.from('demo_usage_logs')
        .select('seconds_used, words_used')
        .eq('ip_address', ip).eq('period', period),
      clientId
        ? supabase.from('demo_usage_logs')
            .select('seconds_used, words_used')
            .eq('client_id', clientId).eq('period', period)
        : Promise.resolve({ data: [] as { seconds_used: number; words_used: number }[] }),
    ])

    const sum = (rows: { seconds_used: number; words_used: number }[] | null, key: 'seconds_used' | 'words_used') =>
      (rows ?? []).reduce((total, row) => total + (row[key] ?? 0), 0)

    const usedSeconds = Math.max(sum(ipRows, 'seconds_used'), sum(clientRows, 'seconds_used'))
    const usedWords = Math.max(sum(ipRows, 'words_used'), sum(clientRows, 'words_used'))

    // ── Process for real ────────────────────────────────────────────────
    let transcript = ''
    let secondsUsed = 0
    let wordsUsed = 0

    if (isMedia) {
      if (durationSeconds > PER_UPLOAD_SECONDS_CAP) {
        return limitResponse('Recording exceeds 5 minutes. Please sign up to process longer meetings.')
      }
      if (usedSeconds + durationSeconds > MONTHLY_SECONDS_LIMIT) {
        const remaining = Math.max(0, MONTHLY_SECONDS_LIMIT - usedSeconds)
        return limitResponse(`You have ${Math.floor(remaining / 60)}m ${remaining % 60}s of free demo left this month. Sign up to continue.`)
      }

      const media = await transcribeMeetingMedia(file, {
        sttModel: 'gpt-4o-mini-transcribe',
        useDiarizedStt: false,
      })
      transcript = media.content
      secondsUsed = durationSeconds
    } else {
      if (isDocx) {
        const mammoth = (await import('mammoth')).default
        const result = await mammoth.extractRawText({ buffer: Buffer.from(await file.arrayBuffer()) })
        transcript = result.value.trim()
      } else {
        transcript = (await file.text()).trim()
      }

      wordsUsed = countWords(transcript)
      if (wordsUsed > PER_UPLOAD_WORDS_CAP) {
        return limitResponse('Transcript exceeds the 2,000-word demo limit. Please sign up to process larger documents.')
      }
      if (usedWords + wordsUsed > MONTHLY_WORDS_LIMIT) {
        const remaining = Math.max(0, MONTHLY_WORDS_LIMIT - usedWords)
        return limitResponse(`You have ${remaining} free demo words left this month. Sign up to continue.`)
      }
    }

    if (!transcript) {
      return NextResponse.json(
        { error: 'EmptyTranscript', message: 'Could not read any content from the file.' },
        { status: 422 },
      )
    }

    // Optional: use an attached previous-format template to guide the output structure.
    let templateSample: string | null = null
    if (templateFile instanceof File && templateFile.size > 0 && templateFile.size <= MAX_TEXT_BYTES) {
      try {
        templateSample = await extractTemplateSample(templateFile)
      } catch {
        templateSample = null // ignore unreadable template, fall back to default format
      }
    }

    const minute = await generateDemoMinute(transcript, templateSample)

    // ── Record usage (append-only) ──────────────────────────────────────
    await supabase.from('demo_usage_logs').insert([{
      ip_address: ip,
      client_id: clientId,
      period,
      seconds_used: secondsUsed,
      words_used: wordsUsed,
    }])

    return NextResponse.json({
      success: true,
      data: {
        title: minute.title,
        date: new Date().toISOString(),
        summary: minute.summary,
        sections: minute.sections,
        actionItems: minute.actionItems,
      },
    })
  } catch (error: unknown) {
    const code = (error as { code?: string })?.code
    if (code === '42P01') {
      return NextResponse.json({
        error: 'DatabaseSetupRequired',
        message: "Supabase table 'demo_usage_logs' does not exist. Run the latest migration to enable the demo.",
      }, { status: 500 })
    }
    console.error('[api/demo/generate] failed', error)
    return NextResponse.json(
      { error: 'InternalError', message: 'Failed to generate minutes. Please try again.' },
      { status: 500 },
    )
  }
}
