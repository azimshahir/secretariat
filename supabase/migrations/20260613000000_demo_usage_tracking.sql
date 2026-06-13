-- Demo usage tracking: monthly per-IP + per-client quota for the public Live AI demo.
-- The previous demo_usage_logs table was created manually (ip_address only) and only
-- supported a one-time permanent block. Recreate it to track cumulative monthly usage.

drop table if exists public.demo_usage_logs cascade;

create table public.demo_usage_logs (
  id           uuid primary key default gen_random_uuid(),
  ip_address   text not null,
  client_id    text,
  period       text not null,            -- 'YYYY-MM'
  seconds_used integer not null default 0,
  words_used   integer not null default 0,
  created_at   timestamptz not null default now()
);

create index demo_usage_logs_ip_period_idx on public.demo_usage_logs (ip_address, period);
create index demo_usage_logs_client_period_idx on public.demo_usage_logs (client_id, period);

-- No anonymous access. The /api/demo/generate route uses the service-role client,
-- which bypasses RLS. Enabling RLS with no policies blocks all anon/auth access.
alter table public.demo_usage_logs enable row level security;
