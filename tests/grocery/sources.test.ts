// 가격 출처 넓히기(P3) 화면 계산: 몰 주소 줄 문구, 로우차트 관측값 문구, 참가격 매장 줄 문구, 상품 찾기 필터, 주소 거절 문구.
import { describe, expect, it } from 'vitest'
import {
  filterGoods,
  NOTE_NOT_BEST,
  observedText,
  shopPriceText,
  shopSourceText,
  shopStateText,
  storeRowText,
  storeSourceText,
  storeTypeName,
  urlRejectText,
  type ShopPrice,
  type StorePrice,
} from '../../src/grocery/lib/sources'

const NOW = new Date('2026-10-19T12:00:00Z') // 한국 10-19 21:00
const base: ShopPrice = {
  source: 'kurly', sourceId: '5082274', url: 'https://www.kurly.com/goods/5082274', addedAt: '2026-10-19T01:00:00Z',
  checkedAt: '2026-10-19T02:10:00Z', ok: true, error: null,
  pricedAt: '2026-10-19T02:10:00Z', name: '[비비고] 왕교자 만두 대용량 1.05kg', price: 10980, imageUrl: null, rating: null, reviewCount: null, size: '1050g',
  priceFrom: null, obsLow: null, obsHigh: null, obsAvg: null, changedOn: null,
}

describe('몰 주소 줄', () => {
  it('성공한 값이 있으면 상태 문구는 없고, 가격과 출처·확인 시각을 쓴다', () => {
    expect(shopStateText(base, NOW)).toBeNull()
    expect(shopPriceText(base)).toBe('10,980원')
    expect(shopSourceText(base, NOW)).toBe('컬리, 오늘 11:10')
  })

  it('아직 확인 전이면 "아직 확인 전", 가격은 "확인 못 함"', () => {
    const p = { ...base, checkedAt: null, ok: null, error: null, pricedAt: null, name: null, price: null }
    expect(shopStateText(p, NOW)).toBe('아직 확인 전')
    expect(shopPriceText(p)).toBe('확인 못 함')
    expect(shopSourceText(p, NOW)).toBe('컬리')
  })

  it('마지막 확인이 실패면 "지금 불러오지 못했어요"와, 이전 성공 값이 있으면 그 시각', () => {
    const failedNoValue = { ...base, ok: false, error: 'http_503', pricedAt: null, name: null, price: null }
    expect(shopStateText(failedNoValue, NOW)).toBe('컬리 가격을 지금 불러오지 못했어요.')
    const failedOld = { ...base, ok: false, error: 'parse_failed', checkedAt: '2026-10-19T03:00:00Z', pricedAt: '2026-10-18T02:00:00Z' }
    expect(shopStateText(failedOld, NOW)).toBe('컬리 가격을 지금 불러오지 못했어요. 10월 18일 11:00에 확인한 값을 보여 드려요.')
    expect(shopSourceText(failedOld, NOW)).toBe('컬리, 10월 18일 11:00')
  })

  it('로우차트는 "쿠팡 현재가" 출처와 적용 시작일, 관측값 문구', () => {
    const low: ShopPrice = {
      ...base, source: 'lowchart', sourceId: '9519439579-18170724212', url: 'https://www.lowchart.com/9519439579-18170724212',
      price: 28920, priceFrom: '2026-10-19', obsLow: 28920, obsHigh: 39360, obsAvg: 37722, changedOn: '2026-10-19',
    }
    expect(shopSourceText(low, NOW)).toBe('로우차트(쿠팡), 오늘 11:10, 10월 19일부터 이 값')
    expect(observedText(low)).toBe('로우차트 관측: 최저 28,920원, 최고 39,360원, 평균 37,722원, 최근 변동 10월 19일')
    expect(observedText({ ...low, obsAvg: null, changedOn: null })).toBe('로우차트 관측: 최저 28,920원, 최고 39,360원, 평균 확인 못 함')
    expect(observedText(base)).toBeNull()
  })

  it('넣은 값은 가장 싼 값에 넣지 않는다는 안내', () => {
    expect(NOTE_NOT_BEST).toBe('넣은 주소의 값은 같은 상품인지 확인되지 않아 가장 싼 값에는 넣지 않아요.')
  })
})

describe('주소 거절 문구', () => {
  it('이유마다 할 일을 알려 준다', () => {
    expect(urlRejectText('not_url')).toBe('상품 페이지 주소를 붙여 넣어 주세요.')
    expect(urlRejectText('unsupported')).toBe('컬리·홈플러스·쿠팡 상품 페이지 주소만 넣을 수 있어요(쿠팡은 로우차트 관측값으로 보여요).')
    expect(urlRejectText('short_link')).toBe('쿠팡 짧은 주소(link.coupang.com)에는 상품 번호가 없어요. 상품 페이지의 주소를 넣어 주세요.')
    expect(urlRejectText('item_id_missing')).toBe('쿠팡 주소에 itemId가 없어요. 상품 페이지에서 옵션을 고른 뒤 주소를 복사해 주세요.')
  })
})

