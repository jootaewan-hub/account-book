# 주유 영수증 분석과 장보기 비교 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 주유소 영수증에서 유종·리터·리터당 단가를 읽어 저장하고 통계 탭에서 추이를 보여 주며, 장보기 영수증 확인 화면에서 최근 1년 우리 기록과 견준 "이번 장보기 살펴보기"를 보여 준다.

**Architecture:** 읽기는 기존 `extract-entries`의 스키마·프롬프트 확장(`fuel`)과 정리 함수(`checkFuel`), 저장은 새 표 `public.fuel_fills`(내역 1:1, 연쇄 삭제)와 `saveDraft`의 한 줄 추가, 보기는 순수 계산 모듈(`src/lib/fuel.ts`, `src/lib/shopCompare.ts`)과 그것을 그리는 묶음 두 개(`FuelCard`, `ShopCompareCard`)다. 장보기 비교는 DB를 바꾸지 않고 확인 화면이 최근 1년 품목 줄을 읽어 화면에서 계산한다.

**Tech Stack:** TypeScript, React 19, Supabase(PostgREST·RLS, PGlite 시험), Deno Edge Function(`@anthropic-ai/sdk` 구조화 출력, zod), Vitest, Playwright 캡처(`scripts/screenshots.mjs`).

**Spec:** `docs/superpowers/specs/2026-10-21-fuel-and-grocery-compare-design.md`

## Global Constraints

- 화면 숫자는 영수증 값과 우리 기록 값(날짜·가게와 함께)만. 추정 수치를 숫자로 내지 않는다. 등락은 ▲ `clay` / ▼ `indigo` + 글자(D-012).
- "AI", "분석 중", "안전함" 같은 말을 쓰지 않는다. 한글 글자는 13px 이상. 묶음은 `.card`(귀리 면).
- 새 CSS는 `src/styles.css`에, 클래스 이름은 `fuel-`·`cmp-` 접두어(장보기 `grocery.css`와 겹치지 않게).
- 마이그레이션 파일 이름은 `20261031000000_fuel_fills.sql`(가장 늦은 `20261030000000_grocery_item_ingredients.sql`보다 뒤). `_grocery_`가 들어가지 않는다(가계부 마이그레이션).
- `grocery` 스키마·`src/grocery/`는 바꾸지 않는다(단, `SmartSheet`가 이미 쓰는 `receiptLines`·`matchReceipt`는 그대로 쓴다).
- 공유 DB 적용·함수 배포·main 병합은 하지 않는다(사용자 확인 뒤, 설계 7절).
- 커밋은 작업 브랜치 `claude/fuel-and-grocery-compare`에서. 커밋 메시지 끝에 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- UI를 바꾼 뒤에는 `npm run screens -- <장면>`으로 390·1280px 라이트·다크를 찍어 눈으로 본다(개발 서버 포트 5188, `BASE_URL=http://localhost:5188`).

## Review Focus

1. 주유 영수증에 리터만 있고 단가가 없을 때: 단가를 계산해 채우지 않고 칸을 비워 두며, 저장하면 내역만 저장되고 주유 기록은 저장되지 않는다는 안내가 보인다. → Task 2(`checkFuel`)·Task 3(`fuelComplete`) 시험.
2. 유종이 섞인 가구(휘발유·경유): 지난번 대비는 같은 유종끼리만, 다른 유종 기록만 있으면 "비교할 지난 주유 없음". → Task 4 `fuelDelta` 시험.
3. 상품명이 비슷하지만 다른 상품(국산 양파 / 국산 대파, 풀무원 두부 / 풀무원 요거트): 같은 상품으로 맞추지 않는다. → Task 6 `matchPast` 시험.
4. 상품별로 나눠 저장한 지난 영수증(내역 10건, 같은 시각): 한 번의 장보기로 묶여 "지난 장보기"가 된다. → Task 6 `trips` 시험.
5. 과거 기록을 읽지 못했을 때(네트워크 오류): 확인 화면은 그대로 뜨고 저장도 되며 살펴보기 묶음만 "기록을 불러오지 못했어요"로 보인다. → Task 7 수동 확인(캡처 장면 `shell-smart-compare-error`는 두지 않고 코드 리뷰로 확인).

---

### Task 1: 표 `public.fuel_fills`

**Files:**
- Create: `supabase/migrations/20261031000000_fuel_fills.sql`
- Modify: `tests/db.test.ts` (상단 `read` 목록·`freshDb` 배열, 끝에 describe 추가)

**Interfaces:**
- Produces: 표 `public.fuel_fills(id, household_id, transaction_id unique, liters numeric(7,3), price_per_liter integer, fuel_type text, created_by, created_at)`. RLS `fuel_fills_all`(가구 구성원 전부), grant select/insert/update/delete to authenticated·service_role. (transaction_id, household_id) → transactions(id, household_id) on delete cascade.

- [ ] **Step 1: 시험 추가** — `tests/db.test.ts`에 `const FUEL = read('20261031000000_fuel_fills.sql')`를 더하고 `freshDb([...])` 끝에 `FUEL`을 넣는다. 끝에:

