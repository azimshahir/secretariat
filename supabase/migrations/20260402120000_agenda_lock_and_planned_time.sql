alter table public.agendas
  add column if not exists planned_time text;

alter table public.meetings
  add column if not exists agenda_locked_at timestamptz,
  add column if not exists agenda_locked_by uuid references public.profiles(id) on delete set null;
