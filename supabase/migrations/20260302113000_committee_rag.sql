-- Committee-level RAG documents (PDF-only) and chunk storage

create table if not exists public.committee_rag_documents (
  id uuid primary key default uuid_generate_v4(),
  committee_id uuid not null references public.committees(id) on delete cascade,
  category text not null,
  document_name text not null,
  file_name text not null,
  storage_path text not null unique,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.committee_rag_chunks (
  id uuid primary key default uuid_generate_v4(),
  document_id uuid not null references public.committee_rag_documents(id) on delete cascade,
  committee_id uuid not null references public.committees(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  created_at timestamptz not null default now(),
  unique (document_id, chunk_index)
);

create index if not exists idx_committee_rag_documents_committee
  on public.committee_rag_documents(committee_id);

create index if not exists idx_committee_rag_chunks_committee
  on public.committee_rag_chunks(committee_id);

create index if not exists idx_committee_rag_chunks_document
  on public.committee_rag_chunks(document_id);

alter table public.committee_rag_documents enable row level security;
alter table public.committee_rag_chunks enable row level security;

drop policy if exists "Org members view committee rag documents" on public.committee_rag_documents;
create policy "Org members view committee rag documents" on public.committee_rag_documents
  for select using (
    exists (
      select 1 from public.committees c
      where c.id = committee_id and c.organization_id = public.get_user_org_id()
    )
  );

drop policy if exists "CoSec manage committee rag documents" on public.committee_rag_documents;
create policy "CoSec manage committee rag documents" on public.committee_rag_documents
  for all using (
    exists (
      select 1 from public.committees c
      where c.id = committee_id and c.organization_id = public.get_user_org_id()
      and exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role in ('admin', 'cosec')
      )
    )
  )
  with check (
    exists (
      select 1 from public.committees c
      where c.id = committee_id and c.organization_id = public.get_user_org_id()
      and exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role in ('admin', 'cosec')
      )
    )
  );

drop policy if exists "Org members view committee rag chunks" on public.committee_rag_chunks;
create policy "Org members view committee rag chunks" on public.committee_rag_chunks
  for select using (
    exists (
      select 1 from public.committees c
      where c.id = committee_id and c.organization_id = public.get_user_org_id()
    )
  );

drop policy if exists "CoSec manage committee rag chunks" on public.committee_rag_chunks;
create policy "CoSec manage committee rag chunks" on public.committee_rag_chunks
  for all using (
    exists (
      select 1 from public.committees c
      where c.id = committee_id and c.organization_id = public.get_user_org_id()
      and exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role in ('admin', 'cosec')
      )
    )
  )
  with check (
    exists (
      select 1 from public.committees c
      where c.id = committee_id and c.organization_id = public.get_user_org_id()
      and exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role in ('admin', 'cosec')
      )
    )
  );

drop trigger if exists set_updated_at_committee_rag_documents on public.committee_rag_documents;
create trigger set_updated_at_committee_rag_documents
  before update on public.committee_rag_documents
  for each row execute function public.update_updated_at();
