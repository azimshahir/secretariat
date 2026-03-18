-- Add is_skipped flag for "Not Minuted" agendas
alter table public.agendas add column if not exists is_skipped boolean not null default false;
