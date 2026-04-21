import { z } from 'zod'

export const uuidSchema = z.string().uuid('Invalid identifier')

export const loginSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
})

export const signupSchema = loginSchema.extend({
  fullName: z.string().min(2, 'Full name is required').max(120),
})

export const createMeetingSchema = z.object({
  title: z.string().min(3).max(180),
  meetingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  committeeId: z.string().uuid('A secretariat is required before creating a meeting'),
})

export const meetingStatusSchema = z.enum([
  'draft',
  'pending_setup',
  'mapping',
  'generating',
  'in_progress',
  'finalized',
])

export const committeeSchema = z.object({
  name: z.string().min(2).max(120),
  slug: z.string().min(2).max(64).regex(/^[a-z0-9-]+$/),
  personaPrompt: z.string().min(20).max(6000).nullable().optional(),
})

export const formatTemplateSchema = z.object({
  committeeId: uuidSchema,
  name: z.string().min(2).max(120),
  promptText: z.string().min(20),
})

export const formatPromptTextSchema = z.string().min(1).max(200_000)
export const formatAdditionalInfoSchema = z.string().max(50_000).optional().default('')
export const minutePlaybookVariantKeySchema = z.enum(['default', 'with_action', 'without_action'])
export const minutePlaybookModeSchema = z.enum(['resolution_paths', 'legacy_full'])
export const minuteMindScopeTypeSchema = z.enum(['agenda', 'meeting', 'committee'])
export const minuteMindEntryTypeSchema = z.enum([
  'formatting_rule',
  'writing_preference',
  'committee_fact',
  'exception',
])

export const saveAgendaFormattingSchema = z.object({
  agendaId: uuidSchema,
  committeeId: uuidSchema,
  name: z.string().min(1).max(120),
  playbookMode: minutePlaybookModeSchema.optional().default('resolution_paths'),
  resolutionPathsEnabled: z.boolean().optional().default(false),
  variants: z.array(z.object({
    variantKey: minutePlaybookVariantKeySchema,
    promptText: z.string().max(200_000).optional().default(''),
  })).min(1),
  additionalInfo: formatAdditionalInfoSchema,
  saveAsCommitteePlaybook: z.boolean().optional().default(false),
})

export const minutePlaybookLibrarySchema = z.object({
  committeeId: uuidSchema,
  playbookId: uuidSchema.optional().nullable(),
  name: z.string().min(1).max(120),
  defaultVariantKey: minutePlaybookVariantKeySchema.optional().default('default'),
  playbookMode: minutePlaybookModeSchema.optional().default('resolution_paths'),
  resolutionPathsEnabled: z.boolean().optional().default(false),
  variants: z.array(z.object({
    variantKey: minutePlaybookVariantKeySchema,
    promptText: z.string().max(200_000).optional().default(''),
  })).min(1),
})

export const minuteMindEntrySchema = z.object({
  scopeType: minuteMindScopeTypeSchema,
  entryType: minuteMindEntryTypeSchema,
  title: z.string().min(1).max(160),
  content: z.string().min(1).max(12_000),
  appliesToGeneration: z.boolean().optional().default(true),
  appliesToChat: z.boolean().optional().default(true),
  isActive: z.boolean().optional().default(true),
})

export const glossarySchema = z.object({
  committeeId: uuidSchema,
  acronym: z.string().min(1).max(40).regex(/^[A-Za-z0-9-_/().]+$/),
  fullMeaning: z.string().min(2).max(300),
})

export const committeeMinuteInstructionSchema = z.string().max(8000)
export const meetingRulesPromptSchema = z.string().max(2000)

export const generateConfigSchema = z.object({
  useTeamsTranscription: z.boolean(),
  speakerMatchMethod: z.enum(['teams_transcript', 'manual', 'diarization']),
  transcriptId: uuidSchema.optional().nullable(),
  languages: z.array(z.string().max(60)).optional().default(['English']),
  agendaDeviationPrompt: z.string().max(2000).optional().default(''),
  meetingRulesPrompt: meetingRulesPromptSchema.optional().default(''),
  highlightPrompt: z.string().max(2000).optional(),
  excludeDeckPoints: z.boolean().optional().default(false),
  requireCompleteFormatting: z.boolean().optional(),
  skippedAgendaIds: z.array(z.string().uuid()).optional().default([]),
  forcedResolvedOutcomeModes: z.record(uuidSchema, z.literal('closed')).optional().default({}),
})

export const timecodeSchema = z.string().regex(/^\d{1,2}:[0-5]\d:[0-5]\d$/, 'Invalid timecode (HH:MM:SS)')

export const analyzeAgendaSegmentationOptionsSchema = z.object({
  transcriptId: uuidSchema.optional().nullable(),
  useTeamsTranscription: z.boolean(),
  agendaDeviationPrompt: z.string().max(2000).optional().default(''),
  meetingRulesPrompt: meetingRulesPromptSchema.optional().default(''),
  highlightPrompt: z.string().max(2000).optional(),
})

export const segmentationPreviewRowSchema = z.object({
  agendaId: uuidSchema,
  agendaNo: z.string().min(1),
  agendaTitle: z.string().min(1),
  startSec: z.number().int().min(0).nullable(),
  endSec: z.number().int().min(1).nullable(),
  confidence: z.number().min(0).max(1),
  reason: z.string().max(400).default(''),
  mappingStatus: z.enum(['explicit', 'semantic', 'suggested', 'unresolved']),
  requiresReview: z.boolean(),
})

export const segmentationEditableRowSchema = z.object({
  agendaId: uuidSchema,
  startTime: timecodeSchema,
  endTime: timecodeSchema,
})

export const confirmAgendaSegmentationInputSchema = z.object({
  meetingId: uuidSchema,
  transcriptId: uuidSchema,
  rows: z.array(segmentationEditableRowSchema),
  closureRows: z.array(segmentationEditableRowSchema).optional().default([]),
})
