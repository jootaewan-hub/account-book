-- 성분 탭(P7, 화면 설계 5절): 고른 상품(다나와)에 사람이 고른 식약처 품목제조보고(C002)의 원재료와 식품영양성분DB 값을 캐시한다.
-- 공개 자료라 로그인한 사용자는 모두 읽고, 쓰기는 Edge Function food-info(서비스 롤)만 한다. 상품마다 하나(다시 고르면 덮어쓴다). grocery 스키마만(D-003).
create table grocery.product_info (
  product_id uuid primary key references grocery.products (id) on delete cascade,
  report_no text not null check (char_length(report_no) between 1 and 30),
  name text not null check (char_length(name) between 1 and 200),
  maker text check (char_length(maker) <= 100),
  kind text check (char_length(kind) <= 60),
  raw_materials text check (char_length(raw_materials) <= 4000),
  changed_on date,
  -- 식품영양성분DB 값 그대로(_shared/foodInfo.ts의 Nutrition 모양). 못 받았으면 null이고 이유는 nutrition_error(짧은 코드)
  nutrition jsonb,
  nutrition_error text check (char_length(nutrition_error) <= 60),
  chosen_by uuid,
  updated_at timestamptz not null default now()
);

alter table grocery.product_info enable row level security;
create policy product_info_read on grocery.product_info for select to authenticated using (true);
revoke all on grocery.product_info from public, anon, authenticated;
grant select on grocery.product_info to authenticated;
grant select, insert, update, delete on grocery.product_info to service_role;
