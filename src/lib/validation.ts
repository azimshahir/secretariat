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

export const saveAgendaFormattingSchema = z.object({
  agendaId: uuidSchema,
  committeeId: uuidSchema,
  name: z.string().min(1).max(120),
  promptText: formatPromptTextSchema,
  additionalInfo: formatAdditionalInfoSchema,
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
  startSec: z.number().int().min(0),
  endSec: z.number().int().min(1),
  confidence: z.number().min(0).max(1),
  reason: z.string().max(400).default(''),
})

export const segmentationEditableRowSchema = z.object({
  agendaId: uuidSchema,
  startTime: timecodeSchema,
  endTime: timecodeSchema,
})

export const confirmAgendaSegmentationInputSchema = z.object({
  meetingId: uuidSchema,
  transcriptId: uuidSchema,
  rows: z.array(segmentationEditableRowSchema).min(1, 'At least one segmentation row is required'),
})
