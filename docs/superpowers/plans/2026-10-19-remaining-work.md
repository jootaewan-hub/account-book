# 남은 작업 전체 계획 (통합 뒤 장보기·가계부)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 장보기를 가계부로 옮긴 뒤 남은 일을 한 계획으로 묶는다. 단계는 아래와 같다.
1. 통합을 마무리한다(예전 앱 정리).
2. 장 본 것을 가계부 내역으로 넣는다(D-011).
3. 가계부 기록을 "우리가 산 값"으로 가격 비교에 쓴다.
4. 가격 출처를 넓힌다(④-2).
5. 사진으로 상품 찾기와 캡처로 가격 넣기를 붙인다(④-3).
6. 농수산물 시세를 붙인다(③).
7. 사진·바코드로 담기와 매대 앞 바로 확인을 붙인다.
8. 성분·대안 탭을 붙인다(⑤).
9. 열린 문제를 정리한다.

**쓰는 수준:** P1·P2는 지금 바로 만들 수 있게 작업 단위까지 쓴다. P3~P8은 외부 출처를 실제 호출로 확인해야 세부가 정해지므로 확인할 것·DB·함수·화면·완료 기준까지만 쓴다. 각 단계를 시작할 때 첫 작업으로 그 단계의 세부 계획을 이 문서 아래에 덧붙인다(장보기 규칙: "확인 필요" 항목은 실제 호출로 확인한 뒤 문서를 고치고 나서 코드를 쓴다).

**Spec:**
- 통합 설계 `docs/superpowers/specs/2026-10-19-grocery-integration-design.md`(6절: 만나는 기능, 7절: 순서)
- 장보기 화면 설계 `docs/grocery/superpowers/specs/2026-10-16-screens-design.md`
- 가격 확인 설계 `docs/grocery/superpowers/specs/2026-10-19-price-check-design.md`
- 데이터 출처 `docs/grocery/data-sources.md`, 결정 기록 `docs/grocery/tracking/decisions/index.md`(D-003~D-011)

**Tech Stack:** Vite + React 19 + TS, Vitest, PGlite, Supabase Postgres/Edge Functions(Deno), Playwright(`npm run screens`).

## Global Constraints

- `CLAUDE.md`의 공통 규칙과 "장보기 부분 — 반드시 지킬 것" 전부. 특히 다음을 지킨다.
  - 출처 있는 숫자만 쓴다.
  - "찾은 기록 없음"은 "안전함"이 아니다.
  - 키는 서버에만 둔다.
  - 가구 RLS를 지킨다.
  - AI처럼 보이지 않게 한다.
  - 390·1280px, 라이트·다크로 캡처해 확인한다.
  - 다나와 검색은 10초에 한 번만 부르고 캐시를 쓴다.
- 장보기 마이그레이션은 `grocery` 스키마만 바꾼다. `tests/grocery/boundary.test.ts`가 통과해야 한다. 가계부 `public` 표에 쓰는 것은 가계부의 기존 함수 `public.add_transaction_with_items`를 부르는 것뿐이다.
- 새 마이그레이션 파일 이름은 `supabase/migrations/`에서 가장 늦은 파일(지금 `20261020010000_grocery_prices.sql`)보다 뒤로 한다. 이 계획에서는 `20261021…`부터 쓴다. 공유 DB 적용은 MCP `apply_migration`으로 하고, 적용할 때마다 사용자에게 먼저 확인한다. 적용 뒤 보안 점검(Advisors)을 다시 보고 새 항목을 기록한다.
- Edge Function을 새로 만들면 `supabase/config.toml`에 `verify_jwt`를 적는다. 배포(MCP `deploy_edge_function`)는 사용자 확인 뒤에 한다.
- 가계부 화면(스마트 입력 확인 화면 등)을 바꾸는 단계는 가계부 `DESIGN.md`를 따르고, 장보기 화면은 `docs/grocery/DESIGN.md`를 따른다.
- 커밋은 작업마다 한국어로 쓰고 끝에 아래 두 줄을 붙인다. 작업은 브랜치에서 하고, `main` 병합·푸시(=배포)는 사용자 지시로만 한다.
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_018cJe2Fw6PAFf9eqegQtjhx
  ```
- 단계마다 끝에 `docs/grocery/tracking/status.md`를 고치고, 새 결정은 `decisions/index.md`에 D-번호로 남긴다.

## 순서와 막히는 곳 [제안]

| 단계 | 내용 | 시작 조건(막히는 곳) | 사용자 할 일 |
|---|---|---|---|
| P0 | 통합 마무리 | 두 기기 확인 | 두 기기에서 장보기 탭 확인, 장보기 저장소 보관, `danawa-probe` 결정 |
| P1 | 장 본 것 → 가계부 | 없음 | 마이그레이션 적용 확인 |
| P2 | 우리가 산 값 | P1의 연결 칸 | 마이그레이션 적용 확인 |
| P3 | 가격 출처 넓히기(④-2) | 출처별 실제 호출 확인 | 참가격 API 키, I2810 활용신청 |
| P4 | 사진으로 찾기·캡처로 가격(④-3) | WIF 첫 호출 확인(D-009) | (교환이 안 되면) Anthropic 콘솔 규칙 수정 |
| P5 | 농수산물 시세(③) | KAMIS 실제 호출 확인 | KAMIS 인증키·ID |
| P6 | 사진·바코드 담기, 매대 앞 확인 | 바코드 읽기 방법 확인 | 없음 |
| P7 | 성분·대안 탭(⑤) | 영양성분DB·C002 실제 호출 확인 | (필요하면) 공공데이터포털 키 |
| P8 | 열린 문제 | 실제 사용 관찰 | 쓰면서 본 것 알려 주기 |

순서 근거:
- P1·P2는 외부 키 없이 바로 만들 수 있고, 두 앱을 합친 이유(지출 기록을 한 곳에 모으기, D-003)에 가장 가깝다.
- P3~P7은 사용자가 키·활용신청을 끝낸 순서대로 당겨도 된다. P3은 참가격 키 없이도 에누리·컬리 등부터 할 수 있다.
- P8의 작은 고침은 다른 단계 사이에 끼워 넣는다.

---

## P0. 통합 마무리 (통합 설계 7절 2·3단계)

이미 된 것: 가계부 `main` f5eef3c 병합·배포(Actions run 29 성공), 가계부 쪽 식약처 워크플로 수동 실행 200 `skipped`, 장보기 저장소 브랜치 `claude/optimistic-newton-rp08ut`(52a08d1)에 안내 페이지·서비스 워커 지우기·워크플로 삭제.

- [ ] (사용자) 두 기기에서 `https://jootaewan-hub.github.io/account-book/` 장보기 탭 확인: 담기, 상대 기기에 실시간 반영, 상품 고르기, 가격, 식약처 경고, 빼기·되돌리기, 로그아웃 뒤 빼 둔 품목이 되살아나지 않는지.
- [ ] 문제가 있으면 고친 뒤 다시 확인한다. 없으면 장보기 저장소 브랜치를 `main`에 병합해 안내 페이지를 배포한다(사용자 지시).
- [ ] 배포 뒤 확인:
  - 예전 주소를 브라우저에서 열면 안내가 뜨고 5초 뒤 가계부 `?tab=grocery`로 넘어간다.
  - 홈 화면에 설치한 예전 장보기 앱을 한 번 열면 서비스 워커가 지워지고 안내 페이지가 뜬다(실제 iPhone으로 사용자가 확인. 안 되면 무엇이 보였는지 기록).
