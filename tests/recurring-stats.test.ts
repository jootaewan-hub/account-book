import { describe, expect, it } from 'vitest'
import { dueDate, endMonthFor, historyRange, installmentPlan, installmentsLeft, monthlyAmount, nextDue, pastAmounts, monthItem, pendingInputs, phaseAt, termAt, plannedInMonth, plannedTotals, plannedTxs, subscriptionCandidates, termLeft, termOf } from '../src/lib/recurring'
import { categoryBreakdown, monthSeries, OTHER_PLATFORM, pctChange, platformBreakdown, platformOf, scopeSplit, totalOf } from '../src/lib/stats'
import type { Category, MonthTotal, Recurring, Transaction } from '../src/lib/types'

const rec = (p: Partial<Recurring>): Recurring => ({
  id: 'r', household_id: 'h', kind: 'fixed', type: 'expense', title: '월세', amount: 500000, day_of_month: 25,
  every_months: 1, category_id: null, payment_method_id: null, scope: 'shared', start_month: '2026-08-01',
  end_month: null, active: true, memo: null, installment_months: null, ...p,
})
let seq = 0
const tx = (p: Partial<Transaction>): Transaction => ({
  id: String(++seq), household_id: 'h', type: 'expense', occurred_on: '2026-10-15', amount: 1000, title: '',
  memo: null, category_id: null, payment_method_id: null, scope: 'shared', source: 'manual',
  created_by: 'u', created_at: '', recurring_id: null, platform: null, ...p,
})

describe('반복 내역 날짜', () => {
  it('31일은 짧은 달의 마지막 날, 시작 전·끝난 뒤는 없음, 매년은 시작 달에만', () => {
    expect(dueDate(rec({ day_of_month: 31 }), '2026-09')).toBe('2026-09-30')
    expect(dueDate(rec({ day_of_month: 31, start_month: '2026-01-01' }), '2026-02')).toBe('2026-02-28')
    expect(dueDate(rec({}), '2026-07')).toBeNull()
    expect(dueDate(rec({ end_month: '2026-09-01' }), '2026-10')).toBeNull()
    const yearly = rec({ every_months: 12, start_month: '2026-03-01', day_of_month: 3 })
    expect(dueDate(yearly, '2027-03')).toBe('2027-03-03')
    expect(dueDate(yearly, '2026-10')).toBeNull()
    expect(nextDue(yearly, '2026-10-15')).toBe('2027-03-03')
    expect(monthlyAmount({ ...yearly, amount: 39000 })).toBe(3250)
  })

  it('금액을 매달 넣는 관리비: 날짜가 지났고 이번 달 분이 없을 때만 알려 준다', () => {
    const util = rec({ id: 'u1', kind: 'utility', title: '관리비', amount: null, day_of_month: 10 })
    expect(pendingInputs([util], [], '2026-10-09')).toHaveLength(0)
    expect(pendingInputs([util], [], '2026-10-10')).toEqual([{ r: util, due: '2026-10-10' }])
    expect(pendingInputs([util], [tx({ recurring_id: 'u1', occurred_on: '2026-10-11' })], '2026-10-15')).toHaveLength(0)
    expect(pendingInputs([{ ...util, active: false }], [], '2026-10-15')).toHaveLength(0)
    // 10월분을 넣고 날짜만 11월로 고쳐도 10월분은 넣은 것이다 (recurring_month 기준)
    expect(pendingInputs([util], [tx({ recurring_id: 'u1', occurred_on: '2026-11-02', recurring_month: '2026-10-01' })], '2026-10-15')).toHaveLength(0)
    expect(pendingInputs([util], [tx({ recurring_id: 'u1', occurred_on: '2026-10-02', recurring_month: '2026-09-01' })], '2026-10-15')).toHaveLength(1)
  })

  it('구독 후보: 같은 이름·금액이 서로 다른 두 달 이상, 이미 등록한 것과 반복으로 만든 내역은 뺀다', () => {
    const txs = [
      tx({ title: '넷플릭스', amount: 13500, occurred_on: '2026-08-05' }),
      tx({ title: '넷플릭스 ', amount: 13500, occurred_on: '2026-09-05' }),
      tx({ title: '스타벅스', amount: 4500, occurred_on: '2026-09-01' }),
      tx({ title: '스타벅스', amount: 4500, occurred_on: '2026-09-03' }),
      tx({ title: '유튜브', amount: 14900, occurred_on: '2026-08-10' }),
      tx({ title: '유튜브', amount: 14900, occurred_on: '2026-09-10' }),
      tx({ title: '월세', amount: 500000, occurred_on: '2026-09-25', recurring_id: 'r' }),
    ]
    const out = subscriptionCandidates(txs, [rec({ title: '유튜브 프리미엄 ', kind: 'subscription' }), rec({ title: '유튜브' })])
    expect(out.map((c) => [c.title.trim(), c.amount, c.day, c.months])).toEqual([['넷플릭스', 13500, 5, ['2026-08', '2026-09']]])
  })
})

