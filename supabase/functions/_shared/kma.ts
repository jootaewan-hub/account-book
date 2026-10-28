// 기상청 단기예보 조회서비스(공공데이터포털 15084084, D-035): 위경도 → 격자, 발표 시각, 응답 읽기.
// Deno(Edge Function)와 Node(Vitest)가 함께 불러 외부 라이브러리를 쓰지 않는다. 숫자는 응답에 있는 값만 쓴다.
export const KMA_BASE = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0'

/** 기상청 동네예보 격자(람베르트 정각원추도법, 기상청 공개 변환식: 격자 5km, 표준위도 30·60, 기준점 126E 38N = 43, 136) */
export function toGrid(lat: number, lng: number): { nx: number; ny: number } {
  const DEG = Math.PI / 180
  const re = 6371.00877 / 5.0
  const slat1 = 30 * DEG
  const slat2 = 60 * DEG
  const olon = 126 * DEG
  const olat = 38 * DEG
  const q = (v: number) => Math.tan(Math.PI * 0.25 + v * 0.5)
  const sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(q(slat2) / q(slat1))
  const sf = (Math.pow(q(slat1), sn) * Math.cos(slat1)) / sn
  const ro = (re * sf) / Math.pow(q(olat), sn)
  const ra = (re * sf) / Math.pow(q(lat * DEG), sn)
  let theta = lng * DEG - olon
  if (theta > Math.PI) theta -= 2 * Math.PI
  if (theta < -Math.PI) theta += 2 * Math.PI
  theta *= sn
  return { nx: Math.floor(ra * Math.sin(theta) + 43 + 0.5), ny: Math.floor(ro - ra * Math.cos(theta) + 136 + 0.5) }
}

/** 한국 시각의 날짜·시각 조각 */
function kst(d: Date): { date: string; hh: number; mm: number } {
  const k = new Date(d.getTime() + 9 * 3600_000).toISOString()
  return { date: k.slice(0, 10), hh: Number(k.slice(11, 13)), mm: Number(k.slice(14, 16)) }
}
const ymd = (date: string) => date.replace(/-/g, '')

/** 초단기실황: 매시 정각 관측이 40분쯤 뒤 나온다 → 지금에서 40분 뺀 시각의 정시 */
export function ncstBase(now: Date): { baseDate: string; baseTime: string } {
  const k = kst(new Date(now.getTime() - 40 * 60_000))
  return { baseDate: ymd(k.date), baseTime: `${String(k.hh).padStart(2, '0')}00` }
}

/**
 * 단기예보: 오늘 02:00 발표(02:10쯤 나온다)를 받으면 오늘 03시부터 모레까지와 오늘·내일 최저(TMN)·최고(TMX)가 있다.
 * 02:10 전이면 어제 23:00 발표(오늘 00시부터)를 쓴다.
 */
export function fcstBase(now: Date): { baseDate: string; baseTime: string } {
  const k = kst(now)
  if (k.hh > 2 || (k.hh === 2 && k.mm >= 10)) return { baseDate: ymd(k.date), baseTime: '0200' }
  const y = kst(new Date(now.getTime() - 24 * 3600_000))
  return { baseDate: ymd(y.date), baseTime: '2300' }
}

export function kmaUrl(op: 'getUltraSrtNcst' | 'getVilageFcst', key: string, base: { baseDate: string; baseTime: string }, g: { nx: number; ny: number }): string {
  const k = key.trim()
  const enc = k.includes('%') ? k : encodeURIComponent(k)
  const rows = op === 'getVilageFcst' ? 1000 : 20
  return `${KMA_BASE}/${op}?serviceKey=${enc}&pageNo=1&numOfRows=${rows}&dataType=JSON&base_date=${base.baseDate}&base_time=${base.baseTime}&nx=${g.nx}&ny=${g.ny}`
}

export class KmaError extends Error {
  /** not_registered: 공공데이터포털 활용신청 전(등록되지 않은 키), 그 밖은 결과 코드 */
  code: string
  constructor(code: string) {
    super(code)
    this.name = 'KmaError'
    this.code = code
  }
}

