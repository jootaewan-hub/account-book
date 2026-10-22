// 몰 주소 자동 찾기(D-024) 순수 부분: 검색 결과에서 주소 고르기, 이름·용량 견주기, 출처마다 하나 고르기.
import { describe, expect, it } from 'vitest'
import { bestPerSource, findTokens, matchShop, pickLinks, searchResultUrls } from '../../supabase/functions/_shared/shopFind'

describe('searchResultUrls', () => {
  it('web_search_tool_result 블록의 결과 주소만 순서대로 모은다(모델 글·오류 블록은 무시)', () => {
    const content = [
      { type: 'text', text: '컬리에서 찾아볼게요 https://www.kurly.com/goods/1' },
      { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: '비비고 왕교자 컬리' } },
      { type: 'web_search_tool_result', tool_use_id: 's1', content: [
        { type: 'web_search_result', url: 'https://www.kurly.com/goods/5082274', title: '[비비고] 왕교자', encrypted_content: 'x', page_age: null },
        { type: 'web_search_result', url: 'https://www.kurly.com/search?sword=교자', title: '검색', encrypted_content: 'x', page_age: null },
      ] },
      { type: 'web_search_tool_result', tool_use_id: 's2', content: { type: 'web_search_tool_result_error', error_code: 'unavailable' } },
      { type: 'web_search_tool_result', tool_use_id: 's3', content: [
        { type: 'web_search_result', url: 'https://www.coupang.com/vp/products/9519439579?itemId=18170724212&vendorItemId=1', title: '쿠팡', encrypted_content: 'x', page_age: null },
      ] },
    ]
    expect(searchResultUrls(content)).toEqual([
      'https://www.kurly.com/goods/5082274',
      'https://www.kurly.com/search?sword=교자',
      'https://www.coupang.com/vp/products/9519439579?itemId=18170724212&vendorItemId=1',
    ])
  })
})

describe('pickLinks', () => {
  const urls = [
    'https://www.kurly.com/search?sword=교자', // 상품 페이지가 아님
    'https://www.kurly.com/goods/1',
    'https://www.kurly.com/goods/1?ref=x', // 같은 상품
    'https://www.kurly.com/goods/2',
    'https://www.kurly.com/goods/3', // 출처마다 2개까지
    'https://front.homeplus.co.kr/item?itemNo=120074651',
    'https://www.coupang.com/vp/products/9519439579', // itemId가 없으면 로우차트 주소를 못 만든다
    'https://www.coupang.com/vp/products/9519439579?itemId=18170724212',
    'https://emart.ssg.com/item/itemView.ssg?itemId=1', // 모르는 몰
  ]
  it('몰 상품 주소만, 출처마다 앞에서 2개, 쿠팡은 로우차트로', () => {
    expect(pickLinks(urls).map((l) => `${l.source}:${l.sourceId}`)).toEqual([
      'kurly:1', 'kurly:2', 'homeplus:120074651:HYPER', 'lowchart:9519439579-18170724212',
    ])
  })
  it('이미 주소를 넣은 출처는 빼고 찾는다', () => {
    expect(pickLinks(urls, ['homeplus', 'lowchart']).map((l) => l.source)).toEqual(['homeplus', 'lowchart'])
  })
})

describe('matchShop', () => {
  const target = { name: 'CJ제일제당 비비고 왕교자 1.05kg', spec: null }
  it('용량이 같고 상품 단어가 절반 넘게 들어 있으면 자동 저장', () => {
    expect(matchShop(target, { name: '[비비고] 왕교자 1.05kg', size: null })).toEqual({ grade: 'auto', overlap: 2, size: 'same' })
    // 띄어쓰기가 달라도 같은 단어로 본다. 페이지에 용량 칸만 있어도 읽는다
    expect(matchShop(target, { name: 'CJ 비비고 왕 교자', size: '1050g' }).grade).toBe('auto')
  })
  it('용량이 다르면(묶음 포함) 같은 상품으로 보지 않는다', () => {
    expect(matchShop(target, { name: '비비고 왕교자 1.05kg x 2개', size: null })).toEqual({ grade: 'no', overlap: 2, size: 'different' })
    expect(matchShop(target, { name: '비비고 왕교자 455g', size: null }).grade).toBe('no')
  })
  it('용량을 모르거나 단어가 하나만 겹치면 사람이 고르게 후보로', () => {
    expect(matchShop(target, { name: '비비고 왕교자', size: null })).toEqual({ grade: 'maybe', overlap: 2, size: 'unknown' })
    expect(matchShop(target, { name: '풀무원 왕교자 1.05kg', size: null })).toEqual({ grade: 'maybe', overlap: 1, size: 'same' })
  })
  it('겹치는 단어가 없으면 버린다', () => {
    expect(matchShop(target, { name: '고향만두 1.05kg', size: null }).grade).toBe('no')
  })
  it('상품 이름에 용량이 없으면 품목 규격으로 견준다', () => {
    expect(matchShop({ name: '서울우유 나100%', spec: '1L' }, { name: '서울우유 나100% 1000ml', size: null }).grade).toBe('auto')
  })
})

describe('findTokens·bestPerSource', () => {
  it('용량·수량·꾸밈말은 단어로 치지 않는다', () => {
    expect(findTokens('[특가] CJ제일제당 비비고 왕교자 1.05kg 2개 냉동')).toEqual(['cj제일제당', '비비고', '왕교자'])
  })
  it('출처마다 자동 > 후보, 같으면 겹친 단어가 많은 것, 같으면 먼저 찾은 것', () => {
    const c = (source: 'kurly' | 'homeplus' | 'lowchart', id: string, grade: 'auto' | 'maybe' | 'no', overlap: number) =>
      ({ source, id, match: { grade, overlap, size: 'same' as const } })
    const picked = bestPerSource([
      c('kurly', 'k1', 'maybe', 3), c('kurly', 'k2', 'auto', 2), c('kurly', 'k3', 'auto', 2),
      c('homeplus', 'h1', 'no', 0),
      c('lowchart', 'l1', 'maybe', 1), c('lowchart', 'l2', 'maybe', 2),
    ])
    expect(picked.map((x) => x.id)).toEqual(['k2', 'l2'])
  })
})
