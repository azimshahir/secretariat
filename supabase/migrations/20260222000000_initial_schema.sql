-- ============================================
-- secretariat.my - Initial Database Schema
-- Bank-grade meeting minute automation platform
-- ============================================

-- Enable required extensions
create extension if not exists "uuid-ossp";

-- ============================================
-- 1. ORGANIZATIONS
-- Bank/company profiles
-- ============================================
create table public.organizations (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  slug text unique not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================
-- 2. PROFILES (extends Supabase Auth users)
-- CoSec / LCO users
-- ============================================
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  full_name text not null,
  role text not null default 'cosec' check (role in ('admin', 'cosec', 'viewer', 'auditor')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================
-- 3. COMMITTEES
-- ALCO, MRC, Board of Directors profiles with AI persona
-- ============================================
create table public.committees (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid references public.organizations(id) on delete cascade not null,
  name text not null,
  slug text not null,
  persona_prompt text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (organization_id, slug)
);

-- ============================================
-- 4. GLOSSARY
-- Custom acronyms/jargon per committee for AI accuracy
-- ============================================
create table public.glossary (
  id uuid primary key default uuid_generate_v4(),
  committee_id uuid references public.committees(id) on delete cascade not null,
  acronym text not null,
  full_meaning text not null,
  unique (committee_id, acronym)
);

-- ============================================
-- 5. FORMAT TEMPLATES
-- Saved format prompts (e.g., "Approval Paper Format")
-- ============================================
create table public.format_templates (
  id uuid primary key default uuid_generate_v4(),
  committee_id uuid references public.committees(id) on delete cascade not null,
  name text not null,
  prompt_text text not null,
  created_at timestamptz default now()
);

-- ============================================
-- 6. MEETINGS
-- Meeting records with status tracking
-- ============================================
create type meeting_status as enum ('draft', 'pending_setup', 'mapping', 'generating', 'in_progress', 'finalized');

create table public.meetings (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid references public.organizations(id) on delete cascade not null,
  committee_id uuid references public.committees(id) on delete set null,
  title text not null,
  meeting_date date not null,
  status meeting_status default 'draft',
  created_by uuid references public.profiles(id) on delete set null,
  finalized_at timestamptz,
  purge_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================
-- 7. AGENDAS
-- Agenda items per meeting (from Excel import)
-- ============================================
create table public.agendas (
  id uuid primary key default uuid_generate_v4(),
  meeting_id uuid references public.meetings(id) on delete cascade not null,
  agenda_no text not null,
  title text not null,
  presenter text,
  slide_pages text,
  format_template_id uuid references public.format_templates(id) on delete set null,
  sort_order integer not null default 0,
  created_at timestamptz default now()
);

-- ============================================
-- 8. TRANSCRIPTS
-- Raw transcript storage (auto-purge after 30 days)
-- ============================================
create table public.transcripts (
  id uuid primary key default uuid_generate_v4(),
  meeting_id uuid references public.meetings(id) on delete cascade not null,
  content text not null,
  source text not null check (source in ('upload_docx', 'upload_vtt', 'whisper_stt', 'teams')),
  speaker_map jsonb default '{}',
  storage_path text,
  created_at timestamptz default now()
);

-- ============================================
-- 9. TRANSCRIPT SEGMENTS
-- Mapped transcript chunks assigned to agendas
-- ============================================
create table public.transcript_segments (
  id uuid primary key default uuid_generate_v4(),
  transcript_id uuid references public.transcripts(id) on delete cascade not null,
  agenda_id uuid references public.agendas(id) on delete cascade not null,
  content text not null,
  speaker text,
  start_offset integer,
  end_offset integer,
  sort_order integer not null default 0,
  created_at timestamptz default now()
);

-- ============================================
-- 10. MINUTES
-- AI-generated minutes per agenda
-- ============================================
create table public.minutes (
  id uuid primary key default uuid_generate_v4(),
  agenda_id uuid references public.agendas(id) on delete cascade not null,
  content text not null,
  confidence_data jsonb default '[]',
  prompt_1_output text,
  prompt_2_output text,
  is_current boolean default true,
  version integer default 1,
  generated_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================
-- 11. MINUTE VERSIONS
-- Version history for audit trail (immutable)
-- ============================================
create table public.minute_versions (
  id uuid primary key default uuid_generate_v4(),
  minute_id uuid references public.minutes(id) on delete cascade not null,
  content text not null,
  version integer not null,
  change_summary text,
  changed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now()
);

-- ============================================
-- 12. ACTION ITEMS
-- Extracted action items from minutes
-- ============================================
create table public.action_items (
  id uuid primary key default uuid_generate_v4(),
  agenda_id uuid references public.agendas(id) on delete cascade not null,
  meeting_id uuid references public.meetings(id) on delete cascade not null,
  description text not null,
  pic text,
  due_date date,
  sort_order integer not null default 0,
  created_at timestamptz default now()
);

-- ============================================
-- 13. MEDIA FILES
-- Track uploaded files in Supabase Storage
-- ============================================
create table public.media_files (
  id uuid primary key default uuid_generate_v4(),
  meeting_id uuid references public.meetings(id) on delete cascade not null,
  file_type text not null check (file_type in ('audio', 'video', 'slides_pdf', 'agenda_excel', 'transcript_docx')),
  storage_path text not null,
  original_name text not null,
  size_bytes bigint,
  is_purged boolean default false,
  purged_at timestamptz,
  created_at timestamptz default now()
);

-- ============================================
-- 14. AUDIT LOGS (IMMUTABLE)
-- Section 49 Companies Act 2016 compliance
-- ============================================
create table public.audit_logs (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid references public.organizations(id) on delete cascade not null,
  meeting_id uuid references public.meetings(id) on delete set null,
  user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  details jsonb default '{}',
  ip_address inet,
  created_at timestamptz default now()
);

-- Prevent updates/deletes on audit_logs
create or replace function public.prevent_audit_modification()
returns trigger as $$
begin
  raise exception 'Audit logs are immutable and cannot be modified or deleted';
end;
$$ language plpgsql;

create trigger audit_logs_immutable
  before update or delete on public.audit_logs
  for each row execute function public.prevent_audit_modification();

-- ============================================
-- INDEXES
-- ============================================
create index idx_profiles_org on public.profiles(organization_id);
create index idx_committees_org on public.committees(organization_id);
create index idx_meetings_org on public.meetings(organization_id);
create index idx_meetings_committee on public.meetings(committee_id);
create index idx_meetings_status on public.meetings(status);
create index idx_meetings_purge on public.meetings(purge_at) where purge_at is not null;
create index idx_agendas_meeting on public.agendas(meeting_id);
create index idx_transcripts_meeting on public.transcripts(meeting_id);
create index idx_segments_agenda on public.transcript_segments(agenda_id);
create index idx_segments_transcript on public.transcript_segments(transcript_id);
create index idx_minutes_agenda on public.minutes(agenda_id);
create index idx_minute_versions_minute on public.minute_versions(minute_id);
create index idx_action_items_meeting on public.action_items(meeting_id);
create index idx_action_items_agenda on public.action_items(agenda_id);
create index idx_media_meeting on public.media_files(meeting_id);
create index idx_media_purge on public.media_files(is_purged) where is_purged = false;
create index idx_audit_org on public.audit_logs(organization_id);
create index idx_audit_meeting on public.audit_logs(meeting_id);
create index idx_audit_created on public.audit_logs(created_at);

-- ============================================
-- AUTO-UPDATE updated_at TRIGGER
-- ============================================
create or replace function public.update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_updated_at before update on public.organizations for each row execute function public.update_updated_at();
create trigger set_updated_at before update on public.profiles for each row execute function public.update_updated_at();
create trigger set_updated_at before update on public.committees for each row execute function public.update_updated_at();
create trigger set_updated_at before update on public.meetings for each row execute function public.update_updated_at();
create trigger set_updated_at before update on public.minutes for each row execute function public.update_updated_at();

-- ============================================
-- AUTO-SET purge_at WHEN MEETING FINALIZED
-- ============================================
create or replace function public.set_purge_date()
returns trigger as $$
begin
  if new.status = 'finalized' and old.status != 'finalized' then
    new.finalized_at = now();
    new.purge_at = now() + interval '30 days';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger meeting_finalized before update on public.meetings for each row execute function public.set_purge_date();

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- Multi-tenant isolation by organization
-- ============================================
alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.committees enable row level security;
alter table public.glossary enable row level security;
alter table public.format_templates enable row level security;
alter table public.meetings enable row level security;
alter table public.agendas enable row level security;
alter table public.transcripts enable row level security;
alter table public.transcript_segments enable row level security;
alter table public.minutes enable row level security;
alter table public.minute_versions enable row level security;
alter table public.action_items enable row level security;
alter table public.media_files enable row level security;
alter table public.audit_logs enable row level security;

-- Helper: get current user's organization_id (in public schema)
create or replace function public.get_user_org_id()
returns uuid as $$
  select organization_id from public.profiles where id = auth.uid();
$$ language sql security definer stable;

-- ORGANIZATIONS: users can only see their own org
create policy "Users view own org" on public.organizations
  for select using (id = public.get_user_org_id());

-- PROFILES: users see profiles in their org
create policy "Users view org profiles" on public.profiles
  for select using (organization_id = public.get_user_org_id());
create policy "Users update own profile" on public.profiles
  for update using (id = auth.uid());

-- COMMITTEES: org-scoped
create policy "Org members view committees" on public.committees
  for select using (organization_id = public.get_user_org_id());
create policy "Admins manage committees" on public.committees
  for all using (
    organization_id = public.get_user_org_id()
    and exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- GLOSSARY: via committee org scope
create policy "Org members view glossary" on public.glossary
  for select using (
    exists (select 1 from public.committees c where c.id = committee_id and c.organization_id = public.get_user_org_id())
  );
create policy "CoSec manage glossary" on public.glossary
  for all using (
    exists (
      select 1 from public.committees c
      where c.id = committee_id and c.organization_id = public.get_user_org_id()
      and exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'cosec'))
    )
  );

-- FORMAT TEMPLATES: via committee org scope
create policy "Org members view templates" on public.format_templates
  for select using (
    exists (select 1 from public.committees c where c.id = committee_id and c.organization_id = public.get_user_org_id())
  );
create policy "CoSec manage templates" on public.format_templates
  for all using (
    exists (
      select 1 from public.committees c
      where c.id = committee_id and c.organization_id = public.get_user_org_id()
      and exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'cosec'))
    )
  );

-- MEETINGS: org-scoped
create policy "Org members view meetings" on public.meetings
  for select using (organization_id = public.get_user_org_id());
create policy "CoSec manage meetings" on public.meetings
  for all using (
    organization_id = public.get_user_org_id()
    and exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'cosec'))
  );