type Item = { category: string; obsrValue?: string; fcstDate?: string; fcstTime?: string; fcstValue?: string; baseDate: string; baseTime: string }

/** 공공데이터포털 응답 본문 → items. 키가 등록 전이면 not_registered, 결과 코드가 00이 아니면 그 코드 */
export function kmaItems(text: string): Item[] {
  if (text.includes('SERVICE_KEY_IS_NOT_REGISTERED')) throw new KmaError('not_registered')
  let body: { response?: { header?: { resultCode?: string }; body?: { items?: { item?: Item[] } } } }
  try {
    body = JSON.parse(text)
  } catch {
    throw new KmaError('bad_response')
  }
  const code = body.response?.header?.resultCode
  if (code !== '00') throw new KmaError(code ? `result_${code}` : 'bad_response')
  return body.response?.body?.items?.item ?? []
}

const num = (v: string | undefined): number | null => {
  if (v === undefined || v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// 기상청 코드표(단기예보 조회서비스 활용가이드): 강수형태 PTY, 하늘상태 SKY
const PTY: Record<string, string> = { '0': '없음', '1': '비', '2': '비/눈', '3': '눈', '4': '소나기', '5': '빗방울', '6': '빗방울눈날림', '7': '눈날림' }
const SKY: Record<string, string> = { '1': '맑음', '3': '구름많음', '4': '흐림' }

export type WeatherNow = { observedAt: string; temp: number | null; humidity: number | null; rain1h: number | null; precip: string | null }
export type WeatherDay = { date: string; min: number | null; max: number | null; sky: string | null; rainChance: number | null; precip: string | null }

const iso = (date: string, time: string) => `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:00+09:00`

/** 초단기실황: 기온 T1H, 습도 REH, 1시간 강수량 RN1(mm), 강수형태 PTY */
export function readNow(items: Item[]): WeatherNow {
  const v = (c: string) => items.find((i) => i.category === c)?.obsrValue
  const first = items[0]
  if (!first) throw new KmaError('no_items')
  return {
    observedAt: iso(first.baseDate, first.baseTime),
    temp: num(v('T1H')),
    humidity: num(v('REH')),
    rain1h: num(v('RN1')),
    precip: PTY[v('PTY') ?? ''] ?? null,
  }
}

/**
 * 단기예보 → 날짜별 요약. 최저·최고는 TMN·TMX(없으면 null), 하늘은 12시 값(없으면 그날 첫 값),
 * 강수확률은 그날 가장 높은 POP, 강수형태는 그날 '없음'이 아닌 것 중 가장 많이 나온 것(없으면 '없음').
 */
export function readDays(items: Item[], dates: string[]): { issuedAt: string; days: WeatherDay[] } {
  const first = items[0]
  if (!first) throw new KmaError('no_items')
  const days = dates.map((date) => {
    const d = ymd(date)
    const of = (c: string) => items.filter((i) => i.category === c && i.fcstDate === d)
    const skyNoon = of('SKY').find((i) => i.fcstTime === '1200') ?? of('SKY')[0]
    const pops = of('POP').map((i) => num(i.fcstValue)).filter((n): n is number => n !== null)
    const counts = new Map<string, number>()
    for (const i of of('PTY')) if (i.fcstValue && i.fcstValue !== '0') counts.set(i.fcstValue, (counts.get(i.fcstValue) ?? 0) + 1)
    const top = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0]
    return {
      date,
      min: num(of('TMN')[0]?.fcstValue),
      max: num(of('TMX')[0]?.fcstValue),
      sky: SKY[skyNoon?.fcstValue ?? ''] ?? null,
      rainChance: pops.length ? Math.max(...pops) : null,
      precip: of('PTY').length ? (top ? PTY[top] ?? null : '없음') : null,
    }
  })
  return { issuedAt: iso(first.baseDate, first.baseTime), days }
}

/** 오늘·내일(한국 날짜) */
export function todayTomorrow(now: Date): string[] {
  return [kst(now).date, kst(new Date(now.getTime() + 24 * 3600_000)).date]
}
