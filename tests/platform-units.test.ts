import { describe, expect, it } from 'vitest'
import { itemText } from '../supabase/functions/export-csv/csv'
import { checkEntries, checkPack, type Entry } from '../supabase/functions/extract-entries/extract'
import { normalizePlatform, platformOfTx } from '../src/lib/platform'
import { draftTitle, productTitle, toDrafts } from '../src/lib/smart'
import { perUnitLabel, qtyPriceLabel } from '../src/lib/units'
import { EXPORT_ITEMS } from './fixtures'

const item = (name: string, amount: number, p: Partial<Entry['items'][number]> = {}): Entry['items'][number] => ({
  name, is_product: true, quantity: 1, unit_price: amount, amount, pack_size: null, pack_unit: null, image_box: null, ...p,
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
      card_last4: null, payment_hint: null, category: null,
      items: [item('까사미아 원목 선반 3단', 65880, { pack_size: 1, pack_unit: '개' }), item('러그 120x180', 29800)],
    }
    const [d] = toDrafts(checkEntries({ note: null, entries: [entry] }), {
      today: '2026-10-15', methods: [], categories: [], existing: [], fallbackMethodId: null, fallbackScope: 'shared',
    })
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
