create table if not exists public.committee_speakers (
  id uuid primary key default gen_random_uuid(),
  committee_id uuid not null references public.committees(id) on delete cascade,
  speaker_name text not null,
  position text not null default '',
  sort_order int not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (committee_id, speaker_name)
);

alter table public.committee_speakers enable row level security;

create policy "Org members view committee speakers" on public.committee_speakers
  for select using (
    exists (
      select 1
      from public.committees c
      where c.id = committee_id
      and c.organization_id = public.get_user_org_id()
    )
  );

create policy "CoSec manage committee speakers" on public.committee_speakers
  for all using (
    exists (
      select 1
      from public.committees c
      where c.id = committee_id
      and c.organization_id = public.get_user_org_id()
      and exists (
        select 1
        from public.profiles p
        where p.id = auth.uid()
        and p.role in ('admin', 'cosec')
      )
    )
  )
  with check (
    exists (
      select 1
      from public.committees c
      where c.id = committee_id
      and c.organization_id = public.get_user_org_id()
      and exists (
        select 1
        from public.profiles p
        where p.id = auth.uid()
        and p.role in ('admin', 'cosec')
      )
    )
  );

create trigger set_updated_at_committee_speakers
  before update on public.committee_speakers
  for each row execute function public.update_updated_at();

create index if not exists idx_committee_speakers_committee
  on public.committee_speakers(committee_id);