describe('통계', () => {
  const totals: MonthTotal[] = [
    { month: '2025-10-01', type: 'expense', total: 1_800_000, n: 40 },
    { month: '2026-09-01', type: 'expense', total: 2_000_000, n: 50 },
    { month: '2026-09-01', type: 'income', total: 5_000_000, n: 2 },
    { month: '2026-10-01', type: 'expense', total: 2_100_000, n: 55 },
  ]

  it('12개월 추이는 빈 달을 0으로 채우고, 전월·전년 대비 증감률을 계산한다', () => {
    const s = monthSeries(totals, '2026-10')
    expect(s).toHaveLength(12)
    expect(s[0]).toEqual({ ym: '2025-11', expense: 0, income: 0 })
    expect(s[11]).toEqual({ ym: '2026-10', expense: 2_100_000, income: 0 })
    expect(pctChange(totalOf(totals, '2026-10', 'expense'), totalOf(totals, '2026-09', 'expense'))).toBe(5)
    expect(pctChange(totalOf(totals, '2026-10', 'expense'), totalOf(totals, '2025-10', 'expense'))).toBe(16.7)
    expect(pctChange(100, 0)).toBeNull()
  })

  it('분류별 지출은 큰 것부터, 지난달 금액과 비율을 함께', () => {
    const cats: Category[] = [
      { id: 'c1', household_id: 'h', type: 'expense', name: '식비', sort: 1, archived: false },
      { id: 'c2', household_id: 'h', type: 'expense', name: '카페', sort: 2, archived: false },
    ]
    const cur = [tx({ category_id: 'c1', amount: 30000 }), tx({ category_id: 'c2', amount: 10000 }), tx({ amount: 10000 }),
      tx({ type: 'income', amount: 999999 })]
    const prev = [tx({ category_id: 'c1', amount: 20000 })]
    expect(categoryBreakdown(cur, prev, cats)).toEqual([
      { id: 'c1', name: '식비', amount: 30000, prev: 20000, share: 0.6 },
      { id: 'c2', name: '카페', amount: 10000, prev: 0, share: 0.2 },
      { id: null, name: '분류 없음', amount: 10000, prev: 0, share: 0.2 },
    ])
    expect(scopeSplit([...cur, tx({ scope: 'child', amount: 7000 })])).toEqual({ shared: 50000, husband: 0, wife: 0, child: 7000 })
  })

  it('플랫폼별 지출: 이름으로 알아보고, 큰 것부터, 모르는 것은 마지막에 그 외로', () => {
    expect(platformOf('쿠팡이츠 - 버거킹')).toBe('쿠팡이츠')
    expect(platformOf('Coupang 로켓배송')).toBe('쿠팡')
    expect(platformOf('네이버페이 스마트스토어')).toBe('네이버')
    expect(platformOf('마켓컬리')).toBe('컬리')
    expect(platformOf('이마트에브리데이')).toBeNull()
    // 짧은 별칭은 장보기 품목과 섞인다
    expect(platformOf('당근, 양파, 두부')).toBeNull()
    expect(platformOf('알리미 수수료')).toBeNull()
    expect(platformOf('당근마켓 정육점')).toBe('당근')
    expect(platformOf('카카오톡 선물하기')).toBe('카카오 선물하기')
    const cur = [tx({ title: '쿠팡', amount: 30000 }), tx({ title: '쿠팡', amount: 12000 }), tx({ title: '오늘의집', amount: 89000 }),
      tx({ title: '광동반점', amount: 38000 }), tx({ title: '쿠팡', type: 'income', amount: 5000 })]
    const prev = [tx({ title: '쿠팡', amount: 50000 })]
    // 매장 결제는 가게 이름으로. 광동반점은 한 번이지만 전체의 22%라 따로 보인다
    expect(platformBreakdown(cur, prev)).toEqual([
      { name: '오늘의집', kind: 'platform', amount: 89000, count: 1, prev: 0 },
      { name: '쿠팡', kind: 'platform', amount: 42000, count: 2, prev: 50000 },
      { name: '광동반점', kind: 'merchant', amount: 38000, count: 1, prev: 0 },
    ])
  })

  it('어디서 샀나: 한 번만 간 작은 가게도 따로 보이고, 이름 없는 결제만 맨 뒤 한 줄. 반복 내역과 대출이자·관리비 같은 분류는 뺀다', () => {
    const cats: Category[] = [{ id: 'loan', household_id: 'h', type: 'expense', name: '대출이자', sort: 1, archived: false }]
    const cur = [tx({ title: '쿠팡', amount: 100000 }), tx({ title: '(주)신세계까사', amount: 1000 }), tx({ title: '벽제 설렁탕', amount: 1200 }),
      tx({ title: '씨유 분당상록마을점', amount: 500 }), tx({ title: '씨유 서현점', amount: 500 }), tx({ title: '', amount: 9000 }),
      tx({ title: '대출이자', category_id: 'loan', amount: 3_900_000 }), tx({ title: '넷플릭스', recurring_id: 'r1', amount: 17000 })]
    expect(platformBreakdown(cur, [], cats)).toEqual([
      { name: '쿠팡', kind: 'platform', amount: 100000, count: 1, prev: 0 },
      { name: '벽제 설렁탕', kind: 'merchant', amount: 1200, count: 1, prev: 0 },
      { name: '씨유', kind: 'merchant', amount: 1000, count: 2, prev: 0 },
      { name: '신세계까사', kind: 'merchant', amount: 1000, count: 1, prev: 0 },
      { name: OTHER_PLATFORM, kind: 'other', amount: 9000, count: 1, prev: 0 },
    ])
  })
})