```ts
describe('주유 기록 (20261031000000_fuel_fills)', () => {
  it('같은 가구만 보고 쓰며, 내역 하나에 하나, 다른 가구 내역에는 못 붙이고, 내역을 지우면 함께 지워진다', async () => {
    const [{ id: txA }] = await as<{ id: string }>(A,
      `insert into public.transactions (household_id, type, occurred_on, amount, title, scope) values ($1, 'expense', '2026-10-18', 58150, 'GS칼텍스 분당주유소', 'shared') returning id`, [hhA])
    await as(A, `insert into public.fuel_fills (household_id, transaction_id, liters, price_per_liter, fuel_type) values ($1, $2, 35.2, 1652, '휘발유')`, [hhA, txA])
    const rows = await as<{ liters: string; price_per_liter: number; fuel_type: string }>(B, `select liters, price_per_liter, fuel_type from public.fuel_fills`)
    expect(rows.map((r) => [Number(r.liters), r.price_per_liter, r.fuel_type])).toEqual([[35.2, 1652, '휘발유']])
    expect(await as(C, `select * from public.fuel_fills`)).toHaveLength(0)
    expect(await errorOf(as(null, `select * from public.fuel_fills`))).toContain('permission denied')
    expect(await errorOf(as(C, `insert into public.fuel_fills (household_id, transaction_id, liters, price_per_liter) values ($1, $2, 1, 1000)`, [hhA, txA]))).toContain('row-level security')
    expect(await errorOf(as(B, `insert into public.fuel_fills (household_id, transaction_id, liters, price_per_liter) values ($1, $2, 1, 1000)`, [hhA, txA]))).toContain('duplicate key')
    expect(await errorOf(as(A, `insert into public.fuel_fills (household_id, transaction_id, liters, price_per_liter) values ($1, gen_random_uuid(), 0, 1000)`, [hhA]))).toContain('check')
    const [{ id: txC }] = await as<{ id: string }>(C,
      `insert into public.transactions (household_id, type, occurred_on, amount, scope) values ($1, 'expense', '2026-10-18', 1000, 'shared') returning id`, [hhC])
    expect(await errorOf(as(A, `insert into public.fuel_fills (household_id, transaction_id, liters, price_per_liter) values ($1, $2, 1, 1000)`, [hhA, txC]))).toContain('foreign key')
    await as(A, `delete from public.transactions where id = $1`, [txA])
    expect(await as(B, `select * from public.fuel_fills`)).toHaveLength(0)
  })
})
```

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/db.test.ts -t 주유` → FAIL (파일 없음).
- [ ] **Step 3: 마이그레이션 작성** — `utility_bills` 파일을 본떠 표·색인(`fuel_fills_household_idx (household_id)`, `fuel_fills_created_by_idx`)·RLS·grant. 제약: `liters > 0 and liters < 1000`, `price_per_liter > 0 and price_per_liter < 100000`, `fuel_type is null or char_length(fuel_type) between 1 and 20`. 실시간 publication에는 넣지 않는다. 첫 줄 주석에 설계 문서 이름.
- [ ] **Step 4: 통과 확인** — `npx vitest run tests/db.test.ts tests/grocery/boundary.test.ts tests/grocery/db.test.ts` → PASS (장보기 DB 시험은 마이그레이션 전부를 적용하므로 새 파일이 깨지지 않는지 본다).
- [ ] **Step 5: 커밋** — `git add supabase/migrations/20261031000000_fuel_fills.sql tests/db.test.ts && git commit -m "주유 기록 표 fuel_fills(내역 1:1, 가구 RLS, 연쇄 삭제)"`

### Task 2: `extract-entries`가 주유를 읽고, 다시 읽은 결과를 쓴다

**Files:**
- Modify: `supabase/functions/extract-entries/extract.ts` (`EntrySchema`, `SYSTEM_PROMPT`, `CheckedEntry`, `checkEntries`), `supabase/functions/extract-entries/index.ts` (다시 읽기 선택)
- Test: `tests/fuel.test.ts` (새 파일), `tests/smart.test.ts`는 그대로

**Interfaces:**
- Produces:
  - `FuelSchema = z.object({ liters, price_per_liter, fuel_type })`(각 nullable), `EntrySchema.fuel: FuelSchema.nullable()`
  - `interface CheckedFuel { liters: number | null; price_per_liter: number | null; fuel_type: string | null }`
  - `checkFuel(fuel: Fuel | null, amount: number): { fuel: CheckedFuel | null; note: string | null }`
  - `CheckedEntry.fuel: CheckedFuel | null`, `CheckedEntry.fuel_note?: string`
  - `preferRetry(first: CheckedEntry[], second: CheckedEntry[]): CheckedEntry[]` — second가 비어 있지 않으면 second.

- [ ] **Step 1: 시험** — `tests/fuel.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { checkEntries, checkFuel, preferRetry, SYSTEM_PROMPT, type Entry } from '../supabase/functions/extract-entries/extract'

const entry = (p: Partial<Entry>): Entry => ({ date: '2026-10-18', time: null, merchant: 'GS칼텍스 분당주유소', amount: 58150, is_income: false, is_cancellation: false,
  card_last4: null, payment_hint: null, installment_months: null, category: '차량·주유', items: [], platform: null, fuel: null, ...p })

