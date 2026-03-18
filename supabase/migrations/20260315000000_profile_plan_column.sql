-- Add plan tier to profiles for per-user subscription management
alter table public.profiles
  add column plan text not null default 'free'
  check (plan in ('free', 'pro', 'max'));