describe('달력의 고정지출 예정분 (D-030)', () => {
  const at = (list: Recurring[], ym: string, today = '2026-10-26', txs: Transaction[] = []) =>
    plannedInMonth(list, txs, ym, today).map((p) => [p.r.id, p.date, p.amount, p.round])

  it('다음 달부터는 내는 날마다, 이번 달은 오늘 뒤 날짜만(오늘 분은 DB가 이미 넣었다)', () => {
    const list = [rec({ id: 'rent', day_of_month: 25 }), rec({ id: 'phone', amount: 55000, day_of_month: 26 }), rec({ id: 'gym', amount: 60000, day_of_month: 28 })]
    expect(at(list, '2026-11')).toEqual([['rent', '2026-11-25', 500000, null], ['phone', '2026-11-26', 55000, null], ['gym', '2026-11-28', 60000, null]])
    expect(at(list, '2026-10')).toEqual([['gym', '2026-10-28', 60000, null]])
    expect(at(list, '2026-09')).toEqual([])
  })

  it('그 달 분이 이미 내역에 있으면(recurring_month 기준) 빼고, 다른 달 분은 빼지 않는다', () => {
    const list = [rec({ id: 'gym', amount: 60000, day_of_month: 28 })]
    expect(at(list, '2026-10', '2026-10-26', [tx({ recurring_id: 'gym', occurred_on: '2026-10-20', recurring_month: '2026-10-01' })])).toEqual([])
    expect(at(list, '2026-11', '2026-10-26', [tx({ recurring_id: 'gym', occurred_on: '2026-10-28', recurring_month: '2026-10-01' })])).toHaveLength(1)
  })

  it('끝난 뒤·시작 전·꺼진 항목·금액이 매달 다른 항목·수입은 없고, 매년 항목은 그 달에만, 31일은 그 달 마지막 날', () => {
    expect(at([rec({ end_month: '2026-12-01' })], '2027-01')).toEqual([])
    expect(at([rec({ start_month: '2027-01-01' })], '2026-12')).toEqual([])
    expect(at([rec({ active: false })], '2026-11')).toEqual([])
    expect(at([rec({ kind: 'utility', amount: null })], '2026-11')).toEqual([])
    expect(at([rec({ type: 'income', title: '월급' })], '2026-11')).toEqual([])
    const yearly = rec({ id: 'y', every_months: 12, start_month: '2026-03-01', day_of_month: 3, amount: 39000 })
    expect(at([yearly], '2027-03')).toEqual([['y', '2027-03-03', 39000, null]])
    expect(at([yearly], '2027-02')).toEqual([])
    expect(at([rec({ id: 'e', day_of_month: 31 })], '2026-11')).toEqual([['e', '2026-11-30', 500000, null]])
  })

  it('할부는 회차를 DB 메모와 같은 셈으로 붙인다', () => {
    // 9월 시작 6개월(9월~2월), 매달 15일
    const fridge = rec({ id: 'f', kind: 'installment', amount: 100000, day_of_month: 15, start_month: '2026-09-01', end_month: '2027-02-01', installment_months: 6 })
    expect(at([fridge], '2026-11')).toEqual([['f', '2026-11-15', 100000, [3, 6]]])
    expect(at([fridge], '2027-02')).toEqual([['f', '2027-02-15', 100000, [6, 6]]])
    expect(at([fridge], '2027-03')).toEqual([])
  })
})

