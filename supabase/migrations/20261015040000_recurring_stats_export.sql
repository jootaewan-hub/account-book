-- 3단계: 고정지출·구독·관리비, 월별 통계, 정산 기록, 구글 시트 내보내기

-- ---------------------------------------------------------------------------
-- 반복 내역 (고정지출 / 구독 / 관리비·공과금)
-- amount가 null이면 매달 금액이 달라서(관리비 등) 자동으로 넣지 않고 "입력할 차례"로 알려 준다.
-- ---------------------------------------------------------------------------
create table public.recurring (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  kind text not null check (kind in ('fixed', 'subscription', 'utility')),
  type text not null default 'expense' check (type in ('expense', 'income')),
  title text not null check (char_length(title) between 1 and 60),
  amount bigint check (amount is null or (amount > 0 and amount < 10000000000)),
  day_of_month int not null check (day_of_month between 1 and 31),
  every_months int not null default 1 check (every_months in (1, 12)),
  category_id uuid,
  payment_method_id uuid,
  scope text not null default 'shared' check (scope in ('shared', 'husband', 'wife')),
  start_month date not null check (extract(day from start_month) = 1),
  end_month date check (end_month is null or end_month >= start_month),
  generated_through date, -- 자동 입력을 마친 마지막 달(1일). 지운 내역이 다시 생기지 않게 한다
  active boolean not null default true,
  memo text check (char_length(memo) <= 200),
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id),
  foreign key (category_id, household_id)
    references public.categories (id, household_id) on delete set null (category_id),
  foreign key (payment_method_id, household_id)
    references public.payment_methods (id, household_id) on delete set null (payment_method_id)
);
create index recurring_household_idx on public.recurring (household_id);
create index recurring_category_idx on public.recurring (category_id, household_id);
create index recurring_method_idx on public.recurring (payment_method_id, household_id);
create index recurring_created_by_idx on public.recurring (created_by);
create trigger recurring_touch_updated_at
before update on public.recurring
for each row execute function private.touch_updated_at();

alter table public.recurring enable row level security;
create policy recurring_all on public.recurring
  for all to authenticated
  using ((select private.is_household_member(household_id)))
  with check ((select private.is_household_member(household_id)));
grant select, insert, update, delete on public.recurring to authenticated;
grant select, insert, update, delete on public.recurring to service_role;

-- 반복 내역에서 만들어진 내역: 어느 반복의 몇 월 분인지
alter table public.transactions
  add column recurring_id uuid,
  add column recurring_month date;
alter table public.transactions
  add constraint transactions_recurring_fk foreign key (recurring_id, household_id)
    references public.recurring (id, household_id) on delete set null (recurring_id);
create unique index transactions_recurring_month_key
  on public.transactions (recurring_id, recurring_month) where recurring_id is not null;

-- 날짜가 지난 반복 내역을 자동으로 넣는다. 여러 기기가 동시에 불러도 한 번만 들어간다.
create function public.generate_recurring(p_household_id uuid, p_today date)
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
        insert into public.transactions (household_id, type, occurred_on, amount, title, category_id,
          payment_method_id, scope, source, recurring_id, recurring_month)
        values (r.household_id, r.type, due, r.amount, r.title, r.category_id,
          r.payment_method_id, r.scope, 'recurring', r.id, m)
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

-- ---------------------------------------------------------------------------
-- 월별 합계 (통계 그래프·전년 대비). RLS가 그대로 적용된다.
-- ---------------------------------------------------------------------------
create function public.monthly_totals(p_household_id uuid, p_from date, p_to date)
returns table (month date, type text, total bigint, n int)
language sql
stable
security invoker
set search_path = ''
as $$
  select date_trunc('month', t.occurred_on)::date, t.type, sum(t.amount)::bigint, count(*)::int
  from public.transactions t
  where t.household_id = p_household_id and t.occurred_on between p_from and p_to
  group by 1, 2
  order by 1, 2;
