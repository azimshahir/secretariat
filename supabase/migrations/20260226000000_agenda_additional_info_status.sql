-- Add additional_info for per-agenda context notes (e.g. "CBO used CRO's mic")
alter table public.agendas add column additional_info text;

-- Add minute_status to track review progress per agenda
alter table public.agendas add column minute_status text not null default 'pending'
  check (minute_status in ('done', 'ongoing', 'pending'));

-- Manual quick unblock (if migration runner is unavailable):
-- alter table public.agendas add column if not exists additional_info text;
-- alter table public.agendas add column if not exists minute_status text not null default 'pending'
--   check (minute_status in ('done','ongoing','pending'));
