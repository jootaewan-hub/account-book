-- 6단계: 관리비 고지서. 사진에서 읽은 항목별 금액·사용량을 달마다 저장해 전월·전년 같은 달과 비교한다.

create table public.utility_bills (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  -- 몇 월분인지 (그 달 1일)
  bill_month date not null check (extract(day from bill_month) = 1),
  total bigint not null check (total >= 0 and total < 100000000),
  due_date date,
  -- [{name, amount, prev_month, last_year}] 항목별 금액(원). prev_month·last_year는 고지서에 적혀 있던 값
  charges jsonb not null default '[]'::jsonb check (jsonb_typeof(charges) = 'array' and pg_column_size(charges) < 20000),
  -- [{name, amount, unit, prev_month, last_year}] 세대 사용량 (전기·수도·온수·난방·가스)
  usages jsonb not null default '[]'::jsonb check (jsonb_typeof(usages) = 'array' and pg_column_size(usages) < 20000),
  -- 가계부에 넣은 지출 내역 (같은 가구 것만)
  transaction_id uuid,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, bill_month),
  foreign key (transaction_id, household_id)
    references public.transactions (id, household_id) on delete set null (transaction_id)
);
create index utility_bills_transaction_id_idx on public.utility_bills (transaction_id);
create index utility_bills_created_by_idx on public.utility_bills (created_by);
create trigger utility_bills_touch_updated_at
before update on public.utility_bills
for each row execute function private.touch_updated_at();

alter table public.utility_bills enable row level security;
create policy utility_bills_all on public.utility_bills
  for all to authenticated
  using ((select private.is_household_member(household_id)))
  with check ((select private.is_household_member(household_id)));
grant select, insert, update, delete on public.utility_bills to authenticated;
grant select, insert, update, delete on public.utility_bills to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.utility_bills;
  end if;
end;
$$;
