# 구조

배포·데이터·로그인은 확정(D-003, D-004, D-006). 실제 표·함수는 `supabase/migrations/*_grocery_*.sql`, Edge Function 목록과 하는 일은 저장소 맨 위 `README.md` "구조" 표가 기준이다(이 문서는 큰 그림만).

2026-10-19부터 장보기는 가계부 저장소 안의 '장보기' 탭이다(D-010). 앱은 가계부 앱 하나이고(`src/grocery/`), 로그인·가구 확인·새 버전 확인은 가계부가 한다. 마이그레이션·Edge Function·예약 실행·배포도 가계부 저장소 하나에서 관리한다.

## 구성

| 부분 | 선택 | 이유 |
|---|---|---|
| 앱 | 가계부 앱(React + TypeScript + Vite, PWA)의 '장보기' 탭, 코드는 `src/grocery/` | 휴대폰 홈 화면 설치, 카메라(바코드·사진), 오프라인 목록 보기. 두 앱을 하나로(D-010). |
| 데이터·로그인 | 가계부와 같은 Supabase 프로젝트(`account-book`)의 Postgres, Auth, Realtime. 장보기 테이블은 `grocery` 스키마 | 계정·가구를 가계부와 공유(D-003). 로그인은 가계부 계정 이메일+비밀번호(D-004). RLS로 가구 구성원만 접근. |
| 서버 함수 | Supabase Edge Functions | API 키를 서버에만 두고 외부 API를 대신 호출. 응답 캐시. |
| 정기 수집 | GitHub Actions 예약 실행 → Edge Function | 매일 한국 시간 07:00 식약처 목록(`food-alerts-sync`), 07:10 농수산물 시세(`market-sync`), 07:20 참가격(`tprice-sync`), 07:30 안 산 품목 가격 다시 확인(`price-recheck`). 워크플로는 `.github/workflows/`의 같은 이름 파일. 함수는 20시간에 한 번만 실제로 받고 30분 잠금으로 동시 호출을 막는다. |
| 배포 | 가계부 GitHub Pages 하나(`https://jootaewan-hub.github.io/account-book/`, 장보기 탭은 `?tab=grocery`) | 가계부 `deploy.yml`이 테스트(장보기 포함) → 빌드 → 배포(D-006, D-010). |

## 공유 DB 규칙 (D-003)

- 장보기 마이그레이션은 `grocery` 스키마 안의 객체만 만들고 바꾼다. 가계부의 `public` 테이블은 읽기만 하고, 가계부 내역에 쓰는 것은 지출 기록 단계에서 정할 함수 하나로만 한다.
- `grocery.items`의 `added_by`·`bought_by`는 가계부 구성원을 참조하되 `on delete set null`이다(D-007). 장보기 데이터가 가계부의 구성원·계정 삭제를 막지 않고, 떠난 구성원이 담은 품목은 이름 없이 남는다. 새 행은 RLS가 `added_by` = 본인을 강제한다.
- 장보기 스키마(`grocery`)와 RLS는 `supabase/migrations/`에 있고 PGlite 테스트로 검증한다. 공유 DB 적용과 Exposed schemas 추가는 사용자 확인 후 한다.
- 가구·구성원은 가계부의 테이블을 그대로 쓴다. 아래 초안의 `households`, `household_members`는 새로 만들지 않는다.
- 공유 DB에 마이그레이션을 적용하는 방법은 Supabase MCP의 `apply_migration` 하나뿐이다. `supabase db push`는 쓰지 않는다. 통합 전에는 두 저장소가 마이그레이션을 나눠 가져 서로의 적용분을 어긋나게 할 수 있었다. 통합 뒤에는 한 저장소에 모였지만 같은 규칙을 지킨다.
- `tests/grocery/boundary.test.ts`가 장보기 마이그레이션에 `public` 객체 만들기·바꾸기·권한·쓰기가 없는지 검사하고, 장보기 DB 테스트는 가계부 마이그레이션까지 전부 적용한 위에서 돈다(`tests/grocery/dbSetup.ts`).
- Realtime: `grocery.items`의 INSERT·UPDATE는 `household_id` 필터로 구독하지만, DELETE는 Supabase가 필터를 지원하지 않아 필터 없이 구독한다. 그래서 공유 프로젝트에 로그인한 사용자는 어느 가구의 삭제든 지워진 행의 `id`만 받는다(행 내용은 오지 않는다). 앱은 이 이벤트를 받으면 자기 가구 목록을 다시 읽을 뿐이다.

