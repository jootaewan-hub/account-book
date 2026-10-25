import { describe, expect, it } from 'vitest'
import { itemText } from '../supabase/functions/export-csv/csv'
import { checkEntries, checkPack, type Entry } from '../supabase/functions/extract-entries/extract'
import { normalizePlatform, platformOfTx } from '../src/lib/platform'
import { allocateDiscount, canSplit, draftTitle, markRepeats, productTitle, saveBatches, toDrafts, type Draft } from '../src/lib/smart'
import { perUnitLabel, qtyPriceLabel } from '../src/lib/units'
import { EXPORT_ITEMS } from './fixtures'

const item = (name: string, amount: number, p: Partial<Entry['items'][number]> = {}): Entry['items'][number] => ({
  name, is_product: true, quantity: 1, unit_price: amount, amount, pack_size: null, pack_unit: null, category: null, image_box: null, ...p,
})

describe('용량 정리 (checkPack)', () => {
  it('kg→g, L→ml로 바꾸고 셈 단위는 그대로, 말이 안 되면 버린다', () => {
    expect(checkPack(1.5, 'kg')).toEqual({ pack_size: 1500, pack_unit: 'g' })
    expect(checkPack(2, 'L')).toEqual({ pack_size: 2000, pack_unit: 'ml' })
    expect(checkPack(900, 'mL')).toEqual({ pack_size: 900, pack_unit: 'ml' })
    expect(checkPack(1000, '매')).toEqual({ pack_size: 1000, pack_unit: '매' })
    expect(checkPack(12, 'EA')).toEqual({ pack_size: 12, pack_unit: '개' })
    expect(checkPack(0, 'g')).toEqual({ pack_size: null, pack_unit: null })
    expect(checkPack(3, 'boxes')).toEqual({ pack_size: null, pack_unit: null })
    expect(checkPack(null, 'g')).toEqual({ pack_size: null, pack_unit: null })
  })
})

describe('단위당 가격', () => {
  it('g·ml는 100 단위, 셈 단위는 1개당. 100원 미만은 소수 첫째 자리', () => {
    expect(perUnitLabel({ amount: 19600, quantity: 2, pack_size: 1000, pack_unit: '매' })).toBe('1매당 9.8원')
    expect(perUnitLabel({ amount: 12000, quantity: 10, pack_size: 12000, pack_unit: 'ml' })).toBe('100ml당 10원')
    expect(perUnitLabel({ amount: 32900, quantity: 1, pack_size: 10000, pack_unit: 'g' })).toBe('100g당 329원')
    expect(perUnitLabel({ amount: 7980, quantity: 1, pack_size: 30, pack_unit: '구' })).toBe('1구당 266원')
    expect(perUnitLabel({ amount: 5000, quantity: 1, pack_size: null, pack_unit: null })).toBeNull()
    expect(perUnitLabel({ amount: -1000, quantity: 1, pack_size: 10, pack_unit: '개' })).toBeNull()
  })

  it('수량 × 개당 가격', () => {
    expect(qtyPriceLabel({ quantity: 2, unit_price: 4900 })).toBe('2개 × 4,900원')
    expect(qtyPriceLabel({ quantity: 1, unit_price: 15800 })).toBe('1개 × 15,800원')
    expect(qtyPriceLabel({ quantity: 3, unit_price: null })).toBe('3개')
    expect(qtyPriceLabel({ quantity: 1, unit_price: null })).toBeNull()
  })

  it('앱 CSV의 품목 글자는 구글 시트용 DB 함수와 같다', () => {
    const text = [
      { name: '물티슈 100매 x 10팩', quantity: 2, unit_price: 9800, amount: 19600, pack_size: 1000, pack_unit: '매' },
      { name: '생수 2L x 6병', quantity: 10, unit_price: 1200, amount: 12000, pack_size: 12000, pack_unit: 'ml' },
      { name: '쌀 10kg', quantity: 1, unit_price: 32900, amount: 32900, pack_size: 10000, pack_unit: 'g' },
      { name: '배송비', quantity: 1, unit_price: null, amount: 0, pack_size: null, pack_unit: null },
      { name: '단위만', quantity: 1, unit_price: null, amount: 100, pack_size: null, pack_unit: null },
    ].map(itemText).join(', ')
    expect(text).toBe(EXPORT_ITEMS)
  })
})

