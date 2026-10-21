# 인수인계: 로컬(PC·맥북)에서 이어서 하기 (2026-10-19 클라우드 세션 끝)

클라우드 세션에서 하던 일을 로컬 Claude Code로 이어 가기 위한 메모다. 규칙은 `CLAUDE.md`, 진행 상황은 `docs/grocery/tracking/status.md`,
남은 계획은 `docs/superpowers/plans/2026-10-19-remaining-work.md`, 결정은 `docs/grocery/tracking/decisions/index.md`(D-001~D-013)에 있다.

## 1. 지금 상태 한 줄씩

- **작업 브랜치** `claude/optimistic-newton-rp08ut` (마지막 커밋은 이 문서 커밋). `main`은 `e8deac2`(P5까지 배포됨).
  브랜치가 main보다 앞선 것은 문서 커밋뿐이다(P3 확인 기록·계획·D-013·이 문서). 코드 변경 없음.
- **배포된 것(main = GitHub Pages)**: 통합(장보기 탭), P1 장 본 것 → 가계부, P5 농수산물 시세(목록 | 시세 전환).
- **공유 DB에 적용된 장보기 마이그레이션**: `…_grocery_purchase_link`(P1), `grocery_market`(P5). P3 마이그레이션은 아직 없음.
- **배포된 Edge Function**: extract-entries, export-csv, food-alerts-sync, product-search, product-check, **market-sync(v2)**,
  그리고 일회용 `danawa-probe`·`market-probe`(둘 다 410만 돌려줌, 소스 없음). 두 일회용 함수는 Supabase 대시보드 → Edge Functions에서 지워도 된다(MCP에는 지우는 도구가 없다).
- **예약 실행(GitHub Actions)**: 식약처 목록 매일 07:00, 농수산물 시세 매일 07:10(첫 수동 실행 성공, `skipped`).
- **비밀값(Supabase Edge Function Secrets)**: `FOODSAFETY_API_KEY`, `DATA_GO_KR_SERVICE_KEY`(공공데이터포털 15156057 시세 + 15158701 참가격, 끝에 공백이 붙어 있어 코드가 `trim()`한다. 다시 넣어 두면 좋다).

## 2. 로컬 준비 (처음 한 번)

```bash
git clone https://github.com/jootaewan-hub/account-book.git   # 이미 있으면 git fetch origin
cd account-book
git checkout claude/optimistic-newton-rp08ut
git pull origin claude/optimistic-newton-rp08ut
npm ci
npx playwright install chromium     # 화면 캡처용(로컬은 미리 깔린 브라우저가 없다)
npm test                            # 591개 통과해야 한다(PGlite DB 시험 포함, 1~2분)
npx tsc --noEmit
```

화면 확인(UI를 바꾸면 반드시, `CLAUDE.md` 공통 규칙):

```bash
# 창 1: 개발 서버(공개용 키는 .github/workflows/deploy.yml에 있는 값, 비밀이 아님)
VITE_SUPABASE_URL=https://kifdfpbwiebfgvdumqjf.supabase.co \
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_bQ2BOXHX_7-_l_tvVrel6A_-2atkMYK npm run dev
# 창 2: 캡처(111장, 390·1280 라이트·다크). 일부만: npm run screens -- grocery-market
npm run screens
```

- 장보기 데모 화면: `http://localhost:5173/?demo=grocery` (데모 데이터, 실제 값 아님).
- Windows PowerShell이면 환경변수는 `$env:VITE_SUPABASE_URL="…"; $env:VITE_SUPABASE_PUBLISHABLE_KEY="…"; npm run dev`.
- Claude Code에서 공유 DB 적용·함수 배포를 하려면 **Supabase MCP**가 연결돼 있어야 한다(클라우드 세션에서 쓰던 것과 같은 계정). 마이그레이션 적용은 `apply_migration`만, 사용자 확인 뒤(`CLAUDE.md`).

## 3. 다음 할 일: P3 가격 출처 넓히기 (세부 계획은 remaining-work 계획서 "P3 세부 계획")

확인은 끝났고(D-013, `data-sources.md` 1-2·2절) 코드는 아직 없다. 순서:

