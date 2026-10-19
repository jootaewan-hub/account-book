# 장보기 통합 1단계: 옮기기 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 장보기 앱(`jootaewan-hub/grocery-app` main 2578f58)의 화면·계산·테스트·마이그레이션 파일·Edge Function 소스·함수 설정·식약처 예약 워크플로·문서를 가계부 저장소로 옮긴다. 가계부 아래 탭에 '장보기'를 넣고, 설정은 톱니 버튼으로 연다. 장보기 화면은 옮기기 전과 똑같이 동작해야 한다.

**Architecture:**
- 장보기 코드는 `src/grocery/` 아래에 통째로 둔다.
- 진입점 `GroceryTab`이 가계부가 이미 불러온 가구·구성원(`useLedgerMeta`)과 가계부 Supabase 클라이언트(`sb()`)로 장보기 저장소(`createSupabaseStore`)를 만들어 `ListScreen`에 넘긴다. 로그인·가구 확인·PWA 갱신은 가계부 것만 쓴다.
- 장보기 CSS는 `.grocery` 상자 안에서만 먹고, 가계부 CSS의 겹치는 선택자는 장보기 상자 안으로 새지 않게 막는다.
- 서버 쪽 파일(마이그레이션·함수·`config.toml`·워크플로)은 내용을 바꾸지 않고 옮긴다.

**Tech Stack:** Vite + React 19 + TS, Vitest, PGlite(DB 시험), Supabase Edge Functions(Deno), Playwright(화면 캡처).

**Spec:** `docs/superpowers/specs/2026-10-19-grocery-integration-design.md`(이하 설계). 이 계획은 설계 7절의 1단계만 다룬다. 2단계(main 병합·배포·가계부 쪽 식약처 워크플로 수동 실행), 3단계(예전 장보기 안내 페이지·워크플로 끄기·보관)는 사용자 지시로 따로 한다. 4단계부터(장 본 것 → 가계부, 우리가 산 값)는 다음 계획이다.

## Global Constraints

