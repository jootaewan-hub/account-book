-- 장보기(grocery 스키마만): 몰 주소·자주 가는 매장 저장이 데이터 API에서 거절되던 칸 권한.
--
-- 몰 주소(shop_links)·자주 가는 매장(household_prefs) 저장은 앱이 upsert(on conflict do update)로 한다
-- (src/grocery/lib/supabaseStore.ts addShopLink·setStores). PostgREST(merge-duplicates)는 보낸 칸 전부를
-- `do update set …`에 넣으므로 충돌 열쇠 칸(household_id 등)에도 update 권한이 있어야 한다. 없으면 충돌이 없어도
-- 문장 전체가 42501(permission denied)로 거절된다(transactions에서 겪은 것과 같은 종류, 20261015180000_tx_update_grants.sql).
-- update 정책의 with check가 가구 소속을 확인하므로 다른 가구로 옮길 수는 없다(tests/grocery/sourcesDb.test.ts).

grant update (household_id, product_id, source) on grocery.shop_links to authenticated;
grant update (household_id) on grocery.household_prefs to authenticated;
