create table if not exists public.minute_playbooks (
  id uuid primary key default gen_random_uuid(),
  committee_id uuid not null references public.committees(id) on delete cascade,
  name text not null,
  scope text not null check (scope in ('agenda', 'committee')),
  is_reusable boolean not null default false,
  default_variant_key text not null default 'default' check (default_variant_key in ('default', 'with_action', 'without_action')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.minute_playbook_variants (
  id uuid primary key default gen_random_uuid(),
  playbook_id uuid not null references public.minute_playbooks(id) on delete cascade,
  variant_key text not null check (variant_key in ('default', 'with_action', 'without_action')),
  format_template_id uuid not null references public.format_templates(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (playbook_id, variant_key)
);

create table if not exists public.minute_mind_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  committee_id uuid references public.committees(id) on delete cascade,
  meeting_id uuid references public.meetings(id) on delete cascade,
  agenda_id uuid references public.agendas(id) on delete cascade,
  scope_type text not null check (scope_type in ('agenda', 'meeting', 'committee')),
  source text not null check (source in ('chat', 'settings')),
  entry_type text not null check (entry_type in ('formatting_rule', 'writing_preference', 'committee_fact', 'exception')),
  title text not null,
  content text not null,
  applies_to_generation boolean not null default true,
  applies_to_chat boolean not null default true,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (scope_type = 'committee' and committee_id is not null and meeting_id is null and agenda_id is null)
    or (scope_type = 'meeting' and meeting_id is not null and agenda_id is null)
    or (scope_type = 'agenda' and agenda_id is not null)
  )
);

alter table public.agendas
  add column if not exists minute_playbook_id uuid references public.minute_playbooks(id) on delete set null,
  add column if not exists minute_playbook_variant_override_id uuid references public.minute_playbook_variants(id) on delete set null;

create index if not exists idx_minute_playbooks_committee
  on public.minute_playbooks(committee_id, created_at desc);

create index if not exists idx_minute_playbook_variants_playbook
  on public.minute_playbook_variants(playbook_id);

create index if not exists idx_minute_playbook_variants_template
  on public.minute_playbook_variants(format_template_id);

create index if not exists idx_agendas_minute_playbook
  on public.agendas(minute_playbook_id);

create index if not exists idx_agendas_minute_playbook_override
  on public.agendas(minute_playbook_variant_override_id);

create index if not exists idx_minute_mind_entries_committee
  on public.minute_mind_entries(committee_id, updated_at desc);

create index if not exists idx_minute_mind_entries_meeting
  on public.minute_mind_entries(meeting_id, updated_at desc);

create index if not exists idx_minute_mind_entries_agenda
  on public.minute_mind_entries(agenda_id, updated_at desc);

create index if not exists idx_minute_mind_entries_active
  on public.minute_mind_entries(organization_id, is_active, updated_at desc);

alter table public.minute_playbooks enable row level security;
alter table public.minute_playbook_variants enable row level security;
alter table public.minute_mind_entries enable row level security;

create policy "Scoped users view minute playbooks" on public.minute_playbooks
  for select using (
    exists (
      select 1
      from public.committees committee
      where committee.id = minute_playbooks.committee_id
        and committee.organization_id = public.get_user_org_id()
        and public.user_has_committee_read_access(committee.id)
    )
  );

create policy "Scoped users manage minute playbooks" on public.minute_playbooks
  for all using (
    exists (
      select 1
      from public.committees committee
      where committee.id = minute_playbooks.committee_id
        and committee.organization_id = public.get_user_org_id()
        and public.user_has_committee_write_access(committee.id)
    )
  )
  with check (
    exists (
      select 1
      from public.committees committee
      where committee.id = minute_playbooks.committee_id
        and committee.organization_id = public.get_user_org_id()
        and public.user_has_committee_write_access(committee.id)
    )
  );

create policy "Scoped users view minute playbook variants" on public.minute_playbook_variants
  for select using (
    exists (
      select 1
      from public.minute_playbooks playbook
      join public.committees committee on committee.id = playbook.committee_id
      where playbook.id = minute_playbook_variants.playbook_id
        and committee.organization_id = public.get_user_org_id()
        and public.user_has_committee_read_access(committee.id)
    )
  );

create policy "Scoped users manage minute playbook variants" on public.minute_playbook_variants
  for all using (
    exists (
      select 1
      from public.minute_playbooks playbook
      join public.committees committee on committee.id = playbook.committee_id
      where playbook.id = minute_playbook_variants.playbook_id
        and committee.organization_id = public.get_user_org_id()
        and public.user_has_committee_write_access(committee.id)
    )
  )
  with check (
    exists (
      select 1
      from public.minute_playbooks playbook
      join public.committees committee on committee.id = playbook.committee_id
      where playbook.id = minute_playbook_variants.playbook_id
        and committee.organization_id = public.get_user_org_id()
        and public.user_has_committee_write_access(committee.id)
    )
  );

create policy "Scoped users view minute mind entries" on public.minute_mind_entries
  for select using (
    minute_mind_entries.organization_id = public.get_user_org_id()
    and (
      minute_mind_entries.committee_id is null
      or exists (
        select 1
        from public.committees committee
        where committee.id = minute_mind_entries.committee_id
          and committee.organization_id = public.get_user_org_id()
          and public.user_has_committee_read_access(committee.id)
      )
    )
  );

create policy "Scoped users manage minute mind entries" on public.minute_mind_entries
  for all using (
    minute_mind_entries.organization_id = public.get_user_org_id()
    and (
      minute_mind_entries.committee_id is null
      or exists (
        select 1
        from public.committees committee
        where committee.id = minute_mind_entries.committee_id
          and committee.organization_id = public.get_user_org_id()
          and public.user_has_committee_write_access(committee.id)
      )
    )
  )
  with check (
    minute_mind_entries.organization_id = public.get_user_org_id()
    and (
      minute_mind_entries.committee_id is null
      or exists (
        select 1
        from public.committees committee
        where committee.id = minute_mind_entries.committee_id
          and committee.organization_id = public.get_user_org_id()
          and public.user_has_committee_write_access(committee.id)
      )
    )
  );

drop trigger if exists set_updated_at_minute_playbooks on public.minute_playbooks;
create trigger set_updated_at_minute_playbooks
  before update on public.minute_playbooks
  for each row execute function public.update_updated_at();

drop trigger if exists set_updated_at_minute_playbook_variants on public.minute_playbook_variants;
create trigger set_updated_at_minute_playbook_variants
  before update on public.minute_playbook_variants
  for each row execute function public.update_updated_at();

drop trigger if exists set_updated_at_minute_mind_entries on public.minute_mind_entries;
create trigger set_updated_at_minute_mind_entries
  before update on public.minute_mind_entries
  for each row execute function public.update_updated_at();

create or replace function public.clear_meeting_formatting_for_org_member(p_meeting_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_org_id uuid;
  v_meeting_org_id uuid;
  v_affected_rows integer := 0;
begin
  if v_user_id is null then
    raise exception 'Unauthorized';
  end if;

  select p.organization_id
  into v_user_org_id
  from public.profiles p
  where p.id = v_user_id;

  if v_user_org_id is null then
    raise exception 'Profile not found';
  end if;

  select m.organization_id
  into v_meeting_org_id
  from public.meetings m
  where m.id = p_meeting_id;

  if v_meeting_org_id is null then
    raise exception 'Meeting not found';
  end if;

  if v_user_org_id <> v_meeting_org_id then
    raise exception 'Not allowed to clear formatting for this meeting';
  end if;

  begin
    update public.agendas
    set format_template_id = null,
        minute_playbook_id = null,
        minute_playbook_variant_override_id = null,
        additional_info = null
    where meeting_id = p_meeting_id;

    get diagnostics v_affected_rows = row_count;
  exception
    when undefined_column then
      update public.agendas
      set format_template_id = null,
          additional_info = null
      where meeting_id = p_meeting_id;

      get diagnostics v_affected_rows = row_count;
  end;

  return v_affected_rows;
end;
$$;

revoke all on function public.clear_meeting_formatting_for_org_member(uuid) from public;
grant execute on function public.clear_meeting_formatting_for_org_member(uuid) to authenticated;

create or replace function public.clear_agenda_formatting_for_org_member(p_agenda_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_org_id uuid;
  v_agenda_org_id uuid;
  v_affected_rows integer := 0;
begin
  if v_user_id is null then
    raise exception 'Unauthorized';
  end if;

  select p.organization_id
  into v_user_org_id
  from public.profiles p
  where p.id = v_user_id;

  if v_user_org_id is null then
    raise exception 'Profile not found';
  end if;

  select m.organization_id
  into v_agenda_org_id
  from public.agendas a
  join public.meetings m on m.id = a.meeting_id
  where a.id = p_agenda_id;

  if v_agenda_org_id is null then
    raise exception 'Agenda not found';
  end if;

  if v_user_org_id <> v_agenda_org_id then
    raise exception 'Not allowed to clear formatting for this agenda';
  end if;

  begin
    update public.agendas
    set format_template_id = null,
        minute_playbook_id = null,
        minute_playbook_variant_override_id = null,
        additional_info = null
    where id = p_agenda_id;

    get diagnostics v_affected_rows = row_count;
  exception
    when undefined_column then
      update public.agendas
      set format_template_id = null,
          additional_info = null
      where id = p_agenda_id;

      get diagnostics v_affected_rows = row_count;
  end;

  return v_affected_rows;
end;
$$;

revoke all on function public.clear_agenda_formatting_for_org_member(uuid) from public;
grant execute on function public.clear_agenda_formatting_for_org_member(uuid) to authenticated;
