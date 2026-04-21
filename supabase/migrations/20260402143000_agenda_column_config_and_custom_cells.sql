alter table public.meetings
  add column if not exists agenda_column_config jsonb not null default '[]'::jsonb;

alter table public.agendas
  add column if not exists custom_cells jsonb not null default '{}'::jsonb;
