import { randomUUID } from 'crypto'
import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'

interface WhisperWord {
  word: string
  start: number
  end: number
}

interface WhisperResult {
  text: string
  words: WhisperWord[]
}

interface SpeakerTurn {
  speaker: string
  start: number
  end: number
}

function inferSpeaker(word: WhisperWord, diarization: SpeakerTurn[]) {
  const midpoint = (word.start + word.end) / 2
  const turn = diarization.find(item => midpoint >= item.start && midpoint <= item.end)
  return turn?.speaker ?? null
}

function buildSpeakerTranscript(words: WhisperWord[], diarization: SpeakerTurn[]) {
  if (words.length === 0) return null
  const lines: { speaker: string; text: string }[] = []
  const fallback = ['Speaker A', 'Speaker B', 'Speaker C', 'Speaker D', 'Speaker E']
  const seen = new Map<string, string>()
  let currentSpeaker = inferSpeaker(words[0], diarization) ?? 'Speaker A'
  let currentText = ''

  const normalizeSpeaker = (raw: string) => {
    if (!seen.has(raw)) seen.set(raw, fallback[seen.size] ?? `Speaker ${seen.size + 1}`)
    return seen.get(raw) as string
  }

  for (const word of words) {
    const detected = inferSpeaker(word, diarization)
    const speaker = normalizeSpeaker(detected ?? currentSpeaker)
    const previous = normalizeSpeaker(currentSpeaker)
    if (speaker !== previous && currentText.trim()) {
      lines.push({ speaker: previous, text: currentText.trim() })
      currentText = ''
    }
    currentSpeaker = detected ?? currentSpeaker
    currentText += word.word
    if (!/\s$/.test(currentText)) currentText += ' '
  }

  if (currentText.trim()) {
    lines.push({ speaker: normalizeSpeaker(currentSpeaker), text: currentText.trim() })
  }

  return lines.map(line => `${line.speaker}: ${line.text}`).join('\n')
}

async function transcribeWithWhisper(file: File): Promise<WhisperResult> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for audio/video transcription')

  const body = new FormData()
  body.append('file', file)
  body.append('model', 'whisper-1')
  body.append('response_format', 'verbose_json')
  body.append('timestamp_granularities[]', 'word')
  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body,
  })
  if (!response.ok) throw new Error(`Whisper transcription failed: ${await response.text()}`)

  const data = await response.json() as { text?: string; words?: WhisperWord[] }
  const text = data.text?.trim() ?? ''
  if (!text) throw new Error('Whisper returned empty transcript')
  const words = (data.words ?? [])
    .filter(w => Number.isFinite(w.start) && Number.isFinite(w.end) && typeof w.word === 'string')
    .map(w => ({ word: w.word, start: w.start, end: w.end }))
  return { text, words }
}

async function runDiarizationScript(tempPath: string): Promise<SpeakerTurn[]> {
  const token = process.env.HUGGINGFACE_TOKEN || process.env.HF_TOKEN || ''
  if (!token) return []

  const scriptPath = path.join(process.cwd(), 'scripts', 'diarize_audio.py')
  const model = process.env.DIARIZATION_MODEL || 'pyannote/speaker-diarization-3.1'
  const stdout = await new Promise<string>((resolve, reject) => {
    const args = [scriptPath, '--input', tempPath, '--token', token, '--model', model]
    const child = spawn('python', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.on('data', chunk => { out += String(chunk) })
    child.stderr.on('data', chunk => { err += String(chunk) })
    child.on('error', reject)
    child.on('close', code => (code === 0 ? resolve(out) : reject(new Error(err || `Diarization failed (${code})`))))
  })

  return (JSON.parse(stdout) as { speaker: string; start: number; end: number }[])
    .filter(row => Number.isFinite(row.start) && Number.isFinite(row.end) && row.end > row.start)
}

export async function transcribeWithDiarization(file: File) {
  const whisper = await transcribeWithWhisper(file)
  const ext = file.name.split('.').pop() || (file.type.startsWith('audio/') ? 'wav' : 'mp4')
  const tempPath = path.join(os.tmpdir(), `secretariat-${randomUUID()}.${ext}`)
  try {
    await fs.writeFile(tempPath, Buffer.from(await file.arrayBuffer()))
    const turns = await runDiarizationScript(tempPath).catch(() => [])
    return {
      content: buildSpeakerTranscript(whisper.words, turns) ?? whisper.text,
      diarizationApplied: turns.length > 0,
    }
  } finally {
    await fs.unlink(tempPath).catch(() => undefined)
  }
}