- [ ] 장보기 저장소에서 식약처 워크플로가 더 이상 예약 실행되지 않는지 Actions에서 본다(파일 삭제로 꺼짐).
- [ ] (사용자) 장보기 저장소 Settings > Archive this repository. 이 세션에는 보관 기능이 없다.
- [ ] (사용자 결정) Edge Function `danawa-probe` 삭제 여부. 이 세션의 Supabase 도구에는 함수 삭제가 없으므로, 지운다면 대시보드에서 사용자가 한다. 지운 뒤 `list_edge_functions`로 확인해 기록한다.
- [ ] 가계부 작업 브랜치의 문서 커밋 c8de188(통합 2단계 기록)을 다음 `main` 병합 때 함께 올린다.
- [ ] `status.md`의 "통합 2·3단계"를 끝남으로 고친다.

완료 기준: 예전 주소가 안내 후 가계부로 넘어가고, 장보기 저장소는 보관됐으며, 식약처 동기화는 가계부 저장소에서만 돈다.

---

## P1. 장 본 것 → 가계부 내역 (D-011, 통합 설계 6-1·6-3)

**Architecture:**
- `grocery.items`에 가계부 내역을 가리키는 `transaction_id`를 둔다. 같은 가구의 내역만 가리키도록 `(transaction_id, household_id)`를 `public.transactions (id, household_id)`(가계부에 `unique (id, household_id)`가 있다)에 외래키로 걸고, 내역을 지우면 연결만 풀린다(`on delete set null (transaction_id)`).
- 연결은 함수로만 한다. `grocery.link_purchase`는 이미 연결된 품목을 막고, `grocery.record_purchase`는 장보기에서 넣을 때 가계부 함수 `public.add_transaction_with_items`를 부른 뒤 연결까지 한 번에 한다.
- 두 함수 모두 장보기 관례대로 security invoker(RLS를 그대로 따름)다.
- 화면 쪽 길은 둘이다. 길 ① 가계부 스마트 입력 확인 화면에서 영수증 상품과 장보기 품목을 맞춘다. 길 ② 장보기 목록에서 "가계부에 넣기" 시트를 쓴다.

**Files:**

| 파일 | 하는 일 |
|---|---|
| `supabase/migrations/20261021000000_grocery_purchase_link.sql` | `grocery.items.transaction_id`, 외래키·인덱스, 열 권한, `grocery.link_purchase`, `grocery.record_purchase` |
| `tests/grocery/purchaseDb.test.ts` | 위 함수·권한 PGlite 시험 |
| `src/grocery/lib/purchase.ts` | 분류 대응, 넣을 내역 만들기(나누기/한 내역), 영수증 상품 ↔ 장보기 품목 맞추기 |
| `tests/grocery/purchase.test.ts` | 위 계산 시험 |
| `src/grocery/lib/store.ts`, `supabaseStore.ts`, `types.ts`, `demo.ts` | `Item.transactionId`, `recordPurchase`, 메모리 저장소 |
| `src/grocery/components/RecordSheet.tsx`, `ListScreen.tsx`, `ListRow.tsx`, `grocery.css` | 길 ② 시트와 진입 버튼, 연결된 품목 표시 |
| `src/grocery/lib/ledgerLink.ts` | 길 ①에서 가계부 쪽이 쓰는 장보기 읽기·연결(연결 안 된 품목 목록, `link_purchase` 호출) |
| `src/lib/smart.ts`, `src/components/SmartSheet.tsx`, `src/styles.css` | 길 ①: `saveDraft`가 내역 id를 돌려주게, 확인 화면의 "장보기 목록에서 찾은 품목" 묶음 |
| `src/grocery/GroceryTab.tsx`, `src/App.tsx` | 장보기 탭에 가계부 분류·구성원·저장 뒤 다시 불러오기 넘기기 |
| `scripts/screenshots.mjs`, `scripts/shell-fixtures.mjs` | 새 화면 캡처(가짜 `extract-entries` 응답 포함) |

### Task P1-1: 연결 칸과 함수 (DB)

