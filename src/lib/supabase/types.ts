// Auto-generated TypeScript types matching Supabase schema
// Update this file when schema changes

export type MeetingStatus = 'draft' | 'pending_setup' | 'mapping' | 'generating' | 'in_progress' | 'finalized'
export type UserRole = 'admin' | 'cosec' | 'viewer' | 'auditor'
export type FileType = 'audio' | 'video' | 'slides_pdf' | 'agenda_excel' | 'transcript_docx'
export type TranscriptSource = 'upload_docx' | 'upload_vtt' | 'whisper_stt' | 'openai_stt' | 'teams'
export type TranscriptIntelligencePreset = 'testing' | 'balanced' | 'high_accuracy'

export interface Organization {
  id: string
  name: string
  slug: string
  created_at: string
  updated_at: string
}

export interface OrganizationAiSettings {
  organization_id: string
  provider: 'anthropic' | 'openai' | 'google'
  model: string
  transcript_intelligence_preset: TranscriptIntelligencePreset
  generate_mom_provider: 'anthropic' | 'openai' | 'google' | null
  generate_mom_model: string | null
  go_deeper_ask_provider: 'anthropic' | 'openai' | 'google' | null
  go_deeper_ask_model: string | null
  go_deeper_agent_provider: 'anthropic' | 'openai' | 'google' | null
  go_deeper_agent_model: string | null
  generate_itineraries_provider: 'anthropic' | 'openai' | 'google' | null
  generate_itineraries_model: string | null
  created_at: string
  updated_at: string
}

export interface OrganizationAiPlanSettings {
  organization_id: string
  plan_tier: PlanTier
  generate_mom_provider: 'anthropic' | 'openai' | 'google' | null
  generate_mom_model: string | null
  go_deeper_ask_provider: 'anthropic' | 'openai' | 'google' | null
  go_deeper_ask_model: string | null
  go_deeper_agent_provider: 'anthropic' | 'openai' | 'google' | null
  go_deeper_agent_model: string | null
  generate_itineraries_provider: 'anthropic' | 'openai' | 'google' | null
  generate_itineraries_model: string | null
  created_at: string
  updated_at: string
}

export type PlanTier = 'free' | 'basic' | 'pro' | 'premium'

export interface Profile {
  id: string
  organization_id: string
  full_name: string
  role: UserRole
  plan: PlanTier
  credit_balance: number
  created_at: string
  updated_at: string
}

export interface UserSubscriptionUsageMonthly {
  user_id: string
  organization_id: string
  usage_month: string
  meetings_created: number
  transcript_review_jobs: number
  transcription_seconds_used: number
  go_deeper_agent_runs: number
  best_fit_mom_runs: number
  extract_minute_runs: number
  credits_consumed: number
  created_at: string
  updated_at: string
}

export type UserCreditLedgerEntryKind =
  | 'monthly_included_credits'
  | 'admin_top_up'
  | 'admin_deduction'
  | 'manual_adjustment'
  | 'go_deeper_agent'
  | 'best_fit_mom'
  | 'transcription_overage'
  | 'extract_minute'

export interface UserCreditLedger {
  id: string
  user_id: string
  organization_id: string
  usage_month: string | null
  meeting_id: string | null
  entry_kind: UserCreditLedgerEntryKind
  credits_delta: number
  applies_to_wallet: boolean
  reason: string | null
  metadata: Record<string, unknown>
  created_by: string | null
  created_at: string
}

export type IndustryCategory = 'Banking' | 'Construction & Property' | 'Oil & Gas' | 'NGOs & Foundations' | 'Others'

