-- Organization-level AI model settings (admin-managed)
create table if not exists public.organization_ai_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  provider text not null check (provider in ('anthropic', 'openai', 'google')),
  model text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.organization_ai_settings enable row level security;

drop policy if exists "Admins view org AI settings" on public.organization_ai_settings;
create policy "Admins view org AI settings" on public.organization_ai_settings
  for select using (
    organization_id = public.get_user_org_id()
    and exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );

drop policy if exists "Admins manage org AI settings" on public.organization_ai_settings;
create policy "Admins manage org AI settings" on public.organization_ai_settings
  for all using (
    organization_id = public.get_user_org_id()
    and exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  )
  with check (
    organization_id = public.get_user_org_id()
    and exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );

drop trigger if exists set_updated_at_organization_ai_settings on public.organization_ai_settings;
create trigger set_updated_at_organization_ai_settings
  before update on public.organization_ai_settings
  for each row execute function public.update_updated_at();