- [ ] `20261021000000_grocery_purchase_link.sql`:
  - `alter table grocery.items add column transaction_id uuid;`
  - `alter table grocery.items add foreign key (transaction_id, household_id) references public.transactions (id, household_id) on delete set null (transaction_id);`(참조만 하므로 경계 검사 허용 대상)
  - `create index items_transaction_idx on grocery.items (transaction_id) where transaction_id is not null;`
  - 열 권한: `transaction_id`는 `authenticated`의 update 권한에 넣지 않는다(함수로만 바꾼다). 함수가 security invoker이므로, 함수 안에서 바꾸려면 권한이 필요하다. 그래서 둘 중 하나를 시험으로 고른다. (a) `grant update (transaction_id)`를 주고 이미 연결된 값을 다른 값으로 바꾸는 것을 트리거로 막는다. (b) 연결 함수만 security definer로 두고 안에서 `private.is_household_member`와 같은 가구를 직접 확인한다. 장보기 관례가 invoker이므로 (a)를 먼저 시도한다 [제안].
  - `grocery.link_purchase(p_tx uuid, p_links jsonb)`: `p_links = [{item_id, paid}]`.
    - 내역이 보이지 않으면(RLS) `tx_not_found`.
    - 품목이 이미 연결돼 있으면 `already_linked`.
    - 아니면 `bought_at = coalesce(bought_at, (내역 날짜 + 12:00) at time zone 'Asia/Seoul')`, `bought_by = coalesce(bought_by, auth.uid())`, `paid = p_links.paid`(null 허용), `transaction_id = p_tx`. 바꾼 개수를 돌려준다.
  - `grocery.record_purchase(p_household_id uuid, p_entries jsonb)`: `p_entries = [{tx, items, links}]`. 항목마다 `public.add_transaction_with_items(p_household_id, tx, items)`를 부르고 돌려받은 id로 `link_purchase`를 부른다. 한 번의 호출 = 한 트랜잭션이라 중간에 실패하면 전부 되돌아간다. 만든 내역 id 배열을 돌려준다.
  - 권한: 두 함수 모두 `revoke execute … from public, anon`, `grant execute … to authenticated`.
- [ ] `tests/grocery/purchaseDb.test.ts`(`freshDb` 사용):
  - 같은 가구 내역 연결은 되고 산 것·금액이 채워진다.
  - 다른 가구 내역 id로는 연결되지 않는다(외래키 또는 `tx_not_found`).
  - 이미 연결된 품목은 `already_linked`.
  - 가계부 내역을 지우면 품목은 남고 `transaction_id`만 null이 된다.
  - `record_purchase`는 내역·품목·연결을 한 번에 만들고, 두 번째 항목이 실패하면 첫 항목도 남지 않는다.
  - anon은 실행할 수 없다. authenticated가 `transaction_id`를 직접 update해서 연결을 바꿀 수 없다((a)를 고르면 트리거로 막힌다).
  - `tests/grocery/boundary.test.ts`가 그대로 통과한다.
- [ ] 커밋. 공유 DB 적용은 P1 끝에서 사용자 확인 후 한다.

### Task P1-2: 계산 (분류 대응, 넣을 내역, 이름 맞추기)

- [ ] `src/grocery/lib/purchase.ts`:
  - `ledgerCategoryFor(item, categories)`: 대응표(통합 설계 6-3)대로 정한다.
    - 정육~음료 9개 → '장보기'.
    - 생활용품·기타 → 가계부 `suggestCategory(item.name, categories)`. 없으면 생활용품은 '생활용품', 기타는 '장보기'.
    - 대응 분류가 없거나 숨겨졌으면 '장보기', 그것도 없으면 null.
  - `buildEntries(items, input)`: `input = { date, place, scope, total | perItem }`.
    - 품목마다 금액이 있으면 품목마다 내역 하나(내역 이름 = 품목 이름, 품목 1줄, 분류는 품목별)로 만든다.
    - 총액만 있으면 내역 하나로 만든다. 이름은 가계부 규칙 "첫 상품 외 N건", 분류는 품목들의 대응 분류가 하나면 그것, 섞이면 '장보기'. 메모에 품목 이름을 쉼표로 적는다.
    - `transaction_items`는 금액(not null)이 필요하므로 이 경우 품목 줄은 넣지 않는다.
    - 금액은 사용자가 적은 값만 쓴다. 확인한 가격으로 채우지 않는다.
    - `source`는 `'manual'`로 한다(가계부 `TxSource`에 장보기용 값이 없고, DB check도 manual·text·photo·recurring뿐). 장보기에서 넣었다는 사실은 연결 칸으로 남는다.
  - `matchReceipt(receiptItems, groceryItems)`: 공백·기호를 뺀 소문자로 비교한다.
    - 장보기 품목 이름(2글자 이상)이 영수증 상품명에 들어 있거나 그 반대면 후보로 둔다. 한 글자 품목('파', '무')은 단어 전체가 같을 때만.
    - 한 영수증 상품에 후보가 여럿이면 긴 이름 순으로 둔다.
    - 결과는 제안일 뿐이고 화면에서 사용자가 고른다.
- [ ] `tests/grocery/purchase.test.ts`: 대응표 전부, 숨긴 분류, 나누기/한 내역의 합계가 입력 금액과 같은지, "첫 상품 외 N건", 이름 맞추기 경계('대파'↔'국산 대파 1단', '파'↔'파프리카' 안 맞음, '우유'↔'서울우유 900ml').
- [ ] 커밋.

### Task P1-3: 길 ② 장보기에서 "가계부에 넣기"

- [ ] `Item.transactionId`를 읽는다(`supabaseStore` 행 변환, 메모리 저장소, 데모).
- [ ] `ListStore.recordPurchase(entries)` → `rpc('record_purchase')`. 메모리 저장소도 같은 결과를 흉내 낸다.
- [ ] `RecordSheet.tsx`(장보기 시트 방식, 가운데 창 560px):
  - 넣을 품목 체크(기본: 오늘 산 것 중 연결 안 된 것).
  - 날짜(기본: 산 날).
  - 어디서(가계부 `PlatformInput`의 가게·플랫폼 목록).
  - 누구(공동·남편·아내·자녀 칩, 가계부와 같은 색 점 순서).
  - 금액: 총액 칸 하나와 "품목마다 적기" 펼침.
  - 품목별 분류 칩: 가계부 분류, 대응표로 미리 고름.
  - 저장 버튼 이름은 결과를 말한다("3개 23,400원 가계부에 넣기"). 금액이 비면 저장을 막고 이유를 문장으로 쓴다.
- [ ] `ListScreen`: 산 품목 묶음 아래에 "가계부에 넣기"(산 품목 중 연결 안 된 것이 있을 때만). 저장하면 알림 "가계부에 3건 넣었어요"를 띄우고, 가계부 쪽 내역을 다시 불러온다(`GroceryTab` → `App`의 `reload`).
- [ ] `ListRow`: 연결된 품목의 둘째 줄에 "가계부에 넣음"을 쓴다(산 사람·금액 옆, 쉼표로).
- [ ] 장보기 탭은 가계부 `meta.categories`·구성원·`lookup`이 필요하므로 `GroceryTab` props로 넘긴다.
- [ ] 화면 캡처: `grocery-record-sheet-{390,1280}-{light,dark}`, 연결된 줄이 있는 목록, 금액 빈 오류. 데모 데이터에 산 품목을 더한다.
- [ ] 커밋.

