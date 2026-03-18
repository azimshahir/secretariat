create table if not exists public.committee_generation_settings (
  committee_id uuid primary key references public.committees(id) on delete cascade,
  default_format_template_id uuid references public.format_templates(id) on delete set null,
  default_format_source_name text,
  minute_instruction text not null default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.committee_generation_settings enable row level security;

create policy "Org members view committee generation settings" on public.committee_generation_settings
  for select using (
    exists (
      select 1
      from public.committees c
      where c.id = committee_id
      and c.organization_id = public.get_user_org_id()
    )
  );

create policy "CoSec manage committee generation settings" on public.committee_generation_settings
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

create trigger set_updated_at_committee_generation_settings
  before update on public.committee_generation_settings
  for each row execute function public.update_updated_at();

create index if not exists idx_committee_generation_settings_default_template
  on public.committee_generation_settings(default_format_template_id);
