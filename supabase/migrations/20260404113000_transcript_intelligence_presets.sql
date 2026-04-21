alter table public.organization_ai_settings
  add column if not exists transcript_intelligence_preset text not null default 'balanced'
    check (transcript_intelligence_preset in ('testing', 'balanced', 'high_accuracy'));

update public.organization_ai_settings
set transcript_intelligence_preset = coalesce(nullif(transcript_intelligence_preset, ''), 'balanced')
where transcript_intelligence_preset is null
   or transcript_intelligence_preset = '';

alter table public.transcripts
  add column if not exists raw_content text,
  add column if not exists processing_metadata jsonb not null default '{}'::jsonb;

alter table public.transcripts
  drop constraint if exists transcripts_source_check;

alter table public.transcripts
  add constraint transcripts_source_check
  check (source in ('upload_docx', 'upload_vtt', 'whisper_stt', 'openai_stt', 'teams'));
