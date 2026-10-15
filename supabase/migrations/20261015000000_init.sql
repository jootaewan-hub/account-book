-- 우리집 가계부: 초기 스키마
-- 가구(household) 하나에 최대 2명. 모든 데이터는 가구 단위로 RLS로 보호한다.
-- 가구 생성과 참여는 security definer 함수(create_household, join_household)로만 한다.

-- ---------------------------------------------------------------------------
-- 초대 코드: 헷갈리는 글자(0/O, 1/I)를 뺀 32자 알파벳, 8자리
-- gen_random_uuid()의 완전 무작위 바이트(0~5, 9~10, 11)만 사용한다.
-- ---------------------------------------------------------------------------
create or replace function public.gen_invite_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  b bytea := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
  idx int[] := array[0, 1, 2, 3, 4, 5, 9, 10];
  code text := '';
  i int;
begin
  foreach i in array idx loop
    code := code || substr(alphabet, (get_byte(b, i) % 32) + 1, 1);
  end loop;
  return code;
end;
$$;

-- ---------------------------------------------------------------------------
-- 테이블
-- ---------------------------------------------------------------------------
create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null default '우리집' check (char_length(name) between 1 and 40),
  invite_code text not null unique default public.gen_invite_code(),
  share_ratio numeric(3, 2) not null default 0.50 check (share_ratio between 0 and 1),
  created_at timestamptz not null default now()
);
comment on column public.households.share_ratio is '공동 지출 중 첫 번째 멤버(owner)가 부담하는 비율';

create table public.members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 20),
  role text not null check (role in ('owner', 'partner')),
  created_at timestamptz not null default now(),
  primary key (household_id, user_id),
  unique (user_id),                -- 한 사람은 가구 하나에만
  unique (household_id, role)      -- 가구당 owner 1명, partner 1명
);

create table public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 30),
  kind text not null check (kind in ('card', 'account', 'cash', 'easypay')),
  last4 text check (last4 ~ '^[0-9]{4}$'),
  -- member: owner_user_id가 낸 돈 / shared: 공동 계좌·카드 / entered_by: 입력한 사람이 낸 돈(현금)
  owner_type text not null check (owner_type in ('member', 'shared', 'entered_by')),
  owner_user_id uuid,
  sort int not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id, household_id),
  check ((owner_type = 'member') = (owner_user_id is not null)),
  foreign key (household_id, owner_user_id) references public.members (household_id, user_id)
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  type text not null check (type in ('expense', 'income')),
  name text not null check (char_length(name) between 1 and 20),
  sort int not null default 0,
  archived boolean not null default false,
  unique (household_id, type, name),
  unique (id, household_id)
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  type text not null check (type in ('expense', 'income')),
  occurred_on date not null,
  occurred_at time,
  amount bigint not null check (amount > 0 and amount < 10000000000),
  title text not null default '' check (char_length(title) <= 60),
  memo text check (char_length(memo) <= 500),
  category_id uuid,
  payment_method_id uuid,
  -- shared: 공동 지출(수입) / member: scope_user_id 개인 지출(수입)
  scope text not null check (scope in ('shared', 'member')),
  scope_user_id uuid,
  source text not null default 'manual' check (source in ('manual', 'text', 'photo', 'recurring')),
  receipt_path text,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id),
  check ((scope = 'shared') = (scope_user_id is null)),
  foreign key (category_id, household_id)
    references public.categories (id, household_id) on delete set null (category_id),
  foreign key (payment_method_id, household_id)
    references public.payment_methods (id, household_id) on delete set null (payment_method_id),
  foreign key (household_id, scope_user_id) references public.members (household_id, user_id)
);
create index transactions_household_date_idx on public.transactions (household_id, occurred_on);

create table public.transaction_items (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null,
  household_id uuid not null,
  name text not null check (char_length(name) between 1 and 60),
  quantity numeric(10, 3) not null default 1 check (quantity > 0),
  unit_price bigint,
  amount bigint not null,
  sort int not null default 0,
  foreign key (transaction_id, household_id)
    references public.transactions (id, household_id) on delete cascade
);
create index transaction_items_tx_idx on public.transaction_items (transaction_id);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger transactions_touch_updated_at
before update on public.transactions
for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
create or replace function public.is_household_member(hh uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.members m
    where m.household_id = hh and m.user_id = (select auth.uid())
  );
$$;

