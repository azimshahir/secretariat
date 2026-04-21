import { z } from 'zod'
import { minuteMindEntrySchema } from '@/lib/validation'

export const GO_DEEPER_AGENT_ACTIONS_START = '[[[SECRETARIAT_AGENT_ACTIONS]]]'
export const GO_DEEPER_AGENT_ACTIONS_END = '[[[/SECRETARIAT_AGENT_ACTIONS]]]'

export const goDeeperAgentIntentSchema = z.enum([
  'apply_only',
  'save_only',
  'both',
  'none',
])

export const goDeeperAgentApplyScopeSchema = z.enum([
  'selection',
  'minute',
  'none',
])

export const goDeeperAgentMindDraftSchema = minuteMindEntrySchema
export const goDeeperAgentResolvedOutcomeModeSchema = z.enum(['closed', 'follow_up'])
export const goDeeperAgentResolvedOutcomeChangeSchema = z.object({
  nextMode: goDeeperAgentResolvedOutcomeModeSchema,
  reason: z.string().optional().default(''),
})

export const goDeeperAgentActionMetadataSchema = z.object({
  intent: goDeeperAgentIntentSchema,
  applyScope: goDeeperAgentApplyScopeSchema,
  minuteProposalText: z.string().optional().default(''),
  sourceExcerpt: z.string().optional(),
  mindDraft: goDeeperAgentMindDraftSchema.nullable().optional(),
  resolvedOutcomeChange: goDeeperAgentResolvedOutcomeChangeSchema.nullable().optional(),
}).superRefine((value, ctx) => {
  const needsApply = value.intent === 'apply_only' || value.intent === 'both'
  const needsSave = value.intent === 'save_only' || value.intent === 'both'

  if (needsApply) {
    if (value.applyScope === 'none') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'applyScope is required when apply intent is present',
        path: ['applyScope'],
      })
    }

    if (!value.minuteProposalText.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'minuteProposalText is required when apply intent is present',
        path: ['minuteProposalText'],
      })
    }
  }

  if (!needsApply && value.applyScope !== 'none') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'applyScope must be none when apply intent is absent',
      path: ['applyScope'],
    })
  }

  if (!needsApply && value.minuteProposalText.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'minuteProposalText must be empty when apply intent is absent',
      path: ['minuteProposalText'],
    })
  }

  if (needsSave && !value.mindDraft) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'mindDraft is required when save intent is present',
      path: ['mindDraft'],
    })
  }

  if (!needsSave && value.mindDraft) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'mindDraft must be null when save intent is absent',
      path: ['mindDraft'],
    })
  }

  if (value.applyScope === 'selection' && !value.sourceExcerpt?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'sourceExcerpt is required for selection apply scope',
      path: ['sourceExcerpt'],
    })
  }
})

export type GoDeeperAgentIntent = z.infer<typeof goDeeperAgentIntentSchema>
export type GoDeeperAgentApplyScope = z.infer<typeof goDeeperAgentApplyScopeSchema>
export type GoDeeperAgentMindDraft = z.infer<typeof goDeeperAgentMindDraftSchema>
export type GoDeeperAgentActionMetadata = z.infer<typeof goDeeperAgentActionMetadataSchema>

function findTrailingPartialMarkerStart(text: string, marker: string) {
  const maxLength = Math.min(marker.length - 1, text.length)

  for (let length = maxLength; length > 0; length -= 1) {
    if (text.endsWith(marker.slice(0, length))) {
      return text.length - length
    }
  }

  return -1
}

function normalizeAgentMetadataPayload(rawMetadata: string) {
  let normalized = rawMetadata.trim()

  if (normalized.startsWith('```')) {
    normalized = normalized
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim()
  }

  if (/^json\s*$/i.test(normalized.split('\n')[0] ?? '')) {
    normalized = normalized.split('\n').slice(1).join('\n').trim()
  }

  const firstBrace = normalized.indexOf('{')
  const lastBrace = normalized.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    normalized = normalized.slice(firstBrace, lastBrace + 1).trim()
  }

  return normalized
}

function parseAgentMetadata(rawMetadata: string) {
  const normalized = normalizeAgentMetadataPayload(rawMetadata)
  if (!normalized) return null

  try {
    return JSON.parse(normalized)
  } catch {
    return null
  }
}

export function splitGoDeeperAgentResponse(text: string) {
  const startIndex = text.indexOf(GO_DEEPER_AGENT_ACTIONS_START)

  if (startIndex >= 0) {
    const visibleText = text.slice(0, startIndex).trimEnd()
    const afterStart = text.slice(startIndex + GO_DEEPER_AGENT_ACTIONS_START.length)
    const endIndex = afterStart.indexOf(GO_DEEPER_AGENT_ACTIONS_END)

    if (endIndex < 0) {
      const parsedMetadata = parseAgentMetadata(afterStart)
      const parsed = goDeeperAgentActionMetadataSchema.safeParse(parsedMetadata)

      return {
        visibleText,
        metadata: parsed.success ? parsed.data : null,
        hasOpenMetadata: !parsed.success,
      }
    }

    const rawMetadata = afterStart.slice(0, endIndex).trim()
    const parsedMetadata = parseAgentMetadata(rawMetadata)
    const parsed = goDeeperAgentActionMetadataSchema.safeParse(parsedMetadata)

    return {
      visibleText,
      metadata: parsed.success ? parsed.data : null,
      hasOpenMetadata: false,
    }
  }

  const partialStartIndex = findTrailingPartialMarkerStart(text, GO_DEEPER_AGENT_ACTIONS_START)
  if (partialStartIndex >= 0) {
    return {
      visibleText: text.slice(0, partialStartIndex).trimEnd(),
      metadata: null as GoDeeperAgentActionMetadata | null,
      hasOpenMetadata: true,
    }
  }

  return {
    visibleText: text,
    metadata: null as GoDeeperAgentActionMetadata | null,
    hasOpenMetadata: false,
  }
}