### Task P1-4: 길 ① 가계부 스마트 입력에서 연결

- [ ] `saveDraft`가 `{ installment: boolean, txId: string }`를 돌려주게 바꾼다(RPC가 이미 내역 id를 돌려준다). 부르는 곳(`SmartSheet.saveAll`)을 맞춘다. 가계부 `tests/smart.test.ts` 등 기존 테스트가 통과해야 한다.
- [ ] `src/grocery/lib/ledgerLink.ts`:
  - `openGroceryItems(householdId)`: 연결 안 된 품목. 안 산 것과 최근 7일 안에 산 것.
  - `linkGroceryItems(txId, links)` → `rpc('link_purchase')`.
  - 이미 연결된 최근 품목(흐리게 보일 것).
- [ ] `SmartSheet` 확인 화면(영수증·쇼핑 주문일 때만): 초안들 아래에 "장보기 목록에서 찾은 품목" 묶음을 둔다.
  - 줄 = 장보기 품목 ↔ 맞춘 영수증 상품(이름·금액). `matchReceipt` 결과를 미리 체크해 둔다. 장보기 품목과 맞는 게 없으면 묶음을 그리지 않는다.
  - 이미 가계부에 넣은 장보기 품목이 같은 이름으로 맞으면 흐리게 보이고 "이 장보기는 이미 넣었어요"라고 쓴다(통합 설계 6-1의 중복 안내).
  - 저장하면 초안마다 받은 `txId`로, 체크한 장보기 품목을 그 상품이 든 초안에 연결한다(`paid` = 그 상품 금액). 연결이 실패해도 내역 저장은 되돌리지 않고 "장보기 연결은 못 했어요"를 알린다.
- [ ] 가계부 DESIGN 규칙을 따른다: 문장형 제목, 점으로 이은 문자열 금지, 체크는 가계부 칩·체크 방식.
- [ ] 캡처: 셸 가짜 응답에 `extract-entries`(영수증 결과)와 장보기 품목을 넣고 `shell-smart-confirm-grocery-{390,1280}-{light,dark}`를 찍는다. 옮기기 전 확인 화면과 비교해 묶음 말고는 같아야 한다.
- [ ] 커밋.

### Task P1-5: 적용·확인

- [ ] `npm test`, `npm run build`, `npm run screens`(자동 검사 통과, 눈으로 확인).
- [ ] 사용자 확인 뒤 MCP `apply_migration`(`grocery_purchase_link`). 적용 뒤 확인할 것:
  - `grocery.items`에 열과 외래키가 생겼다.
  - 두 함수의 권한이 맞다.
  - 보안 점검 결과에 새 항목이 생겼으면 기록한다.
- [ ] (사용자 지시로) `main` 병합·배포. 두 기기에서 길 ①·② 각각 한 번씩 확인한다.
- [ ] `status.md`, README "지금 들어 있는 기능"을 고친다. D-011 구현 메모를 남긴다.

**Review Focus (P1):**
- 금액은 사용자 입력 또는 영수증 값만 쓴다. 장보기 확인 가격이 낸 금액으로 들어가면 실패다.
- 연결 안 된 품목만 넣을 수 있다. 같은 품목을 두 길로 두 번 넣지 못한다.
- 다른 가구의 내역 id로 연결할 수 없다.
- 길 ①의 연결이 실패해도 영수증 내역 저장은 남는다.

---

## P2. 가계부 기록 → "우리가 산 값" (통합 설계 6-2)

**Architecture:**
- 품목 상세 가격 탭에 "우리가 산 값"(연결된 기록 + "맞아요"를 누른 기록)과 "이름이 비슷한 우리 기록"(확인 전)을 따로 둔다.
- 읽기는 장보기 함수 `grocery.our_purchases(p_item)`(security invoker)가 가계부 `transactions`·`transaction_items`를 RLS 아래에서 읽어 돌려준다.
- "맞아요/아니에요"는 `grocery.purchase_verdicts`에 가구 단위로 남긴다. 키는 장보기 품목의 `grocery.name_key(name, spec)` + 가계부 품목 id다.
- 과거 값이라 "가장 싼 값"으로 뽑지 않는다(화면 설계 4절).

**Files:** `supabase/migrations/20261021010000_grocery_our_purchases.sql`, `tests/grocery/ourPurchasesDb.test.ts`, `src/grocery/lib/products.ts`(타입·단위가격), `src/grocery/lib/supabaseStore.ts`·`store.ts`·`demo.ts`, `src/grocery/components/ItemDetail.tsx`, `grocery.css`, 캡처.

### Task P2-1: 표와 읽기 함수

- [x] `grocery.purchase_verdicts`:
  - 열: `household_id`(→ households cascade), `name_key text`, `transaction_item_id uuid`(→ `public.transaction_items(id)` on delete cascade), `same boolean`, `decided_by`(→ members set null), `decided_at`.
  - pk: `(household_id, name_key, transaction_item_id)`.
  - RLS: 구성원만 select·insert·update.
- [x] `grocery.our_purchases(p_item uuid)` → `(kind text, transaction_id, transaction_item_id, occurred_on, platform, place, created_by, name, quantity, unit_price, amount, pack_size, pack_unit)`.
  - `kind`는 `'linked' | 'confirmed' | 'similar'`.
  - `linked`: `grocery.items.transaction_id`의 내역. 품목 줄이 여럿이면 이름이 가장 잘 맞는 줄. 품목 줄이 없으면(총액만 넣은 경우) 단위 가격을 비운 내역 한 줄.
  - `confirmed`: verdict `same = true`.
  - `similar`: 최근 365일 가계부 품목 중 이름 단어가 맞는 것. `same = false`와 이미 linked·confirmed는 빼고 최대 20줄.
  - 맞추는 규칙은 `grocery._alert_hits`의 단어 일치 방식을 따른다(한 글자는 단어 전체).
