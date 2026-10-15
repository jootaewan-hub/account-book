import { describe, expect, it } from 'vitest'
import { buildUserText, checkBox, checkEntries, hasItemMismatch, ResultSchema, type Entry } from '../supabase/functions/extract-entries/extract'
import { fitImage, imageTokens, MAX_IMAGE_TOKENS, squareBox } from '../src/lib/image'
import { issuerOf, last4Matches, matchMethod, matchMethodDetailed, modelLabel, toDrafts } from '../src/lib/smart'
import type { Category, PaymentMethod, Transaction } from '../src/lib/types'

const entry = (p: Partial<Entry>): Entry => ({
  date: '2026-10-13', time: '18:42', merchant: '이마트24', amount: 12400, is_income: false, is_cancellation: false,
  card_last4: null, payment_hint: null, category: null, items: [], platform: null, ...p,
})

describe('모델 출력 정리 (checkEntries)', () => {
  it('품목 합계를 검사하고, 할인 줄(음수)도 합계에 넣는다', () => {
    const [e] = checkEntries({ note: null, entries: [entry({ items: [
      { name: '우유', is_product: true, pack_size: null, pack_unit: null, quantity: 2, unit_price: 2800, amount: 5600, image_box: null },
      { name: '빵', is_product: true, pack_size: null, pack_unit: null, quantity: 1, unit_price: null, amount: 7800, image_box: null },
      { name: '행사할인', is_product: true, pack_size: null, pack_unit: null, quantity: 1, unit_price: null, amount: -1000, image_box: null },
    ] })] })
    expect(e.items_match).toBe(true)
    expect(e.type).toBe('expense')
    const [bad] = checkEntries({ note: null, entries: [entry({ items: [{ name: '우유', is_product: true, pack_size: null, pack_unit: null, quantity: 1, unit_price: null, amount: 5600, image_box: null }] })] })
    expect(bad.items_match).toBe(false)
    expect(hasItemMismatch([e, bad])).toBe(true)
  })

  it('형식이 틀린 날짜·시간·끝자리는 비우고, 0원은 버린다', () => {
    const out = checkEntries({ note: null, entries: [
      entry({ date: '10/13', time: '6시', card_last4: '***4', amount: 9900.4, is_income: true }),
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

describe('쇼핑 캡처의 상품 사진 영역', () => {
  const sizes = [{ width: 1107, height: 2400 }, { width: 1107, height: 2400 }]

  it('이미지 안으로 맞추고, 번호가 없거나 너무 작거나 화면 절반보다 크면 버린다', () => {
    expect(checkBox({ image: 2, left: 40, top: 300, right: 260, bottom: 520 }, sizes)).toEqual({ image: 2, left: 40, top: 300, right: 260, bottom: 520 })
    expect(checkBox({ image: 1, left: 260, top: 520, right: -10, bottom: 300 }, sizes)).toEqual({ image: 1, left: 0, top: 300, right: 260, bottom: 520 })
    expect(checkBox({ image: 3, left: 0, top: 0, right: 100, bottom: 100 }, sizes)).toBeNull()
    expect(checkBox({ image: 1, left: 0, top: 0, right: 10, bottom: 10 }, sizes)).toBeNull()
    expect(checkBox({ image: 1, left: 0, top: 0, right: 1107, bottom: 2000 }, sizes)).toBeNull()
    expect(checkBox(null, sizes)).toBeNull()
  })

  it('품목의 사진 영역은 모델 출력 정리 때 함께 검사된다', () => {
    const [e] = checkEntries({ note: null, entries: [entry({ merchant: '쿠팡', amount: 9800, items: [
      { name: '물티슈', is_product: true, pack_size: null, pack_unit: null, quantity: 2, unit_price: 4900, amount: 9800, image_box: { image: 1, left: 30, top: 400, right: 250, bottom: 620 } },
    ] })] }, sizes)
    expect(e.items[0].image_box).toEqual({ image: 1, left: 30, top: 400, right: 250, bottom: 620 })
    expect(checkEntries({ note: null, entries: [entry({ items: [
      { name: 'x', is_product: true, pack_size: null, pack_unit: null, quantity: 1, unit_price: null, amount: 12400, image_box: { image: 1, left: 30, top: 400, right: 250, bottom: 620 } },
    ] })] })[0].items[0].image_box).toBeNull() // 이미지 크기를 모르면(문자 입력) 버린다
  })

  it('잘라 낼 영역을 정사각형으로 넓히되 이미지 밖으로 나가지 않는다', () => {
    const sq = squareBox({ left: 0, top: 100, right: 200, bottom: 160 }, 1107, 2400)
    expect(sq.right - sq.left).toBe(sq.bottom - sq.top)
    expect(sq.left).toBe(0)
    expect(sq.right - sq.left).toBe(216)
    const edge = squareBox({ left: 1000, top: 2300, right: 1107, bottom: 2400 }, 1107, 2400)
    expect(edge.right).toBeLessThanOrEqual(1107)
    expect(edge.bottom).toBeLessThanOrEqual(2400)
  })

  it('쇼핑 캡처 요청에는 이미지 크기와 사진 위치 안내가 들어간다', () => {
    const t = buildUserText({ kind: 'image', today: '2026-10-15', categories: ['생활용품'], images: sizes, shop: true })
    expect(t).toContain('이미지 1 크기: 1107×2400 픽셀')
    expect(t).toContain('image_box')
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

  it('카드가 여러 장이어도: 가려진 끝자리, 카드사, 체크/신용으로 좁히고 애매하면 고르지 않는다', () => {
    const cards = [
      method({ id: 'sh-check', name: '신한 체크', last4: '1234' }),
      method({ id: 'sh-credit', name: '신한 신용', last4: '5678', owner: 'wife' }),
      method({ id: 'kb', name: 'KB국민카드', last4: '1294' }),
      method({ id: 'kbank', name: '케이뱅크 체크', last4: null }),
    ]
    expect(issuerOf('KB국민카드')).toBe('국민')
    expect(issuerOf('케이뱅크')).toBe('케이뱅크')
    expect(last4Matches('1*3*', '1234')).toBe(true)
    expect(last4Matches('1*3*', '1294')).toBe(false)
    // 1*?4는 신한 1234와 국민 1294 둘 다 맞지만 카드사가 신한이면 하나로 좁혀진다
    expect(matchMethod({ card_last4: '12*4', payment_hint: '신한카드' }, cards)?.id).toBe('sh-check')
    expect(matchMethodDetailed({ card_last4: '12*4', payment_hint: null }, cards)).toMatchObject({ method: null, reason: 'ambiguous' })
    // 끝자리 없이 카드사만: 신한이 두 장이면 체크/신용 글자로 고른다
    expect(matchMethod({ card_last4: null, payment_hint: '신한체크' }, cards)?.id).toBe('sh-check')
    expect(matchMethodDetailed({ card_last4: null, payment_hint: '신한카드' }, cards)).toMatchObject({ method: null, reason: 'ambiguous', issuer: '신한' })
    // 끝자리가 등록 안 된 다른 카드면 같은 카드사 한 장이라도 고르지 않는다
    expect(matchMethodDetailed({ card_last4: '9999', payment_hint: 'KB국민' }, cards)).toMatchObject({ method: null, reason: 'unknown_last4' })
    expect(matchMethod({ card_last4: null, payment_hint: 'kbank' }, cards)?.id).toBe('kbank')
  })

  it('초안: 이 가맹점에서 지난번에 고른 카드를 먼저 쓴다', () => {
    const [d] = toDrafts(checkEntries({ note: null, entries: [entry({ merchant: '쿠팡' })] }), {
      today: '2026-10-15', methods, categories: [], existing: [], fallbackMethodId: 'kakao', fallbackScope: 'shared',
      rememberedMethod: (m) => (m === '쿠팡' ? 'hyundai' : null),
    })
    expect(d.payment_method_id).toBe('hyundai')
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

describe('모델 이름 표시', () => {
  it('모델 id를 읽기 쉬운 이름으로', () => {
    expect(modelLabel('claude-haiku-5-5')).toBe('Claude Haiku 5.5')
    expect(modelLabel('claude-sonnet-5-5-20261001')).toBe('Claude Sonnet 5.5')
    expect(modelLabel('claude-opus-5')).toBe('Claude Opus 5')
    expect(modelLabel('something-else')).toBe('something-else')
    expect(modelLabel(undefined)).toBeNull()
  })
})
