-- 화면 캡처로 가격 넣기(P4, D-009): 가구가 올린 캡처에서 읽어 확인한 가격 줄. 다른 가격 표(다나와·몰 주소 확인)는 공용 캐시지만 캡처는 가구 것이라
-- 가구 RLS를 건다. 오늘 캡처한 같은 수량의 값은 "가장 싼 값" 후보가 된다(item_prices를 다시 정의). grocery 스키마만 바꾼다(D-003).

create table grocery.captured_quotes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  product_id uuid not null references grocery.products (id) on delete cascade,
  seller text not null check (char_length(seller) between 1 and 40),
  price int not null check (price > 0),
  qty int not null check (qty between 1 and 99),
  delivery int check (delivery >= 0),
  unit_price int check (unit_price > 0),
  unit_label text check (char_length(unit_label) <= 10),
  captured_at timestamptz not null default now(),
  captured_on date generated always as ((captured_at at time zone 'Asia/Seoul')::date) stored,
  captured_by uuid default auth.uid(),
  foreign key (household_id, captured_by) references public.members (household_id, user_id) on delete set null (captured_by)
);
create index captured_quotes_product_idx on grocery.captured_quotes (household_id, product_id, captured_on desc);

alter table grocery.captured_quotes enable row level security;
create policy captured_quotes_select on grocery.captured_quotes
  for select to authenticated
  using ((select private.is_household_member(household_id)));
create policy captured_quotes_insert on grocery.captured_quotes
  for insert to authenticated
  with check ((select private.is_household_member(household_id)) and captured_by = (select auth.uid()));
create policy captured_quotes_delete on grocery.captured_quotes
  for delete to authenticated
  using ((select private.is_household_member(household_id)));
revoke all on grocery.captured_quotes from public, anon, authenticated;
grant select, insert, delete on grocery.captured_quotes to authenticated;
grant select, insert, update, delete on grocery.captured_quotes to service_role;

-- 안 산 내 가구 품목마다: 오늘(한국 시간) 성공한 다나와 확인의 고른 수량 줄과, 오늘 내 가구가 캡처한 같은 수량의 값 중 최저가 하나.
-- 같은 값이면 판매처가 있는 줄이 먼저. 20261020010000의 정의에 캡처 값을 더했다(열은 그대로).
create or replace function grocery.item_prices()
returns table (item_id uuid, price int, seller text, source text, qty int, delivery int, checked_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct on (i.id) i.id, x.price, x.seller, x.source, x.qty, x.delivery, x.checked_at
    from grocery.items i
    join lateral (
      select q.price, q.seller, c.source, q.qty, q.delivery, c.checked_at
        from grocery.price_checks c
        join grocery.price_quotes q on q.check_id = c.id and q.qty = i.product_qty
       where c.product_id = i.product_id and c.ok
         and c.checked_on = (now() at time zone 'Asia/Seoul')::date
      union all
      select k.price, k.seller, 'capture'::text, k.qty, k.delivery, k.captured_at
        from grocery.captured_quotes k
       where k.product_id = i.product_id and k.household_id = i.household_id and k.qty = i.product_qty
         and k.captured_on = (now() at time zone 'Asia/Seoul')::date
    ) x on true
   where i.bought_at is null and i.product_id is not null
   order by i.id, x.price, (x.seller is null), x.checked_at desc
$$;
