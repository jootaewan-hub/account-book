-- 가격 출처 넓히기(P3, D-013): 몰 상품 주소(컬리·홈플러스·로우차트)와 그 페이지 확인 기록, 참가격(한국소비자원) 판매점·상품·가격,
-- 품목 ↔ 참가격 상품 연결, 자주 가는 매장, 수집 잠금 id 3. grocery 스키마만 바꾼다(D-003).
-- 쓰기: shop_checks·tprice_*는 Edge Function(서비스 롤)만, shop_links·store_links·household_prefs는 가구 구성원(RLS).

-- 1. 가구가 고른 상품에 붙인 몰 주소. 출처마다 하나. 주소는 _shared/shops.ts가 정리한 모양만 받는다(쿠팡 주소는 로우차트 주소로 바꿔서).
create table grocery.shop_links (
  household_id uuid not null references public.households (id) on delete cascade,
  product_id uuid not null references grocery.products (id) on delete cascade,
  source text not null check (source in ('kurly', 'homeplus', 'lowchart')),
  source_id text not null check (char_length(source_id) between 1 and 60),
  url text not null check (url ~ '^https://(www\.kurly\.com/goods/[0-9]{1,20}|mfront\.homeplus\.co\.kr/item\?itemNo=[0-9]{1,20}&storeType=[A-Z]{1,10}|www\.lowchart\.com/[0-9]{1,20}-[0-9]{1,20})$'),
  added_by uuid default auth.uid(),
  added_at timestamptz not null default now(),
  -- 주소는 출처·출처 id에서 만든 것과 같아야 한다(_shared/shops.ts의 shopUrl과 같은 규칙). 확인 기록(shop_checks)은 출처·id로 가구들이 함께 쓰므로,
  -- 다른 주소를 그 id에 붙여 다른 가구가 보는 값을 오염시키지 못하게 한다. 함수도 저장된 url 대신 id로 주소를 다시 만든다.
  check (url = case source
    when 'kurly' then 'https://www.kurly.com/goods/' || source_id
    when 'homeplus' then 'https://mfront.homeplus.co.kr/item?itemNo=' || split_part(source_id, ':', 1) || '&storeType=' || split_part(source_id, ':', 2)
    when 'lowchart' then 'https://www.lowchart.com/' || source_id
  end),
  primary key (household_id, product_id, source),
  foreign key (household_id, added_by) references public.members (household_id, user_id) on delete set null (added_by)
);
create index shop_links_product_idx on grocery.shop_links (product_id);

alter table grocery.shop_links enable row level security;
create policy shop_links_select on grocery.shop_links
  for select to authenticated
  using ((select private.is_household_member(household_id)));
create policy shop_links_insert on grocery.shop_links
  for insert to authenticated
  with check ((select private.is_household_member(household_id)) and added_by = (select auth.uid()));
create policy shop_links_update on grocery.shop_links
  for update to authenticated
  using ((select private.is_household_member(household_id)))
  with check ((select private.is_household_member(household_id)) and added_by = (select auth.uid()));
create policy shop_links_delete on grocery.shop_links
  for delete to authenticated
  using ((select private.is_household_member(household_id)));
revoke all on grocery.shop_links from public, anon, authenticated;
grant select, insert, delete on grocery.shop_links to authenticated;
grant update (source_id, url, added_by, added_at) on grocery.shop_links to authenticated;
grant select, insert, update, delete on grocery.shop_links to service_role;

-- 2. 몰 페이지를 한 번 읽은 기록(출처·출처 id마다, 가구와 상관없음). 성공이면 이름·가격이 꼭 있다. 로우차트는 관측값도 남긴다.
create table grocery.shop_checks (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('kurly', 'homeplus', 'lowchart')),
  source_id text not null check (char_length(source_id) between 1 and 60),
  checked_at timestamptz not null default now(),
  checked_on date generated always as ((checked_at at time zone 'Asia/Seoul')::date) stored,
  ok boolean not null,
  error text,
  name text check (char_length(name) <= 200),
  price int check (price > 0),
  image_url text,
  rating numeric(2, 1),
  review_count int,
  size text check (char_length(size) <= 40),
  price_from date,
  obs_low int check (obs_low > 0),
  obs_high int check (obs_high > 0),
  obs_avg int check (obs_avg > 0),
  changed_on date,
  check (not ok or (name is not null and price is not null))
);
create index shop_checks_source_idx on grocery.shop_checks (source, source_id, checked_at desc);

