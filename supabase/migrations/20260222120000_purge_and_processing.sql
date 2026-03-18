-- Processing and purge extensions for secretariat.my

alter table public.media_files
  add column if not exists parsed_text_path text;

create or replace function public.purge_expired_meeting_data()
returns void as $$
declare
  rec record;
begin
  for rec in
    select id, organization_id
    from public.meetings
    where status = 'finalized'
      and purge_at is not null
      and purge_at <= now()
  loop
    delete from public.transcript_segments
    where transcript_id in (
      select id from public.transcripts where meeting_id = rec.id
    );

    delete from public.transcripts
    where meeting_id = rec.id;

    update public.media_files
    set is_purged = true,
        purged_at = now()
    where meeting_id = rec.id
      and is_purged = false;

    insert into public.audit_logs (organization_id, meeting_id, action, details)
    values (
      rec.organization_id,
      rec.id,
      'auto_purge_completed',
      jsonb_build_object('trigger', 'pg_cron', 'purged_at', now())
    );
  end loop;
end;
$$ language plpgsql security definer;

-- Requires pg_cron enabled in Supabase project
create extension if not exists pg_cron;

do $outer$
begin
  if not exists (
    select 1 from cron.job where jobname = 'secretariat-my-purge-expired'
  ) then
    perform cron.schedule(
      'secretariat-my-purge-expired',
      '0 3 * * *',
      $$select public.purge_expired_meeting_data();$$
    );
  end if;
end;
$outer$;
