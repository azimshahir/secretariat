alter table public.mom_generation_drafts
  add column if not exists attempt_count integer not null default 0,
  add column if not exists last_completed_stage text null
    check (last_completed_stage in ('prompt1', 'prompt2', 'summary', 'final')),
  add column if not exists last_error_stage text null,
  add column if not exists last_attempt_started_at timestamptz null,
  add column if not exists last_attempt_finished_at timestamptz null;

create index if not exists idx_mom_generation_drafts_last_attempt_started
  on public.mom_generation_drafts(last_attempt_started_at);
