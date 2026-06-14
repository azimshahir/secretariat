-- Stripe billing columns on profiles for subscription tracking.

alter table public.profiles
  add column if not exists stripe_customer_id     text,
  add column if not exists stripe_subscription_id text,
  add column if not exists subscription_status    text,
  add column if not exists current_period_end     timestamptz;

create index if not exists profiles_stripe_customer_id_idx
  on public.profiles (stripe_customer_id);
