-- 주유 기록(설계 docs/superpowers/specs/2026-10-21-fuel-and-grocery-compare-design.md 3-1).
-- 주유소 영수증에서 읽은 리터·리터당 단가·유종을 가계부 내역 하나에 하나씩 붙인다.
-- 날짜·금액·가게 이름은 따로 두지 않고 내역에서 읽는다(내역을 고치면 그대로 따라오고, 지우면 함께 지워진다).

create table public.fuel_fills (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  -- 주유 내역 (같은 가구 것만). 내역 하나에 주유 기록 하나
  transaction_id uuid not null unique,
  -- 주유량(리터)과 리터당 단가(원). 영수증에 적힌 값만 넣는다
  liters numeric(7, 3) not null check (liters > 0 and liters < 1000),
  price_per_liter integer not null check (price_per_liter > 0 and price_per_liter < 100000),
  -- 유종: 휘발유·경유·고급휘발유·LPG 등 영수증 표기 그대로
  fuel_type text check (fuel_type is null or char_length(fuel_type) between 1 and 20),
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  foreign key (transaction_id, household_id)
    references public.transactions (id, household_id) on delete cascade
);
create index fuel_fills_household_idx on public.fuel_fills (household_id);
create index fuel_fills_created_by_idx on public.fuel_fills (created_by);

alter table public.fuel_fills enable row level security;
create policy fuel_fills_all on public.fuel_fills
  for all to authenticated
  using ((select private.is_household_member(household_id)))
  with check ((select private.is_household_member(household_id)));
revoke all on public.fuel_fills from public, anon;
grant select, insert, update, delete on public.fuel_fills to authenticated;
grant select, insert, update, delete on public.fuel_fills to service_role;