describe('주유 영수증 읽기 (checkFuel)', () => {
  it('리터는 소수 셋째 자리, 단가는 정수로 받고, 유종은 20자까지', () => {
    expect(checkFuel({ liters: 35.2004, price_per_liter: 1652.4, fuel_type: ' 휘발유 ' }, 58150)).toEqual({ fuel: { liters: 35.2, price_per_liter: 1652, fuel_type: '휘발유' }, note: null })
  })
  it('말이 안 되는 값은 비우고 계산해 채우지 않으며, 셋 다 없으면 null', () => {
    expect(checkFuel({ liters: 0, price_per_liter: 1652, fuel_type: null }, 58150).fuel).toEqual({ liters: null, price_per_liter: 1652, fuel_type: null })
    expect(checkFuel({ liters: 35.2, price_per_liter: 50, fuel_type: null }, 58150).fuel).toEqual({ liters: 35.2, price_per_liter: null, fuel_type: null })
    expect(checkFuel({ liters: null, price_per_liter: null, fuel_type: null }, 58150)).toEqual({ fuel: null, note: null })
    expect(checkFuel(null, 1)).toEqual({ fuel: null, note: null })
  })
  it('단가 × 리터가 결제 금액과 1% 넘게 다르면 알린다', () => {
    expect(checkFuel({ liters: 35.2, price_per_liter: 1652, fuel_type: '휘발유' }, 58150).note).toBeNull() // 58,150.4
    expect(checkFuel({ liters: 30, price_per_liter: 1652, fuel_type: '휘발유' }, 58150).note).toBe('단가 × 주유량이 49,560원이라 결제 금액 58,150원과 8,590원 달라요. 영수증을 확인해 주세요.')
  })
  it('checkEntries가 fuel과 fuel_note를 함께 돌려준다', () => {
    const [e] = checkEntries({ note: null, entries: [entry({ fuel: { liters: 30, price_per_liter: 1652, fuel_type: '휘발유' } })] })
    expect(e.fuel).toEqual({ liters: 30, price_per_liter: 1652, fuel_type: '휘발유' })
    expect(e.fuel_note).toContain('8,590원')
    expect(checkEntries({ note: null, entries: [entry({})] })[0]).toMatchObject({ fuel: null })
  })
  it('프롬프트에 주유·원단위 절사 규칙이 있다', () => {
    expect(SYSTEM_PROMPT).toContain('fuel')
    expect(SYSTEM_PROMPT).toContain('원단위 절사')
  })
  it('다시 읽은 결과가 비어 있지 않으면 그것을 쓴다', () => {
    const a = checkEntries({ note: null, entries: [entry({ amount: 100 })] })
    const b = checkEntries({ note: null, entries: [entry({ amount: 200 })] })
    expect(preferRetry(a, b)).toBe(b)
    expect(preferRetry(a, [])).toBe(a)
  })
})
```

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/fuel.test.ts` → FAIL.
- [ ] **Step 3: 구현** — `extract.ts`: `FuelSchema`·`EntrySchema.fuel`(describe '주유소 영수증이면 유종·주유량·리터당 단가. 아니면 null'), `checkFuel`(리터 `Math.round(x*1000)/1000`, 0 < 리터 < 500; 단가 반올림 정수, 100 < 단가 < 100000; 유종 trim·20자; 둘 다 있고 `|round(l*p) − amount| > amount*0.01`이면 note 문구는 시험의 글자 그대로, `won()` 사용), `checkEntries`에서 `fuel`·`fuel_note` 채움(`...(note ? { fuel_note: note } : {})`), `preferRetry`. `SYSTEM_PROMPT` 규칙 두 줄 추가:
  - "- 주유소(주유) 영수증이면 fuel에 유종(휘발유·경유·고급휘발유·LPG 등 영수증 표기 그대로), 주유량(리터, 소수 셋째 자리까지), 리터당 단가(원)를 적습니다. 단가 × 주유량이 결제 금액과 거의 같아야 합니다. 보이지 않는 값은 null이고, 주유 영수증의 items는 빈 배열입니다. 분류 목록에 '차량·주유'가 있으면 category는 그것입니다. 주유가 아니면 fuel은 null입니다."
  - items 규칙 뒤에: "영수증의 원단위 절사(끝전 버림)·끝전 할인·봉투값도 줄로 넣습니다. 절사·할인은 음수 금액이고 is_product는 false, 봉투는 상품(true)입니다."
  - `index.ts`: `if (!second.refused) out = { ...second, entries: preferRetry(out.entries, second.entries) }`로 바꾼다(둘 다 어긋나도 Sonnet 결과).
- [ ] **Step 4: 통과 확인** — `npx vitest run tests/fuel.test.ts tests/smart.test.ts tests/bills-batches.test.ts` → PASS.
- [ ] **Step 5: 커밋** — `git commit -m "영수증 읽기: 주유소 영수증의 유종·리터·단가(fuel), 원단위 절사 줄, 다시 읽은 결과 우선"`

### Task 3: 초안·저장·API

**Files:**
- Modify: `src/lib/types.ts`(FuelFill), `src/lib/smart.ts`(DraftFuel, entryDrafts, saveDraft), `src/lib/api.ts`(fetchFuelFills, insertFuelFill, fetchItemHistory)
- Test: `tests/fuel.test.ts`(이어서), `tests/smart.test.ts` 그대로

**Interfaces:**
- Consumes: Task 2의 `CheckedEntry.fuel`·`fuel_note`.
- Produces:
  - `types.ts`: `interface FuelFill { id: string; transaction_id: string; liters: number; price_per_liter: number; fuel_type: string | null; occurred_on: string; amount: number; title: string }`, `interface TxFuel { liters: number; price_per_liter: number; fuel_type: string | null }`, `Transaction.fuel?: TxFuel | null`(목록을 읽을 때 `fuel_fills` 임베드, 없으면 null)
  - `smart.ts`: `type DraftFuel = { liters: number | null; price_per_liter: number | null; fuel_type: string | null }`, `Draft.fuel: DraftFuel | null`, `fuelComplete(f: DraftFuel | null): f is { liters: number; price_per_liter: number; fuel_type: string | null }`, `saveDraft(...)` 반환 `{ installment: boolean; txId: string; fuelSaved: boolean | null }`(주유 없으면 null, 넣기 실패면 false).
  - `api.ts`: `fetchFuelFills(householdId: string): Promise<FuelFill[]>`(최근순, 200개), `insertFuelFill(householdId: string, transactionId: string, f: { liters: number; price_per_liter: number; fuel_type: string | null }): Promise<void>`, `fetchItemHistory(householdId: string, from: string): Promise<Transaction[]>`(품목 줄이 있는 지출만, `transaction_items!inner`, 최근 날짜부터 1,000건). `TX_WITH_ITEMS`에 `fuel_fills(liters, price_per_liter, fuel_type)`를 더해 `withItems`가 `fuel`을 채운다(셸 가짜 응답처럼 칸이 없으면 null).

