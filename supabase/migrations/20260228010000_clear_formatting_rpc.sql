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
        additional_info = null
    where meeting_id = p_meeting_id;

    get diagnostics v_affected_rows = row_count;
  exception
    when undefined_column then
      update public.agendas
      set format_template_id = null
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
        additional_info = null
    where id = p_agenda_id;

    get diagnostics v_affected_rows = row_count;
  exception
    when undefined_column then
      update public.agendas
      set format_template_id = null
      where id = p_agenda_id;

      get diagnostics v_affected_rows = row_count;
  end;

  return v_affected_rows;
end;
$$;

revoke all on function public.clear_agenda_formatting_for_org_member(uuid) from public;
grant execute on function public.clear_agenda_formatting_for_org_member(uuid) to authenticated;