1. **P3-1 `supabase/functions/_shared/shops.ts`**: 붙여 넣은 주소 정리와 상품 페이지 JSON-LD 읽기.
   - 컬리 `https://www.kurly.com/goods/{id}` → `@graph`의 `Product.offers.price`(숫자), `additionalProperty` "중량/용량".
   - 홈플러스 `https://mfront.homeplus.co.kr/item?itemNo={id}&storeType={HYPER…}` → `Product.offers.price`(글자, "0"이면 버림), `aggregateRating`.
   - 쿠팡 `https://www.coupang.com/vp/products/{pid}?itemId={iid}…` → **쿠팡에는 요청하지 않고** `https://www.lowchart.com/{pid}-{iid}`를 읽는다:
     `offers.price`, `validFrom`, `additionalProperty`의 "관측 최저가/최고가/평균가", "최근 가격 변동일". 짧은 주소(link.coupang.com)는 거절.
   - 시험 사본(fixture)은 위 주소에서 다시 받아 **JSON-LD와 og 메타만 남기고 후기(`review`) 본문은 지운다**. 확인에 쓴 표본: 컬리 goods/5082274(10,980원), 홈플러스 itemNo=120074651(4,150원), 로우차트 9519439579-18170724212(28,920원) — 값은 그날 기준.
2. **P3-2 `_shared/tprice.ts`**: 참가격 XML(항목 태그 `iros.openapi.service.vo.*`) → 판매점·상품·가격. 가격 조회는 `entpId`나 `goodId`가 꼭 필요, 조사일은 격주 금요일(최근 09-25, 10-09). 성남 판매점 15곳과 코드는 `data-sources.md` 2절.
3. **P3-3 마이그레이션 `20261023000000_grocery_sources.sql`**: `shop_links`, `shop_checks`, `tprice_stores`·`tprice_goods`·`tprice_prices`, `store_links`, `household_prefs`, `sync_lock` id 3(지금 check가 `id in (1, 2)`).
4. **P3-4 함수**: `product-check`에 주소 넣은 곳 읽기, 새 `tprice-sync` + 워크플로(07:20), `supabase/config.toml`.
5. **P3-5 화면** → **P3-6 적용·배포**(사용자 확인) → P3-7 `price-recheck`.

다른 남은 일: P2(우리가 산 값), P4(사진·캡처, WIF), P6(바코드), P7(성분·대안), P8(열린 문제). 사용자 할 일은 계획서 끝 표와 status.md "준비할 키".

## 4. 알아 둘 것

- 시세(P5): 화면 숫자는 조사처 값 그대로(성남 B-유통 → 수원 → 서울, 축산물은 전국). 평균·비율은 내지 않는다(D-012). 첫 수집 때 들어간 축산물 서울 지역 행 1,713개는 쓰지 않으니 지워도 된다.
- 확인용 함수가 필요하면 예전처럼 `market-probe`에 토큰 헤더를 요구하는 일회용 코드를 배포하고, 끝나면 410 내용으로 되돌린다(키 값은 응답에 넣지 않는다).
- 클라우드 세션의 임시 파일(받은 페이지 사본, 코드표 xlsx 등)은 저장소에 없다. 필요하면 위 주소와 공공데이터포털 15156057 상세 페이지의 첨부 zip에서 다시 받는다.


---

## 5. 로컬 진행(2026-10-19 밤, 맥북, 브랜치 `claude/p3-price-sources`) — 다음 세션이 볼 것

이 브랜치에서 P3·P2·P4·P6·P7·P8의 코드·시험·캡처·문서를 끝냈다(2026-10-20 아침 공유 DB 적용·함수 배포·main 병합까지 됨, 아래 진행 상황). 자세한 기록은 `docs/grocery/tracking/status.md` "된 것"과
계획서 각 단계의 "진행" 묶음, 실행 기록 `docs/superpowers/plans/2026-10-19-remaining-work.progress.md`(단계별 커밋·시험 결과·결정 근거 Ruling 줄·최종 리뷰 결과)에 있다.

### 적용·배포 진행 상황(2026-10-20 06:15~06:35 KST, 사용자 확인 뒤 맥북에서)

1. 됨 — 마이그레이션 5개를 `apply_migration`으로 이름 순 적용: `grocery_sources`, `grocery_our_purchases`, `grocery_captured_quotes`, `grocery_product_info`, `grocery_last_synced`.
   원격 기록의 version은 적용 시각(20261019…)이라 로컬 파일 이름(20261023…~27)과 다르다(전부터 그런 방식). Advisors 보안 항목은 적용 전과 같다.
