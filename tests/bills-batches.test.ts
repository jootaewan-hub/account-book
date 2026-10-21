import { describe, expect, it } from 'vitest'
import { checkBill, type Bill } from '../supabase/functions/extract-entries/extract'
import { billRecurring, billTrend, compareBill, formatUsage, utilityItemForBill } from '../src/lib/bills'
import { mergeBatches, type AnalyzeResult } from '../src/lib/smart'
import type { Recurring, UtilityBill } from '../src/lib/types'

const bill = (month: string, total: number, p: Partial<UtilityBill> = {}): UtilityBill => ({
  id: month, household_id: 'h', bill_month: `${month}-01`, total, due_date: null, charges: [], usages: [], transaction_id: null, ...p,
})

describe('관리비 고지서 정리 (checkBill)', () => {
  const raw: Bill = {
    is_bill: true, bill_month: '2026-09', due_date: '2026-10-25', total: 254000, note: null,
    charges: [
      { name: ' 일반관리비 ', amount: 54000.4, prev_month: 53000, last_year: null },
      { name: '세대전기료', amount: 61000, prev_month: null, last_year: null },
      { name: '난방비', amount: 139000, prev_month: null, last_year: null },
      { name: '', amount: 1, prev_month: null, last_year: null },
    ],
    usages: [
      { name: '세대 전기', amount: 312, unit: 'kwh', prev_month: 280, last_year: 350 },
      { name: '급탕', amount: 4.123456, unit: '㎥', prev_month: null, last_year: null },
      { name: '난방 사용량', amount: 0.62, unit: 'gcal', prev_month: null, last_year: null },
      { name: '상수도', amount: 12, unit: 'm3', prev_month: null, last_year: null },
    ],
  }

  it('항목·사용량 이름과 단위를 맞추고 항목 합계를 검사한다', () => {
    const b = checkBill(raw)
    expect(b.charges.map((c) => [c.name, c.amount])).toEqual([['일반관리비', 54000], ['세대전기료', 61000], ['난방비', 139000]])
    expect(b.usages.map((u) => [u.name, u.amount, u.unit])).toEqual([
      ['전기', 312, 'kWh'], ['온수', 4.123, 'm³'], ['난방', 0.62, 'Gcal'], ['수도', 12, 'm³'],
    ])
    expect(b.sum_match).toBe(true)
    expect(checkBill({ ...raw, total: 250000 }).sum_match).toBe(false)
  })

  it('형식이 틀린 달·날짜는 비우고, 합계가 없으면 항목 합으로', () => {
    const b = checkBill({ ...raw, bill_month: '9월', due_date: '10/25', total: null })
    expect([b.bill_month, b.due_date, b.total]).toEqual([null, null, 254000])
  })
})

