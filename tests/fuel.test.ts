import { describe, expect, it } from 'vitest'
import { checkEntries, checkFuel, preferRetry, SYSTEM_PROMPT, type Entry } from '../supabase/functions/extract-entries/extract'

const entry = (p: Partial<Entry>): Entry => ({
  date: '2026-10-18', time: null, merchant: 'GS칼텍스 분당주유소', amount: 58150, is_income: false, is_cancellation: false,
  card_last4: null, payment_hint: null, installment_months: null, category: '차량·주유', items: [], platform: null, fuel: null, ...p,
})

describe('주유 영수증 읽기 (checkFuel)', () => {
  it('리터는 소수 셋째 자리, 단가는 정수로 받고, 유종은 20자까지', () => {
    expect(checkFuel({ liters: 35.2004, price_per_liter: 1652.4, fuel_type: ' 휘발유 ' }, 58150))
      .toEqual({ fuel: { liters: 35.2, price_per_liter: 1652, fuel_type: '휘발유' }, note: null })
  })

  it('말이 안 되는 값은 비우고 계산해 채우지 않으며, 셋 다 없으면 null', () => {
    expect(checkFuel({ liters: 0, price_per_liter: 1652, fuel_type: null }, 58150).fuel).toEqual({ liters: null, price_per_liter: 1652, fuel_type: null })
    expect(checkFuel({ liters: 35.2, price_per_liter: 50, fuel_type: null }, 58150).fuel).toEqual({ liters: 35.2, price_per_liter: null, fuel_type: null })
    expect(checkFuel({ liters: null, price_per_liter: null, fuel_type: null }, 58150)).toEqual({ fuel: null, note: null })
    expect(checkFuel({ liters: null, price_per_liter: null, fuel_type: '  ' }, 58150)).toEqual({ fuel: null, note: null })
    expect(checkFuel(null, 1)).toEqual({ fuel: null, note: null })
  })

  it('단가 × 리터가 결제 금액과 1% 넘게 다르면 알린다', () => {
    expect(checkFuel({ liters: 35.2, price_per_liter: 1652, fuel_type: '휘발유' }, 58150).note).toBeNull() // 58,150.4
    expect(checkFuel({ liters: 30, price_per_liter: 1652, fuel_type: '휘발유' }, 58150).note)
      .toBe('단가 × 주유량이 49,560원이라 결제 금액 58,150원과 8,590원 달라요. 영수증을 확인해 주세요.')
  })

  it('checkEntries가 fuel과 fuel_note를 함께 돌려준다', () => {
    const [e] = checkEntries({ note: null, entries: [entry({ fuel: { liters: 30, price_per_liter: 1652, fuel_type: '휘발유' } })] })
    expect(e.fuel).toEqual({ liters: 30, price_per_liter: 1652, fuel_type: '휘발유' })
    expect(e.fuel_note).toContain('8,590원')
    const [plain] = checkEntries({ note: null, entries: [entry({})] })
    expect(plain.fuel).toBeNull()
    expect('fuel_note' in plain).toBe(false)
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
