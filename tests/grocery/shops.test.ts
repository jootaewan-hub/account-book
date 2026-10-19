// 몰 상품 페이지(컬리·홈플러스·로우차트) 주소 정리와 JSON-LD 읽기. 사본은 2026-10-19에 받은 실제 페이지(후기 본문은 지움).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseShopProduct, parseShopUrl, SHOP_LABEL, ShopParseError } from '../../supabase/functions/_shared/shops'

const read = (f: string) => readFileSync(new URL(`./fixtures/shops/${f}`, import.meta.url), 'utf8')

describe('주소 정리', () => {
  it('컬리 goods 주소는 번호만 남기고 www.kurly.com으로', () => {
    expect(parseShopUrl('https://www.kurly.com/goods/5082274?x=1#top')).toEqual({
      ok: true,
      link: { source: 'kurly', sourceId: '5082274', url: 'https://www.kurly.com/goods/5082274' },
    })
    expect(parseShopUrl(' kurly.com/goods/5082274 ')).toEqual({
      ok: true,
      link: { source: 'kurly', sourceId: '5082274', url: 'https://www.kurly.com/goods/5082274' },
    })
  })

  it('홈플러스는 itemNo와 storeType만 남기고 mfront로, storeType이 없으면 HYPER', () => {
    expect(parseShopUrl('https://mfront.homeplus.co.kr/item?itemNo=120074651&storeType=HYPER&utm=x')).toEqual({
      ok: true,
      link: { source: 'homeplus', sourceId: '120074651:HYPER', url: 'https://mfront.homeplus.co.kr/item?itemNo=120074651&storeType=HYPER' },
    })
    expect(parseShopUrl('https://front.homeplus.co.kr/item?itemNo=120074651')).toEqual({
      ok: true,
      link: { source: 'homeplus', sourceId: '120074651:HYPER', url: 'https://mfront.homeplus.co.kr/item?itemNo=120074651&storeType=HYPER' },
    })
    expect(parseShopUrl('https://mfront.homeplus.co.kr/item?itemNo=120074651&storeType=EXP')).toMatchObject({
      ok: true,
      link: { sourceId: '120074651:EXP', url: 'https://mfront.homeplus.co.kr/item?itemNo=120074651&storeType=EXP' },
    })
  })

  it('쿠팡 상품 주소는 쿠팡에 요청하지 않고 로우차트 주소로 바꾼다', () => {
    expect(
      parseShopUrl('https://www.coupang.com/vp/products/9519439579?itemId=18170724212&vendorItemId=85334209693&q=참기름'),
    ).toEqual({
      ok: true,
      link: { source: 'lowchart', sourceId: '9519439579-18170724212', url: 'https://www.lowchart.com/9519439579-18170724212' },
    })
  })

  it('쿠팡 주소에 itemId가 없거나 짧은 주소(link.coupang.com)면 거절', () => {
    expect(parseShopUrl('https://www.coupang.com/vp/products/9519439579')).toEqual({ ok: false, reason: 'item_id_missing' })
    expect(parseShopUrl('https://link.coupang.com/a/cXYZ12')).toEqual({ ok: false, reason: 'short_link' })
  })

  it('로우차트 주소는 그대로', () => {
    expect(parseShopUrl('https://www.lowchart.com/9519439579-18170724212?ref=share')).toEqual({
      ok: true,
      link: { source: 'lowchart', sourceId: '9519439579-18170724212', url: 'https://www.lowchart.com/9519439579-18170724212' },
    })
  })

  it('다른 사이트·주소가 아닌 글·모양이 다른 경로는 거절', () => {
    expect(parseShopUrl('https://www.cjthemarket.com/the/product/product-main?prdCd=40055066')).toEqual({ ok: false, reason: 'unsupported' })
    expect(parseShopUrl('비비고 왕교자')).toEqual({ ok: false, reason: 'not_url' })
    expect(parseShopUrl('')).toEqual({ ok: false, reason: 'not_url' })
    expect(parseShopUrl('https://www.kurly.com/search?sword=왕교자')).toEqual({ ok: false, reason: 'unsupported' })
    expect(parseShopUrl('https://www.lowchart.com/c/194176')).toEqual({ ok: false, reason: 'unsupported' })
    expect(parseShopUrl('http://www.kurly.com/goods/abc')).toEqual({ ok: false, reason: 'unsupported' })
  })

  it('출처 이름', () => {
    expect(SHOP_LABEL).toEqual({ kurly: '컬리', homeplus: '홈플러스', lowchart: '로우차트(쿠팡)' })
  })
})