$$;
revoke execute on function public.monthly_totals(uuid, date, date) from public, anon;
grant execute on function public.monthly_totals(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 정산 완료 기록 (달마다 하나)
-- ---------------------------------------------------------------------------
create table public.settlements (
  household_id uuid not null references public.households (id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  from_role text check (from_role in ('husband', 'wife')),
  to_role text check (to_role in ('husband', 'wife')),
  amount bigint not null check (amount >= 0),
  settled_by uuid not null default auth.uid() references auth.users (id),
  settled_at timestamptz not null default now(),
  primary key (household_id, month)
);
create index settlements_settled_by_idx on public.settlements (settled_by);
alter table public.settlements enable row level security;
create policy settlements_all on public.settlements
  for all to authenticated
  using ((select private.is_household_member(household_id)))
  with check ((select private.is_household_member(household_id)));
grant select, insert, delete on public.settlements to authenticated;
grant select, insert, update, delete on public.settlements to service_role;

-- ---------------------------------------------------------------------------
-- 구글 시트 연동: 비밀 주소(토큰)로 내역을 CSV로 읽는다 (=IMPORTDATA)
-- 토큰 표는 API에 노출되지 않는 private 스키마에 두고, 아래 함수로만 다룬다.
-- ---------------------------------------------------------------------------
create table private.export_tokens (
  household_id uuid primary key references public.households (id) on delete cascade,
  token text not null unique check (char_length(token) >= 48),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);
create index export_tokens_created_by_idx on private.export_tokens (created_by);

-- 구성원만: 현재 토큰을 돌려주고, 없거나 p_rotate면 새로 만든다(이전 주소는 끊긴다)
create function public.export_token(p_household_id uuid, p_rotate boolean default false)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  tok text;
begin
  if not private.is_household_member(p_household_id) then
    raise exception 'not_member' using errcode = '42501';
  end if;
  if not p_rotate then
    select token into tok from private.export_tokens where household_id = p_household_id;
    if tok is not null then return tok; end if;
  end if;
  tok := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into private.export_tokens (household_id, token, created_by)
    values (p_household_id, tok, (select auth.uid()))
  on conflict (household_id) do update
    set token = excluded.token, created_by = excluded.created_by, created_at = now();
  return tok;
end;
$$;
revoke execute on function public.export_token(uuid, boolean) from public, anon;
grant execute on function public.export_token(uuid, boolean) to authenticated;

-- 토큰이 맞으면 그 가구의 내역을 돌려준다 (로그인 없이 Edge Function이 부른다)
create function public.export_rows(p_token text)
returns table (
  occurred_on date, occurred_at time, type text, amount bigint, title text, category text,
  method text, method_owner text, scope text, source text, entered_by text, memo text, items text
)
language sql
stable
security definer
set search_path = ''
as $$
  select t.occurred_on, t.occurred_at, t.type, t.amount, t.title, c.name, pm.name, pm.owner, t.scope, t.source,
    coalesce(case m.spouse_role when 'husband' then '남편' when 'wife' then '아내' end, m.display_name),
    t.memo,
    (select string_agg(i.name || case when i.quantity <> 1 then ' x' || trim(trailing '.' from trim(trailing '0' from i.quantity::text)) else '' end
                       || ' ' || i.amount, ', ' order by i.sort)
     from public.transaction_items i where i.transaction_id = t.id)
  from private.export_tokens e
  join public.transactions t on t.household_id = e.household_id
  left join public.categories c on c.id = t.category_id
  left join public.payment_methods pm on pm.id = t.payment_method_id
  left join public.members m on m.household_id = t.household_id and m.user_id = t.created_by
  where e.token = p_token and char_length(p_token) >= 48
  order by t.occurred_on, t.created_at;
$$;
revoke execute on function public.export_rows(text) from public;
grant execute on function public.export_rows(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 실시간 동기화
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.recurring, public.settlements;
  end if;
end;
$$;
