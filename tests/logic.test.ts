import { describe, expect, it } from 'vitest'
import { addMonths, dowOf, formatDateLong, monthGrid, monthRange, todayLocal } from '../src/lib/dates'
import { compact, formatInviteCode, parseAmount, won } from '../src/lib/format'
import { dailyTotals, payerOf, samePeriodDiff, settle, sumType } from '../src/lib/ledger'
import type { PaymentMethod, Transaction } from '../src/lib/types'

const A = 'user-a' // 남편
const B = 'user-b' // 아내
const roleOf = (id: string) => (id === A ? 'husband' : id === B ? 'wife' : null) as 'husband' | 'wife' | null
const method = (id: string, owner: PaymentMethod['owner']): PaymentMethod => ({
  id, household_id: 'h', name: id, kind: 'card', last4: null, owner, sort: 0, archived: false,
})
const methods = new Map([
  ['card-h', method('card-h', 'husband')],
  ['card-w', method('card-w', 'wife')],
  ['acct', method('acct', 'shared')],
  ['cash', method('cash', 'entered_by')],
])
let seq = 0
const tx = (p: Partial<Transaction>): Transaction => ({
  id: String(++seq), household_id: 'h', type: 'expense', occurred_on: '2026-10-15', amount: 1000, title: '',
  memo: null, category_id: null, payment_method_id: null, scope: 'shared', source: 'manual',
  created_by: A, created_at: '', ...p,
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

describe('합계와 정산', () => {
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

  it('누가 냈는지는 결제수단 주인으로 정해진다', () => {
    expect(payerOf(tx({ payment_method_id: 'card-w', created_by: A }), methods, roleOf)).toBe('wife')
    expect(payerOf(tx({ payment_method_id: 'acct' }), methods, roleOf)).toBe('shared')
    expect(payerOf(tx({ payment_method_id: 'cash', created_by: B }), methods, roleOf)).toBe('wife')
    expect(payerOf(tx({ payment_method_id: null, created_by: A }), methods, roleOf)).toBe('husband')
  })

  it('공동 지출 중 개인 수단으로 낸 돈만 비율대로 정산한다', () => {
    const list = [
      tx({ amount: 180100, payment_method_id: 'card-h' }),
      tx({ amount: 140400, payment_method_id: 'card-w' }),
      tx({ amount: 500000, payment_method_id: 'acct' }), // 공동 계좌: 제외
      tx({ amount: 30000, payment_method_id: 'card-h', scope: 'husband' }), // 개인 지출: 제외
      tx({ amount: 9999, payment_method_id: 'card-w', type: 'income' }), // 수입: 제외
    ]
    const s = settle(list, methods, roleOf, 0.5)
    expect(s.paid).toEqual({ husband: 180100, wife: 140400 })
    expect(s).toMatchObject({ from: 'wife', to: 'husband', amount: 19850 })
    expect(settle(list, methods, roleOf, 0.7)).toMatchObject({ from: 'husband', to: 'wife', amount: 44250 })
  })

  it('역할을 모르는 사람의 현금 지출은 정산에서 빠진다', () => {
    const s = settle([tx({ payment_method_id: 'cash', created_by: 'stranger' })], methods, roleOf, 0.5)
    expect(s.amount).toBe(0)
  })
})