- [x] 시험:
  - 남의 가구 기록은 나오지 않는다.
  - "아니에요"를 고른 기록은 다시 나오지 않는다.
  - 가계부 품목을 지우면 verdict도 지워진다.
  - 총액만 넣은 내역은 단위 가격이 비어 있다.
  - 경계 검사가 통과한다.

### Task P2-2: 화면

- [x] `ItemDetail` 가격 탭 아래에 "우리가 산 값" 묶음:
  - 줄 = 날짜, 산 사람(색 점 + 이름), 곳(플랫폼 또는 가게), 개당 가격, 100g·1개당 가격.
  - 출처 태그는 "우리가 산 값"(`blush-soft` 바탕, `rose-ink` 글자, `docs/grocery/DESIGN.md`).
  - 단위 가격 계산은 가계부 `src/lib/units.ts`의 `perUnit`을 쓴다.
- [x] 그 아래 "이름이 비슷한 우리 기록"(가계부에 적힌 원래 상품명·용량·날짜)과 줄마다 "같은 상품 맞아요" / "아니에요". 누르면 저장하고 목록을 다시 읽는다.
- [x] 요약 칸 "가장 싼 값"과 목록 최저가 계산에 우리가 산 값이 들어가지 않음을 테스트로 고정한다(`bestPrice` 입력에 과거 값이 들어오면 무시).
- [x] 캡처: 데모에 우리 기록을 더해 `grocery-item-detail-price-ours-{390,1280}-{light,dark}`.

### Task P2-3: 적용·확인

- [ ] 테스트·빌드·캡처 → 사용자 확인 뒤 `apply_migration` → (지시로) 배포 → 실제 가구 데이터에서 비슷한 기록이 얼마나 잡히는지 보고, 잘못 붙는 예를 `status.md` 열린 문제에 적는다.

---

## P3. 가격 출처 넓히기 (④-2, 가격 확인 설계 4-3·6·7절)

**먼저 확인할 것** (실제 호출, 결과로 `docs/grocery/data-sources.md`를 고친 뒤 코드):
1. 에누리·컬리·홈플러스·CJ더마켓: 상품 주소를 찾는 방법(사이트 검색이 robots 허용이고 서버 HTML로 오는지). 안 되면 다나와 상품명으로 검색 API(Exa 등)를 써서 주소만 찾는다. 검색 API 키가 필요하면 사용자에게 묻는다.
2. 쿠팡 상품 번호 찾기(로우차트용, 로우차트 검색은 robots 금지).
3. 각 몰 약관의 자동 수집 조항.
4. 참가격 API 실제 응답(판매점별 가격·조사일), 분당구 근처 조사 판매점, 품목 대응(사용자 키 필요).
5. 다나와 수량 탭별 가격을 상품 페이지에서 읽을 수 있는지.
6. 막힌 출처는 빼고 바로가기·캡처(P4)로 메운다. 무엇을 뺐는지 사용자에게 알린다.

**DB (grocery만):**
- `price_checks.source`의 check(`= 'danawa'`)를 출처 목록으로 넓힌다.
- 다른 출처 상품과 고른 상품의 연결 기억 `grocery.source_links`(가구, product_id, source, source_id, same boolean). 브랜드·용량·개수가 모두 맞으면 자동으로 같은 상품으로 보고, 애매하면 "같은 상품인지 확인 필요"로 둔다.
- 참가격 매장 가격 `grocery.store_prices`(판매점, 품목, 가격, 조사일).
- 사는 곳·자주 가는 매장 `grocery.household_prefs`.

**함수:**
- `product-check`에 출처별 모듈(`_shared/<source>.ts`, 각자 응답 사본 fixture 시험)을 더한다. 출처 하나가 실패해도 나머지는 저장하고, 실패한 출처는 "○○ 가격을 지금 불러오지 못했어요"로 남긴다.
- 참가격 수집 함수(격주 조사, 하루 한 번 확인).
- 하루 한 번 다시 확인 `price-recheck`: GitHub Actions 07:30(한국 시간), `verify_jwt false`. 식약처 동기화처럼 스스로 막는다(20시간 1회·잠금). 다나와 10초 간격을 지킨다.
- I2810 해외 위해식품 회수를 `food-alerts-sync` 서비스 목록에 더한다(사용자 활용신청 뒤 실제 호출 확인).

**화면:**
- 가격 탭 줄 목록: 출처 태그·확인 시각·배송비. "다른 용량" 묶음, "같은 상품인지 확인 필요" 묶음(맞아요/아니에요).
- "어디서 살지" 보기: 온라인 최저가(배송비 포함)와 매장 기준 가격(참가격 → P2의 우리가 산 매장 값)이 둘 다 있을 때만 판단하고, 아니면 "비교 못 함".
- 사는 곳·자주 가는 매장 설정: 가계부 설정 화면에 "장보기" 묶음을 둔다 [제안].

**완료 기준:**
- 붙인 출처마다 fixture 시험이 있다.
- 실제 상품 3개 이상에서 화면 값이 출처 페이지와 같다(사람이 대조).
- 실패 출처가 화면에 실패로 드러난다.
- "가장 싼 값"은 오늘·같은 상품·같은 수량에서만 고른다.


### P3 세부 계획 (2026-10-19, 실제 호출 확인 뒤)

확인 결과는 `docs/grocery/data-sources.md` 1-2·2절, 결정은 D-013. 바뀐 점: 에누리·CJ더마켓 뺌, 몰 검색 대신 주소 붙여넣기, 하루 한 번 다시 확인은 P3 끝에.

