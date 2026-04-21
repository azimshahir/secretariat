alter table public.agendas
  add column if not exists content_revision integer not null default 1;

alter table public.minutes
  add column if not exists source_agenda_revision integer null;

alter table public.mom_generation_drafts
  add column if not exists source_agenda_revision integer null;

create or replace function public.reconcile_meeting_agendas_for_org(
  p_meeting_id uuid,
  p_organization_id uuid,
  p_column_config jsonb,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meeting_org_id uuid;
  v_agenda_locked_at timestamptz;
  v_inserted_count integer := 0;
  v_updated_count integer := 0;
  v_deleted_count integer := 0;
  v_invalid_id_count integer := 0;
  v_duplicate_id_count integer := 0;
begin
  if p_meeting_id is null then
    raise exception 'Meeting id is required';
  end if;

  if p_organization_id is null then
    raise exception 'Organization id is required';
  end if;

  if p_column_config is null or jsonb_typeof(p_column_config) <> 'array' then
    raise exception 'Column config must be a JSON array';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Agenda rows must be a JSON array';
  end if;

  select m.organization_id, m.agenda_locked_at
  into v_meeting_org_id, v_agenda_locked_at
  from public.meetings m
  where m.id = p_meeting_id
  for update;

  if v_meeting_org_id is null then
    raise exception 'Meeting not found';
  end if;

  if v_meeting_org_id <> p_organization_id then
    raise exception 'Not allowed to edit this meeting';
  end if;

  if v_agenda_locked_at is not null then
    raise exception 'Agenda is locked and confirmed. Reverse Agenda to edit it again.';
  end if;

  create temporary table tmp_reconcile_agenda_rows (
    id uuid null,
    agenda_no text not null,
    title text not null,
    planned_time text null,
    presenter text null,
    attached_pdf text null,
    custom_cells jsonb not null default '{}'::jsonb,
    sort_order integer not null
  ) on commit drop;

  insert into tmp_reconcile_agenda_rows (
    id,
    agenda_no,
    title,
    planned_time,
    presenter,
    attached_pdf,
    custom_cells,
    sort_order
  )
  select
    case
      when nullif(trim(row_data.id), '') is null then null
      else nullif(trim(row_data.id), '')::uuid
    end,
    coalesce(nullif(trim(row_data.agenda_no), ''), '0'),
    coalesce(row_data.title, ''),
    nullif(trim(coalesce(row_data.planned_time, '')), ''),
    nullif(trim(coalesce(row_data.presenter, '')), ''),
    row_data.attached_pdf,
    case
      when row_data.custom_cells is null or jsonb_typeof(row_data.custom_cells) <> 'object'
        then '{}'::jsonb
      else row_data.custom_cells
    end,
    row_data.sort_order
  from (
    select
      row_number() over () - 1 as sort_order,
      x.id,
      x."agendaNo" as agenda_no,
      x.title,
      x."plannedTime" as planned_time,
      x.presenter,
      x."attachedPdf" as attached_pdf,
      x."customCells" as custom_cells
    from jsonb_to_recordset(p_rows) as x(
      id text,
      "agendaNo" text,
      title text,
      "plannedTime" text,
      presenter text,
      "attachedPdf" text,
      "customCells" jsonb
    )
  ) as row_data;

  select count(*)
  into v_invalid_id_count
  from tmp_reconcile_agenda_rows incoming
  where incoming.id is not null
    and not exists (
      select 1
      from public.agendas existing
      where existing.id = incoming.id
        and existing.meeting_id = p_meeting_id
    );

  if v_invalid_id_count > 0 then
    raise exception 'One or more agenda rows do not belong to this meeting';
  end if;

  select count(*)
  into v_duplicate_id_count
  from (
    select incoming.id
    from tmp_reconcile_agenda_rows incoming
    where incoming.id is not null
    group by incoming.id
    having count(*) > 1
  ) duplicate_ids;

  if v_duplicate_id_count > 0 then
    raise exception 'Agenda payload contains duplicate row ids';
  end if;

  update public.meetings
  set agenda_column_config = p_column_config
  where id = p_meeting_id;

  update public.agendas existing
  set
    agenda_no = incoming.agenda_no,
    title = incoming.title,
    planned_time = incoming.planned_time,
    presenter = incoming.presenter,
    slide_pages = incoming.attached_pdf,
    custom_cells = incoming.custom_cells,
    sort_order = incoming.sort_order,
    content_revision = case
      when existing.agenda_no is distinct from incoming.agenda_no
        or existing.title is distinct from incoming.title
        or existing.planned_time is distinct from incoming.planned_time
        or existing.presenter is distinct from incoming.presenter
        or existing.slide_pages is distinct from incoming.attached_pdf
        or coalesce(existing.custom_cells, '{}'::jsonb) is distinct from incoming.custom_cells
        then existing.content_revision + 1
      else existing.content_revision
    end
  from tmp_reconcile_agenda_rows incoming
  where incoming.id is not null
    and existing.id = incoming.id
    and existing.meeting_id = p_meeting_id;

  get diagnostics v_updated_count = row_count;

  insert into public.agendas (
    meeting_id,
    agenda_no,
    title,
    planned_time,
    presenter,
    custom_cells,
    slide_pages,
    sort_order
  )
  select
    p_meeting_id,
    incoming.agenda_no,
    incoming.title,
    incoming.planned_time,
    incoming.presenter,
    incoming.custom_cells,
    incoming.attached_pdf,
    incoming.sort_order
  from tmp_reconcile_agenda_rows incoming
  where incoming.id is null;

  get diagnostics v_inserted_count = row_count;

  delete from public.agendas existing
  where existing.meeting_id = p_meeting_id
    and not exists (
      select 1
      from tmp_reconcile_agenda_rows incoming
      where incoming.id = existing.id
    );

  get diagnostics v_deleted_count = row_count;

  return jsonb_build_object(
    'inserted', v_inserted_count,
    'updated', v_updated_count,
    'deleted', v_deleted_count
  );
end;
$$;

revoke all on function public.reconcile_meeting_agendas_for_org(uuid, uuid, jsonb, jsonb) from public;
grant execute on function public.reconcile_meeting_agendas_for_org(uuid, uuid, jsonb, jsonb) to authenticated;
grant execute on function public.reconcile_meeting_agendas_for_org(uuid, uuid, jsonb, jsonb) to service_role;
