alter table public.events
  add column repeat_weeks smallint check (repeat_weeks in (1, 2)),
  add column repeat_until date,
  add column skipped_on date[] not null default '{}',
  add constraint events_repeat_check check (
    (repeat_weeks is not null or repeat_until is null)
    and (repeat_until is null or repeat_until >= date)
    and (repeat_weeks is null or end_on is null or end_on = date)
  ),
  add unique (id, household_id);

create function public.skip_event_occurrence(p_id uuid, p_date date)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.events
  set skipped_on = case when p_date = any(skipped_on) then skipped_on else array_append(skipped_on, p_date) end
  where id = p_id and repeat_weeks is not null and p_date >= date
    and (repeat_until is null or p_date <= repeat_until)
    and mod(p_date - date, 7 * repeat_weeks) = 0;
  if not found then raise exception 'event_occurrence_missing'; end if;
end;
$$;

revoke execute on function public.skip_event_occurrence(uuid, date) from public, anon;
grant execute on function public.skip_event_occurrence(uuid, date) to authenticated;
