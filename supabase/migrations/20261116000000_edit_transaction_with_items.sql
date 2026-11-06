-- 내역과 품목 수정은 하나의 요청으로 처리한다. 기존 가구 RLS를 그대로 쓴다.
create function public.edit_transaction_with_items(
  p_id uuid, p_updated_at timestamptz, p_input jsonb,
  p_remove uuid[], p_update jsonb, p_insert jsonb
)
returns text[]
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_input public.transactions := jsonb_populate_record(null::public.transactions, p_input);
  v_household uuid;
  v_change record;
  v_paths text[];
  v_count int;
begin
  -- 조건부 UPDATE가 행을 잠근다. 먼저 저장된 변경이나 응답을 못 받은 재시도를 덮어쓰지 않는다.
  update public.transactions
  set type = v_input.type, occurred_on = v_input.occurred_on, amount = v_input.amount,
      title = v_input.title, memo = v_input.memo, category_id = v_input.category_id,
      payment_method_id = v_input.payment_method_id, scope = v_input.scope, platform = v_input.platform
  where id = p_id and updated_at = p_updated_at
  returning household_id into v_household;

  if not found then
    raise exception 'transaction_edit_conflict';
  end if;

  with removed as (
    delete from public.transaction_items
    where transaction_id = p_id and household_id = v_household and id = any(p_remove)
    returning image_path
  )
  select count(*), coalesce(array_agg(image_path) filter (where image_path is not null), '{}')
    into v_count, v_paths from removed;
  if v_count <> cardinality(p_remove) then
    raise exception 'transaction_edit_conflict';
  end if;

  for v_change in select * from jsonb_to_recordset(p_update) as u(id uuid, patch jsonb)
  loop
    update public.transaction_items as item
    set (name, quantity, unit_price, amount, pack_size, pack_unit, sort) = (
      select next.name, next.quantity, next.unit_price, next.amount, next.pack_size, next.pack_unit, next.sort
      from jsonb_populate_record(item, v_change.patch) as next
    )
    where item.id = v_change.id and item.transaction_id = p_id and item.household_id = v_household;
    if not found then
      raise exception 'transaction_edit_conflict';
    end if;
  end loop;

  insert into public.transaction_items (transaction_id, household_id, name, quantity, unit_price, amount, pack_size, pack_unit, sort)
  select p_id, v_household, item.name, item.quantity, item.unit_price, item.amount, item.pack_size, item.pack_unit, item.sort
  from jsonb_populate_recordset(null::public.transaction_items, p_insert) as item;

  return v_paths;
end;
$$;

revoke execute on function public.edit_transaction_with_items(uuid, timestamptz, jsonb, uuid[], jsonb, jsonb) from public, anon;
grant execute on function public.edit_transaction_with_items(uuid, timestamptz, jsonb, uuid[], jsonb, jsonb) to authenticated;
