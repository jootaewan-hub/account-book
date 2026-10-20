// 대안 탭(P7, 화면 설계 5절): 같은 품목의 후보 중 고른 상품보다 나은 점이 있는 것만, 이유 태그(평가가 좋음·더 쌈)를 숫자와 함께. 판정 문장은 쓰지 않는다.
// 회수·부적합 기록이 있는 상품은 표시를 붙이고 뒤로 보낸다(D-016). 모든 숫자는 다나와 후보 값 그대로.
import { describe, expect, it } from 'vitest'
import { alternatives, betterText } from '../../src/grocery/lib/alternatives'
import type { Candidate } from '../../src/grocery/lib/products'

const at = '2026-10-19T02:00:00Z'
const c = (productId: string, name: string, rating: number | null, price: number, qty = 1, reviewCount: number | null = 500): Candidate => ({
  productId, name, imageUrl: null, rating, reviewCount, foundAt: at,
  variants: [{ qty, price, unitPrice: null, unitLabel: null, mallCount: 10 }],
})

describe('alternatives', () => {
  const chosen = c('p1', '비비고 왕교자 1.05kg', 4.6, 10380)
  it('같은 수량 가격이 더 싸면 "더 쌈"(차액), 평점이 0.2 이상 높고 후기 100개 이상이면 "평가가 좋음"', () => {
    const out = alternatives([chosen, c('p2', '동원 왕교자 1.05kg', 4.8, 9900), c('p3', '풀무원 왕교자 1kg', 4.9, 10900, 1, 150), c('p4', '오뚜기 교자 1kg', 4.2, 12000), c('p5', '후기 적음', 4.9, 10900, 1, 50)], 'p1', 1, new Map())
    expect(out.map((a) => a.productId)).toEqual(['p2', 'p3'])
    expect(out.map((a) => a.foundAt)).toEqual([at, at]) // 줄마다 다나와 확인 시각(기준일)을 쓴다
    expect(out[0].reasons).toEqual([
      { kind: 'cheaper', text: '1개 9,900원, 480원 더 쌈' },
      { kind: 'rating', text: '평점 4.8(후기 500개), 고른 상품 4.6' },
    ])
    expect(out[1].reasons).toEqual([{ kind: 'rating', text: '평점 4.9(후기 150개), 고른 상품 4.6' }]) // p5는 후기 100개 미만이라 빠진다
  })
  it('수량이 같은 줄이 없으면 가격은 비교하지 않고, 평점도 없으면 뺀다', () => {
    const out = alternatives([chosen, c('p2', 'x', null, 5000, 2)], 'p1', 1, new Map())
    expect(out).toEqual([])
  })
  it('회수·부적합 기록이 있는 상품은 출처별 건수를 표시로 붙이고 뒤로 보낸다(빼지 않는다)', () => {
    const out = alternatives([chosen, c('p2', 'y', 4.9, 9000), c('p3', 'z', 4.9, 9500)], 'p1', 1, new Map([['p2', [{ source: 'I0490' as const }, { source: 'I2620' as const }]]]))
    expect(out.map((a) => [a.productId, a.alert])).toEqual([['p3', null], ['p2', '회수·판매중지 1건, 검사부적합 1건']])
  })
  it('고른 상품이 없거나 후보가 없으면 빈 배열', () => {
    expect(alternatives([c('p2', 'y', 4.9, 9000)], 'p1', 1, new Map())).toEqual([])
    expect(alternatives([], 'p1', 1, new Map())).toEqual([])
  })
})

describe('요약 칸 "더 나은 상품"', () => {
  it('개수만 쓴다(판정 문장 없음)', () => {
    expect(betterText(0)).toBe('없음')
    expect(betterText(2)).toBe('2개')
    expect(betterText(null)).toBe('확인 못 함')
  })
})
