-- 장보기(grocery 스키마만): 데이터 API upsert가 거절되던 칸 권한과 price_quotes 기본키.
--
-- 1) 몰 주소(shop_links)·자주 가는 매장(household_prefs) 저장은 앱이 upsert(on conflict do update)로 한다.
--    PostgREST(merge-duplicates)는 보낸 칸 전부를 `do update set …`에 넣으므로, 충돌 열쇠 칸(household_id 등)에도
--    update 권한이 있어야 한다. 없으면 충돌이 없어도 문장 전체가 42501(permission denied)로 거절된다
--    (transactions에서 겪은 것과 같은 종류, 20261015180000_tx_update_grants.sql).
--    update 정책의 with check가 가구 소속을 확인하므로 다른 가구로 옮길 수는 없다.
-- 2) grocery.price_quotes에 기본키가 없어(성능 점검 INFO) 식별 칸을 더한다. 앱·함수는 id를 보내지 않는다.

grant update (household_id, product_id, source) on grocery.shop_links to authenticated;
grant update (household_id) on grocery.household_prefs to authenticated;

alter table grocery.price_quotes add column id bigint generated always as identity primary key;