describe('참가격 매장 줄', () => {
  const row: StorePrice = { goodId: '1001', goodName: '비비고 왕교자(1.12kg)', entpId: '7', entpName: '이마트분당점', typeCode: 'LM', inspectedOn: '2026-10-09', price: 9980, dc: false, plusOne: false }

  it('업태 이름', () => {
    expect(['LM', 'SM', 'DP', 'CS', 'MF', 'XX'].map(storeTypeName)).toEqual(['대형마트', '슈퍼마켓', '백화점', '편의점', '제조사', 'XX'])
  })

  it('가격과 할인·1+1 표시, 조사값이 없으면 "확인 못 함"', () => {
    expect(storeRowText(row)).toBe('9,980원')
    expect(storeRowText({ ...row, dc: true })).toBe('9,980원, 할인')
    expect(storeRowText({ ...row, dc: true, plusOne: true })).toBe('9,980원, 할인, 1+1')
    expect(storeRowText({ ...row, inspectedOn: null, price: null })).toBe('확인 못 함')
  })

  it('출처와 조사일', () => {
    expect(storeSourceText(row)).toBe('참가격, 2026년 10월 9일 조사')
    expect(storeSourceText({ ...row, inspectedOn: null, price: null })).toBe('참가격, 최근 조사값 없음')
  })
})

describe('참가격 상품 찾기', () => {
  const goods = [
    { goodId: '1', name: '비비고 왕교자(1.12kg)', detail: '냉동만두' },
    { goodId: '2', name: '서울우유 흰우유(1L)', detail: null },
    { goodId: '3', name: '대파(흙대파, 500~800g)', detail: null },
    { goodId: '4', name: '동원 비비고 비슷한 것', detail: '만두' },
  ]
  it('빈 검색어면 전부, 단어(띄어쓰기 무시)를 모두 담은 이름·상세만, 50개까지', () => {
    expect(filterGoods(goods, '').map((g) => g.goodId)).toEqual(['1', '2', '3', '4'])
    expect(filterGoods(goods, '비비고 만두').map((g) => g.goodId)).toEqual(['1', '4'])
    expect(filterGoods(goods, '왕 교자').map((g) => g.goodId)).toEqual(['1'])
    expect(filterGoods(goods, '흰우유').map((g) => g.goodId)).toEqual(['2'])
    expect(filterGoods(goods, '없는것')).toEqual([])
    const many = Array.from({ length: 80 }, (_, i) => ({ goodId: String(i), name: `우유 ${i}`, detail: null }))
    expect(filterGoods(many, '우유')).toHaveLength(50)
  })
})

describe('몰 주소 자동 찾기 상태 문구(D-024)', async () => {
  const { findStateText, candidateSourceText } = await import('../../src/grocery/lib/sources')
  const base = { searchedAt: '2026-10-22T01:00:00Z', error: null, candidates: [] }
  it('찾는 중·실패·못 찾음은 하는 일 그대로, 결과가 있으면 문구 없음', () => {
    expect(findStateText(null, 0)).toBeNull()
    expect(findStateText({ ...base, status: 'searching' }, 0)).toBe('컬리·홈플러스·쿠팡에서 같은 상품 찾는 중')
    expect(findStateText({ ...base, status: 'failed', error: 'search_disabled' }, 0)).toContain('검색 설정이 꺼져')
    expect(findStateText({ ...base, status: 'failed', error: 'timeout' }, 0)).toBe('몰에서 상품을 찾지 못했어요. 주소를 직접 넣을 수 있어요.')
    expect(findStateText({ ...base, status: 'done' }, 0)).toContain('이름·용량이 같은 상품을 찾지 못했어요')
    expect(findStateText({ ...base, status: 'done' }, 1)).toBeNull() // 넣은 주소가 있으면 따로 말하지 않는다
  })
  it('후보 줄은 출처와 확인 시각을 함께 쓴다', () => {
    const c = { source: 'kurly' as const, sourceId: '1', url: 'https://www.kurly.com/goods/1', name: 'x', size: null, price: 1000, checkedAt: '2026-10-22T01:05:00Z', grade: 'maybe' as const, saved: false }
    expect(candidateSourceText(c, new Date('2026-10-22T03:00:00Z'))).toBe('컬리 페이지, 오늘 10:05 확인')
  })
  it('화면 문구에 AI라는 말을 쓰지 않는다', () => {
    for (const st of ['searching', 'failed', 'done'] as const) expect(findStateText({ ...base, status: st }, 0) ?? '').not.toMatch(/AI|인공지능|분석 중/)
  })
})
