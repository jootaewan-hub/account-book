-- 가계부 기록 → "우리가 산 값"(P2, 통합 설계 6-2, D-011): 품목에 연결된 내역·"맞아요"로 확인한 기록·이름이 비슷한 기록을 읽는 함수와,
-- "맞아요/아니에요" 판정 표. grocery 스키마만 바꾼다(D-003): 가계부 transactions·transaction_items는 RLS 아래에서 읽기만 한다.
-- 과거 값이라 "가장 싼 값"에는 넣지 않는다(화면 설계 4절). 화면이 계산한다.

-- 1. 판정: 품목(이름·규격 열쇠)과 가계부 품목 줄이 같은 상품인지. 가계부 줄이 지워지면 함께 지워진다.
create table grocery.purchase_verdicts (
  household_id uuid not null references public.households (id) on delete cascade,
  name_key text not null,
  transaction_item_id uuid not null references public.transaction_items (id) on delete cascade,
  same boolean not null,
  decided_by uuid default auth.uid(),
  decided_at timestamptz not null default now(),
  primary key (household_id, name_key, transaction_item_id),
  foreign key (household_id, decided_by) references public.members (household_id, user_id) on delete set null (decided_by)
);
create index purchase_verdicts_item_idx on grocery.purchase_verdicts (transaction_item_id);

alter table grocery.purchase_verdicts enable row level security;
create policy purchase_verdicts_select on grocery.purchase_verdicts
  for select to authenticated
  using ((select private.is_household_member(household_id)));
create policy purchase_verdicts_insert on grocery.purchase_verdicts
  for insert to authenticated
  with check ((select private.is_household_member(household_id)) and decided_by = (select auth.uid()));
create policy purchase_verdicts_update on grocery.purchase_verdicts
  for update to authenticated
  using ((select private.is_household_member(household_id)))
  with check ((select private.is_household_member(household_id)) and decided_by = (select auth.uid()));
revoke all on grocery.purchase_verdicts from public, anon, authenticated;
grant select, insert on grocery.purchase_verdicts to authenticated;
grant update (same, decided_by, decided_at) on grocery.purchase_verdicts to authenticated;
grant select, insert, update, delete on grocery.purchase_verdicts to service_role;

-- 품목과 가계부 품목 줄이 같은 상품인지 적는다(바꿀 수 있다). RLS를 따른다: 남의 품목이면 item_not_found, 안 보이는 줄이면 tx_item_not_found.
create function grocery.decide_purchase(p_item uuid, p_tx_item uuid, p_same boolean)
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
  if not exists (select 1 from public.transaction_items ti where ti.id = p_tx_item and ti.household_id = it.household_id) then
    raise exception 'tx_item_not_found' using errcode = 'P0002';
  end if;
  insert into grocery.purchase_verdicts (household_id, name_key, transaction_item_id, same, decided_by, decided_at)
  values (it.household_id, it.k, p_tx_item, p_same, auth.uid(), now())
  on conflict (household_id, name_key, transaction_item_id)
  do update set same = excluded.same, decided_by = excluded.decided_by, decided_at = excluded.decided_at;
end;
$$;
revoke execute on function grocery.decide_purchase(uuid, uuid, boolean) from public, anon;
grant execute on function grocery.decide_purchase(uuid, uuid, boolean) to authenticated;

-- 2. 이름을 단어로 나눈다. grocery._alert_hits(20261020010000)의 규칙과 같다: 소문자, 한글·영문·숫자·점만, 두 글자 이상,
--    수량·단위 토큰과 광고 단어는 뺀다. (_alert_hits는 그대로 두었다. 규칙을 바꾸면 양쪽을 함께 바꾼다.)
create function grocery.name_tokens(p_name text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array(
    select replace(t, '.', '') from (
      select regexp_replace(lower(w), '[^가-힣a-z0-9.]', '', 'g') as t
      from regexp_split_to_table(coalesce(p_name, ''), '\s+') as w
    ) s
    where char_length(replace(t, '.', '')) >= 2
      and t !~ '^x?[0-9.]+(g|kg|mg|ml|l|구|개입|개|포기|단|마리|팩|봉|병|캔|장|롤|모|판|망|근|입|ea)?$'
      and replace(t, '.', '') not in
        ('무료배송', '당일배송', '특가', '행사', '기획', '증정', '세트', '묶음', '정품', '최저가', '할인', '대용량')
  ), '{}'::text[])
$$;
revoke execute on function grocery.name_tokens(text) from public, anon;
grant execute on function grocery.name_tokens(text) to authenticated, service_role;