describe('플랫폼', () => {
  it('아는 플랫폼은 같은 표기로, 모르는 온라인 몰은 적힌 그대로', () => {
    expect(normalizePlatform('네이버페이')).toBe('네이버')
    expect(normalizePlatform('스마트스토어')).toBe('네이버')
    expect(normalizePlatform('마켓컬리')).toBe('컬리')
    expect(normalizePlatform('  쿠팡 ')).toBe('쿠팡')
    expect(normalizePlatform('하프클럽')).toBe('하프클럽')
    expect(normalizePlatform('  ')).toBeNull()
    expect(platformOfTx({ platform: null, title: '쿠팡' })).toBe('쿠팡') // 예전 내역은 이름으로 짐작
    expect(platformOfTx({ platform: '오늘의집', title: '원목 선반' })).toBe('오늘의집')
    expect(platformOfTx({ platform: null, title: '광동반점' })).toBeNull()
  })
})

describe('내역 이름', () => {
  it('상품 줄 이름으로 만들고 배송비·할인은 빼며, 길면 "외 N건"', () => {
    expect(productTitle([item('물티슈 100매', 9800), item('배송비', 3000, { is_product: false }), item('쿠폰 할인', -1000, { is_product: false })]))
      .toBe('물티슈 100매')
    expect(productTitle([item('물티슈', 9800), item('수세미', 6000)])).toBe('물티슈, 수세미')
    const long = productTitle([item('곰곰 무항생제 신선한 대란, 30구, 1개', 7980), item('코멧 키친타월 150매 x 12롤', 12900),
      item('스카치브라이트 크린스틱 리필 12입', 9900)])
    expect(long).toBe('곰곰 무항생제 신선한 대란, 30구, 1개 외 2건')
    expect(long!.length).toBeLessThanOrEqual(60)
    expect(productTitle([item('배송비', 3000, { is_product: false })])).toBeNull()
  })

  it('온라인 주문은 상품명, 배달앱은 가게 이름, 매장·문자는 가맹점 이름', () => {
    const items = [item('물티슈 100매', 9800)]
    expect(draftTitle({ merchant: '쿠팡', items }, '쿠팡')).toBe('물티슈 100매')
    expect(draftTitle({ merchant: '교촌치킨 분당점', items: [item('허니콤보', 23000)] }, '배달의민족')).toBe('교촌치킨 분당점')
    expect(draftTitle({ merchant: '이마트24', items }, null)).toBe('이마트24')
    expect(draftTitle({ merchant: '쿠팡', items: [] }, '쿠팡')).toBe('쿠팡')
  })

  it('초안: 모델이 읽은 플랫폼을 정리해 따로 두고, 이름은 상품명', () => {
    const entry: Entry = {
      date: '2026-10-12', time: null, merchant: '(주)신세계까사', platform: '오늘의집 앱', amount: 95680, is_income: false, is_cancellation: false,
      card_last4: null, payment_hint: null, installment_months: null, category: null, fuel: null,
      items: [item('까사미아 원목 선반 3단', 65880, { pack_size: 1, pack_unit: '개' }), item('러그 120x180', 29800)],
    }
    const [d] = toDrafts(checkEntries({ note: null, entries: [entry] }), {
      today: '2026-10-15', methods: [], categories: [], existing: [], fallbackMethodId: null, fallbackScope: 'shared',
    }, () => false) // 한 내역으로 합칠 때
    expect(d.platform).toBe('오늘의집')
    expect(d.title).toBe('까사미아 원목 선반 3단, 러그 120x180')
    expect(d.items[0]).toMatchObject({ pack_size: 1, pack_unit: '개', is_product: true })
    // 카드 문자처럼 플랫폼 칸이 비어도 가맹점 이름이 플랫폼이면 채운다
    const [sms] = toDrafts(checkEntries({ note: null, entries: [{ ...entry, platform: null, merchant: '쿠팡(쿠페이)', items: [] }] }), {
      today: '2026-10-15', methods: [], categories: [], existing: [], fallbackMethodId: null, fallbackScope: 'shared',
    })
    expect([sms.platform, sms.title]).toEqual(['쿠팡', '쿠팡(쿠페이)'])
  })
})