- [x] **P3-1 몰 상품 페이지 읽기** `supabase/functions/_shared/shops.ts`: 붙여 넣은 주소를 정리(컬리 `goods/{id}`, 홈플러스 `item?itemNo=&storeType=`, 쿠팡 `vp/products/{pid}?itemId=` → 로우차트 `{pid}-{itemId}`, 로우차트 주소 그대로). 짧은 주소(link.coupang.com 등)와 다른 사이트는 거절. JSON-LD에서 이름·가격(양의 정수만, 0은 버림)·평점·후기 수, 로우차트 관측 최저·최고·평균가와 최근 변동일. 사본 fixture(후기 본문은 지움)로 시험.
- [x] **P3-2 참가격 읽기** `supabase/functions/_shared/tprice.ts`: XML 항목(`iros.openapi.service.vo.*`)을 판매점·상품·가격 행으로. 성남 지역 상세코드(020918000·020919000·020925000)만. 조사일 후보는 최근 5주의 금요일. fixture는 실제 응답 값으로 만든 XML.
- [x] **P3-3 DB** `20261023000000_grocery_sources.sql`(grocery만): `shop_links`(가구·상품·출처·주소, 가구 RLS, 주소 모양 check), `shop_checks`(출처·출처 id·확인 시각·성공·이름·가격·평점·관측값, 읽기만), `tprice_stores`·`tprice_goods`·`tprice_prices`(공개 자료 읽기), `store_links`(가구·이름 열쇠 → 참가격 상품, 가구 RLS), `household_prefs`(가구·자주 가는 매장), `sync_lock` id 3. PGlite 시험.
- [x] **P3-4 함수**: `product-check`가 다나와 다음에 가구가 넣은 주소들을 읽는다(출처·주소마다 하루 한 번, 하나가 실패해도 나머지 저장). `tprice-sync`(verify_jwt false, 20시간 1회·잠금 id 3): 판매점·상품 목록, 성남 판매점 × 최근 금요일 가격. 워크플로 매일 07:20.
- [x] **P3-5 화면**: 품목 상세 가격 탭에 "주소를 넣은 곳"(출처 태그·확인 시각·상품 이름, 가장 싼 값에는 넣지 않음)과 주소 넣기·빼기, "매장 가격(참가격)"(조사일, 고른 매장, 참가격 상품 고르기·바꾸기, 매장 고르기). 데모·캡처.
- [x] **P3-6 적용·확인**(2026-10-20): 마이그레이션·함수 배포·첫 수집·보안 점검·status 됨. 실제 상품 3개 이상 대조는 로그인이 필요해 사용자가 앱에서(HANDOFF 5절 4).
- [x] **P3-7 하루 한 번 다시 확인** `price-recheck`(안 산 품목의 고른 상품, 07:30). P3-6 뒤.

---

## P4. 사진으로 상품 찾기·캡처로 가격 넣기 (④-3, D-009)

**먼저 확인할 것:** 가계부 `extract-entries`와 같은 WIF 교환이 새 함수에서도 되는지 첫 호출로 본다. 같은 Supabase 로그인 토큰, 같은 federation rule(`household_id` 조건), `private.ai_households` 허용 목록이 해당한다. 안 되면 사진·캡처 기능을 미루고, 콘솔 규칙 수정과 API 키 중 무엇으로 갈지 사용자에게 묻는다. 묻지 않고 API 키로 바꾸지 않는다.

**함수:**
- `grocery-photo`(`verify_jwt true`) 하나에 두 가지 일을 둔다.
  - `product`: 포장 앞면 → 제품명·브랜드·용량.
  - `price`: 쇼핑몰 캡처·가격표 → 판매처·상품명·가격·수량·용량.
- WIF 교환 코드는 `extract-entries`에서 `_shared/anthropic-wif.ts`로 복사해 쓴다. `extract-entries` 자체는 이 단계에서 고치지 않는다(다시 배포하지 않게).
- 모델·프롬프트는 만들 때 `claude-api` 스킬로 현재 모델 이름을 확인해 정한다(가계부는 Haiku 5.5·Sonnet 5.5를 쓴다). 읽히지 않는 글자는 추측하지 말고 빼라고 지시한다.

**DB:** `grocery.captured_quotes`(가구, product_id, seller, price, qty, delivery, unit_price, captured_at, captured_by). 가구 RLS를 건다(다른 가격 표는 공용 캐시지만 캡처는 가구 것이다).

**화면:**
- 후보 시트와 후보 0개 줄에 "사진으로 찾기". 읽은 값을 확인·고친 뒤 그 값으로 다나와를 다시 검색한다. 읽은 값은 검색어로만 쓴다.
- 가격 탭 바로가기 옆에 "화면 캡처로 가격 넣기". 확인 화면을 거쳐 저장하면 출처 "캡처", 캡처 시각, 올린 사람과 함께 가격 줄이 된다. 오늘 캡처한 값은 "가장 싼 값" 후보가 된다.
- 진행 문구는 "사진 읽는 중"처럼 하는 일 그대로 쓴다. "분석 중"·반짝이는 쓰지 않는다.
- 사진 줄이기·자르기는 가계부 `src/lib/image.ts`를 쓴다.

### P4 진행(2026-10-19 로컬)

- [x] `grocery-photo` 함수(product·price), `_shared/anthropic-wif.ts`(extract-entries에서 옮겨 적음), `photo.ts` 시험.
- [x] `grocery.captured_quotes`와 `item_prices()`에 오늘 캡처 값 포함(`20261025000000_grocery_captured_quotes.sql`).
- [x] 후보 시트 "사진으로 찾기", 가격 탭 "화면 캡처로 가격 넣기", 확인 화면을 거친 값만 저장, 출처 "캡처(올린 사람)". 캡처 6장.
- [ ] 배포 뒤(2026-10-20 v1 배포됨) 첫 호출로 WIF 교환 확인 — 로그인이 필요해 사용자가 앱에서 사진 1장 올려 본다(안 되면 함수 로그 `wif_exchange_failed`). 실제 포장 사진 3장·캡처 3장 대조.
- [ ] `list` 일(메모·냉장고·영수증 사진 → 품목 목록)은 P6에서.

**완료 기준:**
- 실제 포장 사진 3장, 캡처 3장으로 사람이 대조했다.
- 저장 전 확인 화면에서 고친 값만 저장된다.
- 키가 브라우저·저장소에 없다.

---

## P5. 농수산물 시세 (③, 화면 설계 8·8-3절)

**먼저 확인할 것**(사용자 KAMIS 키 뒤): 일별 API의 축산물 포함 여부, 갱신 시각, 호출 한도, 성남(또는 가까운) 지역 코드, 품목 코드표. 결과로 `data-sources.md` 3절을 고친다.

**DB:**
- `grocery.market_items`(KAMIS 품목·품종·등급 코드와 장보기 이름 사전 대응).
- `grocery.price_points`(품목 코드, 지역, 날짜, 소매가, 단위, 출처 `kamis`). 매일 쌓아 30일 추이를 그린다.
- `grocery.watch`(가구, 품목 코드).

