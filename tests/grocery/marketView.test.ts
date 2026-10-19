import { describe, expect, it } from 'vitest'
import {
  boardSource,
  change,
  changeText,
  dayText,
  gradeText,
  latestOn,
  movers,
  pickSeries,
  rangeText,
  recordText,
  rowQuote,
  seriesForItem,
  seriesName,
  unitOf,
  whereOf,
  type MarketSeries,
} from '../../src/grocery/lib/market'
import { rowToSeries } from '../../src/grocery/lib/marketStore'

function s(over: Partial<MarketSeries> & Pick<MarketSeries, 'item' | 'vrty' | 'grd'>): MarketSeries {
  return {
    ctgry: '200', itemNm: '파', vrtyNm: '대파', grdNm: '상품', unit: 'kg', unitSz: '1',
    sgg: '3112', sggNm: '성남', mrkt: '0310407', mrktNm: 'B-유통',
    cur: { on: '2026-10-16', price: 1980 }, prev: null, w1: null, m1: null, y1: null,
    low: 1980, high: 4780, markets: 12, firstOn: '2026-09-02', days: 30, fetchedAt: '2026-10-17T00:10:00Z',
    ...over,
  }
}

const GREEN = s({ item: '246', vrty: '00', grd: '04', w1: { on: '2026-10-09', price: 2100 } })
const CHIVE = s({ item: '246', vrty: '02', grd: '04', vrtyNm: '쪽파', cur: { on: '2026-10-16', price: 3960 } })
const ONION = s({ item: '245', vrty: '00', grd: '04', itemNm: '양파', vrtyNm: '양파', cur: { on: '2026-10-16', price: 1960 }, w1: { on: '2026-10-09', price: 2060 } })
const ONION_MID = s({ item: '245', vrty: '00', grd: '05', itemNm: '양파', vrtyNm: '양파', grdNm: '중품', cur: { on: '2026-10-16', price: 1500 }, w1: { on: '2026-10-09', price: 2000 } })
const PORK = s({
  item: '4304', vrty: '27', grd: '27', ctgry: '500', itemNm: '돼지', vrtyNm: '삼겹살', grdNm: '삼겹살', unit: 'g', unitSz: '100',
  sgg: '1000', sggNm: '전국', mrkt: '', mrktNm: '', cur: { on: '2026-10-18', price: 2580 }, w1: { on: '2026-10-11', price: 2400 }, low: null, high: null, markets: 0,
})
const APPLE = s({ item: '411', vrty: '07', grd: '04', ctgry: '400', itemNm: '사과', vrtyNm: '홍로', unit: '개', unitSz: '10', cur: { on: '2026-10-16', price: 18600 }, w1: { on: '2026-10-09', price: 18600 } })
const BOARD = [GREEN, CHIVE, ONION, ONION_MID, PORK, APPLE]

describe('이름·단위·조사처', () => {
  it('품종이 품목을 품으면 품종만, 같으면 품목만, 아니면 둘 다', () => {
    expect(seriesName(GREEN)).toBe('대파')
    expect(seriesName(ONION)).toBe('양파')
    expect(seriesName(APPLE)).toBe('사과 홍로')
    expect(seriesName(PORK)).toBe('돼지 삼겹살')
  })
  it('등급은 없거나 품종과 같으면 쓰지 않는다', () => {
    expect(gradeText(GREEN)).toBe('상품')
    expect(gradeText(PORK)).toBe('')
    expect(gradeText({ grdNm: '-', vrtyNm: '국산(염장)' })).toBe('')
  })
  it('단위와 조사처', () => {
    expect(unitOf(APPLE)).toBe('10개')
    expect(whereOf(GREEN)).toBe('성남 B-유통')
    expect(whereOf(PORK)).toBe('전국')
  })
})

describe('비교', () => {
  it('차이는 원 단위 절댓값과 방향, 비교 값이 없으면 확인 못 함', () => {
    expect(changeText(change(GREEN.cur, GREEN.w1))).toBe('▼ 120원')
    expect(changeText(change(PORK.cur, PORK.w1))).toBe('▲ 180원')
    expect(changeText(change(APPLE.cur, APPLE.w1))).toBe('변동 없음')
    expect(changeText(change(GREEN.cur, null))).toBe('확인 못 함')
  })
  it('연도가 다른 날짜는 연도까지 쓴다', () => {
    expect(dayText('2026-10-09', '2026-10-16')).toBe('10월 9일')
    expect(dayText('2025-10-16', '2026-10-16')).toBe('2025년 10월 16일')
    expect(recordText({ firstOn: '2025-10-10', days: 24, cur: { on: '2026-10-16', price: 1 } })).toBe('2025년 10월 10일부터 기록, 최근 45일 중 24일 조사')
  })
  it('주변 범위는 조사처가 둘 이상일 때만, 출처 값 그대로', () => {
    expect(rangeText(GREEN)).toBe('서울·수원·성남 12곳 1,980~4,780원')
    expect(rangeText({ low: 2000, high: 2000, markets: 3 })).toBe('서울·수원·성남 3곳 2,000원')
    expect(rangeText({ low: 2000, high: 2000, markets: 1 })).toBeNull()
    expect(rangeText(PORK)).toBeNull()
  })
})