describe('관리비 비교', () => {
  const cur = bill('2026-09', 254000, {
    usages: [{ name: '전기', amount: 312, unit: 'kWh', prev_month: 280, last_year: 350 }, { name: '수도', amount: 12, unit: 'm³', prev_month: 10, last_year: null }],
    charges: [{ name: '일반관리비', amount: 54000, prev_month: 53000, last_year: null }, { name: '난방비', amount: 139000, prev_month: null, last_year: null }],
  })
  const aug = bill('2026-08', 240000, { usages: [{ name: '전기', amount: 300, unit: 'kWh', prev_month: null, last_year: null }] })
  const lastSep = bill('2025-09', 260000, { charges: [{ name: '난방 비', amount: 120000, prev_month: null, last_year: null }] })

  it('저장된 전월·전년 고지서를 먼저 쓰고, 없으면 고지서에 적힌 값', () => {
    const c = compareBill(cur, [aug, lastSep])
    expect(c.total).toMatchObject({ cur: 254000, prev: 240000, prevFrom: 'saved', prevPct: 5.8, lastYear: 260000, lastYearPct: -2.3 })
    expect(c.usages[0]).toMatchObject({ name: '전기', prev: 300, prevFrom: 'saved', lastYear: 350, lastYearFrom: 'printed', lastYearPct: -10.9 })
    expect(c.usages[1]).toMatchObject({ name: '수도', prev: 10, prevFrom: 'printed', lastYear: null, lastYearFrom: null })
    // 금액 큰 항목부터, 이름의 띄어쓰기는 무시하고 맞춘다
    expect(c.charges.map((r) => [r.name, r.lastYear, r.prev])).toEqual([['난방비', 120000, null], ['일반관리비', null, 53000]])
  })

  it('최근 12개월 추이는 없는 달을 비운다', () => {
    const t = billTrend([cur, aug], '2026-09')
    expect(t).toHaveLength(12)
    expect(t.at(-1)).toEqual({ ym: '2026-09', total: 254000 })
    expect(t.at(-2)).toEqual({ ym: '2026-08', total: 240000 })
    expect(t[0]).toEqual({ ym: '2025-10', total: null })
  })

  it('관리비 지출을 연결할 반복 항목과 사용량 표기', () => {
    const r = (p: Partial<Recurring>): Recurring => ({
      id: 'r', household_id: 'h', kind: 'utility', type: 'expense', title: '도시가스', amount: null, day_of_month: 25, every_months: 1,
      category_id: null, payment_method_id: null, scope: 'shared', start_month: '2026-01-01', end_month: null, active: true, memo: null, installment_months: null, ...p,
    })
    expect(billRecurring([r({ id: 'gas' }), r({ id: 'apt', title: '아파트 관리비' })])?.id).toBe('apt')
    expect(billRecurring([r({ id: 'only' })])?.id).toBe('only')
    expect(billRecurring([r({ id: 'a' }), r({ id: 'b', title: '인터넷' })])).toBeNull()
    expect(billRecurring([r({ id: 'fixed', title: '관리비', amount: 200000 })])).toBeNull()
    expect([formatUsage(1234), formatUsage(0.6234)]).toEqual(['1,234', '0.623'])
  })
})

describe('사진 묶음 합치기', () => {
  const result = (merchant: string, image: number): AnalyzeResult => ({
    note: null, model: 'claude-sonnet-5-5',
    entries: [{
      date: '2026-10-15', time: null, merchant, platform: merchant, amount: 1000, is_income: false, is_cancellation: false, card_last4: null,
      payment_hint: null, installment_months: null, category: null, type: 'expense', items_match: true, fuel: null,
      items: [{ name: 'x', is_product: true, quantity: 1, unit_price: 1000, amount: 1000, pack_size: null, pack_unit: null, category: null,
        image_box: { image, left: 0, top: 0, right: 50, bottom: 50 } }],
    }],
  })

  it('두 번째 묶음의 사진 번호를 전체 기준으로 바꾸고, 실패한 묶음은 사진 번호로 알린다', () => {
    const m = mergeBatches([result('쿠팡', 2), result('컬리', 1), new Error('잠시 후 다시 시도해 주세요.')], [5, 5, 2])
    expect(m.entries.map((e) => [e.platform, e.items[0].image_box?.image])).toEqual([['쿠팡', 2], ['컬리', 6]])
    expect(m.failed).toEqual([{ from: 11, to: 12, message: '잠시 후 다시 시도해 주세요.' }])
    expect(m.model).toBe('claude-sonnet-5-5')
  })
})

describe('관리비 항목이 없을 때 고지서로 만드는 반복 항목', () => {
  it('지출 날짜의 날과 달로 매달 금액을 넣는 관리비·공과금 항목을 만들고, 다음 고지서가 그 항목을 찾는다', () => {
    const item = utilityItemForBill({ occurred_on: '2026-10-26', category_id: 'cat-util', scope: 'shared' })
    expect(item).toEqual({
      kind: 'utility', type: 'expense', title: '관리비', amount: null, day_of_month: 26, every_months: 1,
      category_id: 'cat-util', payment_method_id: null, scope: 'shared', start_month: '2026-10-01', end_month: null,
      active: true, memo: null, installment_months: null,
    })
    expect(billRecurring([{ ...item, id: 'new', household_id: 'h' }])?.id).toBe('new')
  })
})
