-- 가게 이름 칸(D-032): 영수증·카드 문자에서 읽은 가게(가맹점) 이름을 내역에 남긴다. 상품별로 나눠 저장하면
-- 내역 이름이 상품명이라 가게를 잃었다(통계 어디서 샀나가 가게를 모름). 한 내역으로 저장해도 함께 남긴다.
-- 입력은 표 단위 insert 권한(20261015000000_init.sql)으로 되고, 앱은 이 칸을 고치지 않으므로 칸 수정 권한은 주지 않는다.
alter table public.transactions
  add column merchant text check (merchant is null or char_length(merchant) between 1 and 60);

-- 서명은 그대로 두고 p_tx의 merchant만 더 읽는다(grocery.record_purchase는 merchant 없이 부른다).
-- 나머지는 20261104000000_tx_save_batch.sql과 같다.
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
    category_id, payment_method_id, scope, source, platform, save_batch, merchant
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
    nullif(p_tx->>'save_batch', '')::uuid,
    left(nullif(btrim(p_tx->>'merchant'), ''), 60)
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