**함수:** `market-sync`(GitHub Actions, KAMIS 갱신 시각 뒤 하루 한 번, 스스로 막기). 지켜보는 품목과 목록의 신선 품목만 받는다.

**화면:**
- 장보기 탭 안에 "목록 | 시세" 전환을 둔다(통합 설계 3-2). 아래 탭은 늘리지 않는다.
- 시세 화면: 맨 위 "KAMIS 소매가격, 갱신 시각", 지켜보는 품목(현재가, 30일 추이, 1주 전·평년 대비), 이번 주 움직임(내린 것·오른 것, 기간 전환), 식약처 최근 회수.
- 등락은 `clay` ▲ / `indigo` ▼에 숫자와 기준일을 함께 쓴다. 쌓인 날이 30일 미만이면 "○월 ○일부터 기록"이라고 적는다. 그래프는 `dataviz` 스킬과 DESIGN 차트 규칙을 따른다.
- 신선 품목(정육·수산·채소·과일) 줄: "농수산물 시세로 확인(준비 중)"을 시세 값으로 바꾼다.
- 신선 품목 상세: 요약(오늘 시세, 1주 전 대비, 평년 대비, 식약처 기록)과 탭(시세 | 가격 | 안전). 대응이 없으면 "확인 못 함".

**완료 기준:**
- 화면의 시세가 KAMIS 응답과 같다(사람이 대조).
- 지역 표기가 있다.
- 쌓인 기간이 표시된다.


### P5 세부 계획 (2026-10-19, 실제 호출 확인 뒤)

확인 결과는 `docs/grocery/data-sources.md` 3-1, 결정은 D-012. 바뀐 점: KAMIS 직접 API 대신 공공데이터포털 15156057(일별, 조사처별), 평년 대신 1년 전, 성남 조사처 값 + 주변 범위.

- [ ] **P5-1 품목 사전·응답 해석** `supabase/functions/_shared/market.ts`(함수와 화면이 함께 쓴다).
  - `MARKET_ITEMS`: 정해 둔 품목(부류·품목 코드, 화면 이름, 축산물이면 전국). 채소·과일·버섯·감자류·축산(소·돼지·닭·계란·수입 돼지고기)·수산.
  - `matchMarket(name)`: 장보기 품목 이름 → {품목 코드, 품종 코드(있으면)}. 긴 키워드 먼저, 한 글자는 단어 전체.
  - `parseRows(json)`: 응답 → 저장할 행. 소매(`se_cd` 01)만, 서울(1101)·수원(3111)·성남(3112)과 전국(1000)만, 가격이 양의 정수가 아니면 버린다. 축산물 `exmn_dd_cnvs_prc`는 쓰지 않는다.
  - `marketPriority(sgg, mrkt)`: 전국 0, 성남 B-유통 1, 수원 2, 서울 3.
  - 테스트 `tests/grocery/market.test.ts`.
- [ ] **P5-2 DB** `supabase/migrations/20261022000000_grocery_market.sql`(grocery만).
  - `grocery.price_points`: 품목·품종·등급·시군구·시장·조사일 유일. 이름·단위·가격·원본등록일시·받은 시각. 로그인한 사용자 읽기, 쓰기는 서비스 롤.
  - `grocery.watch`: 가구·품목·품종·등급. 가구 RLS(items와 같은 방식).
  - `grocery.sync_lock`에 시세용 행(id 2).
  - `grocery.market_board()`: 시리즈(품목·품종·등급)마다 고른 조사처(우선순위가 가장 높고 최근 14일 안에 값이 있는 곳)의 최근 값·날짜, 이전 조사일·1주 전(7~21일 전)·1개월 전(30~45일 전)·1년 전(365~379일 전) 값과 날짜, 그날 주변 조사처 최저·최고·수.
  - `grocery.market_trend(...)`: 그 조사처의 최근 45일 값과 날마다 주변 최저·최고.
  - 테스트 `tests/grocery/marketDb.test.ts`(PGlite), `boundary.test.ts` 통과.
- [ ] **P5-3 수집 함수** `supabase/functions/market-sync`(verify_jwt false, 스스로 막기: 20시간 안에 성공했으면 건너뜀, 잠금 30분).
  - 품목마다 최근 범위(값이 없으면 45일, 있으면 10일)와 1년 전 범위(없을 때만)를 받는다. 동시에 4개까지, 100초가 넘으면 남은 품목은 다음 실행으로 미루고 207.
  - 키는 `DATA_GO_KR_SERVICE_KEY`(앞뒤 공백 제거), 오류 문구에서 키를 가린다. `sync_runs`에 `kamis` 기록.
  - `.github/workflows/market-sync.yml`: 매일 07:10(한국 시간)과 수동 실행.
  - 테스트 `tests/grocery/marketSync.test.ts`.
- [ ] **P5-4 화면**
  - 장보기 탭 위에 "목록 | 시세" 전환(사람마다 기억).
  - 시세 화면: 맨 위 "KAMIS 소매가격(공공데이터포털), 받은 시각, 조사일". 지켜보는 품목(큰 숫자 = 조사처 값, 조사처·날짜, 1주 전 비교, 45일 추이 선과 주변 범위 띠), 이번 주 움직임(1주 전 | 1개월 전 | 1년 전, 내린 것·오른 것 각 5개, 이전 값 → 지금 값), 식약처 최근 회수·판매중지 5건.
  - 시세 상세(시트): 표(최근·이전 조사일·1주·1개월·1년 전), 추이 그래프, 그날 주변 조사처 값, 기록 기간, 지켜보기.
  - 신선 품목: 목록 줄 둘째 줄에 "시세 1,980원/1kg, 성남 10월 16일", 품목 상세는 요약(오늘 시세·1주 전·1년 전·식약처) + 탭 시세 | 가격 | 안전. 대응이 없으면 "확인 못 함".
  - 데모·캡처(390·1280, 라이트·다크).
- [ ] **P5-5 적용·확인**(사용자 확인 뒤): 마이그레이션 적용, 함수 배포, 첫 실행, 화면 값과 API 응답 대조, 보안 점검, status 갱신.

---