export interface Committee {
  id: string
  organization_id: string
  name: string
  slug: string
  category: IndustryCategory
  persona_prompt: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface CommitteeMembership {
  id: string
  committee_id: string
  user_id: string
  role: 'operator'
  created_by: string | null
  created_at: string
}

export interface CommitteeInvitation {
  id: string
  committee_id: string
  organization_id: string
  email: string
  invited_by: string | null
  status: 'pending' | 'accepted' | 'revoked' | 'expired'
  created_at: string
  accepted_at: string | null
}

export interface GlossaryItem {
  id: string
  committee_id: string
  acronym: string
  full_meaning: string
}

export interface FormatTemplate {
  id: string
  committee_id: string
  name: string
  prompt_text: string
  compiled_template_json: Record<string, unknown>
  compiled_template_version: number
  compiled_template_hash: string
  created_at: string
}

export interface MinutePlaybook {
  id: string
  committee_id: string
  name: string
  scope: 'agenda' | 'committee'
  is_reusable: boolean
  default_variant_key: 'default' | 'with_action' | 'without_action'
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface MinutePlaybookVariant {
  id: string
  playbook_id: string
  variant_key: 'default' | 'with_action' | 'without_action'
  format_template_id: string
  created_at: string
  updated_at: string
}

export interface MinuteMindEntry {
  id: string
  organization_id: string
  committee_id: string | null
  meeting_id: string | null
  agenda_id: string | null
  scope_type: 'agenda' | 'meeting' | 'committee'
  source: 'chat' | 'settings'
  entry_type: 'formatting_rule' | 'writing_preference' | 'committee_fact' | 'exception'
  title: string
  content: string
  applies_to_generation: boolean
  applies_to_chat: boolean
  is_active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface CommitteeGenerationSettings {
  committee_id: string
  default_format_template_id: string | null
  default_format_source_name: string | null
  minute_instruction: string
  formatting_default_snapshot: Record<string, unknown> | null
  template_sections: Record<string, unknown>[]
  created_at: string
  updated_at: string
}

export interface CommitteeRagDocument {
  id: string
  committee_id: string
  category: string
  document_name: string
  file_name: string
  storage_path: string
  uploaded_by: string | null
  created_at: string
  updated_at: string
}

export interface CommitteeRagChunk {
  id: string
  document_id: string
  committee_id: string
  chunk_index: number
  content: string
  created_at: string
}

export interface Meeting {
  id: string
  organization_id: string
  committee_id: string | null
  title: string
  meeting_date: string
  meeting_rules: string
  status: MeetingStatus
  meeting_pack_config: Record<string, unknown>
  agenda_column_config: Record<string, unknown>[]
  agenda_locked_at: string | null
  agenda_locked_by: string | null
  committee_formatting_default_applied_at: string | null
  template_section_overrides: Record<string, unknown>[]
  speaker_overrides: Record<string, unknown>[]
  created_by: string | null
  finalized_at: string | null
  finalized_content: string | null
  purge_at: string | null
  created_at: string
  updated_at: string
}

export interface Agenda {
  id: string
  meeting_id: string
  agenda_no: string
  title: string
  presenter: string | null
  planned_time: string | null
  content_revision: number
  custom_cells: Record<string, string>
  slide_pages: string | null
  format_template_id: string | null
  minute_playbook_id: string | null
  minute_playbook_variant_override_id: string | null
  additional_info: string | null
  minute_status: 'done' | 'ongoing' | 'pending'
  is_skipped: boolean
  sort_order: number
  created_at: string
}

export interface Transcript {
  id: string
  meeting_id: string
  content: string
  raw_content: string | null
  source: TranscriptSource
  speaker_map: Record<string, string>
  processing_metadata: Record<string, unknown>
  storage_path: string | null
  created_at: string
}

export interface TranscriptSegment {
  id: string
  transcript_id: string
  agenda_id: string
  content: string
  speaker: string | null
  start_offset: number | null
  end_offset: number | null
  sort_order: number
  created_at: string
}

export interface Minute {
  id: string
  agenda_id: string
  source_agenda_revision: number | null
  content: string
  confidence_data: { offset: number; length: number; score: number; reason: string }[]
  applied_memory_trace: Record<string, unknown>[] | null
  resolved_outcome_mode: 'closed' | 'follow_up' | null
  prompt_1_output: string | null
  prompt_2_output: string | null
  summary_paper: string | null
  summary_discussion: string | null
  summary_heated: string | null
  is_current: boolean
  version: number
  generated_at: string
  updated_at: string
}

export interface MinuteVersion {
  id: string
  minute_id: string
  content: string
  version: number
  change_summary: string | null
  changed_by: string | null
  created_at: string
}

export type MomDraftStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'imported'

export interface MomGenerationBatch {
  id: string
  meeting_id: string
  created_by: string | null
  is_active: boolean
  imported_at: string | null
  generation_config: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface MomGenerationDraft {
  id: string
  batch_id: string
  meeting_id: string
  agenda_id: string
  source_agenda_revision: number | null
  status: MomDraftStatus
  content: string | null
  confidence_data: { offset: number; length: number; score: number; reason: string }[]
  applied_memory_trace: Record<string, unknown>[] | null
  resolved_outcome_mode: 'closed' | 'follow_up' | null
  prompt_1_output: string | null
  prompt_2_output: string | null
  summary_paper: string | null
  summary_discussion: string | null
  summary_heated: string | null
  attempt_count: number
  last_completed_stage: 'prompt1' | 'prompt2' | 'summary' | 'final' | null
  last_error_stage: string | null
  last_attempt_started_at: string | null
  last_attempt_finished_at: string | null
  error_message: string | null
  generated_at: string | null
  imported_at: string | null
  created_at: string
  updated_at: string
}

export interface ActionItem {
  id: string
  agenda_id: string
  meeting_id: string
  description: string
  pic: string | null
  due_date: string | null
  sort_order: number
  created_at: string
}

export interface MediaFile {
  id: string
  meeting_id: string
  file_type: FileType
  storage_path: string
  original_name: string
  size_bytes: number | null
  is_purged: boolean
  purged_at: string | null
  created_at: string
}

export interface AuditLog {
  id: string
  organization_id: string
  meeting_id: string | null
  user_id: string | null
  action: string
  details: Record<string, unknown>
  ip_address: string | null
  created_at: string
}

export type CustomIndustryRequestStatus = 'pending' | 'reviewed' | 'template_created' | 'dismissed'

export interface CustomIndustryRequest {
  id: string
  organization_id: string
  user_id: string
  custom_industry: string | null
  detected_industry: string | null
  custom_meeting_type: string | null
  suggested_meeting_types: string[] | null
  selected_industry: string | null
  selected_meeting_type: string | null
  status: CustomIndustryRequestStatus
  admin_notes: string | null
  created_at: string
  reviewed_at: string | null
}