describe('예정 내역·달별 합계·고정 탭의 달 (D-030 보충)', () => {
  const rent = rec({ id: 'rent', day_of_month: 25 })
  const util = rec({ id: 'u', kind: 'utility', title: '관리비', amount: null, day_of_month: 25 })
  const yearly = rec({ id: 'y', every_months: 12, start_month: '2026-03-01', day_of_month: 3, amount: 39000 })

  it('예정 내역은 DB에 없는 id(plan:)와 planned 표시, 그 달 분(recurring_month)을 단다', () => {
    expect(plannedTxs([rent], [], '2026-11', '2026-10-26')).toEqual([expect.objectContaining({
      id: 'plan:rent:2026-11', type: 'expense', occurred_on: '2026-11-25', amount: 500000, title: '월세', source: 'recurring',
      recurring_id: 'rent', recurring_month: '2026-11-01', planned: { kind: 'fixed', round: null },
    })])
  })

  it('12개월 막대: 이번 달부터만, 달마다 합계와 건수', () => {
    expect(plannedTotals([rent, yearly], [], '2026-01', '2027-03', '2026-10-26')).toEqual([
      { month: '2026-11-01', type: 'expense', total: 500000, n: 1 },
      { month: '2026-12-01', type: 'expense', total: 500000, n: 1 },
      { month: '2027-01-01', type: 'expense', total: 500000, n: 1 },
      { month: '2027-02-01', type: 'expense', total: 500000, n: 1 },
      { month: '2027-03-01', type: 'expense', total: 539000, n: 2 },
    ])
  })

  it('고정 탭의 달: 기록됨(내역 금액)·예정·기록 없음·그 달엔 없음, 관리비는 지난번 금액을 짐작으로', () => {
    const today = '2026-10-26'
    const done = tx({ recurring_id: 'rent', occurred_on: '2026-10-25', recurring_month: '2026-10-01', amount: 480000 })
    expect(monthItem(rent, [done], [], '2026-10', today)).toEqual({ date: '2026-10-25', state: 'done', amount: 480000, estimate: false })
    expect(monthItem(rent, [], [], '2026-10', today)).toEqual({ date: '2026-10-25', state: 'missing', amount: 500000, estimate: false })
    expect(monthItem(rent, [], [], '2026-11', today)).toEqual({ date: '2026-11-25', state: 'planned', amount: 500000, estimate: false })
    expect(monthItem(yearly, [], [], '2026-11', today)).toEqual({ date: null, state: 'none', amount: 39000, estimate: false })
    expect(monthItem({ ...rent, active: false }, [], [], '2026-11', today).state).toBe('none')
    // 예정 내역(planned)은 '기록됨'으로 치지 않는다
    expect(monthItem(rent, plannedTxs([rent], [], '2026-11', today), [], '2026-11', today).state).toBe('planned')
    const hist = [tx({ recurring_id: 'u', occurred_on: '2026-09-25', amount: 167860 })]
    expect(monthItem(util, [], hist, '2026-11', today)).toEqual({ date: '2026-11-25', state: 'planned', amount: 167860, estimate: true })
    expect(monthItem(util, [], [], '2026-11', today)).toEqual({ date: '2026-11-25', state: 'planned', amount: null, estimate: true })
  })
})

