// @vitest-environment jsdom
// 알아보기 탭(D-035): 날씨·미세먼지 묶음과 다나와 검색 → 쇼핑몰별 가격 시트. 함수 응답은 가짜로 준다.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const calls: { name: string; body: Record<string, unknown> }[] = []
let responses: Record<string, (body: Record<string, unknown>) => unknown> = {}
vi.mock('../../src/lib/supabase', () => ({
  sb: () => ({
    functions: {
      invoke: async (name: string, opts: { body: Record<string, unknown> }) => {
        calls.push({ name, body: opts.body })
        const r = responses[name]
        return r ? { data: r(opts.body), error: null } : { data: null, error: new Error('no') }
      },
    },
  }),
}))

const { clearWeatherCache, ExploreView } = await import('../../src/components/ExploreView')

const WEATHER = {
  lat: 37.42, lng: 127.13,
  weather: {
    status: 'ok',
    now: { observedAt: new Date().toISOString(), temp: 12.3, humidity: 55, rain1h: 0, precip: '없음' },
    issuedAt: new Date().toISOString(),
    days: [{ date: '2026-10-28', min: 6, max: 17, sky: '구름많음', rainChance: 30, precip: '없음' }],
  },
  air: { status: 'ok', station: { name: '정자동', addr: null, distanceKm: 1.4 }, measuredAt: new Date().toISOString(), pm10: { value: 35, grade: '보통' }, pm25: { value: null, grade: null } },
}
const SEARCH = {
  status: 'done', query: '비비고 왕교자', foundAt: new Date().toISOString(),
  items: [{ pcode: '5643303', name: 'CJ제일제당 비비고 왕교자 1.05kg', imageUrl: 'https://evil.example/x.jpg', rating: 4.8, reviewCount: 9217,
    variants: [{ qty: 1, price: 10380, unitPrice: 989, unitLabel: '100g', mallCount: 33 }, { qty: 2, price: 19250, unitPrice: 917, unitLabel: '100g', mallCount: 132 }] }],
}
const KURLY = {
  status: 'done', source: 'kurly', query: '비비고 왕교자', foundAt: new Date().toISOString(),
  items: [{ id: '5082274', name: '[비비고] 왕교자 만두 대용량 1.05kg', price: 10480, listPrice: 11480, discountRate: 8, soldOut: false, url: 'https://www.kurly.com/goods/5082274', reviews: '9,999+', rating: null, tags: ['샛별배송'] }],
}
const DAISO = {
  status: 'done', source: 'daiso', query: '비비고 왕교자', foundAt: new Date().toISOString(),
  items: Array.from({ length: 7 }, (_, i) => ({ id: String(100 + i), name: `다이소 상품 ${i + 1}`, price: 1000 * (i + 1), listPrice: null, discountRate: null, soldOut: i === 1, url: `https://www.daisomall.co.kr/pd/pdr/SCR_PDR_0001?pdNo=${100 + i}`, reviews: '12', rating: 4.5, tags: ['매장 픽업'] })),
}
const PRODUCT = {
  status: 'cached',
  product: { pcode: '5643303', name: 'CJ제일제당 비비고 왕교자 1.05kg', rating: 4.8, reviewCount: 9217, ratedAt: null },
  checkedAt: new Date().toISOString(), pageQty: 3,
  variants: [{ qty: 1, seller: null, price: 10380, delivery: null, unitPrice: 989, unitLabel: '100g', mallCount: 33 }],
  offers: [
    { qty: 3, seller: '11번가', price: 28900, delivery: null, unitPrice: null, unitLabel: null, mallCount: null },
    { qty: 3, seller: '옥션', price: 28800, delivery: 0, unitPrice: null, unitLabel: null, mallCount: null },
  ],
}

beforeEach(() => {
  calls.length = 0
  clearWeatherCache()
  localStorage.clear()
  responses = { 'explore-weather': () => WEATHER, 'explore-price': (b) => (b.pcode ? PRODUCT : b.source === 'kurly' ? KURLY : b.source === 'daiso' ? DAISO : SEARCH) }
})
afterEach(cleanup)