-- 3. 우리가 산 값. kind: linked(품목에 연결된 내역, 줄이 여럿이면 이름이 가장 잘 맞는 줄, 줄이 없으면 총액만 있는 내역 한 줄),
--    confirmed("맞아요"), similar(최근 365일 가계부 품목 줄 중 이름 단어가 맞는 것, "아니에요"·이미 linked·confirmed는 뺌, 최근 순 20줄).
--    place는 내역 제목(가게 이름). RLS를 따르므로 내 가구 것만 나온다.
create function grocery.our_purchases(p_item uuid)
returns table (
  kind text, transaction_id uuid, transaction_item_id uuid, occurred_on date, platform text, place text, created_by uuid,
  name text, quantity numeric, unit_price bigint, amount bigint, pack_size numeric, pack_unit text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with it as (
    select i.household_id, i.transaction_id, i.paid, grocery.name_key(i.name, i.spec) as k, grocery.name_tokens(i.name) as toks
      from grocery.items i where i.id = p_item
  ),
  lines as (
    select ti.id as tid, t.id as txid, t.occurred_on, t.platform, t.title, t.created_by,
           ti.name, ti.quantity, ti.unit_price, ti.amount, ti.pack_size, ti.pack_unit, ti.sort,
           regexp_replace(lower(ti.name), '[^가-힣a-z0-9]', '', 'g') as nn
      from it
      join public.transactions t on t.household_id = it.household_id
      join public.transaction_items ti on ti.transaction_id = t.id
     where t.occurred_on >= current_date - 365 or t.id = it.transaction_id
  ),
  -- 연결된 내역의 줄 고르기: 산 금액(items.paid)과 같은 줄 → 이름 단어가 가장 많이 맞는 줄. 단어가 하나도 안 맞고(한 글자 품목 등) 줄이 여럿이면
  -- 다른 상품 줄을 집지 않고 총액 한 줄(이름은 내역 제목, 단위 가격 없음, 금액은 산 금액 또는 내역 총액)로 둔다.
  linked as (
    select 0 as r, 'linked'::text as kind, t.id as txid,
           case when l.use_line then l.tid end as tid,
           t.occurred_on, t.platform, t.title, t.created_by,
           case when l.use_line then l.name else t.title end as name,
           case when l.use_line then l.quantity end as quantity,
           case when l.use_line then l.unit_price end as unit_price,
           case when l.use_line then l.amount else coalesce(it.paid, t.amount) end as amount,
           case when l.use_line then l.pack_size end as pack_size,
           case when l.use_line then l.pack_unit end as pack_unit
      from it
      join public.transactions t on t.id = it.transaction_id
      left join lateral (
        select l.*,
               (select count(*) from unnest(it.toks) k where strpos(l.nn, k) > 0) as hits,
               (select count(*) from lines x where x.txid = t.id) as n_lines
          from lines l
         where l.txid = t.id
         order by (it.paid is not null and l.amount = it.paid) desc, (select count(*) from unnest(it.toks) k where strpos(l.nn, k) > 0) desc, l.sort
         limit 1
      ) l0 on true
      left join lateral (
        select l0.tid, l0.name, l0.quantity, l0.unit_price, l0.amount, l0.pack_size, l0.pack_unit,
               (l0.tid is not null and (l0.n_lines = 1 or l0.hits > 0 or (it.paid is not null and l0.amount = it.paid))) as use_line
      ) l on true
  ),
  verdicts as (
    select v.transaction_item_id, v.same
      from it join grocery.purchase_verdicts v on v.household_id = it.household_id and v.name_key = it.k
  ),
  confirmed as (
    select 1 as r, 'confirmed'::text as kind, l.txid, l.tid, l.occurred_on, l.platform, l.title, l.created_by,
           l.name, l.quantity, l.unit_price, l.amount, l.pack_size, l.pack_unit
      from lines l
      join verdicts v on v.transaction_item_id = l.tid and v.same
     where l.tid not in (select tid from linked where tid is not null)
  ),
  alike as ( -- similar는 예약어
    select 2 as r, 'similar'::text as kind, l.txid, l.tid, l.occurred_on, l.platform, l.title, l.created_by,
           l.name, l.quantity, l.unit_price, l.amount, l.pack_size, l.pack_unit
      from lines l, it
     where l.occurred_on >= current_date - 365
       and cardinality(it.toks) > 0
       and exists (select 1 from unnest(it.toks) k where strpos(l.nn, k) > 0)
       and (select count(*) from unnest(it.toks) k where strpos(l.nn, k) > 0) * 2 > cardinality(it.toks)
       and not exists (select 1 from verdicts v where v.transaction_item_id = l.tid)
       and l.tid not in (select tid from linked where tid is not null)
     order by l.occurred_on desc, l.sort
     limit 20
  )
  select x.kind, x.txid, x.tid, x.occurred_on, x.platform, x.title, x.created_by,
         x.name, x.quantity, x.unit_price, x.amount, x.pack_size, x.pack_unit
    from (
      select * from linked
      union all select * from confirmed
      union all select * from alike
    ) x
   order by x.r, x.occurred_on desc
$$;
revoke execute on function grocery.our_purchases(uuid) from public, anon;
grant execute on function grocery.our_purchases(uuid) to authenticated;