-- AGENDAS: via meeting org scope
create policy "Org members view agendas" on public.agendas
  for select using (
    exists (select 1 from public.meetings m where m.id = meeting_id and m.organization_id = public.get_user_org_id())
  );
create policy "CoSec manage agendas" on public.agendas
  for all using (
    exists (
      select 1 from public.meetings m where m.id = meeting_id and m.organization_id = public.get_user_org_id()
      and exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'cosec'))
    )
  );

-- TRANSCRIPTS: via meeting org scope
create policy "Org members view transcripts" on public.transcripts
  for select using (
    exists (select 1 from public.meetings m where m.id = meeting_id and m.organization_id = public.get_user_org_id())
  );
create policy "CoSec manage transcripts" on public.transcripts
  for all using (
    exists (
      select 1 from public.meetings m where m.id = meeting_id and m.organization_id = public.get_user_org_id()
      and exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'cosec'))
    )
  );

-- TRANSCRIPT SEGMENTS: via transcript -> meeting org scope
create policy "Org members view segments" on public.transcript_segments
  for select using (
    exists (
      select 1 from public.transcripts t
      join public.meetings m on m.id = t.meeting_id
      where t.id = transcript_id and m.organization_id = public.get_user_org_id()
    )
  );
create policy "CoSec manage segments" on public.transcript_segments
  for all using (
    exists (
      select 1 from public.transcripts t
      join public.meetings m on m.id = t.meeting_id
      where t.id = transcript_id and m.organization_id = public.get_user_org_id()
      and exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'cosec'))
    )
  );

