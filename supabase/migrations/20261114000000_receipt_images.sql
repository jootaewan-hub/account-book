-- 영수증 사진 보관(D-053): 영수증 확인 화면에서 저장할 때 분석에 쓴 축소 JPEG를 남겨 두고, 수정 시트에서 보고 다시 읽을 수 있게 한다.
-- 사진 경로는 <가구 id>/<내역 id>/<n>.jpg, transactions.receipt_path(init부터 있던 칸)에는 폴더 <가구 id>/<내역 id>를 적는다.
-- 상품별로 나눠 저장한 내역(save_batch)은 같은 폴더를 가리킨다. 칸 수정 권한(update grant)은 init에 이미 있다.

-- 폴더 경로 길이(가구 id 36 + '/' + 내역 id 36 = 73자)와 "같은 사진을 쓰는 내역이 남았나" 조회용 색인
alter table public.transactions
  add constraint transactions_receipt_path_check check (receipt_path is null or char_length(receipt_path) <= 200);
create index transactions_receipt_path_idx on public.transactions (receipt_path) where receipt_path is not null;

-- 영수증 사진 저장소: 비공개, JPEG만, 한 장 3MB(분석에 쓴 축소 JPEG는 긴 변 2400px·품질 0.85라 보통 1MB 안)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipt-images', 'receipt-images', false, 3145728, array['image/jpeg'])
on conflict (id) do nothing;

-- 가구 구성원만 읽기·올리기·지우기(private.storage_household_ok: 20261015060000_items_images_no_shared.sql, 경로 첫 폴더가 내 가구 id인지)
create policy receipt_images_select on storage.objects
  for select to authenticated
  using (bucket_id = 'receipt-images' and private.storage_household_ok(name));
create policy receipt_images_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'receipt-images' and private.storage_household_ok(name));
create policy receipt_images_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'receipt-images' and private.storage_household_ok(name));
