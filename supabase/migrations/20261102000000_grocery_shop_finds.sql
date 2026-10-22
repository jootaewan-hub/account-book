-- 몰 주소 자동 찾기(D-024, grocery 스키마만): 가구가 고른 상품마다 컬리·홈플러스·쿠팡(로우차트)을 한 번 찾은 결과.
-- Edge Function shop-find(서비스 롤)가 쓰고, 가구 구성원은 읽기만 한다. 같은 상품은 다시 찾지 않는다(검색은 돈이 든다).
-- candidates: 찾은 페이지 중 출처마다 가장 잘 맞는 하나. 한 줄 모양은 _shared/shopFind.ts FoundShop
-- ({source, sourceId, url, name, size, price, checkedAt, grade: 'auto'|'maybe', saved}). 가격은 그 페이지에서 읽은 값과 읽은 시각이다.
-- 'auto'로 맞은 주소는 shop_links에도 넣는다(saved). 'maybe'는 화면에서 사람이 고르면 shop_links에 들어간다.

create table grocery.shop_finds (
  household_id uuid not null references public.households (id) on delete cascade,
  product_id uuid not null references grocery.products (id) on delete cascade,
  status text not null check (status in ('searching', 'done', 'failed')),
  candidates jsonb not null default '[]'::jsonb check (jsonb_typeof(candidates) = 'array' and jsonb_array_length(candidates) <= 6),
  error text check (char_length(error) <= 200),
  searched_at timestamptz not null default now(),
  primary key (household_id, product_id)
);
create index shop_finds_product_idx on grocery.shop_finds (product_id);

alter table grocery.shop_finds enable row level security;
create policy shop_finds_select on grocery.shop_finds
  for select to authenticated
  using ((select private.is_household_member(household_id)));
revoke all on grocery.shop_finds from public, anon, authenticated;
grant select on grocery.shop_finds to authenticated;
grant select, insert, update, delete on grocery.shop_finds to service_role;
