// @vitest-environment jsdom
// 알아보기 탭(D-035) 화면 글자와 기기 위치 저장
import { afterEach, describe, expect, it } from 'vitest'
import { dayName, DEFAULT_PLACE, degree, failText, loadPlace, offerTotal, savePlace, sortOffers, variantText, whenText, type Quote } from '../../src/lib/explore'

afterEach(() => localStorage.clear())

const q = (seller: string, price: number, delivery: number | null): Quote => ({ qty: 1, seller, price, delivery, unitPrice: null, unitLabel: null, mallCount: null })

describe('글자', () => {
  const now = new Date('2026-10-28T02:30:00Z') // 한국 11:30
  it('같은 한국 날짜면 "오늘 HH:MM", 아니면 "M월 D일 HH:MM"', () => {
    expect(whenText('2026-10-28T02:00:00+09:00', now)).toBe('오늘 02:00')
    expect(whenText('2026-10-27T23:00:00+09:00', now)).toBe('10월 27일 23:00')
    // UTC로는 27일이어도 한국 날짜가 28일이면 오늘
    expect(whenText('2026-10-27T16:10:00Z', now)).toBe('오늘 01:10')
  })
  it('오늘·내일, 그 밖은 날짜', () => {
    expect(dayName('2026-10-28', now)).toBe('오늘')
    expect(dayName('2026-10-29', now)).toBe('내일')
    expect(dayName('2026-10-30', now)).toBe('10월 30일')
  })
  it('기온은 정수면 그대로, 아니면 소수 한 자리, 없으면 확인 못 함', () => {
    expect(degree(17)).toBe('17°')
    expect(degree(12.34)).toBe('12.3°')
    expect(degree(null)).toBe('확인 못 함')
  })
  it('실패 문구는 무엇을 못 받았는지 그대로', () => {
    expect(failText('weather', 'not_registered')).toBe('기상청 예보는 공공데이터포털 활용신청 뒤에 보여요')
    expect(failText('air', 'error')).toBe('에어코리아 미세먼지를 받지 못했어요')
  })
  it('수량별 최저가 줄', () => {
    expect(variantText({ qty: 2, price: 19250, unitPrice: 917, unitLabel: '100g', mallCount: 132 })).toBe('2개 19,250원 · 100g당 917원 · 판매처 132곳')
    expect(variantText({ qty: 1, price: 900, unitPrice: null, unitLabel: null, mallCount: null })).toBe('1개 900원')
  })
})

describe('쇼핑몰 줄', () => {
  it('합계는 배송비를 알 때만, 정렬은 합계(모르면 상품가) 오름차순', () => {
    expect(offerTotal(q('a', 1000, 0))).toBe(1000)
    expect(offerTotal(q('a', 1000, 3000))).toBe(4000)
    expect(offerTotal(q('a', 1000, null))).toBeNull()
    const sorted = sortOffers([q('G마켓', 15105, 3000), q('옥션', 15400, 0), q('11번가', 15990, null)])
    expect(sorted.map((o) => o.seller)).toEqual(['옥션', '11번가', 'G마켓'])
  })
})

describe('위치 저장(기기마다)', () => {
  it('저장한 현재 위치를 소수 둘째 자리로 읽고, 없거나 깨졌으면 기본(성남시청)', () => {
    expect(loadPlace()).toEqual(DEFAULT_PLACE)
    savePlace({ lat: 37.401234, lng: 127.108765, kind: 'here' })
    expect(loadPlace()).toEqual({ lat: 37.4, lng: 127.11, kind: 'here' })
    savePlace(DEFAULT_PLACE)
    expect(loadPlace()).toEqual(DEFAULT_PLACE)
    localStorage.setItem('ab:explorePlace', '{깨짐')
    expect(loadPlace()).toEqual(DEFAULT_PLACE)
  })
})
