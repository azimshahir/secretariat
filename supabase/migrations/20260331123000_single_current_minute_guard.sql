with ranked_current_minutes as (
  select
    id,
    row_number() over (
      partition by agenda_id
      order by updated_at desc nulls last, generated_at desc nulls last, id desc
    ) as row_rank
  from public.minutes
  where is_current = true
)
update public.minutes minute
set is_current = false
from ranked_current_minutes ranked
where minute.id = ranked.id
  and ranked.row_rank > 1;

create unique index if not exists idx_minutes_unique_current_agenda
  on public.minutes(agenda_id)
  where is_current = true;