describe('상품 페이지', () => {
  it('컬리: @graph 안 Product의 이름·숫자 가격·중량/용량, 평점은 없음', () => {
    const p = parseShopProduct(read('kurly-5082274.html'))
    expect(p).toEqual({
      name: '[비비고] 왕교자 만두 대용량 1.05kg',
      price: 10980,
      imageUrl: 'https://product-image.kurly.com/product/image/6b5b8a11-d6fd-475b-a830-8f3313b3c6a7.jpg',
      rating: null,
      reviewCount: null,
      size: '1050g',
      priceFrom: null,
      observed: null,
    })
  })

  it('홈플러스: 글자 가격 "4150"을 숫자로, 평점·후기 수', () => {
    const p = parseShopProduct(read('homeplus-120074651.html'))
    expect(p.name).toBe('농심 신라면 120G*5입')
    expect(p.price).toBe(4150)
    expect(p.rating).toBe(4.9)
    expect(p.reviewCount).toBe(121683)
    expect(p.imageUrl).toBe('https://image.homeplus.kr/td/0928af1f-77d3-4aab-bedc-761a0d80c914')
    expect(p.size).toBeNull()
    expect(p.observed).toBeNull()
  })

  it('로우차트: 여러 JSON-LD 블록 중 Product, 현재가·적용일·관측 최저·최고·평균가·최근 변동일', () => {
    const p = parseShopProduct(read('lowchart-9519439579-18170724212.html'))
    expect(p.name).toBe('오뚜기옛날 참기름, 350ml, 6개')
    expect(p.price).toBe(28920)
    expect(p.priceFrom).toBe('2026-10-19')
    expect(p.rating).toBe(5)
    expect(p.reviewCount).toBe(235193)
    expect(p.observed).toEqual({ low: 28920, high: 39360, avg: 37722, changedOn: '2026-10-19' })
    expect(p.imageUrl).toMatch(/^https:\/\/thumbnail\.coupangcdn\.com\//)
  })

  it('가격이 "0"이면 출처 값이 아니므로 ShopParseError', () => {
    const html = read('homeplus-120074651.html').replace('"price": "4150"', '"price": "0"')
    expect(() => parseShopProduct(html)).toThrow(ShopParseError)
  })

  it('가격이 없거나 음수·소수면 ShopParseError', () => {
    const base = read('kurly-5082274.html')
    expect(() => parseShopProduct(base.replace('"price":10980,', ''))).toThrow(ShopParseError)
    expect(() => parseShopProduct(base.replace('"price":10980', '"price":-5'))).toThrow(ShopParseError)
    expect(() => parseShopProduct(base.replace('"price":10980', '"price":"10,980원"'))).toThrow(ShopParseError)
  })

  it('JSON-LD Product가 없으면 ShopParseError(구조가 바뀜)', () => {
    expect(() => parseShopProduct('<html><body>점검 중</body></html>')).toThrow(ShopParseError)
    expect(() => parseShopProduct('<script type="application/ld+json">{broken</script>')).toThrow(ShopParseError)
  })

  it('관측값 중 못 읽은 것은 null로 두고 나머지는 읽는다', () => {
    const html = read('lowchart-9519439579-18170724212.html').replace('"name":"관측 평균가","value":"37,722원"', '"name":"관측 평균가","value":"-"')
    expect(parseShopProduct(html).observed).toEqual({ low: 28920, high: 39360, avg: null, changedOn: '2026-10-19' })
  })
})
