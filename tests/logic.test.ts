import { describe, expect, it } from 'vitest'
import { addMonths, dowOf, formatDateLong, monthGrid, monthRange, todayLocal } from '../src/lib/dates'
import { compact, formatInviteCode, parseAmount, won } from '../src/lib/format'
import { dailyTotals, samePeriodDiff, sumType } from '../src/lib/ledger'
import type { Transaction } from '../src/lib/types'

const A = 'user-a' // 남편
let seq = 0
const tx = (p: Partial<Transaction>): Transaction => ({
  id: String(++seq), household_id: 'h', type: 'expense', occurred_on: '2026-10-15', amount: 1000, title: '',
  memo: null, category_id: null, payment_method_id: null, scope: 'shared', source: 'manual',
  created_by: A, created_at: '', recurring_id: null, platform: null, ...p,
})

describe('날짜', () => {
  it('2026년 10월 달력은 목요일에 시작하고 5주다', () => {
    const g = monthGrid('2026-10')
    expect(g.slice(0, 5)).toEqual([null, null, null, null, '2026-10-01'])
    expect(g.length).toBe(35)
    expect(g.filter(Boolean)).toHaveLength(31)
  })
  it('월 이동과 범위', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12')
    expect(addMonths('2026-12', 1)).toBe('2027-01')
    expect(monthRange('2026-02')).toEqual({ start: '2026-02-01', end: '2026-02-28' })
  })
  it('요일과 표기', () => {
    expect(dowOf('2026-10-03')).toBe(6)
    expect(formatDateLong('2026-10-15')).toBe('10월 15일 목요일')
    expect(todayLocal(new Date(2026, 9, 5))).toBe('2026-10-05')
  })
})

describe('숫자 표기', () => {
  it('원 단위와 달력용 축약', () => {
    expect(won(1234567)).toBe('1,234,567')
    expect(compact(168000)).toBe('168,000')
    expect(compact(3200000)).toBe('320만')
    expect(parseAmount('12,000원')).toBe(12000)
    expect(formatInviteCode('ABCD2345')).toBe('ABCD-2345')
  })
})

describe('합계', () => {
  it('기간 합계와 일별 합계', () => {
    const list = [
      tx({ amount: 5000, occurred_on: '2026-10-01' }),
      tx({ amount: 7000, occurred_on: '2026-10-20' }),
      tx({ amount: 9000, occurred_on: '2026-10-01', type: 'income' }),
    ]
    expect(sumType(list, 'expense')).toBe(12000)
    expect(sumType(list, 'expense', 15)).toBe(5000)
    expect(dailyTotals(list).get('2026-10-01')).toEqual({ expense: 5000, income: 9000 })
    expect(samePeriodDiff(list, [tx({ amount: 2000, occurred_on: '2026-09-03' })], 15)).toBe(3000)
  })
})
