create table if not exists public.itinerary_templates (
  id uuid primary key default gen_random_uuid(),
  committee_id uuid not null references public.committees(id) on delete cascade,
  section_key text not null,
  storage_path text not null,
  file_name text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (committee_id, section_key)
);

alter table public.itinerary_templates enable row level security;

create policy "Org members view itinerary templates" on public.itinerary_templates
  for select using (
    exists (
      select 1
      from public.committees c
      where c.id = committee_id
      and c.organization_id = public.get_user_org_id()
    )
  );

create policy "CoSec manage itinerary templates" on public.itinerary_templates
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

create trigger set_updated_at_itinerary_templates
  before update on public.itinerary_templates
  for each row execute function public.update_updated_at();

create index if not exists idx_itinerary_templates_committee
  on public.itinerary_templates(committee_id);
