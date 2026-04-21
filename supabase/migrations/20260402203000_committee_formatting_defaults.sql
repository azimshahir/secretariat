alter table public.committee_generation_settings
  add column if not exists formatting_default_snapshot jsonb;

alter table public.meetings
  add column if not exists committee_formatting_default_applied_at timestamptz;