describe('장보기 품목 → 시세', () => {
  it('품종을 정한 이름은 그 품종, 아니면 기본 품종, 등급은 상품 먼저', () => {
    expect(seriesForItem(BOARD, '대파', null)).toBe(GREEN)
    expect(seriesForItem(BOARD, '쪽파', null)).toBe(CHIVE)
    expect(seriesForItem(BOARD, '양파', '1.5kg')).toBe(ONION)
    expect(seriesForItem(BOARD, '삼겹살', '600g')).toBe(PORK)
  })
  it('이름으로 정한 품종 값이 없으면 다른 품종으로 바꾸지 않는다', () => {
    expect(seriesForItem([GREEN], '쪽파', null)).toBeNull()
    expect(seriesForItem([CHIVE], '대파', null)).toBeNull()
  })
  it('기본 품종 값이 없으면 같은 품목의 다른 품종', () => {
    expect(pickSeries([APPLE], { item: '411', vrty: null, label: '사과' })).toBe(APPLE)
  })
  it('사전에 없거나 시세판에 없으면 null', () => {
    expect(seriesForItem(BOARD, '고수', null)).toBeNull()
    expect(seriesForItem(BOARD, '한우 국거리', null)).toBeNull()
  })
  it('목록 줄의 시세 칸', () => {
    expect(rowQuote(GREEN)).toEqual({ price: '1,980원', unit: '1kg', note: '성남 10월 16일' })
    expect(rowQuote(PORK)).toEqual({ price: '2,580원', unit: '100g', note: '전국 10월 18일' })
  })
})

describe('이번 주 움직임', () => {
  it('비율 순으로 내린 것·오른 것, 같은 품목·품종은 한 줄, 변동 없음은 뺀다', () => {
    const m = movers(BOARD, 'w1')
    // 양파 중품(-25%)이 상품(-4.9%)보다 먼저이고, 같은 양파라 상품 줄은 빠진다
    expect(m.down.map((x) => x.s)).toEqual([ONION_MID, GREEN])
    expect(m.up.map((x) => x.s)).toEqual([PORK])
    expect(m.down[0].c).toEqual({ dir: 'down', diff: 500 })
  })
  it('비교 값이 없는 기간이면 비어 있다', () => {
    expect(movers(BOARD, 'y1')).toEqual({ down: [], up: [] })
  })
  it('n개까지만', () => {
    const many = Array.from({ length: 8 }, (_, i) => s({ item: String(300 + i), vrty: '00', grd: '04', w1: { on: '2026-10-09', price: 3000 + i } }))
    expect(movers(many, 'w1', 5).down).toHaveLength(5)
  })
})

describe('시세판 머리글', () => {
  it('받은 시각과 가장 늦은 조사일', () => {
    const now = new Date('2026-10-17T03:00:00Z')
    expect(boardSource('2026-10-16T22:10:00Z', now)).toBe('KAMIS 소매가격(공공데이터포털), 오늘 07:10 받음')
    expect(boardSource('2026-10-15T22:10:00Z', now)).toBe('KAMIS 소매가격(공공데이터포털), 10월 16일 07:10 받음')
    expect(boardSource(null, now)).toBe('KAMIS 소매가격(공공데이터포털), 아직 받지 못했어요')
    expect(latestOn(BOARD)).toBe('2026-10-18')
    expect(latestOn([])).toBeNull()
  })
})

describe('rowToSeries', () => {
  it('DB 행을 바꾸고, 비교 값이 없으면 null', () => {
    const r = rowToSeries({
      item_cd: '246', vrty_cd: '00', grd_cd: '04', ctgry_cd: '200', item_nm: '파', vrty_nm: '대파', grd_nm: '상품', unit: 'kg', unit_sz: '1',
      sgg_cd: '3112', sgg_nm: '성남', mrkt_cd: '0310407', mrkt_nm: 'B-유통', cur_on: '2026-10-16', cur_price: 1980,
      prev_on: '2026-10-15', prev_price: 1980, w1_on: null, w1_price: null, m1_on: '2026-09-16', m1_price: 2650, y1_on: null, y1_price: null,
      low: 1980, high: 4780, markets: 12, first_on: '2026-09-02', days: 30, fetched_at: '2026-10-17T00:10:00Z',
    })
    expect(r).toMatchObject({ cur: { on: '2026-10-16', price: 1980 }, prev: { on: '2026-10-15', price: 1980 }, w1: null, m1: { price: 2650 }, y1: null, markets: 12 })
  })
})