describe('상품별로 나누기', () => {
  const ctx = {
    today: '2026-10-15', methods: [], existing: [], fallbackMethodId: null, fallbackScope: 'shared' as const,
    categories: [
      { id: 'food', household_id: 'h', type: 'expense' as const, name: '장보기', sort: 1, archived: false },
      { id: 'life', household_id: 'h', type: 'expense' as const, name: '생활용품', sort: 2, archived: false },
    ],
  }
  const order: Entry = {
    date: '2026-10-15', time: null, merchant: '쿠팡', platform: '쿠팡', amount: 17680, is_income: false, is_cancellation: false,
    card_last4: null, payment_hint: null, installment_months: null, category: '장보기', fuel: null,
    items: [
      item('오뚜기 사과식초 900ml', 2900, { category: '장보기', pack_size: 900, pack_unit: 'ml' }),
      item('샘표 진간장 금F3 1.7L', 7140, { category: '장보기' }),
      item('오뚜기 통후추 리필용', 3100, { category: '장보기' }),
      item('청정원 천일염 굵은소금', 4540, { category: '장보기' }),
      item('배송비', 3000, { is_product: false }),
      item('쿠폰 할인', -3000, { is_product: false }),
    ],
  }

  it('할인은 상품 금액 비율로 나누고 반올림 차이는 가장 비싼 상품에', () => {
    expect(allocateDiscount([2900, 7140, 3100, 4540], -3000)).toEqual([-492, -1212, -526, -770])
    expect(allocateDiscount([1000, 1000, 1000], -100)).toEqual([-34, -33, -33])
    expect(allocateDiscount([5000], 0)).toEqual([0])
  })

  it('상품이 두 개 이상이면 상품마다 내역 하나, 배송비는 따로, 합계는 결제 금액과 같다', () => {
    const [e] = checkEntries({ note: null, entries: [order] })
    expect(e.items_match).toBe(true)
    expect(canSplit(e)).toBe(true)
    const ds = toDrafts([e], ctx, canSplit)
    expect(ds.map((d) => [d.title, d.amount, d.category_id, d.platform])).toEqual([
      ['오뚜기 사과식초 900ml', 2408, 'food', '쿠팡'],
      ['샘표 진간장 금F3 1.7L', 5928, 'food', '쿠팡'],
      ['오뚜기 통후추 리필용', 2574, 'food', '쿠팡'],
      ['청정원 천일염 굵은소금', 3770, 'food', '쿠팡'],
      ['배송비', 3000, 'food', '쿠팡'],
    ])
    expect(ds.reduce((s, d) => s + d.amount, 0)).toBe(17680)
    expect(ds[0].memo).toBe('할인 492원 나눠 뺌 (원래 2,900원)')
    expect(ds[0].items).toHaveLength(1)
    expect(ds[0].items[0]).toMatchObject({ name: '오뚜기 사과식초 900ml', pack_size: 900, pack_unit: 'ml', src: '0:0' })
    expect(ds[4].items).toHaveLength(0)
    expect(new Set(ds.map((d) => d.key)).size).toBe(5)
  })

  it('상품마다 분류를 따로 고르고, 모르면 주문 분류', () => {
    const [e] = checkEntries({ note: null, entries: [{ ...order, items: [
      item('키친타월', 9900, { category: '생활용품' }), item('두부', 1500, { category: null }),
    ], amount: 11400 }] })
    expect(toDrafts([e], ctx, canSplit).map((d) => d.category_id)).toEqual(['life', 'food'])
  })

  it('상품이 하나면 나누지 않는다', () => {
    const [e] = checkEntries({ note: null, entries: [{ ...order, amount: 5900, items: [item('핸드워시 리필', 5900), item('배송비', 0, { is_product: false })] }] })
    expect(canSplit(e)).toBe(false)
    expect(toDrafts([e], ctx).map((d) => [d.title, d.items.length])).toEqual([['핸드워시 리필', 2]])
  })

  it('같은 분석에서 같은 상품이 또 나오면 뒤의 것을 빼 둔다 (목록·상세 화면을 함께 찍은 경우)', () => {
    const bundle = checkEntries({ note: null, entries: [{ ...order, amount: 7640, items: [item('오뚜기 통후추 리필용', 3100), item('청정원 천일염 굵은소금', 4540)] }] })[0]
    const single = checkEntries({ note: null, entries: [{ ...order, amount: 3100, items: [item('오뚜기 통후추 리필용', 3100)] }] })[0]
    const ds = toDrafts([bundle, single], ctx, canSplit)
    expect(ds.map((d) => [d.title, d.include])).toEqual([
      ['오뚜기 통후추 리필용', true], ['청정원 천일염 굵은소금', true], ['오뚜기 통후추 리필용', false],
    ])
    expect(ds[2].warnings.at(-1)).toContain('같은 상품이 위에 이미 있어서')
    const before = [{ date: '2026-10-15', amount: 3100, title: '오뚜기 통후추 리필용', items: [] } as unknown as Draft]
    expect(markRepeats([ds[0]], before)[0].include).toBe(false)
    // 묶음 주문에서 할인이 나눠져 금액이 달라도 원래 상품 금액이 같으면 같은 상품으로 본다
    const [withCoupon] = checkEntries({ note: null, entries: [order] })
    const again = toDrafts([withCoupon, single], ctx, canSplit)
    expect(again.at(-1)).toMatchObject({ title: '오뚜기 통후추 리필용', amount: 3100, include: false })
  })

  it('기본은 주문 하나를 내역 하나로 넣는다 (D-027). 품목은 그 내역의 품목 줄로', () => {
    const [e] = checkEntries({ note: null, entries: [order] })
    const ds = toDrafts([e], ctx)
    expect(ds).toHaveLength(1)
    expect(ds[0]).toMatchObject({ key: '0', amount: 17680, include: true, memo: null })
    expect(ds[0].items.map((it) => it.name)).toEqual(order.items.map((it) => it.name))
  })

  it('한 묶음이 기본이어도 같은 상품을 두 번 넣지 않는다: 하나짜리 주문이 묶음 안에 있으면 하나짜리를 뺀다 (어느 쪽이 먼저여도)', () => {
    const bundle = checkEntries({ note: null, entries: [{ ...order, amount: 7640, items: [item('오뚜기 통후추 리필용', 3100), item('청정원 천일염 굵은소금', 4540)] }] })[0]
    const single = checkEntries({ note: null, entries: [{ ...order, amount: 3100, items: [item('오뚜기 통후추 리필용', 3100)] }] })[0]
    const after = toDrafts([bundle, single], ctx)
    expect(after.map((d) => [d.amount, d.include])).toEqual([[7640, true], [3100, false]])
    expect(after[1].warnings.at(-1)).toContain('다른 묶음 주문에 들어 있어서')
    const before = toDrafts([single, bundle], ctx)
    expect(before.map((d) => [d.amount, d.include])).toEqual([[3100, false], [7640, true]])
    expect(before[0].warnings.at(-1)).toContain('다른 묶음 주문에 들어 있어서')
    // 묶음에 할인이 있어도 상품 줄은 원래 금액이라 같은 상품으로 본다
    const [withCoupon] = checkEntries({ note: null, entries: [order] })
    expect(toDrafts([withCoupon, single], ctx).map((d) => d.include)).toEqual([true, false])
    // 날짜가 다르면 따로 산 것
    const later = { ...single, date: '2026-10-16' }
    expect(toDrafts([bundle, later], ctx).map((d) => d.include)).toEqual([true, true])
  })

  it('나누기를 다시 고를 때 위에서 이미 뺀 초안과는 견주지 않는다', () => {
    const single = checkEntries({ note: null, entries: [{ ...order, amount: 3100, items: [item('오뚜기 통후추 리필용', 3100)] }] })[0]
    const bundle = checkEntries({ note: null, entries: [{ ...order, amount: 7640, items: [item('오뚜기 통후추 리필용', 3100), item('청정원 천일염 굵은소금', 4540)] }] })[0]
    const [first] = toDrafts([single, bundle], ctx) // 묶음 안에 있어서 빠진 하나짜리
    expect(first.include).toBe(false)
    // 묶음을 상품마다 나누면 통후추 초안은 다시 넣을 대상이 된다(둘 다 빠지지 않게)
    const split = toDrafts([bundle], ctx, canSplit)
    expect(markRepeats(split, [first]).map((d) => d.include)).toEqual([true, true])
  })

  it('나눠 저장하는 주문의 초안끼리 같은 묶음 번호, 한 건짜리 주문은 없음', () => {
    let n = 0
    const batches = saveBatches([{ key: '0' }, { key: '1-0' }, { key: '1-1' }, { key: '1-x0' }, { key: '2-0' }, { key: '3-0' }, { key: '3-1' }], () => `b${++n}`)
    expect(Object.fromEntries(batches)).toEqual({ '1-0': 'b1', '1-1': 'b1', '1-x0': 'b1', '3-0': 'b2', '3-1': 'b2' })
  })
})
