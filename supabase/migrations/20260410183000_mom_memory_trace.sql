alter table public.mom_generation_drafts
  add column if not exists applied_memory_trace jsonb null;

alter table public.minutes
  add column if not exists applied_memory_trace jsonb null;