alter table grocery.shop_checks enable row level security;
create policy shop_checks_read on grocery.shop_checks for select to authenticated using (true);
revoke all on grocery.shop_checks from public, anon, authenticated;
grant select on grocery.shop_checks to authenticated;
grant select, insert, update, delete on grocery.shop_checks to service_role;

-- 내 가구가 이 상품에 넣은 주소마다: 마지막 확인(상태)과 마지막 성공한 확인의 값. RLS(shop_links)를 따르므로 내 가구 것만.
create function grocery.shop_prices(p_product uuid)
returns table (
  source text, source_id text, url text, added_at timestamptz,
  checked_at timestamptz, ok boolean, error text,
  priced_at timestamptz, name text, price int, image_url text, rating numeric, review_count int, size text,
  price_from date, obs_low int, obs_high int, obs_avg int, changed_on date
)
language sql
stable
security invoker
set search_path = ''
as $$
  select l.source, l.source_id, l.url, l.added_at,
         c.checked_at, c.ok, c.error,
         k.checked_at, k.name, k.price, k.image_url, k.rating, k.review_count, k.size,
         k.price_from, k.obs_low, k.obs_high, k.obs_avg, k.changed_on
    from grocery.shop_links l
    left join lateral (
      select x.checked_at, x.ok, x.error from grocery.shop_checks x
       where x.source = l.source and x.source_id = l.source_id
       order by x.checked_at desc limit 1
    ) c on true
    left join lateral (
      select x.* from grocery.shop_checks x
       where x.source = l.source and x.source_id = l.source_id and x.ok
       order by x.checked_at desc limit 1
    ) k on true
   where l.product_id = p_product
   order by l.source
$$;
revoke execute on function grocery.shop_prices(uuid) from public, anon;
grant execute on function grocery.shop_prices(uuid) to authenticated;

-- 3. 참가격 판매점·상품·가격(공개 자료, 공공누리 1유형). tprice-sync(서비스 롤)가 쓴다. 가격은 (판매점, 상품, 조사일)마다 하나.
create table grocery.tprice_stores (
  entp_id text primary key check (entp_id ~ '^[0-9]{1,10}$'),
  name text not null check (char_length(name) <= 60),
  type_code text not null check (char_length(type_code) <= 4),
  area_code text not null check (char_length(area_code) <= 12),
  area_detail_code text not null check (char_length(area_detail_code) <= 12),
  road_addr text check (char_length(road_addr) <= 200),
  telno text check (char_length(telno) <= 30),
  fetched_at timestamptz not null default now()
);
create index tprice_stores_area_idx on grocery.tprice_stores (area_detail_code);

create table grocery.tprice_goods (
  good_id text primary key check (good_id ~ '^[0-9]{1,10}$'),
  name text not null check (char_length(name) <= 100),
  total_cnt numeric,
  total_div text check (char_length(total_div) <= 10),
  base_cnt numeric,
  unit_div text check (char_length(unit_div) <= 10),
  smlcls_code text check (char_length(smlcls_code) <= 12),
  detail text check (char_length(detail) <= 100),
  maker_code text check (char_length(maker_code) <= 20),
  fetched_at timestamptz not null default now()
);

create table grocery.tprice_prices (
  entp_id text not null references grocery.tprice_stores (entp_id) on delete cascade,
  good_id text not null references grocery.tprice_goods (good_id) on delete cascade,
  inspected_on date not null,
  price int not null check (price > 0),
  input_at timestamptz,
  dc boolean not null default false,
  plus_one boolean not null default false,
  dc_start date,
  dc_end date,
  fetched_at timestamptz not null default now(),
  primary key (entp_id, good_id, inspected_on)
);
create index tprice_prices_good_idx on grocery.tprice_prices (good_id, inspected_on desc);

