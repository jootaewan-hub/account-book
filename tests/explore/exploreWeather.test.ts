import { describe, expect, it } from 'vitest'
import { handle, type WeatherDeps } from '../../supabase/functions/explore-weather/handle'
import { FCST_ROWS, kmaFcst, kmaNcst, measure, NCST, NEARBY, NOT_REGISTERED } from './fixtures'

const NOW = new Date('2026-10-28T02:30:00Z') // 한국 11:30

function deps(over: Partial<WeatherDeps> = {}, route: (url: string) => { status: number; text: string } = ok) {
  const urls: string[] = []
  const d: WeatherDeps = {
    key: 'k',
    get: async (url) => {
      urls.push(url)
      return route(url)
    },
    now: () => NOW,
    ...over,
  }
  return { d, urls }
}

function ok(url: string): { status: number; text: string } {
  if (url.includes('getVilageFcst')) return { status: 200, text: kmaFcst(FCST_ROWS) }
  if (url.includes('getUltraSrtNcst')) return { status: 200, text: kmaNcst(NCST) }
  if (url.includes('getNearbyMsrstnList')) return { status: 200, text: NEARBY }
  if (url.includes('getMsrstnAcctoRltmMesureDnsty')) return { status: 200, text: measure() }
  return { status: 404, text: '' }
}

const post = (body: unknown) =>
  new Request('https://x/functions/v1/explore-weather', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) })

describe('explore-weather: 입력', () => {
  it('POST가 아니면 405, 숫자가 아니거나 한국 밖이면 400이고 아무것도 부르지 않는다', async () => {
    const { d, urls } = deps()
    expect((await handle(new Request('https://x/', { method: 'GET' }), d)).status).toBe(405)
    expect((await handle(post('x'), d)).status).toBe(400)
    expect((await handle(post({ lat: '37', lng: 127 }), d)).status).toBe(400)
    expect((await handle(post({ lat: 51.5, lng: -0.1 }), d)).status).toBe(400)
    expect(urls).toHaveLength(0)
  })

  it('위치는 소수 둘째 자리로 줄여 쓴다', async () => {
    const { d } = deps()
    const body = await (await handle(post({ lat: 37.41987, lng: 127.12654 }), d)).json()
    expect([body.lat, body.lng]).toEqual([37.42, 127.13])
  })

  it('키가 없으면 부르지 않고 not_configured', async () => {
    const { d, urls } = deps({ key: undefined })
    const body = await (await handle(post({ lat: 37.42, lng: 127.13 }), d)).json()
    expect(body.weather).toEqual({ status: 'not_configured' })
    expect(body.air).toEqual({ status: 'not_configured' })
    expect(urls).toHaveLength(0)
  })
})

describe('explore-weather: 응답', () => {
  it('날씨(실황·오늘·내일)와 가까운 측정소 미세먼지', async () => {
    const { d, urls } = deps()
    const body = await (await handle(post({ lat: 37.42, lng: 127.13 }), d)).json()
    expect(body.weather).toEqual({
      status: 'ok',
      now: { observedAt: '2026-10-28T10:00:00+09:00', temp: 12.3, humidity: 55, rain1h: 0, precip: '없음' },
      issuedAt: '2026-10-28T02:00:00+09:00',
      days: [
        { date: '2026-10-28', min: 6, max: 17, sky: '구름많음', rainChance: 30, precip: '없음' },
        { date: '2026-10-29', min: 8, max: 14, sky: '흐림', rainChance: 80, precip: '비' },
      ],
    })
    expect(body.air).toEqual({
      status: 'ok',
      station: { name: '정자동', addr: '경기 성남시 분당구 정자일로 80', distanceKm: 1.4 },
      measuredAt: '2026-10-28T11:00:00+09:00',
      pm10: { value: 35, grade: '보통' },
      pm25: { value: 18, grade: '보통' },
    })
    expect(urls.find((u) => u.includes('getVilageFcst'))).toContain('base_date=20261028&base_time=0200&nx=62&ny=124')
    expect(urls.find((u) => u.includes('getUltraSrtNcst'))).toContain('base_time=1000')
    expect(urls.find((u) => u.includes('getMsrstnAcctoRltmMesureDnsty'))).toContain(`stationName=${encodeURIComponent('정자동')}`)
    // 응답에 키를 싣지 않는다
    expect(JSON.stringify(body)).not.toContain('serviceKey')
  })

  it('활용신청 전이면 각각 not_registered', async () => {
    const { d } = deps({}, () => ({ status: 200, text: NOT_REGISTERED }))
    const body = await (await handle(post({ lat: 37.42, lng: 127.13 }), d)).json()
    expect(body.weather).toEqual({ status: 'not_registered' })
    expect(body.air).toEqual({ status: 'not_registered' })
  })

  it('미세먼지만 실패해도 날씨는 보인다. 측정값이 "-"면 null, 등급이 없으면 null(만들지 않는다)', async () => {
    const { d } = deps({}, (u) => (u.includes('getNearbyMsrstnList') ? { status: 500, text: '' } : ok(u)))
    const body = await (await handle(post({ lat: 37.42, lng: 127.13 }), d)).json()
    expect(body.weather.status).toBe('ok')
    expect(body.air).toEqual({ status: 'error', reason: 'http_500' })

    const { d: d2 } = deps({}, (u) => (u.includes('getMsrstnAcctoRltmMesureDnsty') ? { status: 200, text: measure({ pm10Value: '-', pm25Grade1h: '' }) } : ok(u)))
    const air = (await (await handle(post({ lat: 37.42, lng: 127.13 }), d2)).json()).air
    expect(air.pm10).toEqual({ value: null, grade: '보통' })
    expect(air.pm25).toEqual({ value: 18, grade: null })
  })

  it('실황만 실패하면 지금 칸만 비운다', async () => {
    const { d } = deps({}, (u) => (u.includes('getUltraSrtNcst') ? { status: 502, text: '' } : ok(u)))
    const body = await (await handle(post({ lat: 37.42, lng: 127.13 }), d)).json()
    expect(body.weather.status).toBe('ok')
    expect(body.weather.now).toBeNull()
    expect(body.weather.days).toHaveLength(2)
  })

  it('에어코리아 자정 "24:00"은 다음 날 00시', async () => {
    const { d } = deps({}, (u) => (u.includes('getMsrstnAcctoRltmMesureDnsty') ? { status: 200, text: measure({ dataTime: '2026-10-27 24:00' }) } : ok(u)))
    const air = (await (await handle(post({ lat: 37.42, lng: 127.13 }), d)).json()).air
    expect(air.measuredAt).toBe('2026-10-28T00:00:00+09:00')
  })
})
