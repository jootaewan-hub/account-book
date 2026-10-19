-- 농수산물 시세(계획 ③ P5, D-012): 공공데이터포털 15156057 일별 소매 조사값을 쌓고, 화면이 읽는 함수를 둔다.
-- grocery 스키마만 바꾼다(D-003). 쓰기는 market-sync(서비스 롤)만 한다. 조사값은 공개 자료라 로그인한 사용자는 모두 읽는다.
-- 숫자는 조사값(price) 그대로만 돌려준다. 평균·비율은 계산하지 않는다(D-012). 최저·최고·조사처 수는 그날 조사값에서 고른 것이다.

-- 조사값 한 줄: 품목·품종·등급·시군구·시장·조사일마다 하나. 축산물(전국, 1000)은 시장이 없어 mrkt_cd = ''.
-- 시군구는 성남(3112)·수원(3111)·서울(1101)·전국(1000)만 받는다(supabase/functions/_shared/market.ts의 KEEP_SGG).
create table grocery.price_points (
  item_cd text not null check (item_cd ~ '^[0-9]{3,4}$'),
  vrty_cd text not null check (char_length(vrty_cd) <= 8),
  grd_cd text not null check (char_length(grd_cd) <= 8),
  sgg_cd text not null check (sgg_cd in ('3112', '3111', '1101', '1000')),
  mrkt_cd text not null check (char_length(mrkt_cd) <= 12),
  exmn_ymd date not null,
  ctgry_cd text not null check (ctgry_cd ~ '^[0-9]{3}$'),
  item_nm text not null check (char_length(item_nm) <= 60),
  vrty_nm text not null check (char_length(vrty_nm) <= 60),
  grd_nm text not null check (char_length(grd_nm) <= 60),
  sgg_nm text not null check (char_length(sgg_nm) <= 30),
  mrkt_nm text not null check (char_length(mrkt_nm) <= 60),
  unit text not null check (char_length(unit) <= 20),
  unit_sz text not null check (char_length(unit_sz) <= 20),
  price int not null check (price > 0),
  orgnl_reg_dt timestamptz,
  fetched_at timestamptz not null default now(),
  primary key (item_cd, vrty_cd, grd_cd, sgg_cd, mrkt_cd, exmn_ymd)
);
create index price_points_series_idx on grocery.price_points (item_cd, vrty_cd, grd_cd, exmn_ymd desc);

alter table grocery.price_points enable row level security;
create policy price_points_read on grocery.price_points for select to authenticated using (true);
revoke all on grocery.price_points from public, anon, authenticated;
grant select on grocery.price_points to authenticated;
grant select, insert, update, delete on grocery.price_points to service_role;

-- 지켜보는 품목(가구마다). 품목·품종·등급 하나가 시세 화면의 한 줄이다.
create table grocery.watch (
  household_id uuid not null references public.households (id) on delete cascade,
  item_cd text not null check (item_cd ~ '^[0-9]{3,4}$'),
  vrty_cd text not null check (char_length(vrty_cd) <= 8),
  grd_cd text not null check (char_length(grd_cd) <= 8),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (household_id, item_cd, vrty_cd, grd_cd),
  foreign key (household_id, created_by) references public.members (household_id, user_id) on delete set null (created_by)
);

alter table grocery.watch enable row level security;
create policy watch_select on grocery.watch
  for select to authenticated
  using ((select private.is_household_member(household_id)));
create policy watch_insert on grocery.watch
  for insert to authenticated
  with check ((select private.is_household_member(household_id)) and created_by = (select auth.uid()));
create policy watch_delete on grocery.watch
  for delete to authenticated
  using ((select private.is_household_member(household_id)));
revoke all on grocery.watch from public, anon, authenticated;
grant select, insert, delete on grocery.watch to authenticated;
grant select, insert, update, delete on grocery.watch to service_role;

-- 시세 수집 잠금: 식약처(id 1)와 따로 id 2를 쓴다(20261019010000과 같은 방식).
alter table grocery.sync_lock drop constraint sync_lock_id_check;
alter table grocery.sync_lock add constraint sync_lock_id_check check (id in (1, 2));
insert into grocery.sync_lock (id, locked_at) values (2, '-infinity');

-- 큰 숫자로 쓸 조사처의 순서(작을수록 먼저). market.ts의 marketPriority와 같다(tests/grocery/marketDb.test.ts가 맞춰 본다).
create function grocery.market_priority(p_sgg text, p_mrkt text)
returns int
language sql
immutable
set search_path = ''
as $$
  select case
    when p_sgg = '1000' then 0
    when p_sgg = '3112' then case when p_mrkt = '0310407' then 1 else 2 end
    when p_sgg = '3111' then 3
    when p_sgg = '1101' then 4
    else 9
  end