alter table grocery.tprice_stores enable row level security;
alter table grocery.tprice_goods enable row level security;
alter table grocery.tprice_prices enable row level security;
create policy tprice_stores_read on grocery.tprice_stores for select to authenticated using (true);
create policy tprice_goods_read on grocery.tprice_goods for select to authenticated using (true);
create policy tprice_prices_read on grocery.tprice_prices for select to authenticated using (true);
revoke all on grocery.tprice_stores, grocery.tprice_goods, grocery.tprice_prices from public, anon, authenticated;
grant select on grocery.tprice_stores, grocery.tprice_goods, grocery.tprice_prices to authenticated;
grant select, insert, update, delete on grocery.tprice_stores, grocery.tprice_goods, grocery.tprice_prices to service_role;

-- 4. 품목(이름·규격 열쇠) ↔ 참가격 상품 연결. 사람이 고르고 가구가 기억한다(D-013 ①). product_choices와 같은 열쇠(grocery.name_key).
create table grocery.store_links (
  household_id uuid not null references public.households (id) on delete cascade,
  name_key text not null,
  good_id text not null references grocery.tprice_goods (good_id) on delete cascade,
  chosen_by uuid default auth.uid(),
  chosen_at timestamptz not null default now(),
  primary key (household_id, name_key),
  foreign key (household_id, chosen_by) references public.members (household_id, user_id) on delete set null (chosen_by)
);

alter table grocery.store_links enable row level security;
create policy store_links_select on grocery.store_links
  for select to authenticated
  using ((select private.is_household_member(household_id)));
create policy store_links_insert on grocery.store_links
  for insert to authenticated
  with check ((select private.is_household_member(household_id)) and chosen_by = (select auth.uid()));
create policy store_links_update on grocery.store_links
  for update to authenticated
  using ((select private.is_household_member(household_id)))
  with check ((select private.is_household_member(household_id)) and chosen_by = (select auth.uid()));
create policy store_links_delete on grocery.store_links
  for delete to authenticated
  using ((select private.is_household_member(household_id)));
revoke all on grocery.store_links from public, anon, authenticated;
grant select, insert, delete on grocery.store_links to authenticated;
grant update (good_id, chosen_by, chosen_at) on grocery.store_links to authenticated;
grant select, insert, update, delete on grocery.store_links to service_role;

