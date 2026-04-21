alter table public.profiles
  add column if not exists credit_balance integer not null default 0;

update public.profiles
set plan = 'premium'
where plan = 'max';

alter table public.profiles
  drop constraint if exists profiles_plan_check;

alter table public.profiles
  add constraint profiles_plan_check
  check (plan in ('free', 'basic', 'pro', 'premium'));

create table if not exists public.user_subscription_usage_monthly (
  user_id uuid not null references public.profiles (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  usage_month date not null,
  meetings_created integer not null default 0,
  transcript_review_jobs integer not null default 0,
  transcription_seconds_used integer not null default 0,
  go_deeper_agent_runs integer not null default 0,
  best_fit_mom_runs integer not null default 0,
  extract_minute_runs integer not null default 0,
  credits_consumed integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_month)
);

create index if not exists idx_user_subscription_usage_monthly_org_month
  on public.user_subscription_usage_monthly (organization_id, usage_month);

create table if not exists public.user_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  usage_month date,
  meeting_id uuid references public.meetings (id) on delete set null,
  entry_kind text not null check (
    entry_kind in (
      'monthly_included_credits',
      'admin_top_up',
      'admin_deduction',
      'manual_adjustment',
      'go_deeper_agent',
      'best_fit_mom',
      'transcription_overage',
      'extract_minute'
    )
  ),
  credits_delta integer not null default 0,
  applies_to_wallet boolean not null default false,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_user_credit_ledger_user_created
  on public.user_credit_ledger (user_id, created_at desc);

create index if not exists idx_user_credit_ledger_org_created
  on public.user_credit_ledger (organization_id, created_at desc);

create table if not exists public.organization_ai_plan_settings (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  plan_tier text not null check (plan_tier in ('free', 'basic', 'pro', 'premium')),
  generate_mom_provider text check (generate_mom_provider in ('anthropic', 'openai', 'google')),
  generate_mom_model text,
  go_deeper_ask_provider text check (go_deeper_ask_provider in ('anthropic', 'openai', 'google')),
  go_deeper_ask_model text,
  go_deeper_agent_provider text check (go_deeper_agent_provider in ('anthropic', 'openai', 'google')),
  go_deeper_agent_model text,
  generate_itineraries_provider text check (generate_itineraries_provider in ('anthropic', 'openai', 'google')),
  generate_itineraries_model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, plan_tier)
);

create or replace function public.set_updated_at_timestamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_user_subscription_usage_monthly_updated_at on public.user_subscription_usage_monthly;
create trigger trg_user_subscription_usage_monthly_updated_at
before update on public.user_subscription_usage_monthly
for each row execute function public.set_updated_at_timestamp();

drop trigger if exists trg_organization_ai_plan_settings_updated_at on public.organization_ai_plan_settings;
create trigger trg_organization_ai_plan_settings_updated_at
before update on public.organization_ai_plan_settings
for each row execute function public.set_updated_at_timestamp();

insert into public.organization_ai_plan_settings (
  organization_id,
  plan_tier,
  generate_mom_provider,
  generate_mom_model,
  go_deeper_ask_provider,
  go_deeper_ask_model,
  go_deeper_agent_provider,
  go_deeper_agent_model,
  generate_itineraries_provider,
  generate_itineraries_model
)
select
  organization_id,
  tier.plan_tier,
  generate_mom_provider,
  generate_mom_model,
  go_deeper_ask_provider,
  go_deeper_ask_model,
  go_deeper_agent_provider,
  go_deeper_agent_model,
  generate_itineraries_provider,
  generate_itineraries_model
from public.organization_ai_settings
cross join (
  values ('free'), ('basic'), ('pro'), ('premium')
) as tier(plan_tier)
on conflict (organization_id, plan_tier) do nothing;

alter table public.user_subscription_usage_monthly enable row level security;
alter table public.user_credit_ledger enable row level security;
alter table public.organization_ai_plan_settings enable row level security;

drop policy if exists "Users can view own subscription usage" on public.user_subscription_usage_monthly;
create policy "Users can view own subscription usage"
  on public.user_subscription_usage_monthly
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users can view own credit ledger" on public.user_credit_ledger;
create policy "Users can view own credit ledger"
  on public.user_credit_ledger
  for select
  using (auth.uid() = user_id);

drop policy if exists "Admins can view plan AI settings in org" on public.organization_ai_plan_settings;
create policy "Admins can view plan AI settings in org"
  on public.organization_ai_plan_settings
  for select
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.organization_id = organization_ai_plan_settings.organization_id
        and profiles.role = 'admin'
    )
  );
