-- 4단계: 쇼핑 주문 캡처의 상품 사진을 품목에 붙인다.
-- (처음 적용할 때 '공동' 내역을 입력한 사람 몫으로 옮기는 문장이 있었으나, 공동 구분을 유지하기로 해서 빼고 운영 DB 데이터는 되돌렸다)

-- 품목 사진 (Storage 'item-images' 버킷 안의 경로: <가구 id>/<파일>)
alter table public.transaction_items
  add column image_path text check (image_path is null or char_length(image_path) <= 200);

-- 내역 + 품목 저장에 사진 경로를 더한다. 자기 가구 폴더가 아닌 경로는 버린다.
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

  insert into public.transaction_items (transaction_id, household_id, name, quantity, unit_price, amount, sort, image_path)
  select tx_id, p_household_id,
    e.item->>'name',
    coalesce((e.item->>'quantity')::numeric, 1),
    (e.item->>'unit_price')::bigint,
    (e.item->>'amount')::bigint,
    e.ord::int,
    case when e.item->>'image_path' like p_household_id::text || '/%' then e.item->>'image_path' end
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as e(item, ord);

  return tx_id;
end;
$$;

-- 상품 사진 저장소: 비공개, 작은 JPEG/WebP만
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('item-images', 'item-images', false, 512000, array['image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- 경로 첫 폴더가 내 가구 id인지
create function private.storage_household_ok(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when split_part(object_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then private.is_household_member(split_part(object_name, '/', 1)::uuid)
    else false
  end;
$$;
revoke execute on function private.storage_household_ok(text) from public, anon;
grant execute on function private.storage_household_ok(text) to authenticated;

create policy item_images_select on storage.objects
  for select to authenticated
  using (bucket_id = 'item-images' and private.storage_household_ok(name));
create policy item_images_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'item-images' and private.storage_household_ok(name));
create policy item_images_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'item-images' and private.storage_household_ok(name));