- [ ] **Step 1: 시험** — `tests/fuel.test.ts`에:

```ts
import { entryDrafts, fuelComplete } from '../src/lib/smart'
const cats = [{ id: 'car', household_id: 'h', type: 'expense' as const, name: '차량·주유', sort: 1, archived: false }, { id: 'etc', household_id: 'h', type: 'expense' as const, name: '기타', sort: 2, archived: false }]
describe('주유 초안', () => {
  it('fuel이 있으면 초안에 싣고 분류는 차량·주유, 단가 경고는 초안 경고로', () => {
    const [e] = checkEntries({ note: null, entries: [entry({ category: '기타', fuel: { liters: 30, price_per_liter: 1652, fuel_type: '휘발유' } })] })
    const [d] = entryDrafts(e, 0, { today: '2026-10-21', methods: [], categories: cats, existing: [], fallbackMethodId: null, fallbackScope: 'shared' }, true)
    expect(d.fuel).toEqual({ liters: 30, price_per_liter: 1652, fuel_type: '휘발유' })
    expect(d.category_id).toBe('car')
    expect(d.warnings.some((w) => w.includes('8,590원'))).toBe(true)
  })
  it('주유가 아니면 fuel은 null이고 분류는 그대로', () => {
    const [e] = checkEntries({ note: null, entries: [entry({ merchant: '이마트', category: '기타' })] })
    const [d] = entryDrafts(e, 0, { today: '2026-10-21', methods: [], categories: cats, existing: [], fallbackMethodId: null, fallbackScope: 'shared' }, true)
    expect(d.fuel).toBeNull()
    expect(d.category_id).toBe('etc')
  })
  it('리터와 단가가 다 있어야 저장할 수 있다', () => {
    expect(fuelComplete({ liters: 35.2, price_per_liter: 1652, fuel_type: null })).toBe(true)
    expect(fuelComplete({ liters: 35.2, price_per_liter: null, fuel_type: '휘발유' })).toBe(false)
    expect(fuelComplete(null)).toBe(false)
  })
})
```

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/fuel.test.ts` → FAIL.
- [ ] **Step 3: 구현** — `smart.ts`: `entryDrafts`의 `make`에서 `fuel: e.fuel ?? null`(그룹의 첫 초안에만; 주유는 items가 비어 나뉘지 않는다), `category_id`는 `e.fuel`이면 `categories.find(c => c.type === 'expense' && c.name === '차량·주유')?.id ?? pickCategory(...)`, `shared`에 `e.fuel_note` 추가. `saveDraft`: rpc 뒤 `fuelComplete(d.fuel)`이면 `insertFuelFill(...)`를 `try/catch`로 부르고 `fuelSaved`를 돌려준다. `api.ts`: `FUEL_COLUMNS = 'id, transaction_id, liters, price_per_liter, fuel_type, transactions(occurred_on, amount, title)'`, 읽은 뒤 평탄화·`Number()`·`occurred_on` 내림차순 정렬, `fetchItemHistory`는 `TX_WITH_ITEMS`에서 `transaction_items(`를 `transaction_items!inner(`로 바꾼 select와 `.eq('type','expense').gte('occurred_on', from).order('occurred_on')`.
- [ ] **Step 4: 통과 확인** — `npx vitest run tests/fuel.test.ts tests/smart.test.ts && npx tsc --noEmit` → PASS.
- [ ] **Step 5: 커밋** — `git commit -m "주유 초안·저장: Draft.fuel, 차량·주유 분류, fuel_fills 넣기와 읽기, 최근 1년 품목 줄 읽기"`

### Task 4: 주유 계산 `src/lib/fuel.ts`

**Files:**
- Create: `src/lib/fuel.ts`
- Test: `tests/fuel.test.ts`(이어서)

**Interfaces:**
- Consumes: `FuelFill`.
- Produces:
  - `sortFills(fills: FuelFill[]): FuelFill[]` — 최근 날짜 먼저(같은 날은 입력 순서 유지).
  - `fuelKind(t: string | null): string | null` — 고급 → `고급휘발유`, 휘발유·가솔린 → `휘발유`, 경유·디젤 → `경유`, lpg → `LPG`, 그 밖은 trim 그대로, null은 null.
  - `fuelDelta(fills: FuelFill[]): { latest: FuelFill; prev: FuelFill | null; diff: number | null; pct: number | null } | null` — prev는 latest보다 앞선 같은 `fuelKind`(둘 다 null이면 같다) 중 가장 최근. 없으면 null.
  - `fuelText(f: TxFuel): string` — `휘발유 35.2L, 1,652원/L`(유종 없으면 생략). 내역 행(`TxRow` 보조 줄)과 수정 시트(`EntrySheet`, 품목 줄 자리에 읽기 전용 한 줄)에 쓴다.
  - `fuelMonth(fills: FuelFill[], ym: string): { ym: string; count: number; liters: number; amount: number }`
  - `fuelInterval(fills: FuelFill[], n = 6): number | null` — 최근 n번의 이웃 날짜 간격 평균(일, 반올림). 2번 미만이면 null.
  - `fuelTrend(fills: FuelFill[], n = 12): FuelFill[]` — 최근 n번을 오래된 것부터.
  - `litersText(l: number): string` — `35.2L`, `35L`(정수), 소수 둘째 자리까지.
  - `fillLine(f: FuelFill): string` — `10월 18일, 휘발유 35.2L, 1,652원/L, 58,150원`(유종 없으면 생략).

- [ ] **Step 1: 시험** — `tests/fuel.test.ts`에 `fill(date, ppl, liters, fuel_type = '휘발유')` 도우미와:

```ts
describe('주유 계산', () => {
  const fills = [fill('2026-10-18', 1652, 35.2), fill('2026-10-02', 1629, 30), fill('2026-09-20', 1615, 40, '경유'), fill('2026-09-05', 1640, 28.5)]
  it('지난번 대비는 같은 유종끼리', () => {
    expect(fuelDelta(fills)).toMatchObject({ latest: { occurred_on: '2026-10-18' }, prev: { occurred_on: '2026-10-02' }, diff: 23, pct: 1.4 })
    expect(fuelDelta([fill('2026-10-18', 1652, 35.2), fill('2026-09-20', 1615, 40, '경유')])?.prev).toBeNull()
    expect(fuelDelta([])).toBeNull()
  })
  it('달별 횟수·리터·금액과 평균 간격', () => {
    expect(fuelMonth(fills, '2026-10')).toEqual({ ym: '2026-10', count: 2, liters: 65.2, amount: 58150 + 48870 })
    expect(fuelInterval(fills)).toBe(14) // (16 + 12 + 15) / 3 = 14.33
    expect(fuelInterval([fills[0]])).toBeNull()
  })
  it('추이는 최근 n번을 오래된 것부터, 글자는 단위와 함께', () => {
    expect(fuelTrend(fills, 2).map((f) => f.occurred_on)).toEqual(['2026-10-02', '2026-10-18'])
    expect(litersText(35.2)).toBe('35.2L'); expect(litersText(30)).toBe('30L')
    expect(fillLine(fills[0])).toBe('10월 18일, 휘발유 35.2L, 1,652원/L, 58,150원')
  })
})
```
  (`fill` 도우미의 amount는 `Math.round(ppl * liters)`.)

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/fuel.test.ts` → FAIL.
- [ ] **Step 3: 구현** — `src/lib/fuel.ts`. 비율은 `pctChange`(`src/lib/stats.ts`), 날짜 글자는 `md` 형식(`insights.ts`의 것과 같은 꼴, 함수는 새로 둔다).
- [ ] **Step 4: 통과 확인** — `npx vitest run tests/fuel.test.ts` → PASS.
- [ ] **Step 5: 커밋** — `git commit -m "주유 계산: 지난번 대비(같은 유종), 달별 합계, 평균 간격, 추이"`

### Task 5: 주유 화면 — 통계 묶음과 확인 화면 칸

**Files:**
- Create: `src/components/FuelCard.tsx`
- Modify: `src/components/StatsView.tsx`(BillCard 다음에 `<FuelCard householdId reloadKey={cur} ym={ym} today={today} onAdd={onFuel} />`, Props에 `onFuel: () => void`), `src/App.tsx`(`onFuel={() => setSmart({ open: true, mode: 'photo' })}`), `src/components/SmartSheet.tsx`(`DraftCard`에 주유 칸, review 단계에서 `fetchFuelFills`로 지난 주유 한 줄, `saveAll`의 안내 문구), `src/styles.css`, `scripts/shell-fixtures.mjs`, `scripts/screenshots.mjs`, `README.md`·`DESIGN.md`는 Task 8에서.

**Interfaces:**
- Consumes: Task 3·4 전부.
- Produces: `FuelCard` 묶음(`.card.fuel-card`), `DraftCard`의 `.fuel-fields`.

- [ ] **Step 1: FuelCard** — 설계 3-1 "통계 탭 주유 묶음" 그대로. 그래프는 `<svg className="fuel-chart" viewBox="0 0 360 140">`에 리터당 가격 선(`polyline`)과 점, 첫·마지막·최저·최고 값을 `text`로 직접(최저·최고가 첫·마지막과 같으면 한 번만), x축은 날짜 `M/D`(최대 6개만 고르게). 유종이 섞이면 최근 유종만 선으로 그리고 다른 유종은 선 없이 점. 빈 상태·오류 문구. 버튼 "주유 영수증 넣기"(`ghost full-btn`).
- [ ] **Step 2: DraftCard 주유 칸** — `d.fuel`이 있을 때 분류 칩 위에 `.fuel-fields`: 유종(`input`, maxLength 20), 주유량 L(`inputMode="decimal"`), 리터당 원(`inputMode="numeric"`), 아래 `tx-meta`로 "단가 × 주유량 = N원"(둘 다 있을 때) 또는 "리터와 단가를 모두 적어야 주유 기록이 저장돼요. 비워 두면 내역만 저장해요." 지난 주유(prop `lastFill: FuelFill | null`)가 있고 유종이 같으면 "지난 주유(10월 2일) 1,629원/L보다 ▲ 23원" (`fuelDelta([{…현재 값…}, lastFill])` 재사용: 현재 값을 임시 `FuelFill`로 만들어 넘긴다). `SmartSheet`는 review 단계에 들어갈 때 `withGrocery`와 같은 `useEffect`에서 `fetchFuelFills`를 부르되 `drafts.some(d => d.fuel)`일 때만.
- [ ] **Step 3: saveAll 안내와 저장 뒤 보기** — `fuelSaved === false`가 하나라도 있으면 parts에 "주유 기록은 저장하지 못했어요", 주유를 저장했으면 "주유 기록 N건을 넣었어요". `TxRow`의 meta에 `t.fuel`이 있으면 `fuelText(t.fuel)`를 품목 수 자리에, `EntrySheet`는 `editing.fuel`이 있으면 품목 줄 자리에 "주유 — 휘발유 35.2L, 1,652원/L (고치려면 내역을 지우고 다시 찍어요)" 한 줄. `FuelCard`의 다시 읽기 열쇠는 `[billsVersion, cur]`(저장 뒤 실시간 이벤트가 `fuel_fills` 삽입보다 먼저 와도 `billsVersion`이 뒤에 오른다).
- [ ] **Step 4: CSS** — `.fuel-fields`(세 칸 `grid-template-columns: 1.2fr 1fr 1fr; gap: 8px`), `.fuel-big`(amount-lg 34/800), `.fuel-delta.up { color: var(--clay) } .down { color: var(--indigo) }`, `.fuel-chart`(선 `stroke: var(--sage)`, 점 `fill: var(--sage)`, 글자 11px은 숫자만), `.fuel-list`(줄마다 `grid 1fr auto`, 13px 이상).
- [ ] **Step 5: 가짜 데이터·장면** — `shell-fixtures.mjs`: `EXPENSE`에 `'차량·주유'` 추가, `daysAgo(n)` 도우미, 주유 내역 3건(`t20`~`t22`, 제목 'GS칼텍스 분당주유소'·'SK에너지 야탑주유소', 금액 58150·48870·46740)과 `'public.fuel_fills'`: 같은 3건(`transactions: { occurred_on, amount, title }` 포함, liters 35.2·30·28.5, ppl 1652·1629·1640, 휘발유). `FUEL_RECEIPT`(merchant 'GS칼텍스 분당주유소', amount 58150, items [], fuel { 35.2, 1652, '휘발유' }, category '차량·주유', date daysAgo(0)) 내보내기. `screenshots.mjs`: `fakeSupabase`에서 `s.fuel`이면 `FUEL_RECEIPT`; 장면 `shell-smart-fuel-{390,1280}-{light,dark}`(receipt 흐름 뒤 `getByText('리터당')` 대기, `.fuel-fields` 스크롤), 통계는 기존 `shell-stats-*`(full)에 묶음이 들어간다.
- [ ] **Step 6: 캡처·확인** — 개발 서버(5188) 띄우고 `BASE_URL=http://localhost:5188 npm run screens -- shell-smart-fuel shell-stats` → 8+8장을 Read로 보고 가로 스크롤·겹침·글자 크기·다크 대비를 고친다. `npx tsc --noEmit && npm test` PASS.
- [ ] **Step 7: 커밋** — `git commit -m "통계 주유 묶음(리터당 가격 추이·달별·간격)과 영수증 확인 화면의 주유 칸"`

### Task 6: 장보기 비교 계산 `src/lib/shopCompare.ts`

**Files:**
- Create: `src/lib/shopCompare.ts`
- Test: `tests/shop-compare.test.ts`

**Interfaces:**
- Consumes: `Transaction`(items 포함), `perUnit`(`src/lib/units.ts`), `pctChange`.
- Produces:
  - `normName(s: string): string` — 공백·`★*·,()[]/` 제거·소문자.
  - `nameTokens(s: string): string[]` — 공백으로 나눠 2자 이상, 용량·수량 토큰(`/^x?\d+(\.\d+)?(g|kg|ml|l|구|개입|개|팩|봉|병|캔|장|롤|입|ea|매)?$/i`)과 꾸밈말(국산·수입·특가·행사·기획·증정·세트·묶음·할인·대용량·무료배송·당일배송) 제외.
  - `type CompareLine = { key: string; name: string; quantity: number; unitPrice: number | null; amount: number; packSize: number | null; packUnit: string | null; groceryName: string | null }`
  - `type PastLine = { txId: string; date: string; place: string; name: string; quantity: number; unitPrice: number | null; amount: number; packSize: number | null; packUnit: string | null }`
  - `pastLines(txs: Transaction[]): PastLine[]` — 지출 내역의 상품 줄(금액 > 0, 이름이 '배송비'로 시작하지 않음). place는 `platform ?? title`.
  - `matchPast(line: CompareLine, past: PastLine[]): { grade: 'product' | 'kind'; line: PastLine; all: PastLine[] } | null` — 설계 3-2 ①: (a) 정규화 이름 같음/포함(짧은 쪽 4자 이상) 또는 (b) 토큰 2개 이상 겹침 → `product`; 없으면 (c) `groceryName`의 정규화 글자가 지난 이름에 포함 → `kind`. `all`은 같은 등급으로 맞은 지난 줄 전부(최근순), `line`은 그 첫째.
  - `unitOf(l: { quantity, unitPrice, amount, packSize, packUnit }): { base: string; price: number } | null` — 용량이 있으면 `perUnit`(100g·100ml·1개), 없으면 `{ base: '1개', price: unitPrice ?? amount / quantity }`.
  - `restockDays(name: string, groceryName: string | null): number` — 설계 3-2 ③ 표(`RESTOCK_DAYS`), 기본 7.
  - `trips(txs: Transaction[], groceryCategoryIds: ReadonlySet<string>): { date: string; place: string; count: number; total: number }[]` — 같은 날짜·`created_at` 5분 안에 이어지는 내역 묶음, 상품 줄 합 3개 이상, 내역 하나라도 분류가 `groceryCategoryIds`에 듦, 최근 날짜 먼저.
  - `type LineVerdict = { key: string; name: string; match: ReturnType<typeof matchPast>; price: { now: number; prev: number; base: string; diff: number; pct: number | null; ref: PastLine } | null; recent: { ref: PastLine; days: number; limit: number } | null; offList: boolean; duplicate: boolean }`
  - `type CompareResult = { count: number; total: number; prevTrip: { date: string; place: string; count: number; total: number } | null; pricier: LineVerdict[]; cheaper: LineVerdict[]; recent: LineVerdict[]; offList: LineVerdict[]; duplicates: LineVerdict[]; first: LineVerdict[]; listUsed: boolean }`
  - `isGroceryEntry(categoryName: string | null, lines: CompareLine[]): boolean` — 분류 이름이 `장보기`·`식비`이거나 `lines.some(l => l.groceryName)`.
  - `compareTrip(lines: CompareLine[], history: Transaction[], date: string, total: number, groceryCategoryIds: ReadonlySet<string>): CompareResult` — `trips`는 내역 하나라도 `category_id`가 `groceryCategoryIds`에 든 묶음만(인자로 받는다: `trips(txs, groceryCategoryIds)`); `pastLines`는 분류와 상관없이 전부. `listUsed = lines.some(l => l.groceryName)`; `offList`는 listUsed일 때만; `price`는 두 `unitOf`의 base가 같을 때만(등급 `kind`는 base가 '1개'가 아닐 때만); `recent`는 `days = date − ref.date`가 `limit`보다 작을 때(limit: `all`이 2개 이상이면 그 날짜 간격 중앙값의 절반(올림, 최소 1), 아니면 `restockDays`); `prevTrip`은 `trips(history)` 중 `date`보다 앞선 첫째; `pricier`·`cheaper`는 `diff` 절댓값 큰 순, `diff === 0`은 둘 다 아님.

- [ ] **Step 1: 시험** — `tests/shop-compare.test.ts`(도우미 `tx(id, date, title, items, createdAt?)`, `line(name, amount, p?)`):

```ts
describe('이름 맞추기', () => {
  it('같은 상품: 정규화 이름 포함, 토큰 2개 겹침', () => {
    expect(normName('★진라면 순한맛 (120GX5)')).toBe('진라면순한맛120gx5')
    expect(nameTokens('*국산 양파 1.5kg(망)')).toEqual(['양파'])
    const past = pastLines([tx('p1', '2026-10-14', '이마트', [{ name: '서울저지방우유 1L*2입', amount: 5480, pack_size: 2000, pack_unit: 'ml' }])])
    expect(matchPast(line('서울 저지방 우유 1L*2', 5990), past)?.grade).toBe('product')
    expect(matchPast(line('풀무원 그릭 플레인 400g', 3890), pastLines([tx('p2', '2026-10-14', '이마트', [{ name: '풀무원 국산콩 두부 300g', amount: 2800 }])]))).toBeNull()
    expect(matchPast(line('*국산 대파(봉) 600g', 3200), pastLines([tx('p3', '2026-10-14', '이마트', [{ name: '*국산 양파 1.5kg(망)', amount: 3990 }])]))).toBeNull()
  })
  it('같은 품목: 연결된 장보기 품목 이름이 지난 상품명에 들어 있을 때', () => {
    const past = pastLines([tx('p1', '2026-10-11', '이마트', [{ name: '해찬들 재래식 된장 1kg', amount: 7990, pack_size: 1000, pack_unit: 'g' }])])
    expect(matchPast(line('청정원 순창 재래식 생된장 500g', 4990, { groceryName: '된장' }), past)?.grade).toBe('kind')
    expect(matchPast(line('청정원 순창 재래식 생된장 500g', 4990), past)).toBeNull()
  })
})
describe('값 비교와 최근 구매', () => {
  it('용량이 있으면 100ml당으로, 없으면 개당으로 견준다', () => {
    const past = pastLines([tx('p1', '2026-10-14', '이마트', [{ name: '서울저지방우유 1L*2입', amount: 5480, pack_size: 2000, pack_unit: 'ml' }])])
    const r = compareTrip([line('서울 저지방 우유 1L*2', 5990, { pack_size: 2000, pack_unit: 'ml' })], past, '2026-10-21', 5990)
    expect(r.pricier[0].price).toMatchObject({ base: '100ml', now: 299.5, prev: 274, diff: 25.5, pct: 9.3 })
  })
  it('같은 품목 등급은 용량 값이 없으면 값을 견주지 않는다', () => { /* kind + packSize null → price null, first에 들어가지 않고 match만 */ })
  it('최근에 또 산 것: 기본 표와 중앙값 규칙', () => {
    expect(restockDays('청정원 순창 재래식 생된장 500g', '된장')).toBe(45)
    expect(restockDays('서울 저지방 우유', null)).toBe(5)
    expect(restockDays('이름 없는 것', null)).toBe(7)
    const past = pastLines([tx('p1', '2026-10-11', '이마트', [{ name: '청정원 순창 재래식 생된장 500g', amount: 4990 }])])
    const r = compareTrip([line('청정원 순창 재래식 생된장 500g', 4990)], past, '2026-10-21', 4990)
    expect(r.recent[0].recent).toMatchObject({ days: 10, limit: 45 })
    // 두 번 이상 샀으면 간격 중앙값의 절반: 30일·30일 간격 → 15일 기준, 10일 전이면 표시, 20일 전이면 아님
  })
})
describe('장보기 묶음과 목록', () => {
  it('상품별로 나눈 영수증도 같은 시각이면 한 번의 장보기', () => {
    const t = [...Array(4)].map((_, i) => tx(`s${i}`, '2026-10-14', `상품${i}`, [{ name: `상품${i}`, amount: 1000 }], `2026-10-20T08:00:3${i}Z`, 'food'))
    expect(trips(t, new Set(['food']))).toEqual([{ date: '2026-10-14', place: '장보기', count: 4, total: 4000 }])
    expect(trips(t, new Set(['other']))).toEqual([]) // 장보기·식비가 아닌 묶음(쿠팡 가전 주문)은 지난 장보기가 아니다
    expect(trips([tx('a', '2026-10-14', '이마트', [{ name: 'x', amount: 1 }], undefined, 'food')], new Set(['food']))).toEqual([]) // 상품 3개 미만
  })
  it('목록에 없던 것은 목록을 쓴 영수증에서만, 같은 것이 두 줄', () => {
    const lines = [line('삼겹살', 10000, { groceryName: '삼겹살' }), line('삼겹살', 9000), line('포카칩', 1590)]
    const r = compareTrip(lines, [], '2026-10-21', 20590)
    expect(r.offList.map((v) => v.name)).toEqual(['삼겹살', '포카칩'])
    expect(r.duplicates.map((v) => v.name)).toEqual(['삼겹살'])
    expect(compareTrip([line('포카칩', 1590)], [], '2026-10-21', 1590).offList).toEqual([])
    expect(r.prevTrip).toBeNull()
  })
})
```
  (가운데 빈 시험은 구현 때 채운다.)

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/shop-compare.test.ts` → FAIL.
- [ ] **Step 3: 구현** — `src/lib/shopCompare.ts`.
- [ ] **Step 4: 통과 확인** — `npx vitest run tests/shop-compare.test.ts` → PASS.
- [ ] **Step 5: 커밋** — `git commit -m "장보기 비교 계산: 이름 맞추기, 용량당 값 비교, 최근 구매, 장보기 묶음, 목록에 없던 것"`

### Task 7: "이번 장보기 살펴보기" 묶음

**Files:**
- Create: `src/components/ShopCompareCard.tsx`
- Modify: `src/components/SmartSheet.tsx`(history 읽기, 그룹마다 카드), `src/styles.css`, `scripts/shell-fixtures.mjs`, `scripts/screenshots.mjs`

**Interfaces:**
- Consumes: Task 6 `compareTrip`·`CompareResult`, Task 3 `fetchItemHistory`, 기존 `receiptLines`·`picks`·`grocery`.
- Produces: `ShopCompareCard({ result: CompareResult; loading: boolean; error: string | null })`.

- [ ] **Step 1: SmartSheet** — review 단계·`withGrocery`일 때 `fetchItemHistory(householdId, 365일 전)`를 `historyState: { rows: Transaction[]; loading: boolean; error: string | null }`로. 그룹마다 `useMemo`: `lines`를 그 그룹의 초안(`groupOf(d) === g.index`)으로 좁히고 `CompareLine`으로 바꾸며(`groceryName`은 `picks`에 그 줄 key가 있으면 그 장보기 품목 이름, 없으면 `suggested`도 본다), `compareTrip(lines, rows, g.entry.date ?? today, g.entry.amount, groceryCategoryIds)`(`categories`에서 이름이 `장보기`·`식비`인 id). 카드는 `isGroceryEntry(그 그룹 첫 초안의 분류 이름, lines)`일 때만, 그 그룹의 `.draft-group` 안 초안 카드들 뒤.
- [ ] **Step 2: ShopCompareCard** — 설계 3-2 화면 그대로. 항목마다 5줄 + "N개 더 보기"(`link-btn`), 등락은 `cmp-up`(`clay`)·`cmp-down`(`indigo`), 비율은 괄호. 지난 기록이 전혀 없으면(`history` 비어 있음) 한 문장 + 목록에 없던 것만. `loading`이면 "지난 장보기 기록 읽는 중", `error`면 "지난 기록을 불러오지 못했어요. 저장에는 영향이 없어요." 맨 아래 `tx-meta`: "최근 1년 가계부 기록과 견줬어요. 상품 이름이 비슷한 것끼리 맞춘 거라 다른 상품일 수 있어요."
- [ ] **Step 3: CSS** — `.cmp-card`(`.card` 위에 `display:flex; flex-direction:column; gap:10px`), `.cmp-head`(15px), `.cmp-sub`(`section-title` 14px 700 + 개수 `muted`), `.cmp-row`(`grid minmax(0,1fr) auto`, 이름 2줄 말줄임), `.cmp-ref`(13px `ink-2`), `.cmp-up/.cmp-down`.
- [ ] **Step 4: 가짜 데이터·장면** — `shell-fixtures.mjs`의 `transactions`에 지난 장보기 두 번: `t30`(daysAgo(7), '이마트 분당점', 품목 '서울우유 900ml' 2개 4,800(900ml), '국산 대파 1단' 3,500, '계란 30구' 7,980(30구), '부침두부 300g' 2,800(300g)), `t31`(daysAgo(3), '이마트 분당점', '부침두부 300g' 2,800). `RECEIPT`의 date를 `daysAgo(0)`으로. 장면 `shell-smart-compare-{390,1280}-{light,dark}`: receipt 흐름 뒤 `getByText('이번 장보기 살펴보기')` 대기, `.cmp-card` 스크롤.
- [ ] **Step 5: 캡처·확인** — `BASE_URL=http://localhost:5188 npm run screens -- shell-smart-compare shell-smart-grocery` → 눈으로 확인·수정. `npx tsc --noEmit && npm test` PASS.
- [ ] **Step 6: 커밋** — `git commit -m "영수증 확인 화면의 이번 장보기 살펴보기(지난 장보기 대비, 비싸진·싸진 것, 최근에 또 산 것, 목록에 없던 것)"`

### Task 8: 문서와 마무리

**Files:**
- Modify: `README.md`(기능 목록 두 줄, 구조 표 `tests/fuel.test.ts`·`tests/shop-compare.test.ts`), `DESIGN.md`(Components에 "주유 묶음"·"이번 장보기 살펴보기"), `docs/grocery/tracking/decisions/index.md`(D-021 주유, D-022 장보기 비교), `docs/grocery/tracking/status.md`("된 것"에 한 묶음, "열린 문제"에 오늘 기록의 오독·분류 불일치 관찰), `docs/HANDOFF.md` 5절(적용·배포 대기 항목)

- [ ] **Step 1: 문서 수정** — 각 파일에 위 내용. D-021·D-022 "이유"에는 설계 1-2절의 관찰과 사용자 요청을 적는다.
- [ ] **Step 2: 전체 확인** — `npm test && npx tsc --noEmit && npm run build` PASS. `git status` 깨끗.
- [ ] **Step 3: 커밋** — `git commit -m "문서: 주유 분석·장보기 비교(D-021·D-022), 오늘 장보기 기록 관찰"`
- [ ] **Step 4: 리뷰** — 새 리뷰어(서브에이전트)에게 브랜치 diff 전체를 설계·계획과 함께 넘겨 Important 이상을 고친다.
