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