$$;

-- 시세판: 최근 60일 안에 값이 있는 품목·품종·등급마다 한 줄.
--   조사처: 그 품목의 마지막 조사일부터 14일 안에 값이 있는 조사처 중 순서가 가장 앞선 곳(같으면 시장코드 순).
--   cur: 그 조사처의 마지막 값. prev: 바로 앞 조사일. w1: 7~21일 전 중 가장 늦은 날. m1: 30~45일 전. y1: 365~379일 전.
--   비교 값은 같은 조사처·같은 단위의 조사값이다.
--   low·high·markets: cur 날 같은 단위로 조사한 성남·수원·서울 조사처들의 최저·최고와 그 수(축산물 전국 값은 넣지 않는다).
--   first_on·days: 그 조사처의 쌓인 첫날과 최근 45일 안의 조사일 수.
create function grocery.market_board()
returns table (
  item_cd text, vrty_cd text, grd_cd text, ctgry_cd text,
  item_nm text, vrty_nm text, grd_nm text, unit text, unit_sz text,
  sgg_cd text, sgg_nm text, mrkt_cd text, mrkt_nm text,
  cur_on date, cur_price int,
  prev_on date, prev_price int,
  w1_on date, w1_price int,
  m1_on date, m1_price int,
  y1_on date, y1_price int,
  low int, high int, markets int,
  first_on date, days int, fetched_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with last as (
    select p.item_cd, p.vrty_cd, p.grd_cd, max(p.exmn_ymd) as last_on
      from grocery.price_points p
     where p.exmn_ymd >= (now() at time zone 'Asia/Seoul')::date - 60
     group by p.item_cd, p.vrty_cd, p.grd_cd
  ),
  pick as (
    select distinct on (l.item_cd, l.vrty_cd, l.grd_cd) l.item_cd, l.vrty_cd, l.grd_cd, p.sgg_cd, p.mrkt_cd
      from last l
      join grocery.price_points p
        on p.item_cd = l.item_cd and p.vrty_cd = l.vrty_cd and p.grd_cd = l.grd_cd
       and p.exmn_ymd between l.last_on - 14 and l.last_on
     order by l.item_cd, l.vrty_cd, l.grd_cd, grocery.market_priority(p.sgg_cd, p.mrkt_cd), p.mrkt_cd
  ),
  cur as (
    select distinct on (k.item_cd, k.vrty_cd, k.grd_cd) p.*
      from pick k
      join grocery.price_points p
        on p.item_cd = k.item_cd and p.vrty_cd = k.vrty_cd and p.grd_cd = k.grd_cd
       and p.sgg_cd = k.sgg_cd and p.mrkt_cd = k.mrkt_cd
     order by k.item_cd, k.vrty_cd, k.grd_cd, p.exmn_ymd desc
  )
  select c.item_cd, c.vrty_cd, c.grd_cd, c.ctgry_cd,
         c.item_nm, c.vrty_nm, c.grd_nm, c.unit, c.unit_sz,
         c.sgg_cd, c.sgg_nm, c.mrkt_cd, c.mrkt_nm,
         c.exmn_ymd, c.price,
         prev.exmn_ymd, prev.price,
         w1.exmn_ymd, w1.price,
         m1.exmn_ymd, m1.price,
         y1.exmn_ymd, y1.price,
         rng.low, rng.high, rng.markets,
         rec.first_on, rec.days, c.fetched_at
    from cur c
    left join lateral (
      select q.exmn_ymd, q.price from grocery.price_points q
       where q.item_cd = c.item_cd and q.vrty_cd = c.vrty_cd and q.grd_cd = c.grd_cd
         and q.sgg_cd = c.sgg_cd and q.mrkt_cd = c.mrkt_cd and q.unit = c.unit and q.unit_sz = c.unit_sz
         and q.exmn_ymd < c.exmn_ymd
       order by q.exmn_ymd desc limit 1
    ) prev on true
    left join lateral (
      select q.exmn_ymd, q.price from grocery.price_points q
       where q.item_cd = c.item_cd and q.vrty_cd = c.vrty_cd and q.grd_cd = c.grd_cd
         and q.sgg_cd = c.sgg_cd and q.mrkt_cd = c.mrkt_cd and q.unit = c.unit and q.unit_sz = c.unit_sz
         and q.exmn_ymd between c.exmn_ymd - 21 and c.exmn_ymd - 7
       order by q.exmn_ymd desc limit 1
    ) w1 on true
    left join lateral (
      select q.exmn_ymd, q.price from grocery.price_points q
       where q.item_cd = c.item_cd and q.vrty_cd = c.vrty_cd and q.grd_cd = c.grd_cd
         and q.sgg_cd = c.sgg_cd and q.mrkt_cd = c.mrkt_cd and q.unit = c.unit and q.unit_sz = c.unit_sz
         and q.exmn_ymd between c.exmn_ymd - 45 and c.exmn_ymd - 30
       order by q.exmn_ymd desc limit 1
    ) m1 on true
    left join lateral (
      select q.exmn_ymd, q.price from grocery.price_points q
       where q.item_cd = c.item_cd and q.vrty_cd = c.vrty_cd and q.grd_cd = c.grd_cd
         and q.sgg_cd = c.sgg_cd and q.mrkt_cd = c.mrkt_cd and q.unit = c.unit and q.unit_sz = c.unit_sz
         and q.exmn_ymd between c.exmn_ymd - 379 and c.exmn_ymd - 365
       order by q.exmn_ymd desc limit 1
    ) y1 on true
    left join lateral (
      select min(r.price) as low, max(r.price) as high, count(*)::int as markets
        from grocery.price_points r
       where r.item_cd = c.item_cd and r.vrty_cd = c.vrty_cd and r.grd_cd = c.grd_cd
         and r.exmn_ymd = c.exmn_ymd and r.sgg_cd <> '1000' and r.unit = c.unit and r.unit_sz = c.unit_sz
    ) rng on true
    left join lateral (
      select min(q.exmn_ymd) as first_on,
             (count(*) filter (where q.exmn_ymd > c.exmn_ymd - 45))::int as days
        from grocery.price_points q
       where q.item_cd = c.item_cd and q.vrty_cd = c.vrty_cd and q.grd_cd = c.grd_cd
         and q.sgg_cd = c.sgg_cd and q.mrkt_cd = c.mrkt_cd
    ) rec on true
   order by c.item_cd, c.vrty_cd, c.grd_cd
$$;

-- 추이: 한 조사처의 마지막 조사일부터 p_days일 안의 날마다 그 조사처 값과 성남·수원·서울 조사처들의 최저·최고·수.
-- 단위는 그 조사처의 마지막 값과 같은 것만.
create function grocery.market_trend(p_item text, p_vrty text, p_grd text, p_sgg text, p_mrkt text, p_days int default 45)
returns table (exmn_ymd date, price int, low int, high int, markets int)
language sql
stable
security invoker
set search_path = ''
as $$
  with last as (
    select p.exmn_ymd, p.unit, p.unit_sz from grocery.price_points p
     where p.item_cd = p_item and p.vrty_cd = p_vrty and p.grd_cd = p_grd and p.sgg_cd = p_sgg and p.mrkt_cd = p_mrkt
     order by p.exmn_ymd desc limit 1
  )
  select d.exmn_ymd,
         max(d.price) filter (where d.sgg_cd = p_sgg and d.mrkt_cd = p_mrkt),
         min(d.price) filter (where d.sgg_cd <> '1000'),
         max(d.price) filter (where d.sgg_cd <> '1000'),
         (count(*) filter (where d.sgg_cd <> '1000'))::int
    from grocery.price_points d, last l
   where d.item_cd = p_item and d.vrty_cd = p_vrty and d.grd_cd = p_grd
     and d.unit = l.unit and d.unit_sz = l.unit_sz
     and d.exmn_ymd > l.exmn_ymd - least(greatest(p_days, 1), 400)
     and d.exmn_ymd <= l.exmn_ymd
   group by d.exmn_ymd
   order by d.exmn_ymd
$$;

-- 수집 함수가 받을 범위를 정할 때 쓴다: 품목 코드 중 기간 안에 값이 하나라도 있는 것(서비스 롤만)
create function grocery.market_covered(p_items text[], p_from date, p_to date)
returns table (item_cd text)
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct p.item_cd from grocery.price_points p
   where p.item_cd = any(p_items) and p.exmn_ymd between p_from and p_to
$$;

revoke execute on function grocery.market_covered(text[], date, date) from public, anon, authenticated;
grant execute on function grocery.market_covered(text[], date, date) to service_role;
revoke execute on function grocery.market_priority(text, text) from public, anon;
grant execute on function grocery.market_priority(text, text) to authenticated, service_role;
revoke execute on function grocery.market_board() from public, anon;
grant execute on function grocery.market_board() to authenticated;
revoke execute on function grocery.market_trend(text, text, text, text, text, int) from public, anon;
grant execute on function grocery.market_trend(text, text, text, text, text, int) to authenticated;
