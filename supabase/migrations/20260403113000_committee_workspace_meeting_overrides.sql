alter table public.committee_generation_settings
  add column if not exists template_sections jsonb not null default '[]'::jsonb;

alter table public.meetings
  add column if not exists template_section_overrides jsonb not null default '[]'::jsonb,
  add column if not exists speaker_overrides jsonb not null default '[]'::jsonb;
