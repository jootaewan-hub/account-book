import { describe, expect, it } from 'vitest'
import { fcstBase, KmaError, kmaItems, kmaUrl, ncstBase, readDays, readNow, todayTomorrow, toGrid } from '../../supabase/functions/_shared/kma'
import { toAirKoreaTm } from '../../supabase/functions/_shared/airkorea'
import { FCST_ROWS, kmaFcst, kmaNcst, NCST, NOT_REGISTERED } from './fixtures'

describe('기상청 격자', () => {
  it('서울시청(37.5665, 126.9780)은 60, 127이다(기상청 격자 예시값)', () => {
    expect(toGrid(37.5665, 126.978)).toEqual({ nx: 60, ny: 127 })
  })
  it('성남시청 근처(37.42, 127.13)는 62, 124', () => {
    expect(toGrid(37.42, 127.13)).toEqual({ nx: 62, ny: 124 })
  })
})

describe('에어코리아 TM 변환', () => {
  it('k-skill fine_dust.py와 같은 값(서울시청 198245.053, 451586.838)', () => {
    const { tmX, tmY } = toAirKoreaTm(37.5665, 126.978)
    expect(tmX).toBeCloseTo(198245.053, 2)
    expect(tmY).toBeCloseTo(451586.838, 2)
  })
})

describe('발표 시각', () => {
  it('초단기실황은 지금에서 40분 뺀 시각의 정시(한국 시각)', () => {
    expect(ncstBase(new Date('2026-10-28T02:30:00Z'))).toEqual({ baseDate: '20261028', baseTime: '1000' })
    expect(ncstBase(new Date('2026-10-28T02:45:00Z'))).toEqual({ baseDate: '20261028', baseTime: '1100' })
    // 한국 00:20이면 전날 23시
    expect(ncstBase(new Date('2026-10-27T15:20:00Z'))).toEqual({ baseDate: '20261027', baseTime: '2300' })
  })
  it('단기예보는 02:10부터 오늘 02:00 발표, 그 전은 어제 23:00 발표', () => {
    expect(fcstBase(new Date('2026-10-27T17:05:00Z'))).toEqual({ baseDate: '20261027', baseTime: '2300' })
    expect(fcstBase(new Date('2026-10-27T17:10:00Z'))).toEqual({ baseDate: '20261028', baseTime: '0200' })
    expect(fcstBase(new Date('2026-10-28T13:00:00Z'))).toEqual({ baseDate: '20261028', baseTime: '0200' })
  })
  it('오늘·내일은 한국 날짜', () => {
    expect(todayTomorrow(new Date('2026-10-28T15:30:00Z'))).toEqual(['2026-10-29', '2026-10-30'])
  })
  it('주소에 키를 한 번만 인코딩한다(이미 %가 있으면 그대로)', () => {
    const g = { nx: 62, ny: 124 }
    const b = { baseDate: '20261028', baseTime: '0200' }
    expect(kmaUrl('getVilageFcst', 'a+b/c==', b, g)).toContain('serviceKey=a%2Bb%2Fc%3D%3D&')
    expect(kmaUrl('getVilageFcst', 'a%2Bb ', b, g)).toContain('serviceKey=a%2Bb&')
    expect(kmaUrl('getVilageFcst', 'k', b, g)).toContain('base_date=20261028&base_time=0200&nx=62&ny=124')
  })
})

describe('응답 읽기', () => {
  it('등록 전 키는 not_registered', () => {
    expect(() => kmaItems(NOT_REGISTERED)).toThrow(KmaError)
    try {
      kmaItems(NOT_REGISTERED)
    } catch (e) {
      expect((e as KmaError).code).toBe('not_registered')
    }
  })
  it('결과 코드가 00이 아니면 그 코드, JSON이 아니면 bad_response', () => {
    const noData = JSON.stringify({ response: { header: { resultCode: '03', resultMsg: 'NO_DATA' } } })
    expect(() => kmaItems(noData)).toThrow('result_03')
    expect(() => kmaItems('<html>')).toThrow('bad_response')
  })
  it('실황: 기온·습도·1시간 강수량·강수형태와 관측 시각', () => {
    expect(readNow(kmaItems(kmaNcst(NCST)))).toEqual({ observedAt: '2026-10-28T10:00:00+09:00', temp: 12.3, humidity: 55, rain1h: 0, precip: '없음' })
  })
  it('예보: 날짜별 최저·최고, 12시 하늘, 가장 높은 강수확률, 많이 나온 강수형태', () => {
    const { issuedAt, days } = readDays(kmaItems(kmaFcst(FCST_ROWS)), ['2026-10-28', '2026-10-29'])
    expect(issuedAt).toBe('2026-10-28T02:00:00+09:00')
    expect(days).toEqual([
      { date: '2026-10-28', min: 6, max: 17, sky: '구름많음', rainChance: 30, precip: '없음' },
      { date: '2026-10-29', min: 8, max: 14, sky: '흐림', rainChance: 80, precip: '비' },
    ])
  })
  it('예보에 없는 날·없는 칸은 null(지어내지 않는다)', () => {
    const { days } = readDays(kmaItems(kmaFcst(FCST_ROWS.filter(([c]) => c !== 'TMN'))), ['2026-10-28', '2026-10-31'])
    expect(days[0].min).toBeNull()
    expect(days[1]).toEqual({ date: '2026-10-31', min: null, max: null, sky: null, rainChance: null, precip: null })
  })
})
