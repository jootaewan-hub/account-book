-- 5단계: 어디서 샀는지(플랫폼)를 내역과 따로 저장하고, 품목에 용량(단위당 가격 계산용)을 더한다.

-- 플랫폼: 쿠팡·네이버·오늘의집·컬리 등. 매장 결제는 비워 둔다.
alter table public.transactions
  add column platform text check (platform is null or char_length(platform) between 1 and 30);

-- 상품 1개(주문 수량 1)에 든 총량과 단위. 예: 물티슈 100매×10팩 → 1000, '매' / 우유 900ml×2 → 1800, 'ml'
-- 단위당 가격(100g당·100ml당·1개당)은 화면에서 금액 ÷ (수량 × 총량)으로 계산한다.
alter table public.transaction_items
  add column pack_size numeric check (pack_size is null or pack_size > 0),
  add column pack_unit text check (pack_unit is null or char_length(pack_unit) between 1 and 4),
  add constraint transaction_items_pack_check check ((pack_size is null) = (pack_unit is null));

-- 내역 + 품목 저장에 플랫폼과 용량을 더한다
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
    category_id, payment_method_id, scope, source, platform
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
    nullif(btrim(p_tx->>'platform'), '')
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