describe('알아보기 탭', () => {
  it('기본 위치(성남시청 근처)로 날씨·미세먼지를 받아 출처와 함께 보인다. 값이 없으면 확인 못 함, 등급이 없으면 등급 없음', async () => {
    render(<ExploreView toast={() => {}} />)
    expect(await screen.findByText('12.3°')).toBeTruthy()
    expect(screen.getByText('성남시청 근처')).toBeTruthy()
    expect(screen.getByText('6° / 17°')).toBeTruthy()
    expect(screen.getByText(/기상청 단기예보 오늘 \d\d:\d\d 발표/)).toBeTruthy()
    expect(screen.getByText('35㎍/㎥')).toBeTruthy()
    expect(screen.getByText('보통')).toBeTruthy()
    expect(screen.getByText('확인 못 함')).toBeTruthy()
    expect(screen.getByText('등급 없음')).toBeTruthy()
    expect(screen.getByText(/에어코리아 정자동 측정소\(약 1.4km\)/)).toBeTruthy()
    expect(calls[0]).toEqual({ name: 'explore-weather', body: { lat: 37.42, lng: 127.13 } })
  })

  it('활용신청 전이면 그 사실을 적는다', async () => {
    responses['explore-weather'] = () => ({ lat: 37.42, lng: 127.13, weather: { status: 'not_registered' }, air: { status: 'error' } })
    render(<ExploreView toast={() => {}} />)
    expect(await screen.findByText('기상청 예보는 공공데이터포털 활용신청 뒤에 보여요')).toBeTruthy()
    expect(screen.getByText('에어코리아 미세먼지를 받지 못했어요')).toBeTruthy()
  })

  it('검색하면 결과 줄(1개 최저가, 단위 가격·판매처·다른 수량·평점)을 보이고, 누르면 쇼핑몰별 가격을 합계 순서로 보인다', async () => {
    render(<ExploreView toast={() => {}} />)
    fireEvent.change(screen.getByRole('textbox', { name: '상품 이름' }), { target: { value: '  비비고   왕교자 ' } })
    fireEvent.click(screen.getByRole('button', { name: '찾기' }))
    expect(await screen.findByText('CJ제일제당 비비고 왕교자 1.05kg')).toBeTruthy()
    expect(calls.find((c) => c.name === 'explore-price')?.body).toEqual({ query: '비비고 왕교자' })
    expect(screen.getByText('100g당 989원 · 판매처 33곳 · 2개 19,250원 · 평점 4.8(9,217)')).toBeTruthy()
    expect(screen.getByText('10,380원')).toBeTruthy()
    // 콘텐츠 보안 정책 밖 이미지 호스트는 그리지 않는다
    expect(document.querySelector('img.tx-thumb')).toBeNull()

    fireEvent.click(screen.getByText('CJ제일제당 비비고 왕교자 1.05kg'))
    expect(await screen.findByText('쇼핑몰별 최저가 (3개 묶음 기준)')).toBeTruthy()
    expect(calls.at(-1)).toEqual({ name: 'explore-price', body: { pcode: '5643303' } })
    const rows = [...document.querySelectorAll('.offer-table tbody tr')].map((r) => r.textContent)
    expect(rows).toEqual(['옥션28,800원무료28,800원', '11번가28,900원표시 없음-'])
    expect(screen.getByText(/다나와 상품 페이지, 오늘 \d\d:\d\d 확인/)).toBeTruthy()
  })

  it('한 번 찾으면 다나와·마켓컬리·다이소를 함께 부르고, 컬리·다이소 줄은 그 몰 상품 페이지로 연결한다(앞 5개, 더 보기)', async () => {
    render(<ExploreView toast={() => {}} />)
    fireEvent.change(screen.getByRole('textbox', { name: '상품 이름' }), { target: { value: '비비고 왕교자' } })
    fireEvent.click(screen.getByRole('button', { name: '찾기' }))
    expect(await screen.findByText('[비비고] 왕교자 만두 대용량 1.05kg')).toBeTruthy()
    const bodies = calls.filter((c) => c.name === 'explore-price').map((c) => c.body)
    expect(bodies).toEqual([{ query: '비비고 왕교자' }, { query: '비비고 왕교자', source: 'kurly' }, { query: '비비고 왕교자', source: 'daiso' }])
    const kurly = screen.getByText('[비비고] 왕교자 만두 대용량 1.05kg').closest('a')
    expect(kurly?.getAttribute('href')).toBe('https://www.kurly.com/goods/5082274')
    expect(kurly?.textContent).toContain('정가 11,480원 · 8% 할인 · 샛별배송 · 후기 9,999+')
    expect(kurly?.textContent).toContain('10,480원')
    expect(screen.getByText(/마켓컬리 검색 “비비고 왕교자”, 오늘 \d\d:\d\d 확인/)).toBeTruthy()
    // 다이소는 7개 중 앞 5개, 품절 표시, 더 보기
    expect(screen.getByText('다이소 상품 5')).toBeTruthy()
    expect(screen.queryByText('다이소 상품 6')).toBeNull()
    expect(screen.getByText('다이소 상품 2').closest('a')?.textContent).toContain('품절')
    fireEvent.click(screen.getByRole('button', { name: '2개 더 보기' }))
    expect(screen.getByText('다이소 상품 7')).toBeTruthy()
  })

  it('다나와가 밀려 있으면 그렇게 말한다', async () => {
    responses['explore-price'] = () => ({ status: 'busy' })
    render(<ExploreView toast={() => {}} />)
    fireEvent.change(screen.getByRole('textbox', { name: '상품 이름' }), { target: { value: '우유' } })
    fireEvent.click(screen.getByRole('button', { name: '찾기' }))
    expect(await screen.findByText('다나와 검색이 밀려 있어요. 잠시 뒤 다시 찾아 주세요')).toBeTruthy()
  })

  it('현재 위치로: 위치를 소수 둘째 자리로 줄여 저장하고 그 위치로 다시 받는다', async () => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: (ok: (p: { coords: { latitude: number; longitude: number } }) => void) => ok({ coords: { latitude: 37.401234, longitude: 127.108765 } }) },
    })
    render(<ExploreView toast={() => {}} />)
    await screen.findByText('12.3°')
    fireEvent.click(screen.getByRole('button', { name: '현재 위치로' }))
    await waitFor(() => expect(calls.filter((c) => c.name === 'explore-weather').at(-1)?.body).toEqual({ lat: 37.4, lng: 127.11 }))
    expect(screen.getByText('현재 위치 근처')).toBeTruthy()
    expect(JSON.parse(localStorage.getItem('ab:explorePlace') ?? '{}')).toEqual({ lat: 37.4, lng: 127.11, kind: 'here' })
  })
})
