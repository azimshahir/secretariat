alter table public.committees
  add column if not exists created_by uuid references public.profiles(id) on delete set null;

update public.committees c
set created_by = source.created_by
from (
  select distinct on (m.committee_id)
    m.committee_id,
    m.created_by
  from public.meetings m
  where m.committee_id is not null
    and m.created_by is not null
  order by m.committee_id, m.created_at asc
) source
where c.id = source.committee_id
  and c.created_by is null;

create table if not exists public.committee_memberships (
  id uuid primary key default gen_random_uuid(),
  committee_id uuid references public.committees(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  role text not null default 'operator'
    check (role in ('operator')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (committee_id, user_id)
);

create index if not exists idx_committee_memberships_committee
  on public.committee_memberships(committee_id);
create index if not exists idx_committee_memberships_user
  on public.committee_memberships(user_id);

create table if not exists public.committee_invitations (
  id uuid primary key default gen_random_uuid(),
  committee_id uuid references public.committees(id) on delete cascade not null,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  email text not null,
  invited_by uuid references public.profiles(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'revoked', 'expired')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz null,
  unique (committee_id, email)
);

create index if not exists idx_committee_invitations_org
  on public.committee_invitations(organization_id);
create index if not exists idx_committee_invitations_email
  on public.committee_invitations(email);

alter table public.committee_memberships enable row level security;
alter table public.committee_invitations enable row level security;

insert into public.committee_memberships (committee_id, user_id, role, created_by)
select distinct
  c.id,
  c.created_by,
  'operator',
  c.created_by
from public.committees c
where c.created_by is not null
on conflict (committee_id, user_id) do nothing;

insert into public.committee_memberships (committee_id, user_id, role, created_by)
select distinct
  m.committee_id,
  m.created_by,
  'operator',
  coalesce(c.created_by, m.created_by)
from public.meetings m
join public.committees c
  on c.id = m.committee_id
where m.committee_id is not null
  and m.created_by is not null
on conflict (committee_id, user_id) do nothing;

create or replace function public.get_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid()
$$;

create or replace function public.user_has_org_read_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.get_user_role() in ('admin', 'auditor'), false)
$$;

create or replace function public.user_has_committee_read_access(p_committee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.user_has_org_read_access()
    or exists (
      select 1
      from public.committee_memberships membership
      where membership.committee_id = p_committee_id
        and membership.user_id = auth.uid()
    )
$$;

create or replace function public.user_has_committee_write_access(p_committee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(public.get_user_role() = 'admin', false)
    or exists (
      select 1
      from public.committee_memberships membership
      where membership.committee_id = p_committee_id
        and membership.user_id = auth.uid()
        and membership.role = 'operator'
    )
$$;

create or replace function public.user_has_meeting_read_access(p_meeting_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.meetings meeting
    where meeting.id = p_meeting_id
      and meeting.organization_id = public.get_user_org_id()
      and (
        (meeting.committee_id is null and public.user_has_org_read_access())
        or (meeting.committee_id is not null and public.user_has_committee_read_access(meeting.committee_id))
      )
  )
$$;

create or replace function public.user_has_meeting_write_access(p_meeting_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.meetings meeting
    where meeting.id = p_meeting_id
      and meeting.organization_id = public.get_user_org_id()
      and (
        (meeting.committee_id is null and coalesce(public.get_user_role() = 'admin', false))
        or (meeting.committee_id is not null and public.user_has_committee_write_access(meeting.committee_id))
      )
  )
$$;

create or replace function public.user_has_agenda_read_access(p_agenda_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.agendas agenda
    where agenda.id = p_agenda_id
      and public.user_has_meeting_read_access(agenda.meeting_id)
  )
$$;

create or replace function public.user_has_agenda_write_access(p_agenda_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.agendas agenda
    where agenda.id = p_agenda_id
      and public.user_has_meeting_write_access(agenda.meeting_id)
  )
$$;

create or replace function public.user_has_transcript_read_access(p_transcript_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.transcripts transcript
    where transcript.id = p_transcript_id
      and public.user_has_meeting_read_access(transcript.meeting_id)
  )
$$;

create or replace function public.user_has_transcript_write_access(p_transcript_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.transcripts transcript
    where transcript.id = p_transcript_id
      and public.user_has_meeting_write_access(transcript.meeting_id)
  )
$$;

create or replace function public.user_has_minute_read_access(p_minute_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.minutes minute
    join public.agendas agenda
      on agenda.id = minute.agenda_id
    where minute.id = p_minute_id
      and public.user_has_meeting_read_access(agenda.meeting_id)
  )
$$;

create or replace function public.user_has_minute_write_access(p_minute_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.minutes minute
    join public.agendas agenda
      on agenda.id = minute.agenda_id
    where minute.id = p_minute_id
      and public.user_has_meeting_write_access(agenda.meeting_id)
  )
$$;

drop policy if exists "Org members view committees" on public.committees;
drop policy if exists "Admins manage committees" on public.committees;
create policy "Committee readers view committees" on public.committees
  for select using (
    organization_id = public.get_user_org_id()
    and public.user_has_committee_read_access(id)
  );
create policy "Authenticated users create committees" on public.committees
  for insert with check (
    organization_id = public.get_user_org_id()
    and auth.uid() is not null
  );
create policy "Scoped users update committees" on public.committees
  for update using (
    organization_id = public.get_user_org_id()
    and public.user_has_committee_write_access(id)
  )
  with check (
    organization_id = public.get_user_org_id()
    and public.user_has_committee_write_access(id)
  );
create policy "Scoped users delete committees" on public.committees
  for delete using (
    organization_id = public.get_user_org_id()
    and public.user_has_committee_write_access(id)
  );

drop policy if exists "Org members view glossary" on public.glossary;
drop policy if exists "CoSec manage glossary" on public.glossary;
create policy "Scoped users view glossary" on public.glossary
  for select using (
    exists (
      select 1
      from public.committees committee
      where committee.id = committee_id
        and committee.organization_id = public.get_user_org_id()
        and public.user_has_committee_read_access(committee.id)
    )
  );
create policy "Scoped users manage glossary" on public.glossary
  for all using (
    exists (
      select 1
      from public.committees committee
      where committee.id = committee_id
        and committee.organization_id = public.get_user_org_id()
        and public.user_has_committee_write_access(committee.id)
    )
  )
  with check (
    exists (
      select 1
      from public.committees committee
      where committee.id = committee_id
        and committee.organization_id = public.get_user_org_id()
        and public.user_has_committee_write_access(committee.id)
    )
  );

drop policy if exists "Org members view templates" on public.format_templates;
drop policy if exists "CoSec manage templates" on public.format_templates;
create policy "Scoped users view templates" on public.format_templates
  for select using (
    exists (
      select 1
      from public.committees committee
      where committee.id = committee_id
        and committee.organization_id = public.get_user_org_id()
        and public.user_has_committee_read_access(committee.id)
    )
  );
create policy "Scoped users manage templates" on public.format_templates
  for all using (
    exists (
      select 1
      from public.committees committee
      where committee.id = committee_id
        and committee.organization_id = public.get_user_org_id()
        and public.user_has_committee_write_access(committee.id)
    )
  )
  with check (
    exists (
      select 1
      from public.committees committee
      where committee.id = committee_id
        and committee.organization_id = public.get_user_org_id()
        and public.user_has_committee_write_access(committee.id)
    )
  );

drop policy if exists "Org members view committee generation settings" on public.committee_generation_settings;
drop policy if exists "CoSec manage committee generation settings" on public.committee_generation_settings;
create policy "Scoped users view committee generation settings" on public.committee_generation_settings
  for select using (
    exists (
      select 1
      from public.committees committee
      where committee.id = committee_id
        and committee.organization_id = public.get_user_org_id()
        and public.user_has_committee_read_access(committee.id)
    )
  );
create policy "Scoped users manage committee generation settings" on public.committee_generation_settings
  for all using (
    exists (
      select 1
      from public.committees committee
      where committee.id = committee_id
        and committee.organization_id = public.get_user_org_id()
        and public.user_has_committee_write_access(committee.id)
    )
  )
  with check (
    exists (
      select 1
      from public.committees committee
      where committee.id = committee_id
        and committee.organization_id = public.get_user_org_id()
        and public.user_has_committee_write_access(committee.id)
    )
  );

drop policy if exists "Org members view committee speakers" on public.committee_speakers;
drop policy if exists "CoSec manage committee speakers" on public.committee_speakers;
create policy "Scoped users view committee speakers" on public.committee_speakers
  for select using (
    exists (
      select 1
      from public.committees committee
      where committee.id = committee_id
        and committee.organization_id = public.get_user_org_id()
        and public.user_has_committee_read_access(committee.id)
    )
  );
create policy "Scoped users manage committee speakers" on public.committee_speakers
  for all using (
    exists (
      select 1
      from public.committees committee
      where committee.id = committee_id
        and committee.organization_id = public.get_user_org_id()
        and public.user_has_committee_write_access(committee.id)
    )
  )
  with check (
    exists (
      select 1
      from public.committees committee
      where committee.id = committee_id
        and committee.organization_id = public.get_user_org_id()
        and public.user_has_committee_write_access(committee.id)
    )
  );

drop policy if exists "Org members view itinerary templates" on public.itinerary_templates;
drop policy if exists "CoSec manage itinerary templates" on public.itinerary_templates;
create policy "Scoped users view itinerary templates" on public.itinerary_templates
  for select using (
    exists (
      select 1
      from public.committees committee
      where committee.id = committee_id
        and committee.organization_id = public.get_user_org_id()
        and public.user_has_committee_read_access(committee.id)
    )
  );
create policy "Scoped users manage itinerary templates" on public.itinerary_templates
  for all using (
    exists (
      select 1
      from public.committees committee
      where committee.id = committee_id
        and committee.organization_id = public.get_user_org_id()
        and public.user_has_committee_write_access(committee.id)
    )
  )
  with check (
    exists (
      select 1
      from public.committees committee
      where committee.id = committee_id
        and committee.organization_id = public.get_user_org_id()
        and public.user_has_committee_write_access(committee.id)
    )
  );

drop policy if exists "Org members view committee rag documents" on public.committee_rag_documents;
drop policy if exists "CoSec manage committee rag documents" on public.committee_rag_documents;
create policy "Scoped users view committee rag documents" on public.committee_rag_documents
  for select using (
    exists (
      select 1
      from public.committees committee
      where committee.id = committee_id
        and committee.organization_id = public.get_user_org_id()
        and public.user_has_committee_read_access(committee.id)
    )
  );
create policy "Scoped users manage committee rag documents" on public.committee_rag_documents
  for all using (
    exists (
      select 1
      from public.committees committee
      where committee.id = committee_id
        and committee.organization_id = public.get_user_org_id()
        and public.user_has_committee_write_access(committee.id)
    )
  )
  with check (
    exists (
      select 1
      from public.committees committee
      where committee.id = committee_id
        and committee.organization_id = public.get_user_org_id()
        and public.user_has_committee_write_access(committee.id)
    )
  );

drop policy if exists "Org members view committee rag chunks" on public.committee_rag_chunks;
drop policy if exists "CoSec manage committee rag chunks" on public.committee_rag_chunks;
create policy "Scoped users view committee rag chunks" on public.committee_rag_chunks
  for select using (
    exists (
      select 1
      from public.committees committee
      where committee.id = committee_id
        and committee.organization_id = public.get_user_org_id()
        and public.user_has_committee_read_access(committee.id)
    )
  );
create policy "Scoped users manage committee rag chunks" on public.committee_rag_chunks
  for all using (
    exists (
      select 1
      from public.committees committee
      where committee.id = committee_id
        and committee.organization_id = public.get_user_org_id()
        and public.user_has_committee_write_access(committee.id)
    )
  )
  with check (
    exists (
      select 1
      from public.committees committee
      where committee.id = committee_id
        and committee.organization_id = public.get_user_org_id()
        and public.user_has_committee_write_access(committee.id)
    )
  );

drop policy if exists "Org members view meetings" on public.meetings;
drop policy if exists "CoSec manage meetings" on public.meetings;
create policy "Scoped users view meetings" on public.meetings
  for select using (
    organization_id = public.get_user_org_id()
    and (
      (committee_id is null and public.user_has_org_read_access())
      or (committee_id is not null and public.user_has_committee_read_access(committee_id))
    )
  );
create policy "Scoped users insert meetings" on public.meetings
  for insert with check (
    organization_id = public.get_user_org_id()
    and committee_id is not null
    and public.user_has_committee_write_access(committee_id)
  );
create policy "Scoped users update meetings" on public.meetings
  for update using (
    organization_id = public.get_user_org_id()
    and (
      (committee_id is null and coalesce(public.get_user_role() = 'admin', false))
      or (committee_id is not null and public.user_has_committee_write_access(committee_id))
    )
  )
  with check (
    organization_id = public.get_user_org_id()
    and committee_id is not null
    and public.user_has_committee_write_access(committee_id)
  );
create policy "Scoped users delete meetings" on public.meetings
  for delete using (
    organization_id = public.get_user_org_id()
    and (
      (committee_id is null and coalesce(public.get_user_role() = 'admin', false))
      or (committee_id is not null and public.user_has_committee_write_access(committee_id))
    )
  );

drop policy if exists "Org members view agendas" on public.agendas;
drop policy if exists "CoSec manage agendas" on public.agendas;
create policy "Scoped users view agendas" on public.agendas
  for select using (
    public.user_has_meeting_read_access(meeting_id)
  );
create policy "Scoped users manage agendas" on public.agendas
  for all using (
    public.user_has_meeting_write_access(meeting_id)
  )
  with check (
    public.user_has_meeting_write_access(meeting_id)
  );

drop policy if exists "Org members view transcripts" on public.transcripts;
drop policy if exists "CoSec manage transcripts" on public.transcripts;
create policy "Scoped users view transcripts" on public.transcripts
  for select using (
    public.user_has_meeting_read_access(meeting_id)
  );
create policy "Scoped users manage transcripts" on public.transcripts
  for all using (
    public.user_has_meeting_write_access(meeting_id)
  )
  with check (
    public.user_has_meeting_write_access(meeting_id)
  );

drop policy if exists "Org members view segments" on public.transcript_segments;
drop policy if exists "CoSec manage segments" on public.transcript_segments;
create policy "Scoped users view segments" on public.transcript_segments
  for select using (
    public.user_has_transcript_read_access(transcript_id)
  );
create policy "Scoped users manage segments" on public.transcript_segments
  for all using (
    public.user_has_transcript_write_access(transcript_id)
  )
  with check (
    public.user_has_transcript_write_access(transcript_id)
  );

drop policy if exists "Org members view minutes" on public.minutes;
drop policy if exists "CoSec manage minutes" on public.minutes;
create policy "Scoped users view minutes" on public.minutes
  for select using (
    public.user_has_agenda_read_access(agenda_id)
  );
create policy "Scoped users manage minutes" on public.minutes
  for all using (
    public.user_has_agenda_write_access(agenda_id)
  )
  with check (
    public.user_has_agenda_write_access(agenda_id)
  );

drop policy if exists "Org members view versions" on public.minute_versions;
create policy "Scoped users view minute versions" on public.minute_versions
  for select using (
    public.user_has_minute_read_access(minute_id)
  );
create policy "Scoped users manage minute versions" on public.minute_versions
  for all using (
    public.user_has_minute_write_access(minute_id)
  )
  with check (
    public.user_has_minute_write_access(minute_id)
  );

drop policy if exists "Org members view action items" on public.action_items;
drop policy if exists "CoSec manage action items" on public.action_items;
create policy "Scoped users view action items" on public.action_items
  for select using (
    public.user_has_meeting_read_access(meeting_id)
  );
create policy "Scoped users manage action items" on public.action_items
  for all using (
    public.user_has_meeting_write_access(meeting_id)
  )
  with check (
    public.user_has_meeting_write_access(meeting_id)
  );

drop policy if exists "Org members view media" on public.media_files;
drop policy if exists "CoSec manage media" on public.media_files;
create policy "Scoped users view media" on public.media_files
  for select using (
    public.user_has_meeting_read_access(meeting_id)
  );
create policy "Scoped users manage media" on public.media_files
  for all using (
    public.user_has_meeting_write_access(meeting_id)
  )
  with check (
    public.user_has_meeting_write_access(meeting_id)
  );

drop policy if exists "Org members view audit logs" on public.audit_logs;
drop policy if exists "System insert audit logs" on public.audit_logs;
create policy "Scoped users view audit logs" on public.audit_logs
  for select using (
    organization_id = public.get_user_org_id()
    and (
      (meeting_id is not null and public.user_has_meeting_read_access(meeting_id))
      or (meeting_id is null and (public.user_has_org_read_access() or user_id = auth.uid()))
    )
  );
create policy "Scoped users insert audit logs" on public.audit_logs
  for insert with check (
    organization_id = public.get_user_org_id()
    and (
      (meeting_id is not null and public.user_has_meeting_write_access(meeting_id))
      or (meeting_id is null and auth.uid() is not null)
    )
  );

create policy "Scoped users view committee memberships" on public.committee_memberships
  for select using (
    user_id = auth.uid()
    or public.user_has_committee_read_access(committee_id)
  );
create policy "Scoped users manage committee memberships" on public.committee_memberships
  for all using (
    exists (
      select 1
      from public.committees committee
      where committee.id = committee_id
        and committee.organization_id = public.get_user_org_id()
        and (
          committee.created_by = auth.uid()
          or public.user_has_committee_write_access(committee.id)
        )
    )
  )
  with check (
    exists (
      select 1
      from public.committees committee
      where committee.id = committee_id
        and committee.organization_id = public.get_user_org_id()
        and (
          committee.created_by = auth.uid()
          or public.user_has_committee_write_access(committee.id)
        )
    )
  );

create policy "Scoped users view committee invitations" on public.committee_invitations
  for select using (
    organization_id = public.get_user_org_id()
    and public.user_has_committee_read_access(committee_id)
  );
create policy "Scoped users manage committee invitations" on public.committee_invitations
  for all using (
    organization_id = public.get_user_org_id()
    and public.user_has_committee_write_access(committee_id)
  )
  with check (
    organization_id = public.get_user_org_id()
    and public.user_has_committee_write_access(committee_id)
  );