## 데이터 흐름

1. 담기: 글 → 앱에서 품목·용량·개수 분리 → `items` 저장. 사진 → `grocery-photo` 함수(Claude, WIF) → 확인 목록 → 저장.
2. 품목 확인(품목을 담고 상품을 고르면 자동, 사지 않은 품목은 하루 한 번 다시, 상세를 열었는데 오늘 값이 없으면 그때 확인 — 화면 설계 8-1절): `product-check` 함수가
   - 상품 후보, 이미지, 쇼핑몰별 가격: 가격 출처는 `docs/grocery/data-sources.md` 1절(다나와, 넣은 몰 주소는 D-013)
   - `grocery.food_alerts`(매일 수집분)와 대조 — 지금은 목록 화면이 `grocery.item_alerts()`로 제품명·업체명 단어를 맞춘다(계획 ②). 바코드 일치는 계획 ⑥
   - 신선 품목이면 KAMIS 최근 시세(`price_points`)
   를 모아 `price_checks`·`price_quotes`(다나와)와 `shop_checks`(넣은 몰 주소)에 저장하고 앱에 돌려준다. 같은 상품·같은 출처·같은 날은 캐시.
   성분 탭은 `food-info` 함수(식약처 품목제조보고 원재료, 식품영양성분DB)를 부른다(D-018·D-020).
3. 매일 수집:
   - `food-alerts-sync`(계획 ②): 식품안전나라 I0490 회수·판매중지, I2620 검사부적합, I2715 해외직구 차단 전체를 1,000건씩 받아 `grocery.food_alerts`에 upsert(지우지 않음), 서비스마다 `grocery.sync_runs`에 결과를 남긴다. 호출 비밀번호 없이 스스로 막는다: 세 서비스 모두 20시간 안에 성공했으면 받지 않고, `grocery.sync_lock` 한 행을 `UPDATE … WHERE locked_at < 30분 전`으로 잡아야만 받는다(동시 호출도 하나만). 응답은 결과 종류(`done`·`partial`·`skipped`·`cooldown`)만.
   - 목록 화면은 `grocery.item_alerts()`(로그인한 사용자 권한, RLS 적용)로 자기 가구의 안 산 품목과 대조하고, `sync_runs`의 마지막 성공 시각으로 "확인한 범위"와 48시간 넘은 경고를 보여 준다.
   - `market-sync`(공공데이터포털 15156057 일별 도·소매 가격, 정해 둔 신선 품목) → `price_points`(D-012).
   - `tprice-sync`(참가격, 성남 판매점) → `tprice_stores`·`tprice_goods`·`tprice_prices`(D-013).
   - `price-recheck`(안 산 품목이 고른 상품의 다나와·몰 주소 가격) → `price_checks`·`shop_checks`.

## 표

처음 초안(`product_checks`·`recalls` 등)은 실제 구현과 달라 지웠다. 실제 표는 `supabase/migrations/*_grocery_*.sql`에 있다
(품목 `items`, 다나와 `products`·`price_checks`·`price_quotes`, 식약처 `food_alerts`·`sync_runs`, 시세 `price_points`·`watch`, 참가격 `tprice_*`·`store_links`, 몰 주소 `shop_links`·`shop_checks`,
성분 `item_nutrition`·`item_ingredients`, 그 밖 `household_prefs`·`purchase_verdicts`·`captured_quotes` 등). 가구 데이터 표는 모두 RLS로 그 가구 구성원만 읽고 쓴다.
