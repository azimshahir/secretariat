import type { z } from 'zod'
import type { MinutePlaybookVariantKey } from './minute-playbooks'
import type { ResolvedOutcomeMode } from './resolved-outcome'
import type { generateConfigSchema } from '@/lib/validation'
import type { PlanTier } from '@/lib/supabase/types'

export type GenerationConfig = z.infer<typeof generateConfigSchema>

export type MinuteMemoryApplicationKind =
  | 'formatter_prompt'
  | 'style_prompt'
  | 'fact_prompt'
  | 'exception_prompt'
  | 'template_entry_guidance'
  | 'formatter_scaffold'
  | 'post_generation_repair'

export interface AppliedMinuteMemoryTraceItem {
  entryId: string
  scopeType: 'agenda' | 'meeting' | 'committee'
  entryType: 'formatting_rule' | 'writing_preference' | 'committee_fact' | 'exception'
  title: string
  matchedKeywords: string[]
  matchedSectionHints: string[]
  openingOnly: boolean
  appliedAs: MinuteMemoryApplicationKind[]
}

export interface ConfidenceMarker {
  offset: number
  length: number
  original: string
  score: number
  reason: string
}

export interface CommitteeGenerationContext {
  defaultFormatTemplateId: string | null
  minuteInstruction: string
}

export type MomDraftCompletedStage = 'prompt1' | 'prompt2' | 'summary' | 'final'

export interface MomDraftCheckpointPayload {
  sourceAgendaRevision?: number | null
  prompt1Output?: string | null
  prompt2Output?: string | null
  summaryPaper?: string | null
  summaryDiscussion?: string | null
  summaryHeated?: string | null
  lastCompletedStage: MomDraftCompletedStage
}

export interface GenerationRuntimeContext {
  committeeContext?: CommitteeGenerationContext
  ignoredAgendaNos?: string[]
  meetingRulesPrompt?: string
  transcriptId?: string | null
  userPlanTier?: PlanTier | null
  momDraftCheckpoint?: MomDraftRow | null
  resolvedOutcomeModeOverride?: ResolvedOutcomeMode | null
  skipDiscussedSection?: boolean
  onMomDraftCheckpoint?: (payload: MomDraftCheckpointPayload) => Promise<void>
}

export type ResolutionVariantSelectionSource = 'manual' | 'auto'

export interface ResolutionVariantMetadata {
  resolutionVariantKey: MinutePlaybookVariantKey | null
  resolutionVariantLabel: string | null
  resolutionVariantSource: ResolutionVariantSelectionSource | null
  resolutionExactRenderEnforced: boolean
}

export interface GenerateMinutesForAgendaResult {
  content: string
  markers: ConfidenceMarker[]
  minuteId: string | null
  resolvedOutcomeMode: ResolvedOutcomeMode | null
  resolutionVariantKey: MinutePlaybookVariantKey | null
  resolutionVariantLabel: string | null
  resolutionVariantSource: ResolutionVariantSelectionSource | null
  resolutionExactRenderEnforced: boolean
}

export interface GenerateMinuteDraftPayload {
  content: string
  markers: ConfidenceMarker[]
  sourceAgendaRevision: number | null
  prompt1Output: string
  prompt2Output: string
  summaryPaper: string | null
  summaryDiscussion: string | null
  summaryHeated: string | null
  resolvedOutcomeMode: ResolvedOutcomeMode | null
  resolutionVariantKey: MinutePlaybookVariantKey | null
  resolutionVariantLabel: string | null
  resolutionVariantSource: ResolutionVariantSelectionSource | null
  resolutionExactRenderEnforced: boolean
  appliedMemoryTrace?: AppliedMinuteMemoryTraceItem[] | null
}

export type MomDraftStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'failed'
  | 'skipped'
  | 'imported'

export interface MomDraftBatchSummary {
  id: string
  meetingId: string
  isActive: boolean
  importedAt: string | null
  generationConfig: GenerationConfig | null
  createdAt: string
  updatedAt: string
}

export interface MomDraftRow {
  id: string
  batchId: string
  meetingId: string
  agendaId: string
  sourceAgendaRevision: number | null
  status: MomDraftStatus
  content: string | null
  markers: ConfidenceMarker[]
  prompt1Output: string | null
  prompt2Output: string | null
  summaryPaper: string | null
  summaryDiscussion: string | null
  summaryHeated: string | null
  attemptCount: number
  lastCompletedStage: MomDraftCompletedStage | null
  lastErrorStage: string | null
  lastAttemptStartedAt: string | null
  lastAttemptFinishedAt: string | null
  errorMessage: string | null
  generatedAt: string | null
  importedAt: string | null
  createdAt: string
  updatedAt: string
  resolvedOutcomeMode?: ResolvedOutcomeMode | null
  resolutionVariantKey?: MinutePlaybookVariantKey | null
  resolutionVariantLabel?: string | null
  resolutionVariantSource?: ResolutionVariantSelectionSource | null
  resolutionExactRenderEnforced?: boolean
  appliedMemoryTrace?: AppliedMinuteMemoryTraceItem[] | null
}

export interface MomDraftBatchWithRows {
  batch: MomDraftBatchSummary
  rows: MomDraftRow[]
}

export interface TranscriptUploadResult {
  transcriptId: string
  source: 'upload_docx' | 'upload_vtt' | 'whisper_stt' | 'openai_stt'
  storagePath: string | null
}

export type TranscriptUploadStage =
  | 'validate_request'
  | 'authorize_meeting'
  | 'parse_transcript'
  | 'resolve_transcript_preset'
  | 'clean_transcript'
  | 'upload_storage'
  | 'insert_media_file'
  | 'insert_transcript'
  | 'cleanup_old_transcripts'

export interface TranscriptUploadErrorPayload {
  message: string
  stage: TranscriptUploadStage
  code?: string
}

export interface SegmentationPreviewRow {
  agendaId: string
  agendaNo: string
  agendaTitle: string
  startSec: number | null
  endSec: number | null
  confidence: number
  reason: string
  mappingStatus: 'explicit' | 'semantic' | 'suggested' | 'unresolved'
  requiresReview: boolean
}

export interface SegmentationPreviewResult {
  transcriptId: string
  rows: SegmentationPreviewRow[]
  warnings: string[]
  durationSec: number
}

export interface ConfirmSegmentationResult {
  savedSegmentCount: number
}
