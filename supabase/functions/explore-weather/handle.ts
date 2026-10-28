// 알아보기 탭 날씨·미세먼지(D-035): 위치(소수 둘째 자리)로 기상청 초단기실황·단기예보와 에어코리아 가까운 측정소 실시간 값을 받는다.
// 키(DATA_GO_KR_SERVICE_KEY)는 서버에만 있고 응답·오류 문구에 싣지 않는다. 날씨와 미세먼지는 따로 실패할 수 있다.
// 가구 데이터를 읽거나 쓰지 않는다. Deno 전용 API를 쓰지 않아 Vitest로 시험한다.
import { AirError, measureUrl, nearbyUrl, readMeasure, readNearest, toAirKoreaTm, type AirNow, type Station } from '../_shared/airkorea.ts'
import { fcstBase, KmaError, kmaItems, kmaUrl, ncstBase, readDays, readNow, todayTomorrow, toGrid, type WeatherDay, type WeatherNow } from '../_shared/kma.ts'

export type WeatherDeps = {
  /** 공공데이터포털 키(없으면 not_configured) */
  key: string | undefined
  get(url: string): Promise<{ status: number; text: string }>
  now(): Date
}

export type Failed = { status: 'not_registered' | 'not_configured' | 'error'; reason?: string }
export type WeatherPart = { status: 'ok'; now: WeatherNow | null; issuedAt: string; days: WeatherDay[] } | Failed
export type AirPart = { status: 'ok'; station: Station } & AirNow | Failed

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })

const round2 = (v: number) => Math.round(v * 100) / 100

function failOf(e: unknown): Failed {
  const code = e instanceof KmaError || e instanceof AirError ? e.code : 'network_error'
  return code === 'not_registered' ? { status: 'not_registered' } : { status: 'error', reason: code }
}

async function text(deps: WeatherDeps, url: string): Promise<string> {
  const res = await deps.get(url)
  // 키가 등록 전이면 공공데이터포털이 200이 아닌 코드와 함께 SERVICE_KEY 문구를 주기도 한다 → 본문을 먼저 본다
  if (res.text.includes('SERVICE_KEY_IS_NOT_REGISTERED')) return res.text
  if (res.status !== 200) throw new KmaError(`http_${res.status}`)
  return res.text
}

async function weather(deps: WeatherDeps, key: string, lat: number, lng: number): Promise<WeatherPart> {
  const now = deps.now()
  const grid = toGrid(lat, lng)
  try {
    // 예보가 본체다. 실황만 실패하면 지금 칸만 비운다
    const [fcst, ncst] = await Promise.all([
      text(deps, kmaUrl('getVilageFcst', key, fcstBase(now), grid)).then(kmaItems),
      text(deps, kmaUrl('getUltraSrtNcst', key, ncstBase(now), grid)).then(kmaItems).then(readNow).catch((e) => {
        if (e instanceof KmaError && e.code === 'not_registered') throw e
        return null
      }),
    ])
    const { issuedAt, days } = readDays(fcst, todayTomorrow(now))
    return { status: 'ok', now: ncst, issuedAt, days }
  } catch (e) {
    return failOf(e)
  }
}

async function air(deps: WeatherDeps, key: string, lat: number, lng: number): Promise<AirPart> {
  try {
    const station = readNearest(await text(deps, nearbyUrl(key, toAirKoreaTm(lat, lng))))
    const m = readMeasure(await text(deps, measureUrl(key, station.name)))
    return { status: 'ok', station, ...m }
  } catch (e) {
    return failOf(e)
  }
}

export async function handle(req: Request, deps: WeatherDeps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  let body: { lat?: unknown; lng?: unknown }
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'bad_request' })
  }
  const lat = typeof body?.lat === 'number' ? round2(body.lat) : NaN
  const lng = typeof body?.lng === 'number' ? round2(body.lng) : NaN
  // 한국(기상청 격자·에어코리아 측정소가 있는 범위)만
  if (!(lat >= 32.5 && lat <= 39 && lng >= 124 && lng <= 132.5)) return json(400, { error: 'bad_request' })
  const key = deps.key?.trim()
  if (!key) return json(200, { lat, lng, weather: { status: 'not_configured' }, air: { status: 'not_configured' } })
  const [w, a] = await Promise.all([weather(deps, key, lat, lng), air(deps, key, lat, lng)])
  return json(200, { lat, lng, weather: w, air: a })
}
