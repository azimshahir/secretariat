-- Global (per-organization) billing settings: credit↔transcription rate + credit price.
-- Admin-controlled. Used to unify everything to a single credit currency.

create table if not exists public.organization_billing_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  credits_per_transcription_hour integer not null default 4,
  credit_price_rm numeric(6,2) not null default 0.20,
  updated_at timestamptz not null default now()
);

alter table public.organization_billing_settings enable row level security;

-- Members of the org can read the settings (needed for the pricing slider price display).
drop policy if exists "Org members read billing settings" on public.organization_billing_settings;
create policy "Org members read billing settings"
  on public.organization_billing_settings for select
  using (
    organization_id in (
      select organization_id from public.profiles where id = auth.uid()
    )
  );

-- Only admins can change them.
drop policy if exists "Admins manage billing settings" on public.organization_billing_settings;
create policy "Admins manage billing settings"
  on public.organization_billing_settings for all
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
        and role = 'admin'
        and organization_id = organization_billing_settings.organization_id
    )
  );