-- 품목에 참가격 상품을 고른다(p_good이 null이면 푼다). RLS를 그대로 따른다(security invoker): 남의 품목이면 item_not_found.
create function grocery.choose_store_good(p_item uuid, p_good text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  it record;
begin
  select household_id, grocery.name_key(name, spec) as k into it from grocery.items where id = p_item;
  if not found then
    raise exception 'item_not_found' using errcode = 'P0002';
  end if;
  if p_good is null then
    delete from grocery.store_links where household_id = it.household_id and name_key = it.k;
    return;
  end if;
  insert into grocery.store_links (household_id, name_key, good_id, chosen_by, chosen_at)
  values (it.household_id, it.k, p_good, auth.uid(), now())
  on conflict (household_id, name_key)
  do update set good_id = excluded.good_id, chosen_by = excluded.chosen_by, chosen_at = excluded.chosen_at;
end;
$$;
revoke execute on function grocery.choose_store_good(uuid, text) from public, anon;
grant execute on function grocery.choose_store_good(uuid, text) to authenticated;

-- 그 품목에 고른 참가격 상품(없으면 빈 결과). RLS를 따른다.
create function grocery.item_store_link(p_item uuid)
returns table (good_id text, good_name text, chosen_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select g.good_id, g.name, l.chosen_at
    from grocery.items i
    join grocery.store_links l on l.household_id = i.household_id and l.name_key = grocery.name_key(i.name, i.spec)
    join grocery.tprice_goods g on g.good_id = l.good_id
   where i.id = p_item
$$;
revoke execute on function grocery.item_store_link(uuid) from public, anon;
grant execute on function grocery.item_store_link(uuid) to authenticated;

-- 5. 가구 설정: 자주 가는 참가격 판매점(entp_id 목록, 10곳까지). 비어 있으면 성남 판매점 전부를 본다.
create table grocery.household_prefs (
  household_id uuid primary key references public.households (id) on delete cascade,
  store_ids text[] not null default '{}' check (cardinality(store_ids) <= 10),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  foreign key (household_id, updated_by) references public.members (household_id, user_id) on delete set null (updated_by)
);

alter table grocery.household_prefs enable row level security;
create policy household_prefs_select on grocery.household_prefs
  for select to authenticated
  using ((select private.is_household_member(household_id)));
create policy household_prefs_insert on grocery.household_prefs
  for insert to authenticated
  with check ((select private.is_household_member(household_id)) and updated_by = (select auth.uid()));
create policy household_prefs_update on grocery.household_prefs
  for update to authenticated
  using ((select private.is_household_member(household_id)))
  with check ((select private.is_household_member(household_id)) and updated_by = (select auth.uid()));
revoke all on grocery.household_prefs from public, anon, authenticated;
grant select, insert on grocery.household_prefs to authenticated;
grant update (store_ids, updated_by, updated_at) on grocery.household_prefs to authenticated;
grant select, insert, update, delete on grocery.household_prefs to service_role;

-- 품목 상세의 "매장 가격(참가격)": 고른 참가격 상품을 성남 판매점(고른 매장이 있으면 그 매장만)마다 마지막 조사값과 함께.
-- 조사값이 없는 매장도 한 줄(null)로 돌려준다(화면이 "확인 못 함"으로 쓴다). 싼 순, 값 없는 매장은 뒤.
create function grocery.item_store_prices(p_item uuid)
returns table (
  good_id text, good_name text, entp_id text, entp_name text, type_code text,
  inspected_on date, price int, dc boolean, plus_one boolean, fetched_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with it as (
    select i.household_id, grocery.name_key(i.name, i.spec) as k from grocery.items i where i.id = p_item
  ),
  link as (
    select l.good_id from it join grocery.store_links l on l.household_id = it.household_id and l.name_key = it.k
  ),
  pref as (
    select p.store_ids from it join grocery.household_prefs p on p.household_id = it.household_id
     where cardinality(p.store_ids) > 0
  )
  select g.good_id, g.name, s.entp_id, s.name, s.type_code,
         p.inspected_on, p.price, p.dc, p.plus_one, p.fetched_at
    from link
    join grocery.tprice_goods g on g.good_id = link.good_id
    cross join grocery.tprice_stores s
    left join lateral (
      select x.inspected_on, x.price, x.dc, x.plus_one, x.fetched_at from grocery.tprice_prices x
       where x.entp_id = s.entp_id and x.good_id = g.good_id
       order by x.inspected_on desc limit 1
    ) p on true
   where s.area_detail_code in ('020918000', '020919000', '020925000')
     and (not exists (select 1 from pref) or exists (select 1 from pref where s.entp_id = any(pref.store_ids)))
   order by (p.inspected_on is null), p.price, s.name
$$;
revoke execute on function grocery.item_store_prices(uuid) from public, anon;
grant execute on function grocery.item_store_prices(uuid) to authenticated;

-- 6. 수집 잠금: 참가격 id 3, 하루 한 번 가격 다시 확인(price-recheck) id 4(식약처 1, 시세 2와 같은 방식).
alter table grocery.sync_lock drop constraint sync_lock_id_check;
alter table grocery.sync_lock add constraint sync_lock_id_check check (id in (1, 2, 3, 4));
insert into grocery.sync_lock (id, locked_at) values (3, '-infinity'), (4, '-infinity');
