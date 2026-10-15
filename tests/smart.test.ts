import { describe, expect, it } from 'vitest'
import { buildUserText, checkEntries, hasItemMismatch, ResultSchema, type Entry } from '../supabase/functions/extract-entries/extract'
import { fitImage, imageTokens, MAX_IMAGE_TOKENS } from '../src/lib/image'
import { matchMethod, toDrafts } from '../src/lib/smart'
import type { Category, PaymentMethod, Transaction } from '../src/lib/types'

const entry = (p: Partial<Entry>): Entry => ({
  date: '2026-10-13', time: '18:42', merchant: '이마트24', amount: 12400, is_income: false, is_cancellation: false,
  card_last4: null, payment_hint: null, category: null, items: [], ...p,
})

describe('모델 출력 정리 (checkEntries)', () => {
  it('품목 합계를 검사하고, 할인 줄(음수)도 합계에 넣는다', () => {
    const [e] = checkEntries({ note: null, entries: [entry({ items: [
      { name: '우유', quantity: 2, unit_price: 2800, amount: 5600 },
      { name: '빵', quantity: 1, unit_price: null, amount: 7800 },
      { name: '행사할인', quantity: 1, unit_price: null, amount: -1000 },
    ] })] })
    expect(e.items_match).toBe(true)
    expect(e.type).toBe('expense')
    const [bad] = checkEntries({ note: null, entries: [entry({ items: [{ name: '우유', quantity: 1, unit_price: null, amount: 5600 }] })] })
    expect(bad.items_match).toBe(false)
    expect(hasItemMismatch([e, bad])).toBe(true)
  })

  it('형식이 틀린 날짜·시간·끝자리는 비우고, 0원은 버린다', () => {
    const out = checkEntries({ note: null, entries: [
      entry({ date: '10/13', time: '6시', card_last4: '12*4', amount: 9900.4, is_income: true }),
      entry({ amount: 0 }),
    ] })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ date: null, time: null, card_last4: null, amount: 9900, type: 'income', items_match: null })
  })

  it('붙여넣은 문자는 구분 태그 안에 넣고, 기준일과 분류 목록을 알려 준다', () => {
    const t = buildUserText({ kind: 'text', today: '2026-10-15', categories: ['식비', '카페'], text: '신한카드 12,400원' })
    expect(t).toContain('기준일(오늘): 2026-10-15')
    expect(t).toContain('분류 목록: 식비, 카페')
    expect(t).toMatch(/<pasted>\n신한카드 12,400원\n<\/pasted>/)
  })

  it('스키마가 모델 응답 JSON을 그대로 받아들인다', () => {
    const parsed = ResultSchema.parse({ note: null, entries: [entry({ card_last4: '1234', category: '장보기' })] })
    expect(parsed.entries[0].card_last4).toBe('1234')
  })
})

const method = (p: Partial<PaymentMethod>): PaymentMethod => ({
  id: 'm', household_id: 'h', name: '카드', kind: 'card', last4: null, owner: 'husband', sort: 1, archived: false, ...p,
})

describe('결제수단·중복 판단', () => {
  const methods = [
    method({ id: 'shinhan', name: '신한 체크', last4: '1234', owner: 'husband' }),
    method({ id: 'hyundai', name: '현대카드', last4: '5678', owner: 'wife' }),
    method({ id: 'kakao', name: '카카오페이', kind: 'easypay', owner: 'shared' }),
  ]

  it('끝 4자리로 먼저 찾고, 없으면 카드사·간편결제 이름으로 찾는다', () => {
    expect(matchMethod({ card_last4: '5678', payment_hint: null }, methods)?.id).toBe('hyundai')
    expect(matchMethod({ card_last4: null, payment_hint: '카카오 페이' }, methods)?.id).toBe('kakao')
    expect(matchMethod({ card_last4: '9999', payment_hint: null }, methods)).toBeNull()
  })

  it('초안: 분류·결제수단을 맞추고, 중복·취소·못 읽은 날짜를 알려 준다', () => {
    const categories: Category[] = [{ id: 'c1', household_id: 'h', type: 'expense', name: '장보기', sort: 1, archived: false }]
    const existing = [{ occurred_on: '2026-10-13', amount: 12400, type: 'expense', title: '이마트24' } as Transaction]
    const entries = checkEntries({ note: null, entries: [
      entry({ card_last4: '1234', category: '장보기' }),
      entry({ date: null, amount: 3000, card_last4: '9999' }),
      entry({ amount: 5000, is_cancellation: true }),
    ] })
    const [dup, noDate, cancel] = toDrafts(entries, {
      today: '2026-10-15', methods, categories, existing, fallbackMethodId: 'kakao', fallbackScope: 'shared',
    })
    expect(dup).toMatchObject({ include: false, category_id: 'c1', payment_method_id: 'shinhan' })
    expect(dup.warnings.join()).toContain('이미 있어요')
    expect(noDate).toMatchObject({ include: true, date: '2026-10-15', payment_method_id: null })
    expect(noDate.warnings.join()).toContain('끝자리 9999')
    expect(cancel).toMatchObject({ include: false, payment_method_id: 'kakao' })
    expect(cancel.warnings.join()).toContain('취소')
  })
})

describe('사진 줄이기', () => {
  it('아이폰 사진(3024×4032)을 이미지 토큰 한도 안으로 줄인다', () => {
    const { w, h } = fitImage(3024, 4032)
    expect(imageTokens(w, h)).toBeLessThanOrEqual(MAX_IMAGE_TOKENS)
    expect(imageTokens(w, h)).toBeGreaterThan(MAX_IMAGE_TOKENS * 0.9)
    expect(Math.abs(w / h - 3024 / 4032)).toBeLessThan(0.01)
  })

  it('긴 영수증 캡처는 긴 변 한도를 지키고, 작은 사진은 키우지 않는다', () => {
    expect(Math.max(...Object.values(fitImage(1170, 9000)))).toBeLessThanOrEqual(2400)
    expect(fitImage(800, 600)).toEqual({ w: 800, h: 600 })
  })
})
