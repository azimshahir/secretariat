create table if not exists public.mom_generation_batches (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid references public.meetings(id) on delete cascade not null,
  created_by uuid references public.profiles(id) on delete set null,
  is_active boolean not null default true,
  imported_at timestamptz null,
  generation_config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.mom_generation_drafts (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references public.mom_generation_batches(id) on delete cascade not null,
  meeting_id uuid references public.meetings(id) on delete cascade not null,
  agenda_id uuid references public.agendas(id) on delete cascade not null,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'done', 'failed', 'skipped', 'imported')),
  content text null,
  confidence_data jsonb not null default '[]'::jsonb,
  prompt_1_output text null,
  prompt_2_output text null,
  summary_paper text null,
  summary_discussion text null,
  summary_heated text null,
  error_message text null,
  generated_at timestamptz null,
  imported_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (batch_id, agenda_id)
);

create index if not exists idx_mom_generation_batches_meeting
  on public.mom_generation_batches(meeting_id);
create unique index if not exists idx_mom_generation_batches_active_meeting
  on public.mom_generation_batches(meeting_id)
  where is_active = true and imported_at is null;

create index if not exists idx_mom_generation_drafts_batch
  on public.mom_generation_drafts(batch_id);
create index if not exists idx_mom_generation_drafts_meeting
  on public.mom_generation_drafts(meeting_id);
create index if not exists idx_mom_generation_drafts_agenda
  on public.mom_generation_drafts(agenda_id);
create index if not exists idx_mom_generation_drafts_status
  on public.mom_generation_drafts(status);

create trigger set_updated_at before update on public.mom_generation_batches
for each row execute function public.update_updated_at();

create trigger set_updated_at before update on public.mom_generation_drafts
for each row execute function public.update_updated_at();

alter table public.mom_generation_batches enable row level security;
alter table public.mom_generation_drafts enable row level security;

create policy "Scoped users view MoM draft batches" on public.mom_generation_batches
  for select using (
    public.user_has_meeting_read_access(meeting_id)
  );

create policy "Scoped users manage MoM draft batches" on public.mom_generation_batches
  for all using (
    public.user_has_meeting_write_access(meeting_id)
  )
  with check (
    public.user_has_meeting_write_access(meeting_id)
  );

create policy "Scoped users view MoM drafts" on public.mom_generation_drafts
  for select using (
    public.user_has_meeting_read_access(meeting_id)
  );

create policy "Scoped users manage MoM drafts" on public.mom_generation_drafts
  for all using (
    public.user_has_meeting_write_access(meeting_id)
  )
  with check (
    public.user_has_meeting_write_access(meeting_id)
  );
