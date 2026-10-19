-- 성분 탭(P7, 화면 설계 5절): 고른 상품(다나와)에 사람이 고른 식약처 품목제조보고(C002)의 원재료와 식품영양성분DB 값.
-- 값은 공개 자료지만 "어느 품목이 이 상품인가"는 가구가 고른 것이라 가구마다 둔다(보안 리뷰 2026-10-19: 공용으로 두면 한 가구의 선택이 다른 가구 화면을 바꾼다).
-- 쓰기는 Edge Function food-info(서비스 롤)가 부른 사람의 가구에만 한다. (가구, 상품)마다 하나(다시 고르면 덮어쓴다). grocery 스키마만(D-003).
create table grocery.product_info (
  household_id uuid not null references public.households (id) on delete cascade,
  product_id uuid not null references grocery.products (id) on delete cascade,
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
  updated_at timestamptz not null default now(),
  primary key (household_id, product_id),
  foreign key (household_id, chosen_by) references public.members (household_id, user_id) on delete set null (chosen_by)
);

alter table grocery.product_info enable row level security;
create policy product_info_select on grocery.product_info
  for select to authenticated
  using ((select private.is_household_member(household_id)));
revoke all on grocery.product_info from public, anon, authenticated;
grant select on grocery.product_info to authenticated;
grant select, insert, update, delete on grocery.product_info to service_role;