alter table public.households enable row level security;
alter table public.members enable row level security;
alter table public.payment_methods enable row level security;
alter table public.categories enable row level security;
alter table public.transactions enable row level security;
alter table public.transaction_items enable row level security;

-- households: 조회와 이름·분담비율 변경만. 생성은 create_household로.
create policy households_select on public.households
  for select to authenticated using (public.is_household_member(id));
create policy households_update on public.households
  for update to authenticated
  using (public.is_household_member(id)) with check (public.is_household_member(id));

-- members: 같은 가구 조회, 본인 표시 이름만 변경. 추가는 함수로.
create policy members_select on public.members
  for select to authenticated using (public.is_household_member(household_id));
create policy members_update_self on public.members
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- 나머지: 같은 가구 멤버는 모두 읽고 쓴다.
create policy payment_methods_all on public.payment_methods
  for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

create policy categories_all on public.categories
  for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

create policy transactions_select on public.transactions
  for select to authenticated using (public.is_household_member(household_id));
create policy transactions_insert on public.transactions
  for insert to authenticated
  with check (public.is_household_member(household_id) and created_by = (select auth.uid()));
create policy transactions_update on public.transactions
  for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
create policy transactions_delete on public.transactions
  for delete to authenticated using (public.is_household_member(household_id));

create policy transaction_items_all on public.transaction_items
  for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

-- 권한: 로그인하지 않은 사용자(anon)는 아무것도 못 한다.
revoke all on public.households, public.members, public.payment_methods, public.categories,
  public.transactions, public.transaction_items from anon;
-- 가구는 이름·분담비율만, 멤버는 표시 이름만 수정 가능
revoke insert, update, delete on public.households from authenticated;
grant update (name, share_ratio) on public.households to authenticated;
revoke insert, update, delete on public.members from authenticated;
grant update (display_name) on public.members to authenticated;
-- 작성자는 바꿀 수 없다
revoke update on public.transactions from authenticated;
grant update (type, occurred_on, occurred_at, amount, title, memo, category_id, payment_method_id,
  scope, scope_user_id, source, receipt_path) on public.transactions to authenticated;

-- ---------------------------------------------------------------------------
-- 가구 생성 / 참여
-- ---------------------------------------------------------------------------
create or replace function public.create_household(p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  hh uuid;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if exists (select 1 from public.members where user_id = uid) then
    raise exception 'already_in_household' using errcode = 'P0001';
  end if;

  insert into public.households default values returning id into hh;
  insert into public.members (household_id, user_id, display_name, role)
    values (hh, uid, btrim(p_display_name), 'owner');

  insert into public.categories (household_id, type, name, sort)
  select hh, 'expense', n, o::int
  from unnest(array['식비','외식','카페','장보기','생활용품','교통','통신','보험',
                    '관리비','구독','의료','문화','쇼핑','경조사','기타']) with ordinality as t(n, o);
  insert into public.categories (household_id, type, name, sort)
  select hh, 'income', n, o::int
  from unnest(array['월급','부수입','용돈','기타']) with ordinality as t(n, o);

  insert into public.payment_methods (household_id, name, kind, owner_type, sort) values
    (hh, '생활비 통장', 'account', 'shared', 1),
    (hh, '현금', 'cash', 'entered_by', 2);

  return hh;
end;
$$;

create or replace function public.join_household(p_code text, p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  hh uuid;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if exists (select 1 from public.members where user_id = uid) then
    raise exception 'already_in_household' using errcode = 'P0001';
  end if;

  select id into hh from public.households
  where invite_code = upper(regexp_replace(p_code, '[^A-Za-z0-9]', '', 'g'))
  for update;
  if hh is null then
    raise exception 'invalid_code' using errcode = 'P0001';
  end if;
  if (select count(*) from public.members where household_id = hh) >= 2 then
    raise exception 'household_full' using errcode = 'P0001';
  end if;

  insert into public.members (household_id, user_id, display_name, role)
    values (hh, uid, btrim(p_display_name), 'partner');
  return hh;
end;
$$;

revoke execute on function public.create_household(text) from public, anon;
revoke execute on function public.join_household(text, text) from public, anon;
grant execute on function public.create_household(text) to authenticated;
grant execute on function public.join_household(text, text) to authenticated;
revoke execute on function public.gen_invite_code() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 실시간 동기화 (Supabase Realtime)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.transactions, public.transaction_items, public.payment_methods,
      public.categories, public.members, public.households;
  end if;
end;
$$;