2. 됨 — 함수 배포: `product-check` v4, `tprice-sync` v1, `price-recheck` v1, `grocery-photo` v1(`deno.json`을 import map으로), `food-info` v1. verify_jwt는 `supabase/config.toml`과 같다.
   배포 파일 이름 규칙은 전과 같이 `index.ts`·`handle.ts`·`../_shared/*.ts`(서버가 `source/`와 `_shared/`로 둔다). 로그인 없이 부르면 product-check·food-info·grocery-photo는 401.
3. 됨(직접 호출) — `tprice-sync` 200 done(판매점 14곳·상품 604개·가격 4,528행, `goodInspectDay`=YYYYMMDD 확인됨), `price-recheck` 200 done(대상 상품 0개).
   안 됨 — 워크플로 수동 실행: `gh workflow run`이 404(기본 브랜치에 파일이 없음). main 병합 뒤 Actions에서 `tprice-sync`·`price-recheck`를 한 번씩 돌려 200을 본다. 그 전에는 예약 실행도 돌지 않는다.
4. 남음(로그인 필요, 사용자가 앱에서) — 컬리·홈플러스·로우차트 주소 각 1개 이상(화면 값 = 페이지 값), 참가격 매장 값 3개(`tprice_prices`와 price.go.kr 대조), 포장 사진 3장·캡처 3장
   (`grocery-photo` 첫 호출 = WIF 교환 확인, D-009; 안 되면 함수 로그의 `wif_exchange_failed`), 바코드 10개(iPhone), C002 후보 3개.
5. 됨 — 2026-10-20 06:55 KST 사용자 지시로 main에 fast-forward 병합·푸시(= GitHub Pages 배포). 병합 뒤 Actions에서 `tprice-sync`·`price-recheck` 수동 실행(둘 다 200 skipped).
6. 됨 — 2026-10-20 10:13 KST `grocery_candidate_alerts` 적용 뒤 main 병합·배포(D-015~D-017).
7. 됨 — 2026-10-20 10:22 KST 리뷰에서 미룬 것 고침에 따라 `price-recheck` v2(오래된 순), `tprice-sync` v2(빈 판매점 방어), `food-info` v2(getUser(jwt)) 배포(verify_jwt 그대로) 뒤 main 병합.
8. 됨 — 2026-10-20 11:36 KST `grocery_item_nutrition` 적용(Advisors 변화 없음) → `food-info` v3 배포 → main 병합(D-018). 남은 확인: 성분 탭 → 영양성분 찾기 첫 호출로 FOOD_NM_KR 검색 응답 모양 확인(사용자).
9. 됨 — 2026-10-20 11:53 KST `food-info` v4 배포(verify_jwt true, 무인증 401 확인): 이름 검색 후보를 `rankNutrition`으로 정렬하고 `nutrition_auto`로 성분 탭을 열면 자동 맞춤(D-018 보충). FOOD_NM_KR 검색은 사용자 첫 호출로 응답 모양 확인됨(부분 일치).
10. 됨 — 2026-10-20 12:17 KST `food-info` v5 배포(verify_jwt true, 무인증 401 확인, D-018 보충 2): 이름 검색을 `DB_CLASS_NM=품목대표`+전체 두 번 불러 합치고 자동 맞춤 문턱(`autoFit`). 남은 것: 우유(900ml)에 저장된 도넛 줄 삭제(`delete from grocery.item_nutrition where name_key = '우유|900ml' and food_cd = 'D202-082000000-0138'`)는 MCP 호출이 취소돼 아직 안 됨 → 사용자 허용 뒤 다시 실행하거나 사용자가 SQL 편집기에서 직접 실행. 지운 뒤 앱에서 우유 성분 탭을 열어 맞춰진 식품 이름과 `DB_CLASS_NM` 필터 동작을 확인.
11. 됨 — 2026-10-20 12:57 KST `food-info` v6 배포(verify_jwt true, 무인증 401 확인, D-018 보충 3): 상품을 고른 품목은 상품명으로 먼저 찾고(`matchedBy`), 음식은 재료 이름으로 자동 맞추지 않으며, 품목대표 300건. 남은 것: 된장에 저장된 취나물_된장 줄 삭제(`delete from grocery.item_nutrition where food_cd = 'D113-595050000-0001'`)는 MCP 호출이 두 번(12:14 도넛 줄, 12:57 이 줄) 모두 취소돼 아직 안 됨 → 사용자가 Supabase SQL 편집기에서 직접 실행하거나, 앱에서 된장 성분 탭 → "다른 식품으로 바꾸기" → 맨 위 후보(상품명으로 찾은 것)를 고르면 덮어써진다. 그 뒤 고추장·쌈장·참치액·시리얼 성분 탭을 열어 "상품명으로 자동 맞춤"이 맞는지 확인.
12. 됨 — 2026-10-21 09:55 KST D-020 원재료를 제품명으로 찾기: ① MCP `apply_migration`(`grocery_item_ingredients`) 적용(보안 점검은 전과 같은 항목뿐: grocery `fetch_gate`·`sync_lock` INFO, 가계부 SECURITY DEFINER 함수 3개, 유출 비밀번호 보호 꺼짐) → ② `food-info` v7 배포(verify_jwt true, 무인증 POST 401 확인; 옛 `search`·`choose` 액션 없어짐) → ③ main 병합(a99d797)·푸시, GitHub Pages 배포 성공.
    남은 확인(사용자): 된장·고추장·우유 성분 탭의 "원재료"가 상품명으로 맞춰지는지. 고르기 시트에 "축산물 목록(I1310)은 확인 못 함(INFO-110)" 같은 줄이 뜨면 식품안전나라에서 I1310·C006·C003 활용신청.