-- MINUTES: via agenda -> meeting org scope
create policy "Org members view minutes" on public.minutes
  for select using (
    exists (
      select 1 from public.agendas a
      join public.meetings m on m.id = a.meeting_id
      where a.id = agenda_id and m.organization_id = public.get_user_org_id()
    )
  );
create policy "CoSec manage minutes" on public.minutes
  for all using (
    exists (
      select 1 from public.agendas a
      join public.meetings m on m.id = a.meeting_id
      where a.id = agenda_id and m.organization_id = public.get_user_org_id()
      and exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'cosec'))
    )
  );

-- MINUTE VERSIONS: via minute -> agenda -> meeting org scope
create policy "Org members view versions" on public.minute_versions
  for select using (
    exists (
      select 1 from public.minutes min
      join public.agendas a on a.id = min.agenda_id
      join public.meetings m on m.id = a.meeting_id
      where min.id = minute_id and m.organization_id = public.get_user_org_id()
    )
  );

-- ACTION ITEMS: via meeting org scope
create policy "Org members view action items" on public.action_items
  for select using (
    exists (select 1 from public.meetings m where m.id = meeting_id and m.organization_id = public.get_user_org_id())
  );
create policy "CoSec manage action items" on public.action_items
  for all using (
    exists (
      select 1 from public.meetings m where m.id = meeting_id and m.organization_id = public.get_user_org_id()
      and exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'cosec'))
    )
  );

-- MEDIA FILES: via meeting org scope
create policy "Org members view media" on public.media_files
  for select using (
    exists (select 1 from public.meetings m where m.id = meeting_id and m.organization_id = public.get_user_org_id())
  );
create policy "CoSec manage media" on public.media_files
  for all using (
    exists (
      select 1 from public.meetings m where m.id = meeting_id and m.organization_id = public.get_user_org_id()
      and exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'cosec'))
    )
  );

-- AUDIT LOGS: read-only for org members, insert by cosec/admin
create policy "Org members view audit logs" on public.audit_logs
  for select using (organization_id = public.get_user_org_id());
create policy "System insert audit logs" on public.audit_logs
  for insert with check (organization_id = public.get_user_org_id());
