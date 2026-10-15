-- 2단계: 문자·사진으로 뽑은 내역을 품목과 함께 한 번에 저장하고,
-- Anthropic Workload Identity Federation 규칙이 "우리 가계부 구성원"만 허용할 수 있도록
-- 로그인 토큰(JWT)의 app_metadata에 household_id를 싣는다.

-- 내역 + 품목을 한 트랜잭션으로 저장. security invoker라서 RLS가 그대로 적용된다.
create function public.add_transaction_with_items(p_household_id uuid, p_tx jsonb, p_items jsonb)
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
    category_id, payment_method_id, scope, source
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
    p_tx->>'source'
  )
  returning id into tx_id;

  insert into public.transaction_items (transaction_id, household_id, name, quantity, unit_price, amount, sort)
  select tx_id, p_household_id,
    e.item->>'name',
    coalesce((e.item->>'quantity')::numeric, 1),
    (e.item->>'unit_price')::bigint,
    (e.item->>'amount')::bigint,
    e.ord::int
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as e(item, ord);

  return tx_id;
end;
$$;

revoke execute on function public.add_transaction_with_items(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.add_transaction_with_items(uuid, jsonb, jsonb) to authenticated;

-- 구성원이 되거나 빠질 때 JWT에 실릴 household_id를 맞춘다 (다음 토큰 갱신부터 반영)
create function private.sync_household_claim()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    update auth.users
    set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) - 'household_id'
    where id = old.user_id;
    return old;
  end if;
  update auth.users
  set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('household_id', new.household_id::text)
  where id = new.user_id;
  return new;
end;
$$;

revoke execute on function private.sync_household_claim() from public, anon, authenticated;

create trigger members_sync_household_claim
  after insert or delete on public.members
  for each row execute function private.sync_household_claim();

-- 이미 있는 구성원
update auth.users u
set raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb)
  || jsonb_build_object('household_id', m.household_id::text)
from public.members m
where m.user_id = u.id;
