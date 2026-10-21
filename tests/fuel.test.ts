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

import { entryDrafts, fuelComplete } from '../src/lib/smart'
import { fillLine, fuelDelta, fuelInterval, fuelKind, fuelMonth, fuelText, fuelTrend, litersText, sortFills } from '../src/lib/fuel'
import type { FuelFill } from '../src/lib/types'

const cats = [
  { id: 'car', household_id: 'h', type: 'expense' as const, name: '차량·주유', sort: 1, archived: false },
  { id: 'etc', household_id: 'h', type: 'expense' as const, name: '기타', sort: 2, archived: false },
]
const ctx = { today: '2026-10-21', methods: [], categories: cats, existing: [], fallbackMethodId: null, fallbackScope: 'shared' as const }

describe('주유 초안', () => {
  it('fuel이 있으면 초안에 싣고 분류는 차량·주유, 단가 경고는 초안 경고로', () => {
    const [e] = checkEntries({ note: null, entries: [entry({ category: '기타', fuel: { liters: 30, price_per_liter: 1652, fuel_type: '휘발유' } })] })
    const [d] = entryDrafts(e, 0, ctx, true)
    expect(d.fuel).toEqual({ liters: 30, price_per_liter: 1652, fuel_type: '휘발유' })
    expect(d.category_id).toBe('car')
    expect(d.warnings.some((w) => w.includes('8,590원'))).toBe(true)
  })

  it('주유가 아니면 fuel은 null이고 분류는 그대로', () => {
    const [e] = checkEntries({ note: null, entries: [entry({ merchant: '이마트', category: '기타' })] })
    const [d] = entryDrafts(e, 0, ctx, true)
    expect(d.fuel).toBeNull()
    expect(d.category_id).toBe('etc')
  })

  it('리터와 단가가 다 있어야 저장할 수 있다', () => {
    expect(fuelComplete({ liters: 35.2, price_per_liter: 1652, fuel_type: null })).toBe(true)
    expect(fuelComplete({ liters: 35.2, price_per_liter: null, fuel_type: '휘발유' })).toBe(false)
    expect(fuelComplete({ liters: 0, price_per_liter: 1652, fuel_type: null })).toBe(false)
    expect(fuelComplete(null)).toBe(false)
  })
})

let seq = 0
const fill = (occurred_on: string, ppl: number, liters: number, fuel_type: string | null = '휘발유'): FuelFill => ({
  id: `f${++seq}`, transaction_id: `t${seq}`, liters, price_per_liter: ppl, fuel_type, occurred_on, amount: Math.round(ppl * liters), title: 'GS칼텍스 분당주유소',
})

describe('주유 계산', () => {
  const fills = [fill('2026-10-18', 1652, 35.2), fill('2026-10-02', 1629, 30), fill('2026-09-20', 1615, 40, '경유'), fill('2026-09-05', 1640, 28.5)]

  it('유종은 견줄 때만 정규화한다', () => {
    expect(fuelKind('고급 휘발유')).toBe('고급휘발유')
    expect(fuelKind('휘발유(보통)')).toBe('휘발유')
    expect(fuelKind('가솔린')).toBe('휘발유')
    expect(fuelKind('경유')).toBe('경유')
    expect(fuelKind('디젤')).toBe('경유')
    expect(fuelKind('lpg')).toBe('LPG')
    expect(fuelKind(' 등유 ')).toBe('등유')
    expect(fuelKind(null)).toBeNull()
  })

  it('지난번 대비는 같은 유종끼리', () => {
    expect(sortFills([fills[3], fills[0], fills[1]]).map((f) => f.occurred_on)).toEqual(['2026-10-18', '2026-10-02', '2026-09-05'])
    expect(fuelDelta(fills)).toMatchObject({ latest: { occurred_on: '2026-10-18' }, prev: { occurred_on: '2026-10-02' }, diff: 23, pct: 1.4 })
    expect(fuelDelta([fill('2026-10-18', 1652, 35.2), fill('2026-09-20', 1615, 40, '경유')])).toMatchObject({ prev: null, diff: null, pct: null })
    expect(fuelDelta([fill('2026-10-18', 1652, 35.2, null), fill('2026-09-20', 1615, 40, null)])?.prev?.occurred_on).toBe('2026-09-20')
    expect(fuelDelta([])).toBeNull()
  })

  it('달별 횟수·리터·금액과 평균 간격', () => {
    expect(fuelMonth(fills, '2026-10')).toEqual({ ym: '2026-10', count: 2, liters: 65.2, amount: 58150 + 48870 })
    expect(fuelMonth(fills, '2026-08')).toEqual({ ym: '2026-08', count: 0, liters: 0, amount: 0 })
    expect(fuelInterval(fills)).toBe(14) // (16 + 12 + 15) / 3 = 14.33
    expect(fuelInterval(fills, 2)).toBe(16)
    expect(fuelInterval([fills[0]])).toBeNull()
  })

  it('추이는 최근 n번을 오래된 것부터, 글자는 단위와 함께', () => {
    expect(fuelTrend(fills, 2).map((f) => f.occurred_on)).toEqual(['2026-10-02', '2026-10-18'])
    expect(litersText(35.2)).toBe('35.2L')
    expect(litersText(30)).toBe('30L')
    expect(litersText(28.456)).toBe('28.46L')
    expect(fillLine(fills[0])).toBe('10월 18일, 휘발유 35.2L, 1,652원/L, 58,150원')
    expect(fillLine(fill('2026-10-18', 1652, 35.2, null))).toBe('10월 18일, 35.2L, 1,652원/L, 58,150원')
    expect(fuelText({ liters: 35.2, price_per_liter: 1652, fuel_type: '휘발유' })).toBe('휘발유 35.2L, 1,652원/L')
    expect(fuelText({ liters: 35.2, price_per_liter: 1652, fuel_type: null })).toBe('35.2L, 1,652원/L')
  })
})

import { parseLiters, parsePricePerLiter } from '../src/lib/smart'

describe('주유 칸 글자 → 값 (치는 동안 글자는 남고 값만 검사한다)', () => {
  it('리터당 단가는 100 초과 정수만, 치는 중인 "1"·"16"은 null', () => {
    expect(parsePricePerLiter('1')).toBeNull()
    expect(parsePricePerLiter('16')).toBeNull()
    expect(parsePricePerLiter('1652')).toBe(1652)
    expect(parsePricePerLiter('1,652')).toBe(1652)
    expect(parsePricePerLiter('')).toBeNull()
  })
  it('주유량은 0 초과 500 미만, 소수 셋째 자리까지', () => {
    expect(parseLiters('35.')).toBe(35)
    expect(parseLiters('35.2004')).toBe(35.2)
    expect(parseLiters('0')).toBeNull()
    expect(parseLiters('')).toBeNull()
    expect(parseLiters('600')).toBeNull()
  })
  it('문자 입력(withFuel=false)에서는 주유 값을 버린다', () => {
    const [e] = checkEntries({ note: null, entries: [entry({ fuel: { liters: 30, price_per_liter: 1652, fuel_type: '휘발유' } })] }, [], false)
    expect(e.fuel).toBeNull()
    expect('fuel_note' in e).toBe(false)
  })
})