describe('고른 달의 회차 (D-030 보충 2)', () => {
  // 9월 시작 2027년 2월 끝(6회), 매달 10일
  const tax = rec({ id: 't', title: '취득세', amount: 120000, day_of_month: 10, start_month: '2026-09-01', end_month: '2027-02-01' })
  // 8월에 산 6개월 할부: 8월이 1회차(산 날 내역), 반복 항목은 9월~2027년 1월
  const fridge = rec({ id: 'f', kind: 'installment', amount: 100000, day_of_month: 15, start_month: '2026-09-01', end_month: '2027-01-01', installment_months: 6 })

  it('기간을 정한 고정지출: 시작 전·시작 달·중간·마지막 달·끝난 뒤', () => {
    expect(phaseAt(tax, '2026-08')).toBe('before')
    expect(termAt(tax, '2026-08')).toBeNull()
    expect(termAt(tax, '2026-09')).toEqual({ n: 1, total: 6, left: 5, due: true })
    expect(termAt(tax, '2026-11')).toEqual({ n: 3, total: 6, left: 3, due: true })
    expect(termAt(tax, '2027-02')).toEqual({ n: 6, total: 6, left: 0, due: true })
    expect(phaseAt(tax, '2027-03')).toBe('after')
    expect(termAt(tax, '2027-03')).toBeNull()
  })

  it('할부: 산 달이 1회차, 시작 달이 2회차, 달력의 "할부 n/m"과 같은 회차', () => {
    expect(phaseAt(fridge, '2026-07')).toBe('before')
    expect(termAt(fridge, '2026-08')).toEqual({ n: 1, total: 6, left: 5, due: true })
    expect(termAt(fridge, '2026-09')).toEqual({ n: 2, total: 6, left: 4, due: true })
    expect(termAt(fridge, '2026-11')).toEqual({ n: 4, total: 6, left: 2, due: true })
    expect(plannedInMonth([fridge], [], '2026-11', '2026-10-26')[0].round).toEqual([4, 6])
    expect(termAt(fridge, '2027-01')).toEqual({ n: 6, total: 6, left: 0, due: true })
    expect(phaseAt(fridge, '2027-02')).toBe('after')
  })

  it('매년 항목: 내지 않는 달에는 그 뒤로 남은 횟수만, 끝나는 달이 없으면 회차가 없다', () => {
    const yearly = rec({ every_months: 12, start_month: '2026-03-01', end_month: '2029-03-01', day_of_month: 3 })
    expect(termAt(yearly, '2026-11')).toEqual({ n: 1, total: 4, left: 3, due: false })
    expect(termAt(yearly, '2027-03')).toEqual({ n: 2, total: 4, left: 2, due: true })
    expect(termAt(rec({}), '2026-11')).toBeNull()
    expect(phaseAt(rec({ start_month: '2026-12-01' }), '2026-11')).toBe('before')
  })
})

