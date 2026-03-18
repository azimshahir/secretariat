alter table public.meetings
  add column if not exists meeting_pack_config jsonb not null default '{}'::jsonb;