## P6. 사진·바코드로 담기, 매대 앞 바로 확인 (화면 설계 7절, 데이터 출처 7절)

**먼저 확인할 것:**
- 바코드 읽기: iPhone Safari PWA에서 카메라로 바코드를 읽는 방법. 브라우저 내장 `BarcodeDetector` 지원 여부와 대안 라이브러리(라이선스·크기)를 확인한다. 추측입니다: Safari는 `BarcodeDetector`를 지원하지 않을 수 있다.
- 바코드 → 상품명 성공률: JSON-LD `gtin13`, 검색 API, 실패 시 포장 사진(P4 `product`). 공공 바코드 DB(C005 등)는 2018년 이후 갱신이 멈춰 쓰지 않는다.

**기능:**
- 바코드를 찍으면 먼저 `grocery.food_alerts.barcode`와 바로 대조한다. 바코드가 일치하면 "기록 있음"(화면 설계 8-2)이다. 그다음 상품을 찾는다. 실패해도 대조 결과는 먼저 보여 준다.
- 매대 앞 확인 화면: 목록에 담지 않고 품목 상세를 연다. 아래에 "목록에 담기"를 둔다. 입구는 목록 아래 "바코드로 상품 보기"와 담기 시트다.
- 사진으로 담기: 메모·냉장고·영수증 사진 → 품목 목록. P4 함수에 `list` 일을 더한다. 확인 목록을 거쳐 담는다.
- CSP: 카메라는 `getUserMedia`라 CSP 변경이 필요 없을 것으로 본다(확인 필요). 라이브러리는 번들에 넣는다(외부 스크립트 금지).

### P6 진행(2026-10-19 로컬)

- [x] 바코드 읽기 방법: 내장 `BarcodeDetector` 또는 `barcode-detector` 포니필(MIT, wasm 1.1MB 번들, CSP `'wasm-unsafe-eval'`). Safari는 포니필로 가는 것으로 본다(실기기 확인 필요).
- [x] 바코드 시트: 식약처 바코드 대조 먼저 → 다나와 검색 → 담기. 입구는 목록 아래와 담기 시트.
- [x] 사진으로 담기(`grocery-photo` `list`).
- [ ] 실제 상품 바코드 10개 성공률(사용자, 실기기).

**완료 기준:** 실제 상품 바코드 10개로 성공률을 기록하고, 회수 목록 바코드 일치 시험(fixture)이 있다.

---

## P7. 성분·대안 탭 (⑤, 화면 설계 5절)

**먼저 확인할 것:** 식품영양성분DB 응답 필드와 개별 제품이 잡히는 비율, C002 원재료 조회 조건, 브랜드 평가에 쓸 다나와 평점 표본 수.

**기능:**
- 성분 탭: 영양성분(기준량 명시)과 원재료. "식품유형명이 섞여 포장지 표시와 다를 수 있음"을 안내하고, 값이 없으면 "확인 못 함".
- 대안 탭: 이유 태그(평가가 좋음, 브랜드 평가가 좋음, 성분 수치가 나음, 더 쌈). 숫자만 쓰고 판정 문장은 쓰지 않는다. 회수·부적합 기록이 있는 상품은 뺀다. 모든 후보와 수치는 출처에서 온 것이어야 한다.
- 요약 칸 "더 나은 상품"을 채운다.

세부는 확인 뒤 이 문서에 덧붙인다.

### P7 진행(2026-10-19 로컬)

- [x] 확인: C002 sample 키 실제 호출(항목 이름), 영양성분DB 명세(실제 호출은 키 활용신청 뒤).
- [x] `_shared/foodInfo.ts`, `food-info` 함수(search·choose), `grocery.product_info`(가구 단위).
- [x] 성분 탭(원재료·영양성분 표·안내·품목 고르기 시트), 대안 탭(더 쌈·평가가 좋음, 숫자만), 요약 칸 "더 나은 상품". 캡처 6장.
- [ ] 영양성분DB 키 활용신청·실제 호출 확인(사용자), 후보의 회수·부적합 대조(확정할 결정).

---

## P8. 열린 문제 정리 (`docs/grocery/tracking/status.md` "열린 문제")

작은 것부터 다른 단계 사이에 끼워 넣는다. 각 항목은 재현 조건을 적고 시험을 더한 뒤 고친다.

- [ ] 빼기 되돌리기: 두 번째 품목을 빼면 첫 번째의 되돌리기 알림이 사라진다(첫 번째는 그대로 빠짐). 5초 안에 연달아 뺀 품목을 한 알림("2개 뺐어요" + 되돌리기)으로 합쳐 함께 되돌릴지 사용자와 정한다.
- [ ] Realtime DELETE 이벤트가 `grocery.items`(RLS)에서 실제로 오는지 두 기기로 확인한다.
- [x] 식약처 확인 상태가 `sync_runs` 최근 30건에서만 서비스별 마지막 성공을 찾는 문제. `grocery.last_synced()`(20261027000000)로 고쳤다.
- [ ] I2715 해외직구 기록의 "비슷한 기록" 알림 피로. 실제 목록에서 몇 개 뜨는지 기록하고, 줄일 방법(차단 종료일, 단어 길이 기준)을 사용자와 정한다.
- [ ] 담기 자동 나누기 사전, 기본 수량 표: 실제로 틀린 예가 쌓이면 고친다.
- [x] 화면 캡처 셸의 가짜 데이터에 상품 상세 정보를 더해 셸 안 품목 상세도 내용까지 보이게 한다(2026-10-19 로컬).

---

## 사용자 할 일 모음

| 언제 | 할 일 |
|---|---|
| 지금 | 두 기기에서 장보기 탭 확인(P0). 확인되면 장보기 안내 페이지 배포 지시 |
| P0 뒤 | 장보기 저장소 보관(Settings), `danawa-probe` 삭제 여부 |
| P1·P2 끝 | 마이그레이션 적용 확인, 배포 지시, 두 기기 확인 |
| P3 전 | 공공데이터포털 "한국소비자원_생필품 가격 정보" 키 신청 → Supabase Secrets, 식품안전나라 I2810 활용신청 |
| P5 전 | KAMIS 인증키·ID |
| 언제든 | 식품안전나라 식품 제품·건강기능식품 서비스 활용신청(`data-sources.md` 5-1) |
