import { describe, expect, it } from 'vitest'
import { normalizeWish, seedFromSearch } from '../src/lib/wishes'
import type { ExploreItem, ShopItem } from '../src/lib/explore'

const product: ExploreItem = {
  pcode: '123456', name: '커피 머신', imageUrl: null, rating: null, reviewCount: null,
  variants: [{ qty: 2, price: 650000, unitPrice: null, unitLabel: null, mallCount: null }, { qty: 1, price: 350000, unitPrice: null, unitLabel: null, mallCount: null }],
}

describe('물건 보관 입력과 가격 기록', () => {
  it('이름·링크·메모를 정리하고 목표 가격은 검색 가격과 독립적으로 둔다', () => {
    expect(normalizeWish({ title: '  커피 머신  ', url: ' https://shop.example/coffee ', target_price: 280000, memo: '  같이 보기  ' })).toEqual({
      title: '커피 머신', url: 'https://shop.example/coffee', target_price: 280000, memo: '같이 보기',
    })
    expect(normalizeWish({ title: '의자', url: '', target_price: null, memo: '' })).toEqual({ title: '의자', url: null, target_price: null, memo: null })
  })

  it('위험한 주소·비밀번호 있는 주소·잘못된 가격은 저장하지 않는다', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,x', 'https://me:password@shop.example/x']) {
      expect(() => normalizeWish({ title: '물건', url, target_price: null, memo: null })).toThrow(/링크/)
    }
    for (const target_price of [0, -1, 1.5, 10000000000, NaN]) {
      expect(() => normalizeWish({ title: '물건', url: null, target_price, memo: null })).toThrow(/목표 가격/)
    }
  })

  it('다나와 결과에서 화면과 같은 1개 가격·실제 확인 시각·수량 설명을 보관한다', () => {
    const seed = seedFromSearch(product, '다나와', '2026-10-28T10:00:00Z')
    expect(seed).toMatchObject({ title: '커피 머신', url: 'https://prod.danawa.com/info/?pcode=123456', target_price: null,
      quote: { price: 350000, source: '다나와', checkedAt: '2026-10-28T10:00:00Z' } })
    expect(seed.quote?.note).toContain('1개')
    expect(seed.quote?.note).toContain('배송비 확인 필요')
    expect(seedFromSearch({ ...product, variants: [] }, '다나와', '2026-10-28T10:00:00Z').quote).toBeNull()
  })

  it('중고 나눔과 가격 없는 상품에 임의로 가격을 붙이지 않는다', () => {
    const item: ShopItem = { id: 'a', name: '의자 나눔', price: null, listPrice: null, discountRate: null, soldOut: false,
      url: 'https://www.daangn.com/kr/buy-sell/a', reviews: null, rating: null, tags: ['나눔'] }
    expect(seedFromSearch(item, '당근', '2026-10-28T10:00:00Z').quote).toBeNull()
    expect(seedFromSearch({ ...item, price: 12000 }, '당근', '2026-10-28T10:00:00Z').quote?.price).toBe(12000)
  })
})
