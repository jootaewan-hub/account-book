// "우리가 산 값"(P2) 화면 계산: 줄 문구(날짜·산 사람·곳·개당 가격·단위가격), 묶음 나누기, 가장 싼 값에 들어가지 않음.
import { describe, expect, it } from 'vitest'
import { ourMetaText, ourPriceText, ourUnitText, splitOurs, type OurPurchase } from '../../src/grocery/lib/ours'
import { splitLines, type PriceLine } from '../../src/grocery/lib/products'
import type { Member } from '../../src/grocery/lib/types'

const members: Member[] = [
  { userId: 'h', displayName: '남편', spouseRole: 'husband' },
  { userId: 'w', displayName: '아내', spouseRole: 'wife' },
]
const base: OurPurchase = {
  kind: 'similar', transactionId: 't1', transactionItemId: 'l1', occurredOn: '2026-10-09', platform: '쿠팡', place: '쿠팡',
  createdBy: 'w', name: '비비고 왕교자 1.05kg x2', quantity: 2, unitPrice: 10980, amount: 21960, packSize: 1050, packUnit: 'g',
}

describe('우리가 산 값 줄', () => {
  it('개당 가격은 가계부 unit_price, 없으면 금액 ÷ 수량, 줄이 없는 내역(총액)은 "개당 가격 모름"', () => {
    expect(ourPriceText(base)).toBe('개당 10,980원')
    expect(ourPriceText({ ...base, unitPrice: null })).toBe('개당 10,980원')
    expect(ourPriceText({ ...base, unitPrice: null, quantity: 3, amount: 10000 })).toBe('개당 3,333원')
    expect(ourPriceText({ ...base, transactionItemId: null, unitPrice: null, quantity: null, amount: 23000 })).toBe('총액 23,000원, 개당 가격 모름')
  })

  it('단위가격은 가계부 용량으로(100g·1개당), 용량이 없으면 null', () => {
    expect(ourUnitText(base)).toBe('100g당 1,046원')
    expect(ourUnitText({ ...base, packSize: null, packUnit: null })).toBeNull()
    expect(ourUnitText({ ...base, transactionItemId: null, quantity: null })).toBeNull()
  })

  it('날짜(연도 포함)·산 사람·곳. 플랫폼이 있으면 플랫폼, 없으면 가게 이름(내역 제목). 모르는 사람은 "누군가"', () => {
    expect(ourMetaText(base, members)).toEqual({ day: '2026년 10월 9일', who: members[1], where: '쿠팡' })
    expect(ourMetaText({ ...base, platform: null, place: '이마트 분당점', createdBy: 'x' }, members)).toEqual({ day: '2026년 10월 9일', who: null, where: '이마트 분당점' })
    expect(ourMetaText({ ...base, platform: null, place: '' }, members).where).toBe('어디서 샀는지 모름')
  })

  it('연결된 기록과 "맞아요"는 우리가 산 값, 나머지는 비슷한 기록', () => {
    const rows: OurPurchase[] = [{ ...base, kind: 'linked' }, { ...base, kind: 'confirmed', transactionItemId: 'l2' }, { ...base, transactionItemId: 'l3' }]
    const s = splitOurs(rows)
    expect(s.ours.map((r) => r.kind)).toEqual(['linked', 'confirmed'])
    expect(s.similar.map((r) => r.transactionItemId)).toEqual(['l3'])
  })

  it('우리가 산 값은 과거 값이라 "가장 싼 값"에 들어가지 않는다(오늘 확인한 줄만 고른다)', () => {
    const today = '2026-10-19'
    const lines: PriceLine[] = [
      { price: 10380, seller: '예시몰', source: 'danawa', qty: 1, delivery: 0, checkedAt: '2026-10-19T02:00:00Z', unitPrice: null, unitLabel: null, mallCount: null },
      // 우리가 산 값을 줄 모양으로 넣더라도 어제 확인한 값은 뽑히지 않는다
      { price: 9000, seller: '우리가 산 값', source: 'danawa', qty: 1, delivery: null, checkedAt: '2026-10-09T02:00:00Z', unitPrice: null, unitLabel: null, mallCount: null },
    ]
    expect(splitLines(lines, 1, today).best?.price).toBe(10380)
  })
})