13. 됨 — 2026-10-21 10:58 KST `food-info` v8 배포(verify_jwt true, 무인증 POST 401 확인; D-020 보충·보충 2: 식품유형 검색, 상표+낱말 단계, 띄어쓴 구절 안 씀; DB 변경 없음) → main 병합·푸시. 남은 확인(사용자): 된장·고추장·우유·버터·치즈·과자 성분 탭을 열어 자동 맞춤과 고르기 후보. 운영 로그 404 세 건(2026-10-21 01:00 UTC)은 원인 미확인 → 다시 나면 `query_logs`로 보기.

14. 대기 — 2026-10-21 저녁 D-021·D-022(브랜치 `claude/fuel-and-grocery-compare`, 설계·계획은 `docs/superpowers/specs|plans/2026-10-21-fuel-and-grocery-compare*`): ① MCP `apply_migration`(`fuel_fills`, public 표·RLS) → Advisors 확인 → ② `extract-entries` 배포(verify_jwt true 그대로; `fuel` 스키마·절사 규칙·다시 읽기 선택) → ③ main 병합·푸시. **순서를 지켜야 한다**: 새 번들은 내역을 읽을 때 `fuel_fills` 임베드를 요구하므로 마이그레이션 없이 main을 먼저 푸시하면 내역 목록이 빈 화면이 된다(마이그레이션이 실패하면 main 푸시를 하지 않는다). 그 뒤 사용자가 주유 영수증 1장·장보기 영수증 1장으로 확인(주유 칸 값이 영수증과 같은지, 통계 주유 묶음, 살펴보기 묶음의 지난번 값이 가계부 기록과 같은지).

### 사용자 할 일

- ~~공공데이터포털 식품영양성분DB(15127578) 활용신청~~ 2026-10-20 마침(사용자). 같은 키로 통하는지는 성분 탭 첫 호출로 확인.
- 실기기(iPhone PWA)에서 카메라 바코드 읽기 확인(`BarcodeDetector`가 없으면 wasm 포니필로 간다 — 추측).
- `docs/grocery/tracking/status.md` "확정할 결정" 4개.

### 로컬 준비 메모(2026-10-19 밤 확인)

- 개발 서버 포트 5173은 다른 프로젝트가 잡고 있어 5188을 쓴다: `npx vite --port 5188 --strictPort`, 캡처는 `BASE_URL=http://localhost:5188 npm run screens -- <장면 이름…>`.
- 플레이라이트 브라우저는 `npx playwright install chromium`(버전이 바뀌면 다시).
- `npm test`는 56개 파일 745개(2026-10-19 밤 기준), `npx tsc --noEmit` 통과. 캡처 142장 자동 확인 통과.
