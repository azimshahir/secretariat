-- Track custom industry / meeting type requests for admin review
create table if not exists custom_industry_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  custom_industry text,
  detected_industry text,
  custom_meeting_type text,
  suggested_meeting_types jsonb,
  selected_industry text,
  selected_meeting_type text,
  status text not null default 'pending' check (status in ('pending', 'reviewed', 'template_created', 'dismissed')),
  admin_notes text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

-- RLS
alter table custom_industry_requests enable row level security;

-- Users can insert for their own org
create policy "Users can insert own org requests"
  on custom_industry_requests for insert
  to authenticated
  with check (
    organization_id = (select organization_id from profiles where id = auth.uid())
    and user_id = auth.uid()
  );

-- Users can read their own requests
create policy "Users can read own requests"
  on custom_industry_requests for select
  to authenticated
  using (user_id = auth.uid());

-- Admins can read all org requests
create policy "Admins can read org requests"
  on custom_industry_requests for select
  to authenticated
  using (
    organization_id = (select organization_id from profiles where id = auth.uid())
    and exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

-- Admins can update org requests
create policy "Admins can update org requests"
  on custom_industry_requests for update
  to authenticated
  using (
    organization_id = (select organization_id from profiles where id = auth.uid())
    and exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  )
  with check (
    organization_id = (select organization_id from profiles where id = auth.uid())
    and exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );
