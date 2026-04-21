import { generateText } from 'ai'
import {
  buildGroundedTranscriptRefinementPrompt,
  buildMeetingTranscriptCleanupPrompt,
  buildNumericTranscriptReviewPrompt,
} from '@/lib/ai/prompts'
import { resolveModelById } from '@/lib/ai/model-config'
import type { TranscriptIntelligenceConfig } from '@/lib/ai/transcript-intelligence'
import { sanitizeTranscriptOutput } from './transcript-output'

interface AgendaLexiconItem {
  agendaNo: string
  title: string
  presenter?: string | null
}

interface GlossaryItem {
  acronym: string
  fullMeaning: string
}

interface ReferenceExcerpt {
  source: string
  text: string
}

function normalizeWhitespace(value: string) {
  return value
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function hasLikelyNumericReviewSignal(value: string) {
  const normalized = value.toLowerCase()
  if (!/\d/.test(normalized)) return false
  if (normalized.includes('[[verify:')) return true
  return /\b(?:percent|percentage|bps|basis points|rm|usd|million|billion|ratio)\b/.test(normalized)
}

export async function cleanTranscriptForMeetingContext(params: {
  config: TranscriptIntelligenceConfig
  rawTranscript: string
  meetingTitle: string
  committeeName: string | null
  agendaList: AgendaLexiconItem[]
  glossary: GlossaryItem[]
  speakerNames: string[]
}) {
  const prompt = buildMeetingTranscriptCleanupPrompt({
    meetingTitle: params.meetingTitle,
    committeeName: params.committeeName,
    rawTranscript: params.rawTranscript,
    agendaList: params.agendaList,
    glossary: params.glossary,
    speakerNames: params.speakerNames,
  })

  const result = await generateText({
    model: resolveModelById(params.config.cleanupModel),
    prompt,
  })

  return sanitizeTranscriptOutput(normalizeWhitespace(result.text))
}

export async function refineTranscriptForAgendaContext(params: {
  config: TranscriptIntelligenceConfig
  agendaNo: string
  agendaTitle: string
  presenter: string | null
  cleanedTranscript: string
  referenceGuidance?: string
  referenceExcerpts: ReferenceExcerpt[]
}) {
  if (params.referenceExcerpts.length === 0) {
    return sanitizeTranscriptOutput(normalizeWhitespace(params.cleanedTranscript))
  }

  const refinementPrompt = buildGroundedTranscriptRefinementPrompt({
    agendaNo: params.agendaNo,
    agendaTitle: params.agendaTitle,
    presenter: params.presenter,
    cleanedTranscript: params.cleanedTranscript,
    referenceGuidance: params.referenceGuidance,
    referenceExcerpts: params.referenceExcerpts,
  })

  const refined = await generateText({
    model: resolveModelById(params.config.refinementModel),
    prompt: refinementPrompt,
  })

  let transcript = normalizeWhitespace(refined.text)

  if (
    params.config.numericVerifierModel
    && hasLikelyNumericReviewSignal(transcript)
  ) {
    const numericReviewPrompt = buildNumericTranscriptReviewPrompt({
      agendaNo: params.agendaNo,
      agendaTitle: params.agendaTitle,
      transcript,
      referenceExcerpts: params.referenceExcerpts,
    })

    const reviewed = await generateText({
      model: resolveModelById(params.config.numericVerifierModel),
      prompt: numericReviewPrompt,
    })
    transcript = normalizeWhitespace(reviewed.text)
  }

  return sanitizeTranscriptOutput(transcript)
}