describe('할부', () => {
  it('나누어떨어지지 않는 나머지는 첫 회차에', () => {
    expect(installmentPlan(900000, 3)).toEqual({ first: 300000, rest: 300000 })
    expect(installmentPlan(1000000, 3)).toEqual({ first: 333334, rest: 333333 })
    expect(installmentPlan(99990, 12)).toEqual({ first: 8338, rest: 8332 }) // 99,990 - 8,332×11
  })

  it('오늘 이후 남은 회차 (첫 회차는 산 날 따로, 반복 항목은 다음 달부터 마지막 달까지)', () => {
    const r = rec({ kind: 'installment', day_of_month: 15, start_month: '2026-11-01', end_month: '2027-01-01', installment_months: 4 })
    expect(installmentsLeft(r, '2026-10-15')).toBe(3)
    expect(installmentsLeft(r, '2026-11-15')).toBe(3) // 11월 15일 당일분도 남은 것으로 센다
    expect(installmentsLeft(r, '2026-11-16')).toBe(2)
    expect(installmentsLeft(r, '2027-01-16')).toBe(0)
  })
})

describe('기간 (끝나는 달이 있는 고정지출·구독)', () => {
  it('개월 수로 끝나는 달을 정하고, 끝나는 달에서 개월 수를 되읽는다 (매년은 기간을 쓰지 않는다)', () => {
    expect(endMonthFor('2026-10', 6)).toBe('2027-03-01')
    expect(endMonthFor('2026-10', 1)).toBe('2026-10-01')
    expect(termOf(rec({ start_month: '2026-10-01', end_month: '2027-03-01' }))).toBe(6)
    expect(termOf(rec({ end_month: null }))).toBeNull()
    expect(termOf(rec({ every_months: 12, start_month: '2026-10-01', end_month: '2028-10-01' }))).toBeNull()
  })

  it('남은 회차: 끝나는 달이 없으면 null, 있으면 오늘부터 마지막 달까지, 지나면 0', () => {
    const r = rec({ day_of_month: 25, start_month: '2026-10-01', end_month: '2027-03-01' })
    expect(termLeft(rec({ end_month: null }), '2026-10-20')).toBeNull()
    expect(termLeft(r, '2026-10-20')).toBe(6)
    expect(termLeft(r, '2026-10-26')).toBe(5)
    expect(termLeft(r, '2027-03-26')).toBe(0)
  })
})

describe('고정 탭이 읽는 내역 기간', () => {
  it('지난 5개월부터 다음 달 말까지: 납부 마감일로 미리 넣은 이번 달 관리비도 들어온다', () => {
    expect(historyRange('2026-10-21')).toEqual({ from: '2026-05-01', to: '2026-11-30' })
    expect(historyRange('2026-12-03')).toEqual({ from: '2026-07-01', to: '2027-01-31' })
  })

  it('지난 금액은 날짜가 늦은 것부터, 오늘보다 뒤 날짜로 넣은 것도 포함한다', () => {
    const util = rec({ id: 'u1', kind: 'utility', title: '관리비', amount: null, day_of_month: 26 })
    const past = pastAmounts(util, [
      tx({ recurring_id: 'u1', occurred_on: '2026-09-25', amount: 150000 }),
      tx({ recurring_id: 'u1', occurred_on: '2026-10-26', amount: 167860 }),
      tx({ recurring_id: 'other', occurred_on: '2026-10-27', amount: 1 }),
    ])
    expect(past.map((p) => p.amount)).toEqual([167860, 150000])
  })
})
