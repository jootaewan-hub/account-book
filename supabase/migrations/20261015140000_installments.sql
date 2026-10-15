-- 8단계: 할부. 할부로 산 물건은 첫 회차를 산 날 내역으로 넣고, 남은 회차는 반복 항목(kind 'installment')으로 두어
-- 날짜가 되면 generate_recurring이 매달 넣는다. 자동으로 넣는 내역의 메모에 "할부 2/3회"처럼 회차를 적는다.

alter table public.recurring drop constraint recurring_kind_check;
alter table public.recurring
  add constraint recurring_kind_check check (kind in ('fixed', 'subscription', 'utility', 'installment'));

-- 총 할부 개월 수. end_month가 마지막 회차의 달이라 회차 = 총 개월 수 - (마지막 달까지 남은 달 수)
alter table public.recurring
  add column installment_months smallint check (installment_months is null or installment_months between 2 and 60);
alter table public.recurring
  add constraint recurring_installment_check
  check ((kind = 'installment') = (installment_months is not null and end_month is not null));

create or replace function public.generate_recurring(p_household_id uuid, p_today date)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r record;
  m date;
  due date;
  last_month date := date_trunc('month', p_today)::date;
  done date;
  n int := 0;
begin
  for r in
    select * from public.recurring
    where household_id = p_household_id and active and amount is not null
    for update
  loop
    m := greatest(r.start_month, coalesce((r.generated_through + interval '1 month')::date, r.start_month),
                  (last_month - interval '12 months')::date);
    done := r.generated_through;
    while m <= last_month and (r.end_month is null or m <= r.end_month) loop
      due := m + (least(r.day_of_month, extract(day from (m + interval '1 month - 1 day'))::int) - 1);
      exit when due > p_today;
      if ((extract(year from m) - extract(year from r.start_month)) * 12
          + extract(month from m) - extract(month from r.start_month))::int % r.every_months = 0 then
        insert into public.transactions (household_id, type, occurred_on, amount, title, memo, category_id,
          payment_method_id, scope, source, recurring_id, recurring_month)
        values (r.household_id, r.type, due, r.amount, r.title,
          case when r.kind = 'installment' then format('할부 %s/%s회', r.installment_months
            - ((extract(year from r.end_month) - extract(year from m)) * 12
               + extract(month from r.end_month) - extract(month from m))::int, r.installment_months) end,
          r.category_id, r.payment_method_id, r.scope, 'recurring', r.id, m)
        on conflict (recurring_id, recurring_month) where recurring_id is not null do nothing;
        if found then n := n + 1; end if;
      end if;
      done := m;
      m := (m + interval '1 month')::date;
    end loop;
    if done is distinct from r.generated_through then
      update public.recurring set generated_through = done where id = r.id;
    end if;
  end loop;
  return n;
end;
$$;
revoke execute on function public.generate_recurring(uuid, date) from public, anon;
grant execute on function public.generate_recurring(uuid, date) to authenticated;
