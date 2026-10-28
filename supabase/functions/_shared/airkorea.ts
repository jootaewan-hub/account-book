// 에어코리아(한국환경공단) 측정소정보 15073877·대기오염정보 15073861(D-035): 위경도 → TM, 가까운 측정소, 실시간 측정값.
// WGS84 → 에어코리아 TM(Bessel, 중부원점 38N 127E, 200000/500000) 변환은 NomaDamas/k-skill fine-dust-location(MIT,
// .claude/skills/fine-dust-location/scripts/fine_dust.py)의 식을 옮겼다. 등급은 에어코리아가 준 값만 쓴다(앱이 농도로 만들지 않는다).
export const AIR_STATION_BASE = 'https://apis.data.go.kr/B552584/MsrstnInfoInqireSvc'
export const AIR_MEASURE_BASE = 'https://apis.data.go.kr/B552584/ArpltnInforInqireSvc'

const WGS84_A = 6378137.0
const WGS84_F = 1 / 298.257223563
const BESSEL_A = 6377397.155
const BESSEL_F = 1 / 299.1528128
const TO_BESSEL = [146.43, -507.89, -681.46] as const
const LAT0 = (38 * Math.PI) / 180
const LON0 = (127 * Math.PI) / 180

function wgs84ToBessel(lat: number, lon: number): [number, number] {
  const [dx, dy, dz] = TO_BESSEL
  const se2 = 2 * WGS84_F - WGS84_F ** 2
  const te2 = 2 * BESSEL_F - BESSEL_F ** 2
  const la = (lat * Math.PI) / 180
  const lo = (lon * Math.PI) / 180
  const n = WGS84_A / Math.sqrt(1 - se2 * Math.sin(la) ** 2)
  const x = n * Math.cos(la) * Math.cos(lo) + dx
  const y = n * Math.cos(la) * Math.sin(lo) + dy
  const z = n * (1 - se2) * Math.sin(la) + dz
  const lonB = Math.atan2(y, x)
  const h = Math.sqrt(x * x + y * y)
  let latB = Math.atan2(z, h * (1 - te2))
  for (let k = 0; k < 8; k++) {
    const rn = BESSEL_A / Math.sqrt(1 - te2 * Math.sin(latB) ** 2)
    const next = Math.atan2(z + te2 * rn * Math.sin(latB), h)
    const done = Math.abs(next - latB) < 1e-14
    latB = next
    if (done) break
  }
  return [latB, lonB]
}

function meridionalArc(phi: number, a: number, e2: number): number {
  return a * (
    (1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * phi
    - ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * phi)
    + ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * phi)
    - ((35 * e2 ** 3) / 3072) * Math.sin(6 * phi)
  )
}

/** 에어코리아 근접측정소 목록(getNearbyMsrstnList)이 받는 TM 좌표 */
export function toAirKoreaTm(lat: number, lon: number): { tmX: number; tmY: number } {
  const [la, lo] = wgs84ToBessel(lat, lon)
  const e2 = 2 * BESSEL_F - BESSEL_F ** 2
  const ep2 = e2 / (1 - e2)
  const n = BESSEL_A / Math.sqrt(1 - e2 * Math.sin(la) ** 2)
  const t = Math.tan(la) ** 2
  const c = ep2 * Math.cos(la) ** 2
  const A = (lo - LON0) * Math.cos(la)
  const m = meridionalArc(la, BESSEL_A, e2) - meridionalArc(LAT0, BESSEL_A, e2)
  const tmX = 200000 + n * (A + ((1 - t + c) * A ** 3) / 6 + ((5 - 18 * t + t ** 2 + 72 * c - 58 * ep2) * A ** 5) / 120)
  const tmY = 500000 + m + n * Math.tan(la) * (A ** 2 / 2 + ((5 - t + 9 * c + 4 * c ** 2) * A ** 4) / 24 + ((61 - 58 * t + t ** 2 + 600 * c - 330 * ep2) * A ** 6) / 720)
  return { tmX, tmY }
}

