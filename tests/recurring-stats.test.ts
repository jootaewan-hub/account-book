import { describe, expect, it } from 'vitest'
import { dueDate, installmentPlan, installmentsLeft, monthlyAmount, nextDue, pendingInputs, subscriptionCandidates } from '../src/lib/recurring'
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
    expect(platformBreakdown(cur, prev)).toEqual([
      { name: '오늘의집', amount: 89000, count: 1, prev: 0 },
      { name: '쿠팡', amount: 42000, count: 2, prev: 50000 },
      { name: OTHER_PLATFORM, amount: 38000, count: 1, prev: 0 },
    ])
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