- **공유 DB에는 아무것도 적용하지 않는다.** 마이그레이션 파일은 바이트 그대로 옮긴다(이미 적용된 기록과 같아야 한다). `apply_migration`·`deploy_edge_function`·`supabase db push`·함수 배포를 하지 않는다. Supabase MCP는 읽기(`get_edge_function`, `list_edge_functions`)만 쓴다.
- 장보기 화면의 동작·문구·숫자는 바꾸지 않는다. 바꾸는 것은 설계가 정한 것뿐이다: 목록 머리의 제목·로그아웃을 가계부 위쪽 줄·설정으로 옮기기, 화면 아래 고정 요소를 가계부 아래 탭 위로 올리기.
- 장보기 규칙(장보기 `CLAUDE.md` "반드시 지킬 것")은 장보기 부분에 그대로 적용한다. 출처 있는 숫자만, "찾은 기록 없음"은 "안전함"이 아님, API 키는 서버에만, 가구 RLS, AI처럼 보이지 않게, 390·1280px 라이트·다크 캡처 확인이 해당한다.
- 브라우저 번들에 비밀값이 없어야 한다. 공개용 키 외의 키(`service_role`, `sk-ant`, 식품안전나라 키)가 `dist/`에 없음을 Task 9에서 확인한다.
- 가계부 화면(달력·내역·통계·고정·설정)은 위쪽 줄 톱니 버튼과 왼쪽 메뉴 "설정" 줄 말고는 바뀌지 않는다. 겹치는 클래스 10개(`.seg` `.sheet` `.sheet-head` `.summary` `.tag` `.check` `.empty` `.who` `.who-husband` `.who-wife`)가 양쪽으로 새지 않음을 캡처로 확인한다.
- 작업 브랜치는 `claude/optimistic-newton-rp08ut`이다. 커밋은 Task마다 한국어로 하고, 끝에 아래 두 줄을 붙인다. main 병합·푸시는 사용자 지시가 있을 때만 한다.
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_018cJe2Fw6PAFf9eqegQtjhx
  ```
- 장보기 원본은 고정한다: `git -C <장보기 clone> rev-parse HEAD`가 `2578f58dddfe14b3bf11c0aadf81f3975143c58a`인 상태에서만 파일을 가져온다. 그 사이 장보기 main이 움직였으면 멈추고 사용자에게 묻는다(설계: 옮기는 동안 장보기 저장소에는 새 기능을 넣지 않는다).

## Review Focus

1. **CSS 새는 곳.** 가계부 `.sheet`는 `position: fixed`·`max-width: var(--col)`·넓은 화면 가운데 창 규칙을 가진다. 장보기 시트도 `.sheet` 클래스를 쓴다. 막지 않으면 장보기 담기·후보·상세·경고 시트의 위치가 바뀐다. 반대로 장보기 `.seg`(그리드)가 가계부 설정·입력의 `.seg`를 바꾸면 안 된다. Task 5 캡처에서 본다.
2. **화면 아래가 겹치는 곳.** 장보기 `.bottom-bar`(담기)와 `.notice-slot`(되돌리기 알림)은 `bottom: 0` 기준 고정이다. 가계부 `.tabbar`(z-index 24)도 `bottom: 0` 고정이다. 휴대폰에서 담기 버튼과 되돌리기 알림이 아래 탭에 가려지거나 아래 탭을 가리면 실패다. Task 5에서 본다.
3. **로그아웃 순서.** 장보기는 미뤄 둔 빼기(되돌리기 알림 동안 기다리는 삭제)를 서버에 보낸 뒤에 세션을 끝낸다. 세션이 먼저 끝나면 삭제가 거부되고 뺀 품목이 되살아난다. 가계부 설정의 로그아웃도 이 순서를 지켜야 한다. Task 6에서 시험한다.
4. **D-003 경계.** 옮긴 장보기 마이그레이션이 `public` 스키마 객체를 만들거나 바꾸지 않는지 자동으로 검사한다(Task 3). 앞으로 누가 장보기 파일에 `public` DDL을 넣어도 테스트가 실패해야 한다.
5. **함수 설정이 바뀌는 곳.** `supabase/config.toml`이 생기면 저장소에서 함수를 배포할 때 그 파일의 `verify_jwt`가 쓰인다. 가계부 함수 `extract-entries`·`export-csv`의 지금 설정과 다른 값이 적히면, 다음 배포 때 가계부 함수 보안이 바뀐다. Task 1에서 실제 값을 읽고 Task 2에서 그대로 적는다.

---

## 파일 구조

장보기 경로(왼쪽)는 2578f58 기준이고, 오른쪽은 가계부 저장소 안의 새 위치다.

| 장보기 | 가계부 | 처리 |
|---|---|---|
| `src/components/{ListScreen,ListRow,AddSheet,CandidateSheet,ItemDetail,AlertSheet}.tsx` | `src/grocery/components/` | 옮김. `ListScreen` 머리만 고침(Task 6) |
| `src/lib/{alerts,categories,contrast,format,listView,parse,prefs,products,staples,store,supabaseStore,types}.ts` | `src/grocery/lib/` | 옮김 |
| `src/lib/session.ts` | `src/grocery/lib/membership.ts` | `Membership` 타입과 `toMembership`만 남김. `loadMembership`, `loginErrorMessage`는 버림 |
| `src/demo.ts` | `src/grocery/demo.ts` | 옮김(개발 서버 전용) |
| `src/styles/app.css` + `tokens.css`의 장보기 전용 부분 | `src/grocery/grocery.css` | 합쳐서 `.grocery` 아래로(Task 5) |
| `src/App.tsx`, `main.tsx`, `components/Login.tsx`, `components/NoHousehold.tsx`, `lib/appView.ts`, `lib/supabase.ts`, `lib/supabaseConfig.ts`, `lib/pwaUpdate.ts`, `lib/csp.ts`, `src/assets/`, `public/`, `index.html`, `vite.config.ts` | — | 버림(가계부 것을 씀). CSP 값은 가계부로 합침(Task 6) |
| `supabase/migrations/*_grocery_*.sql` 7개 | `supabase/migrations/` | 바이트 그대로 |
| `supabase/functions/{_shared,food-alerts-sync,product-search,product-check}/` | `supabase/functions/` | 그대로 |
| `supabase/config.toml` | `supabase/config.toml` | 가계부 함수 두 개 설정을 더해서(Task 2) |
| `.github/workflows/food-alerts-sync.yml` | `.github/workflows/` | 그대로 |
| `.github/workflows/deploy.yml` | — | 버림(가계부 것을 씀) |
| `scripts/screenshots.mjs`, `scripts/make-icons.mjs` | `scripts/screenshots.mjs` | 캡처 스크립트만 옮겨 고침(Task 7). 아이콘 스크립트는 버림 |
| `tests/*.test.ts`(장보기) | `tests/grocery/` | 옮김. `appView`·`pwaUpdate`·`supabaseConfig` 테스트는 버림, `csp`·`tokens`·`session` 테스트는 고침 |
| `tests/fixtures/{danawa,foodsafety}/` | `tests/grocery/fixtures/` | 그대로 |
| `tests/fixtures/shared-schema.sql` | — | 버림(실제 마이그레이션 위에서 시험, Task 3) |
| `CLAUDE.md`, `AGENTS.md`, `DESIGN.md`, `README.md`, `docs/` | `CLAUDE.md`(새로), `docs/grocery/` | Task 8 |

새로 만드는 가계부 파일:

| 파일 | 하는 일 |
|---|---|
| `src/grocery/GroceryTab.tsx` | 가계부 가구·구성원 → `Membership` → 장보기 store → `<div className="grocery"><ListScreen/></div>` |
| `src/grocery/flush.ts` | 장보기의 "미뤄 둔 빼기 보내기"를 가계부 로그아웃이 기다릴 수 있게 하는 등록 자리 |
| `src/lib/csp.ts` | 가계부 CSP(지금 `vite.config.ts` 안의 배열)를 함수로 빼서 시험할 수 있게 |
| `tests/supabaseStub.ts` | 가계부 `tests/db.test.ts`의 `SUPABASE_STUB`을 빼낸 공용 Supabase 흉내 |
| `tests/grocery/dbSetup.ts` | 실제 마이그레이션 전부(가계부 + 장보기, 파일 이름 순)를 PGlite에 적용하는 도우미 |
| `tests/grocery/boundary.test.ts` | 장보기 마이그레이션이 `public`을 만들거나 바꾸지 않는지 검사(D-003) |
| `tests/csp.test.ts` | 가계부 CSP 검사 |
| `CLAUDE.md` | 저장소 규칙. 장보기 부분 범위와 규칙 |

---

### Task 1: 기준선과 출처 고정

**Files:** 없음(읽기만)

- [ ] 가계부에서 `npm ci && npm test && npm run build`를 돌려 지금 통과하는지, 테스트 파일·개수가 몇인지 적어 둔다. 실패하면 멈추고 사용자에게 알린다. 옮기기 전의 실패를 옮긴 탓으로 착각하지 않기 위해서다.
- [ ] 장보기 저장소를 스크래치 폴더에 clone하고 `HEAD`가 2578f58인지 확인한다. 같은 폴더에서 `npm ci && npm test && npm run build`도 돌려 장보기 기준선(테스트 개수)을 적는다.
- [ ] Supabase MCP 읽기로 배포된 함수 다섯 개(`extract-entries`, `export-csv`, `food-alerts-sync`, `product-search`, `product-check`)의 `verify_jwt` 값을 읽는다(`get_edge_function` 또는 `list_edge_functions`). 장보기 `config.toml`(false/true/true)과 다르면 멈추고 사용자에게 알린다. MCP가 인증 전이라 못 읽으면 사용자에게 대시보드(Edge Functions > 함수 > Details의 "Enforce JWT Verification") 확인을 부탁하고, 답을 받은 뒤 Task 2의 `config.toml`을 쓴다.
- [ ] 이 Task는 커밋하지 않는다. 결과(테스트 개수, `verify_jwt` 다섯 값)는 Task 9 보고에 쓴다.

### Task 2: 서버 파일 옮기기

**Files:**
- Create: `supabase/migrations/` 장보기 7개, `supabase/functions/{_shared,food-alerts-sync,product-search,product-check}/`, `supabase/config.toml`, `.github/workflows/food-alerts-sync.yml`, `tests/grocery/{danawa,foodAlerts,foodAlertsSync,productCheck,productSearch}.test.ts`, `tests/grocery/fixtures/{danawa,foodsafety}/`
- Modify: `tsconfig.json`

- [ ] 장보기 clone에서 파일을 그대로 복사한다(`git -C <clone> archive 2578f58 <경로> | tar -x -C <가계부>` 같은 방법). 마이그레이션 7개는 `sha256sum`으로 원본과 같은지 확인하고, 그 값을 커밋 메시지에 적는다.
- [ ] `supabase/config.toml`은 장보기 내용에 Task 1에서 읽은 가계부 함수 두 개를 더한다. 설명 주석은 장보기 파일의 말투대로 한국어로 쓴다.
  ```toml
  [functions.extract-entries]
  verify_jwt = <Task 1에서 읽은 값>

  [functions.export-csv]
  verify_jwt = <Task 1에서 읽은 값>
  ```
- [ ] `food-alerts-sync.yml`은 내용을 바꾸지 않는다. 이 브랜치에서는 예약 실행이 돌지 않는다(예약 실행은 기본 브랜치에서만 돈다). main에 들어가면 장보기 쪽과 함께 돌아도 함수가 20시간에 한 번만 받는다(설계 5-3).
- [ ] 함수·파서 테스트 다섯 개와 fixture를 `tests/grocery/`로 옮기고 상대 경로를 한 단계 깊게 고친다(`../supabase/…` → `../../supabase/…`, `./fixtures/…`는 그대로).
- [ ] 장보기 함수 소스는 `'../_shared/danawa.ts'`처럼 `.ts` 확장자로 import한다. 가계부 `tsconfig.json`에 `"allowImportingTsExtensions": true`를 더한다(장보기 tsconfig와 같은 설정, `noEmit`이 이미 있어 허용된다).
- [ ] `npm test`(옮긴 다섯 테스트 포함)와 `npm run typecheck`가 통과하면 커밋한다: "장보기 서버 파일 옮기기: 마이그레이션 7개(내용 그대로), 함수 3개, 함수 설정, 식약처 예약 실행".

### Task 3: DB 테스트를 실제 마이그레이션 위로

**Files:**
- Create: `tests/supabaseStub.ts`, `tests/grocery/dbSetup.ts`, `tests/grocery/boundary.test.ts`
- Create(옮김): `tests/grocery/{db,foodAlertsDb,productsDb,pricesDb}.test.ts`
- Modify: `tests/db.test.ts`(공용 흉내 import로)

- [ ] 가계부 `tests/db.test.ts`의 `SUPABASE_STUB` 문자열을 `tests/supabaseStub.ts`로 빼서 export하고, `db.test.ts`는 그것을 import한다. 내용은 바꾸지 않는다. 가계부 `db.test.ts`가 그대로 통과해야 한다.
- [ ] `tests/grocery/dbSetup.ts`: `supabase/migrations/`의 `.sql`을 `readdirSync`로 모두 읽어 파일 이름 순으로 정렬한다. `freshDb(users)`는 가계부 `freshDb`처럼 ① 흉내 적용 ② `auth.users`에 시험 사용자 넣기 ③ 마이그레이션 전부 적용 순서로 한다. 20261015170000부터 새 사용자 행이 `signups_closed`로 막히므로 사용자를 먼저 넣어야 한다.
- [ ] 장보기 DB 테스트 네 개를 옮기면서 `shared-schema.sql` + 장보기 파일 목록을 `freshDb`로 바꾼다. 테스트가 `auth.users`에 넣던 줄은 `freshDb` 인자로 옮긴다.
  - 가계부 실제 표로 바뀌면서 깨지는 곳이 생길 수 있다. 예를 들어 `households`에는 사본에 없던 열·트리거가 있고, `members`에는 `household_id` 클레임 동기화 트리거가 있다. 이런 곳은 테스트의 기대값을 실제 스키마에 맞춘다. 장보기 마이그레이션이나 권한 검사 내용을 약하게 바꿔서 통과시키지 않는다.
  - 기대값을 바꾼 곳은 커밋 메시지에 하나씩 적는다.
- [ ] `tests/grocery/boundary.test.ts`: 이름에 `_grocery_`가 든 마이그레이션 파일마다, 주석을 뺀 본문에 `public.` 객체를 만들거나 바꾸는 문(`create|alter|drop|comment on|grant … on` 뒤의 `public.`, `create … function public.` 등)이 없음을 검사한다.
  - `references public.households`, `public.members`처럼 참조하는 것은 허용한다.
  - 실패 메시지에 파일 이름과 줄을 낸다.
  - 이 검사가 실제로 잡는지, 임시 문자열로 `alter table public.transactions add column x int`를 넣은 경우가 실패하는 시험을 함께 둔다.
- [ ] "가계부 21개 + 장보기 7개를 이름 순으로 빈 DB에 적용하면 오류가 없다"를 한 테스트로 둔다.
- [ ] `tests/fixtures/shared-schema.sql`은 가져오지 않는다.
- [ ] `npm test` 통과 후 커밋: "장보기 DB 테스트를 실제 마이그레이션 위로, 공용 Supabase 흉내, grocery 스키마 경계 검사".

### Task 4: 앱 코드 옮기기

**Files:**
- Create: `src/grocery/components/*.tsx`, `src/grocery/lib/*.ts`, `src/grocery/lib/membership.ts`, `src/grocery/demo.ts`
- Create(옮김): `tests/grocery/{alerts,format,listView,parse,prefs,products,split,store,membership}.test.ts`

- [ ] 파일 구조 표대로 복사한다.
- [ ] import 경로를 고친다:
  - `ItemDetail.tsx`의 `'../../supabase/functions/_shared/danawa'` → `'../../../supabase/functions/_shared/danawa'`
  - `'../lib/session'`·`'./session'` → `membership`
  - `supabaseStore.ts`의 `import type { Membership } from './session'` → `'./membership'`
- [ ] `membership.ts`: 장보기 `Membership`, `MemberRow`, `toMembership`만 둔다. 가계부 `Member`(`src/lib/types.ts`: `household_id`, `user_id`, `display_name`, `spouse_role`)는 `MemberRow`와 열이 같으므로 `toMembership(userId, meta.members)`로 바로 바꿀 수 있다. 장보기 `session.test.ts`에서 `toMembership` 시험만 `membership.test.ts`로 옮긴다.
- [ ] `appView.test.ts`, `pwaUpdate.test.ts`, `supabaseConfig.test.ts`는 대상 파일을 버리므로 옮기지 않는다. 그 테스트가 지키던 동작은 가계부 쪽이 맡는다: 로그인·가구 확인은 `AuthGate`·`Home`, 새 버전 확인은 `lib/pwa.ts`, Supabase 주소는 `deploy.yml` 환경 변수. 버리는 테스트 이름과 이유를 커밋 메시지에 적는다.
- [ ] 이 Task에서는 화면에 붙이지 않는다(Task 6). `npm run typecheck`·`npm test` 통과 후 커밋: "장보기 화면·계산 코드를 src/grocery로".

### Task 5: CSS 가두기와 토큰 맞추기

**Files:**
- Create: `src/grocery/grocery.css`, `tests/grocery/tokens.test.ts`
- Modify: `src/styles.css`

- [ ] `grocery.css` = 장보기 `app.css` 전부 + `tokens.css`의 장보기 전용 부분. 모든 선택자를 `.grocery` 아래로 둔다(`.grocery .seg`, `@media` 안도 같음).
  - 장보기 `tokens.css`의 전역 규칙(`*`, `html`, `body`, `button…`, `@font-face`)은 버린다. 가계부에 같은 뜻의 규칙이 있다.
  - `.grocery { font-size: 16px; }`로 장보기 `body` 크기를 지킨다(가계부 `body`는 15px).
- [ ] CSS 변수는 설계 4-3 표대로 가계부 이름으로 바꾼다:
  - `--ink-muted`→`--ink-2`, `--on-ink`→`--on-primary`, `--r-group`→`--r-md`, `--r-sheet`→`--r-lg`, `--r-tile`→`--r-sm`.
  - `--ink-faint`는 `.grocery { --ink-3: #726D65 }`(라이트)로 덮고 장보기 안에서 `--ink-3`을 쓴다. 다크 값 `#A09A90`은 두 앱이 같다.
  - 장보기 전용 `--gutter`·`--clay-soft`·`--field-border`·`--backdrop`·`--bottom-bar-h`는 `.grocery`에 라이트 값, `@media (prefers-color-scheme: dark) { .grocery { … } }`에 다크 값으로 둔다. `data-theme` 규칙은 버린다(앱 코드가 켜지 않는다).
- [ ] 가계부 쪽이 장보기 안으로 새는 것을 막는다. 겹치는 10개 클래스에 대해 가계부 `styles.css`의 해당 규칙이 `.grocery` 안 요소에 걸리지 않게 한다. 방법은 둘 중 하나다:
  - 가계부 선택자에 `:not(.grocery *)` 붙이기
  - 장보기 쪽에서 가계부가 정한 속성(`position`, `max-width`, `transition`, `opacity`, `transform` 등)을 모두 다시 정하기

  어느 쪽이든 가계부 `.sheet`의 넓은 화면 규칙(`@media (min-width: 960px)` 안)까지 빠짐없이 다룬다. 고른 방법을 `grocery.css` 맨 위 주석에 한 줄로 적는다.
- [ ] 화면 아래 고정 요소:
  - 가계부 `styles.css`에 `--tabbar-h`(아래 탭 높이, 지금 `.tab` 최소 높이 60px + 윗선 1px)를 정의하고 `.tabbar`가 그 값을 쓰게 한다.
  - 휴대폰에서 장보기 `.bottom-bar`는 `bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom))`, `.notice-slot`은 그 위로 올린다.
  - `.list-page` 아래 여백에도 아래 탭 높이를 더한다.
  - 넓은 화면(960px 이상)은 아래 탭이 왼쪽 메뉴가 되므로 지금 장보기 값(`.notice-slot { bottom: 24px }`)을 그대로 둔다.
- [ ] `tests/grocery/tokens.test.ts`: 장보기 `tokens.test.ts`의 대비 검사(라이트·다크, canvas·oat 위)를 가계부 `styles.css`의 변수 + `grocery.css`의 덮어쓰기 값으로 다시 쓴다. "다크 값이 두 곳에 같다" 검사는 `data-theme`을 버렸으므로 뺀다. `contrast.ts`는 `src/grocery/lib/`에서 import한다.
- [ ] 캡처는 Task 7에서 한꺼번에 한다. 여기서는 `npm test` 통과 후 커밋: "장보기 CSS를 .grocery 안으로, 가계부 토큰 이름에 맞추기, 아래 탭 위로 올리기".

### Task 6: 가계부 셸에 장보기 탭 붙이기

**Files:**
- Create: `src/grocery/GroceryTab.tsx`, `src/grocery/flush.ts`, `src/lib/csp.ts`, `tests/csp.test.ts`, `tests/grocery/flush.test.ts`
- Modify: `src/App.tsx`, `src/components/Icons.tsx`, `src/components/SettingsView.tsx`, `src/grocery/components/ListScreen.tsx`, `src/styles.css`, `vite.config.ts`, `src/main.tsx`

- [ ] **탭.** `App.tsx`의 `type Tab`에 `'grocery'`를 더한다.
  - 아래 탭 순서: 달력·내역·장보기·통계·고정. 설정 탭 버튼은 아래 탭에서 뺀다. `tab === 'settings'` 화면은 그대로 둔다.
  - `TITLE.grocery = '장보기'`, `showMonth`에 넣지 않는다. 둥근 "기록하기" 버튼은 지금처럼 달력·내역에서만 보인다.
  - `.tabbar .wrap`의 `repeat(5, …)`는 그대로 맞는다.
- [ ] **아이콘.** `Icons.tsx`에 장바구니 아이콘을 더한다(24 격자, 선 1.75px, 둥근 끝, 다른 아이콘과 같은 방식). `GearIcon`은 이미 있다.
- [ ] **설정 가는 길.**
  - 위쪽 줄 오른쪽에 톱니 버튼(`icon-btn`, `aria-label="설정"`)을 모든 탭에 둔다.
  - 누르면 지금 탭을 기억하고 `setTab('settings')`로 간다. 설정 화면 위쪽 줄 왼쪽에는 "‹" 돌아가기(`aria-label="돌아가기"`)를 두어 기억한 탭으로 간다.
  - 넓은 화면(960px 이상)에서는 톱니 버튼과 돌아가기를 숨기고, 왼쪽 메뉴 5개 탭 아래에 "설정" 줄을 둔다(`tab` 클래스, `aria-current`). 그 줄은 휴대폰에서 숨긴다.
- [ ] **`?tab=grocery`.** 처음 열 때 `new URLSearchParams(location.search).get('tab') === 'grocery'`면 장보기 탭으로 시작한다. 다른 값은 무시한다.
- [ ] **`GroceryTab`.**
  - props: `household`, `members`(가계부 `Member[]`), `userId`.
  - `toMembership(userId, members)`로 `Membership`을 만들고, 결과가 바뀔 때만 `useMemo`로 `createSupabaseStore(sb(), membership)`를 만든다.
  - `membership`이 `null`이면(이론상 없음, 구성원 목록이 아직 비었을 때) "가구 정보 확인 중"을 보여 준다.
  - 렌더: `<div className="grocery"><ListScreen key={userId} store={store} me={membership} /></div>`, `grocery.css`를 import한다.
  - `tab === 'grocery'`일 때만 그린다(다른 탭과 같은 방식). 탭을 떠나면 장보기는 지금처럼 화면을 떠날 때 미뤄 둔 빼기를 바로 보낸다(`ListScreen`의 마운트 해제 처리).
- [ ] **`ListScreen` 머리.**
  - `<h1>이번 장보기</h1>`과 로그아웃 버튼(`onSignOut` prop)을 뺀다.
  - 넓은 화면 "담기" 버튼과 "편집"·"완료"는 남긴다. 제목이 빠져도 줄 배치가 무너지지 않게 `list-head`를 오른쪽 정렬로 둔다.
  - 제목 수준: 가계부 위쪽 줄 `h1`이 "장보기"가 되므로 장보기 화면 안의 다른 제목 수준은 바꾸지 않는다(분류 묶음 `h2`).
- [ ] **로그아웃 순서(Review Focus 3).**
  - `src/grocery/flush.ts`에 `trackGroceryFlush(p: Promise<unknown>)`와 `waitGroceryFlush(): Promise<void>`를 둔다(가장 최근에 등록한 약속들을 기다림, 실패해도 기다림만 끝냄).
  - `ListScreen`의 `flushRemovals`가 돌려주는 약속을 `trackGroceryFlush`에 등록한다(마운트 해제·화면 숨김·`pagehide` 때 부르는 경로 모두).
  - 가계부 `SettingsView` 로그아웃은 `await waitGroceryFlush()` 뒤에 `sb().auth.signOut()`을 부른다.
  - `tests/grocery/flush.test.ts`: 등록한 약속이 끝나기 전에는 `waitGroceryFlush`가 끝나지 않고, 실패한 약속도 기다림을 막지 않음을 시험한다.
- [ ] **CSP.**
  - 가계부 `vite.config.ts`의 CSP 배열을 `src/lib/csp.ts`의 `CSP` 상수로 옮겨 import한다. 장보기 `vite.config.ts`처럼 `.ts` 확장자 import다(Task 2에서 허용함).
  - `img-src`에 `https://img.danuri.io`를 더하고, `frame-src 'none'`을 더한다. 나머지 값(`https://*.supabase.co` 등)은 바꾸지 않는다.
  - `tests/csp.test.ts`: `script-src 'self'`, `connect-src`에 Supabase https·wss만, `img-src`에 `https://img.danuri.io`, `frame-src 'none'`, `object-src 'none'`을 검사한다. 장보기 `csp.test.ts`의 검사 항목 중 가계부에 맞는 것을 가져온다.
- [ ] **개발 서버 미리보기.**
  - `src/main.tsx`에 `import.meta.env.DEV`일 때만 `?demo=grocery`(데모 목록), `?demo=grocery-empty`, `?demo=grocery-error`를 둔다.
  - 장보기 `main.tsx`의 `devScreen` 방식(동적 import, 빌드에서 빠짐)대로 `<div className="grocery"><ListScreen store={메모리 store} me={데모}/></div>`를 그린다.
  - 가계부 셸 없이 장보기 화면만 보는 용도다(시트·상세 캡처). 빌드 결과에 `demo` 모듈이 없는지 Task 9에서 확인한다.
- [ ] `npm test`, `npm run build` 통과 후 커밋: "가계부에 장보기 탭: 아래 탭 5개, 설정은 톱니 버튼, ?tab=grocery, 로그아웃 전 장보기 빼기 보내기, CSP에 다나와 이미지".

### Task 7: 화면 캡처와 고치기

**Files:**
- Create: `scripts/screenshots.mjs`, `tests/grocery/fixtures/shell/*.json`(셸 캡처용 가짜 응답)
- Modify: `package.json`(`playwright` 개발 의존성, `"screens"` 명령), `.gitignore`(`screenshots/`)

- [ ] `playwright`를 장보기와 같은 판(`^1.64.1`)으로 더한다. 이 환경에는 Chromium이 미리 깔려 있다(`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). `playwright install`은 하지 않는다. 판이 맞지 않아 브라우저를 못 찾으면 `executablePath: '/opt/pw-browsers/chromium'`으로 띄운다.
- [ ] 개발 서버는 공개용 값으로 띄운다: `VITE_SUPABASE_URL=https://kifdfpbwiebfgvdumqjf.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=<deploy.yml의 공개용 키> npm run dev`. 이 값들은 `deploy.yml`에 이미 공개돼 있다. `.env` 파일은 만들지 않는다.
- [ ] **장보기 화면만**(`?demo=grocery…`): 장보기 `screenshots.mjs`의 목록을 가져온다(목록·어디서 살지·편집·빼기 알림·담기 시트 세 가지·경고 시트·후보 시트·품목 상세 세 탭·빈 목록·오류). 각각 390·1280, 라이트·다크다.
  - 주소를 `?demo=1` → `?demo=grocery`로 바꾼다.
  - 기다리는 조건 `heading '이번 장보기'`는 요약 칸 글자 "살 것"으로 바꾼다.
  - 로그인·가구 없음 화면은 장보기 것이 없어졌으므로 뺀다.
- [ ] **가계부 셸 전체**(로그인한 상태):
  - Playwright `page.route('**/rest/v1/**')`로 Supabase 응답을 가짜 JSON으로 돌려준다(`tests/grocery/fixtures/shell/`: 가구 1, 구성원 2, 분류, 이번 달 내역 몇 건, 장보기 품목 몇 개, 나머지 표·RPC는 `[]`). `/functions/v1/**`도 같은 방식이다.
  - 가짜 세션은 `localStorage`의 `sb-kifdfpbwiebfgvdumqjf-auth-token`에 넣는다(먼 미래 만료).
  - 실시간 연결은 막혀도 화면에는 영향이 없다.
  - 가짜 데이터의 숫자는 캡처 확인용이다. 캡처를 저장소에 커밋하지 않는다(`screenshots/`는 무시 목록).
  - **확인 필요:** 쓰는 `@supabase/supabase-js` 판이 저장된 가짜 세션을 서버 확인 없이 받아 주는지 첫 실행에서 본다. 안 되면 셸 캡처 방법을 바꾸기 전에 멈추고, 무엇이 막혔는지 사용자에게 알린다.
- [ ] 셸 캡처 목록. 각각 390·1280, 라이트·다크:
  - 장보기 탭(목록, 휴대폰은 담기 버튼과 아래 탭이 함께 보이게 화면 아래까지)
  - 장보기 탭에서 빼기 → 되돌리기 알림
  - 장보기 탭에서 담기 시트, 품목 상세
  - 달력, 내역, 통계, 고정, 설정(톱니 → 설정, 돌아가기 보임)
  - 내역 입력 시트(가계부 `.sheet`), 설정의 분류 관리(가계부 `.seg` 쓰는 곳)
- [ ] 장보기 원본과 나란히 비교한다. 장보기 clone에서 같은 데모 화면을 장보기 `npm run screens`로 찍어 두고, 옮긴 화면과 차례로 본다.
  - 다른 점이 설계가 정한 것(머리 제목·로그아웃, 아래 탭 위로 올린 위치)뿐이어야 한다.
  - 가계부 다섯 화면은 옮기기 전 코드와 비교한다. 이 계획을 커밋한 시점(앱 코드는 69efbf0과 같음)을 `git worktree`로 따로 꺼내 같은 셸 캡처를 찍고 나란히 본다. 톱니 버튼·설정 줄 말고 달라진 곳이 없어야 한다.
- [ ] 다른 점이 있으면 CSS를 고치고 다시 찍는다. Review Focus 1·2를 하나씩 확인한다.
- [ ] 끝나면 커밋: "화면 캡처 스크립트(장보기 데모 + 가계부 셸)와 캡처로 찾은 것 고치기". 고친 것은 커밋 메시지에 화면 이름별로 적는다.

### Task 8: 규칙과 문서

**Files:**
- Create: `CLAUDE.md`, `docs/grocery/**`
- Modify: `DESIGN.md`, `README.md`, `docs/grocery/tracking/status.md`, `docs/grocery/tracking/decisions/index.md`, `docs/grocery/architecture.md`

- [ ] `CLAUDE.md`(설계 4-4):
  - 공통 규칙: 한국어, 브랜치 작업, main은 지시로만, 공유 DB는 MCP `apply_migration`만, 새 마이그레이션 이름은 가장 늦은 파일보다 뒤.
  - "장보기 부분" 범위(`src/grocery/`, `tests/grocery/`, `supabase/migrations/*_grocery_*.sql`, 장보기 함수 3개와 `_shared`, `docs/grocery/`)와 장보기 `CLAUDE.md` "반드시 지킬 것" 전문.
  - "외부 호출은 한도를 지킨다"의 네이버 문장은 "다나와 검색은 10초에 한 번(robots `Crawl-delay`), 같은 상품·같은 날은 캐시"로 고친다(설계 4-4).
  - 장보기 `AGENTS.md`는 `CLAUDE.md`와 같은 내용이었으므로 가져오지 않는다.
- [ ] 장보기 `docs/`를 `docs/grocery/`로, 장보기 `DESIGN.md`를 `docs/grocery/DESIGN.md`로 옮긴다.
  - `docs/grocery/DESIGN.md`의 "가계부에는 다크 모드가 없다", `tokens.css`·`tests/tokens.test.ts` 경로는 지금 사실로 고친다.
  - 가계부 `DESIGN.md`에 장보기 문서 위치 한 줄을 더한다.
- [ ] `docs/grocery/tracking/status.md`:
  - "④-1 … 브랜치 `feat/foundation-list`, main 미병합"을 사실로 고친다(2578f58에 들어 있음).
  - "다음 할 일"의 통합 항목을 "1단계 옮기기 끝(커밋), 2·3단계 남음"으로 바꾼다.
  - 비밀번호 재설정 열린 문제는 "통합으로 해결(가계부 주소로 돌아감)"으로 닫는다.
  - 장보기 저장소 경로(`D:\openai\grocery-app`) 같은 예전 사실은 기록으로 남기되 "통합 전"이라고 적는다.
- [ ] `decisions/index.md`에 설계 9절의 D-010, D-011, D-005 보충을 더한다.
- [ ] `architecture.md`의 "두 저장소" 표현(공유 DB 규칙, 배포)을 한 저장소 기준으로 고친다.
- [ ] `README.md`: "지금 들어 있는 기능"에 장보기 줄, "구조" 표에 `src/grocery/`·장보기 함수·`docs/grocery/`, "개발"에 `npm run screens` 사용법. 보안 절에 장보기 함수(`food-alerts-sync`는 로그인 없이 부르되 20시간 1회·30분 잠금으로 스스로 막음)를 한 줄로 더한다.
- [ ] 커밋: "장보기 규칙(CLAUDE.md)과 문서를 가계부 저장소로, D-010·D-011".

### Task 9: 마무리 검증과 보고

**Files:** 없음(고칠 것이 나오면 해당 Task 파일)

- [ ] `npm ci && npm test && npm run build` 통과를 확인하고, 테스트 개수를 Task 1 기준선(가계부 + 장보기)과 비교한다. 버린 장보기 테스트(`appView`, `pwaUpdate`, `supabaseConfig`, `session`의 `loadMembership`·`loginErrorMessage`)만큼 줄고 새 테스트만큼 늘어야 한다. 차이는 보고에 적는다.
- [ ] `dist/` 검사:
  - `grep -r "service_role\|sk-ant\|SUPABASE_SERVICE" dist`가 비어 있어야 한다.
  - `dist/index.html`의 CSP에 `https://img.danuri.io`가 있어야 한다.
  - `dist/assets`에 데모 문구(예: 데모 품목 이름)가 없어야 한다.
- [ ] `git diff 69efbf0 -- supabase/migrations/`에서 가계부 파일 21개는 바뀌지 않고, 장보기 7개는 원본과 `sha256`이 같은지 다시 확인한다.
- [ ] 전체 diff를 처음부터 다시 읽으며 Review Focus 다섯 가지를 하나씩 확인하고, 확인한 방법을 보고에 적는다.
- [ ] 공유 DB와 배포된 함수에 아무것도 하지 않았음을 보고에 적는다.
- [ ] 이 브랜치에 푸시하고 사용자에게 보고한다. 보고할 것: 한 일, 캡처에서 찾아 고친 것, 확인 못 한 것, 남은 2·3단계(사용자 지시 필요: main 병합·배포, 가계부 쪽 식약처 워크플로 수동 실행, 예전 장보기 안내 페이지·워크플로 끄기·보관). main 병합은 하지 않는다.
