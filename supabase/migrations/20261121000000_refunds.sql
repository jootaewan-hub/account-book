-- 원결제는 그대로 두고, 금액·요청일·완료일이 다른 부분 환불을 여러 건 기록한다.
create table public.transaction_refunds (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null,
  household_id uuid not null,
  amount bigint not null check (amount > 0 and amount < 10000000000),
  requested_on date not null,
  refunded_on date check (refunded_on is null or refunded_on >= requested_on),
  foreign key (transaction_id, household_id)
    references public.transactions (id, household_id) on delete cascade
);
create index transaction_refunds_transaction_idx on public.transaction_refunds (transaction_id, household_id);

alter table public.transaction_refunds enable row level security;
create policy transaction_refunds_members on public.transaction_refunds
  for all to authenticated
  using ((select private.is_household_member(household_id)))
  with check ((select private.is_household_member(household_id)));
revoke all on public.transaction_refunds from public, anon, authenticated;
grant select, insert, delete on public.transaction_refunds to authenticated;
grant update (amount, requested_on, refunded_on) on public.transaction_refunds to authenticated;
grant select, insert, update, delete on public.transaction_refunds to service_role;
alter publication supabase_realtime add table public.transaction_refunds;

create function private.check_transaction_refund()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  purchase public.transactions;
  already_reserved bigint;
  today date := (now() at time zone 'Asia/Seoul')::date;
begin
  if tg_op = 'UPDATE' and (new.id, new.transaction_id, new.household_id)
    is distinct from (old.id, old.transaction_id, old.household_id) then
    raise exception '환불 기록의 원래 지출은 바꿀 수 없어요.';
  end if;

  -- 같은 지출에 환불을 동시에 기록하거나 결제 금액을 고칠 때 순서를 정한다.
  select t.* into purchase from public.transactions t
  where t.id = new.transaction_id and t.household_id = new.household_id
  for no key update;

  if not found or purchase.type <> 'expense' then
    raise exception '환불을 기록할 지출을 찾을 수 없어요.';
  end if;
  if new.requested_on < purchase.occurred_on or new.requested_on > today
    or (new.refunded_on is not null and new.refunded_on > today) then
    raise exception '환불 날짜는 결제일에서 오늘 사이로 입력해 주세요.';
  end if;

  select coalesce(sum(r.amount), 0) into already_reserved
  from public.transaction_refunds r
  where r.transaction_id = new.transaction_id and r.id <> new.id;
  if already_reserved + new.amount > purchase.amount then
    raise exception '대기 중인 금액과 완료 금액을 합쳐 결제 금액을 넘길 수 없어요.';
  end if;
  return new;
end;
$$;

create trigger transaction_refunds_check
before insert or update on public.transaction_refunds
for each row execute function private.check_transaction_refund();

create function private.check_purchase_with_refunds()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  reserved bigint;
  first_request date;
begin
  select coalesce(sum(r.amount), 0), min(r.requested_on) into reserved, first_request
  from public.transaction_refunds r where r.transaction_id = old.id;
  if reserved = 0 then return new; end if;

  if new.type <> 'expense' then
    raise exception '환불 기록이 있는 지출은 수입으로 바꿀 수 없어요.';
  end if;
  if new.amount < reserved then
    raise exception '결제 금액은 기록한 환불 금액의 합계보다 작을 수 없어요.';
  end if;
  if new.occurred_on > first_request then
    raise exception '결제일은 첫 환불 요청일보다 늦을 수 없어요.';
  end if;
  return new;
end;
$$;

create trigger transaction_purchase_refunds_check
before update of type, amount, occurred_on on public.transactions
for each row
when ((old.type, old.amount, old.occurred_on) is distinct from (new.type, new.amount, new.occurred_on))
execute function private.check_purchase_with_refunds();

-- 월별 지출은 완료된 환불만 원래 결제가 있던 달에서 차감한다.
create or replace function public.monthly_totals(p_household_id uuid, p_from date, p_to date)
returns table (month date, type text, total bigint, n int)
language sql
stable
security invoker
set search_path = ''
as $$
  select date_trunc('month', t.occurred_on)::date, t.type,
    sum(t.amount - coalesce((
      select sum(r.amount) from public.transaction_refunds r
      where r.transaction_id = t.id and r.refunded_on is not null
    ), 0))::bigint, count(*)::int
  from public.transactions t
  where t.household_id = p_household_id and t.occurred_on between p_from and p_to
  group by 1, 2
  order by 1, 2;
$$;

-- CSV 열과 원결제 금액은 유지하고 메모에 환불 기록을 함께 넣는다.
create or replace function public.export_rows_v2(p_token text)
returns table (
  occurred_on date, occurred_at time, type text, amount bigint, title text, platform text, category text,
  scope text, source text, entered_by text, memo text, items text
)
language sql
stable
security definer
set search_path = ''
as $$
  select t.occurred_on, t.occurred_at, t.type, t.amount, t.title, t.platform, c.name, t.scope, t.source,
    coalesce(case m.spouse_role when 'husband' then '남편' when 'wife' then '아내' end, m.display_name),
    case when refunds.summary is null then t.memo else concat_ws(' · ', nullif(t.memo, ''), refunds.summary,
      '순지출 ' || (t.amount - coalesce(refunds.confirmed, 0)) || '원') end,
    (select string_agg(
        i.name
        || case when i.quantity <> 1 then ' x' || private.num_text(i.quantity) else '' end
        || ' ' || i.amount
        || case when i.unit_price is not null and i.quantity <> 1 then ' (개당 ' || i.unit_price || ')' else '' end
        || case when i.pack_size > 0 and i.amount > 0 then
             ' (' || case when i.pack_unit in ('g', 'ml') then '100' || i.pack_unit else '1' || i.pack_unit end || '당 '
             || (select private.num_text(case when x >= 100 then round(x) else round(x, 1) end)
                 from (select i.amount / (i.quantity * i.pack_size)
                         * case when i.pack_unit in ('g', 'ml') then 100 else 1 end as x) u) || ')'
           else '' end,
        ', ' order by i.sort)
     from public.transaction_items i where i.transaction_id = t.id)
  from private.export_tokens e
  join public.transactions t on t.household_id = e.household_id
  left join public.categories c on c.id = t.category_id
  left join public.members m on m.household_id = t.household_id and m.user_id = t.created_by
  left join lateral (
    select string_agg(
      case when r.refunded_on is null then '환불 대기 ' || r.amount || '원 (요청 ' || to_char(r.requested_on, 'YYYY-MM-DD') || ')'
      else '환불 완료 ' || r.amount || '원 (요청 ' || to_char(r.requested_on, 'YYYY-MM-DD') || ', 완료 '
        || to_char(r.refunded_on, 'YYYY-MM-DD') || ')' end,
      ' · ' order by r.requested_on, r.id) as summary,
      sum(r.amount) filter (where r.refunded_on is not null) as confirmed
    from public.transaction_refunds r
    where r.transaction_id = t.id
  ) refunds on true
  where e.token = p_token and char_length(p_token) >= 48
  order by t.occurred_on, t.created_at, t.id;
$$;
