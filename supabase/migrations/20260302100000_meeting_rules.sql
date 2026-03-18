alter table public.meetings
  add column if not exists meeting_rules text not null default '';