const enc = (key: string) => {
  const k = key.trim()
  return k.includes('%') ? k : encodeURIComponent(k)
}

export function nearbyUrl(key: string, tm: { tmX: number; tmY: number }): string {
  return `${AIR_STATION_BASE}/getNearbyMsrstnList?serviceKey=${enc(key)}&returnType=json&tmX=${tm.tmX.toFixed(3)}&tmY=${tm.tmY.toFixed(3)}&ver=1.1`
}

export function measureUrl(key: string, station: string): string {
  return `${AIR_MEASURE_BASE}/getMsrstnAcctoRltmMesureDnsty?serviceKey=${enc(key)}&returnType=json&numOfRows=1&pageNo=1&stationName=${encodeURIComponent(station)}&dataTerm=DAILY&ver=1.3`
}

export class AirError extends Error {
  /** not_registered: 공공데이터포털 활용신청 전(등록되지 않은 키), 그 밖은 결과 코드 */
  code: string
  constructor(code: string) {
    super(code)
    this.name = 'AirError'
    this.code = code
  }
}

function airItems<T>(text: string): T[] {
  if (text.includes('SERVICE_KEY_IS_NOT_REGISTERED')) throw new AirError('not_registered')
  let body: { response?: { header?: { resultCode?: string }; body?: { items?: T[] } } }
  try {
    body = JSON.parse(text)
  } catch {
    throw new AirError('bad_response')
  }
  const code = body.response?.header?.resultCode
  if (code !== '00') throw new AirError(code ? `result_${code}` : 'bad_response')
  return body.response?.body?.items ?? []
}

export type Station = { name: string; addr: string | null; distanceKm: number | null }

/** 근접측정소 목록의 첫 측정소(가까운 순서로 온다) */
export function readNearest(text: string): Station {
  const s = airItems<{ stationName?: string; addr?: string; tm?: number | string }>(text)[0]
  if (!s?.stationName) throw new AirError('no_station')
  const d = s.tm === undefined || s.tm === '' ? null : Number(s.tm)
  return { name: s.stationName, addr: s.addr ?? null, distanceKm: d !== null && Number.isFinite(d) ? d : null }
}

const GRADE: Record<string, string> = { '1': '좋음', '2': '보통', '3': '나쁨', '4': '매우나쁨' }

export type AirValue = { value: number | null; grade: string | null }
export type AirNow = { measuredAt: string | null; pm10: AirValue; pm25: AirValue }

const val = (v: string | undefined): number | null => (v === undefined || v === '' || v === '-' ? null : Number.isFinite(Number(v)) ? Number(v) : null)

/** 측정소별 실시간 측정(ver 1.3): 1시간 농도 pm10Value·pm25Value와 1시간 등급 pm10Grade1h·pm25Grade1h. 측정 시각은 "YYYY-MM-DD HH:mm"(한국 시각) */
export function readMeasure(text: string): AirNow {
  const m = airItems<Record<string, string | undefined>>(text)[0]
  if (!m) throw new AirError('no_measure')
  const t = m.dataTime?.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})$/)
  // 에어코리아는 자정을 "24:00"으로 쓰기도 한다 → 그날 24시 그대로 두지 않고 다음 날 00시로
  let measuredAt: string | null = null
  if (t) {
    const date = t[2] === '24' ? new Date(Date.parse(`${t[1]}T00:00:00Z`) + 24 * 3600_000).toISOString().slice(0, 10) : t[1]
    measuredAt = `${date}T${t[2] === '24' ? '00' : t[2]}:${t[3]}:00+09:00`
  }
  return {
    measuredAt,
    pm10: { value: val(m.pm10Value), grade: GRADE[m.pm10Grade1h ?? ''] ?? null },
    pm25: { value: val(m.pm25Value), grade: GRADE[m.pm25Grade1h ?? ''] ?? null },
  }
}
