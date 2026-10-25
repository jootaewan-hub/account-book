-- 나눠 저장한 영수증 묶음(D-027): 영수증·쇼핑 주문 한 건을 상품마다 나눠 저장한 내역끼리 같은 번호를 붙여
-- 수정 화면에서 한 번에 지울 수 있게 한다. 한 건으로 저장한 주문(기본)에는 붙이지 않는다.
-- 앱은 이 칸을 고치지 않는다(칸 수정 권한을 주지 않는다). 입력·읽기·삭제 권한과 RLS는 표 단위로 이미 있다.
alter table public.transactions add column save_batch uuid;
create index transactions_save_batch_idx on public.transactions (save_batch) where save_batch is not null;

-- 서명은 그대로 두고 p_tx의 save_batch만 더 읽는다(grocery.record_purchase가 같은 함수를 부른다).
-- 나머지는 20261015080000_platform_units.sql과 같다.
create or replace function public.add_transaction_with_items(p_household_id uuid, p_tx jsonb, p_items jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  tx_id uuid;
begin
  insert into public.transactions (
    household_id, type, occurred_on, occurred_at, amount, title, memo,
    category_id, payment_method_id, scope, source, platform, save_batch
  ) values (
    p_household_id,
    p_tx->>'type',
    (p_tx->>'occurred_on')::date,
    nullif(p_tx->>'occurred_at', '')::time,
    (p_tx->>'amount')::bigint,
    coalesce(p_tx->>'title', ''),
    nullif(p_tx->>'memo', ''),
    nullif(p_tx->>'category_id', '')::uuid,
    nullif(p_tx->>'payment_method_id', '')::uuid,
    p_tx->>'scope',
    p_tx->>'source',
    nullif(btrim(p_tx->>'platform'), ''),
    nullif(p_tx->>'save_batch', '')::uuid
  )
  returning id into tx_id;

  insert into public.transaction_items (
    transaction_id, household_id, name, quantity, unit_price, amount, sort, image_path, pack_size, pack_unit
  )
  select tx_id, p_household_id,
    e.item->>'name',
    coalesce((e.item->>'quantity')::numeric, 1),
    (e.item->>'unit_price')::bigint,
    (e.item->>'amount')::bigint,
    e.ord::int,
    case when e.item->>'image_path' like p_household_id::text || '/%' then e.item->>'image_path' end,
    -- 용량은 총량(>0)과 단위가 함께 있을 때만 저장한다
    case when nullif(e.item->>'pack_unit', '') is not null and (e.item->>'pack_size')::numeric > 0
      then (e.item->>'pack_size')::numeric end,
    case when nullif(e.item->>'pack_unit', '') is not null and (e.item->>'pack_size')::numeric > 0
      then e.item->>'pack_unit' end
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as e(item, ord);

  return tx_id;
end;
$$;

-- backfill:start
-- 지난 내역 추정: 이 칸이 생기기 전에 나눠 저장한 내역에도 번호를 붙인다. 나눠 저장한 내역은 품목 줄이 1개 이하(상품 하나 또는 배송비)이고,
-- 같은 사람이 같은 날짜·결제수단·플랫폼으로 잇달아 저장한다. 저장 시각이 60초 안으로 이어진 2건 이상을 한 묶음으로 본다.
-- 같은 날 같은 카드로 낸 영수증 두 장을 한 번에 저장했으면 한 묶음으로 잘못 묶일 수 있다(앱은 지우기 전에 목록을 보여 준다).
with cand as (
  select t.id, t.household_id, t.created_by, t.occurred_on, t.payment_method_id, t.platform, t.created_at
  from public.transactions t
  where t.source = 'photo' and t.recurring_id is null and t.save_batch is null
    and (select count(*) from public.transaction_items i where i.transaction_id = t.id) <= 1
), gaps as (
  select c.*, c.created_at - lag(c.created_at) over w as gap
  from cand c
  window w as (partition by c.household_id, c.created_by, c.occurred_on, c.payment_method_id, c.platform order by c.created_at, c.id)
), runs as (
  select g.*, sum(case when g.gap is null or g.gap > interval '60 seconds' then 1 else 0 end)
    over (partition by g.household_id, g.created_by, g.occurred_on, g.payment_method_id, g.platform order by g.created_at, g.id) as run
  from gaps g
), sized as (
  select r.*, count(*) over (partition by r.household_id, r.created_by, r.occurred_on, r.payment_method_id, r.platform, r.run) as n
  from runs r
)
update public.transactions t
set save_batch = md5(concat_ws('|', s.household_id, s.created_by, s.occurred_on,
  coalesce(s.payment_method_id::text, '-'), coalesce(s.platform, '-'), s.run))::uuid
from sized s
where s.id = t.id and s.n >= 2;
-- backfill:end
