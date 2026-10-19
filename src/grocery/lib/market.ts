// 농수산물 시세(D-012) 화면 규칙. 숫자는 조사값 그대로만 쓴다(평균·비율을 화면에 내지 않는다).
// 비교는 같은 조사처의 이전 조사값과 그 날짜를 나란히 쓰고, 차이(원)와 방향 기호를 함께 쓴다(DESIGN 시세 등락).
import { marketItem, matchMarket, type MarketMatch } from '../../../supabase/functions/_shared/market'
import { koDay, koFullDay } from './alerts'
import { won } from './format'

export type DatedPrice = { on: string; price: number }

/** grocery.market_board()의 한 줄 */
export type MarketSeries = {
  item: string
  vrty: string
  grd: string
  ctgry: string
  itemNm: string
  vrtyNm: string
  grdNm: string
  unit: string
  unitSz: string
  sgg: string
  sggNm: string
  mrkt: string
  mrktNm: string
  cur: DatedPrice
  prev: DatedPrice | null
  w1: DatedPrice | null
  m1: DatedPrice | null
  y1: DatedPrice | null
  /** 그날 성남·수원·서울 조사처들의 최저·최고와 그 수(축산물은 null·0) */
  low: number | null
  high: number | null
  markets: number
  firstOn: string
  /** 최근 45일 안의 조사일 수 */
  days: number
  fetchedAt: string
}

export type MarketBoard = {
  series: MarketSeries[]
  /** 시세를 마지막으로 받은 시각(성공한 수집). 한 번도 없으면 null */
  syncedAt: string | null
}

export type SeriesKey = Pick<MarketSeries, 'item' | 'vrty' | 'grd'>
export type TrendPoint = { on: string; price: number | null; low: number | null; high: number | null; markets: number }
export type NearbyPrice = { sggNm: string; mrktNm: string; mrkt: string; price: number }

export const keyOf = (s: SeriesKey) => `${s.item}|${s.vrty}|${s.grd}`
export const sameKey = (a: SeriesKey, b: SeriesKey) => a.item === b.item && a.vrty === b.vrty && a.grd === b.grd

/** 시리즈 이름: 품종 이름이 품목 이름을 품고 있으면 품종만(대파, 쪽파), 같으면 품목만(양파), 아니면 둘 다(사과 홍로, 돼지 삼겹살) */
export function seriesName(s: Pick<MarketSeries, 'item' | 'itemNm' | 'vrtyNm'>): string {
  const item = s.itemNm || marketItem(s.item)?.label || s.item
  const v = s.vrtyNm.trim()
  if (!v || v === item) return item
  if (v.includes(item)) return v
  return `${item} ${v}`
}

/** 등급 글자: 등급이 없거나('-') 품종과 같으면(돼지 부위) 빈 글자 */
export function gradeText(s: Pick<MarketSeries, 'grdNm' | 'vrtyNm'>): string {
  const g = s.grdNm.trim()
  return !g || g === '-' || g === s.vrtyNm.trim() ? '' : g
}

/** 단위: "1kg", "10개", "100g" */
export const unitOf = (s: Pick<MarketSeries, 'unit' | 'unitSz'>) => `${s.unitSz}${s.unit}`

/** 조사처: "성남 B-유통", 축산물은 "전국" */
export function whereOf(s: Pick<MarketSeries, 'sgg' | 'sggNm' | 'mrktNm'>): string {
  if (s.sgg === '1000') return '전국'
  return [s.sggNm, s.mrktNm].filter(Boolean).join(' ')
}

export type Change = { dir: 'up' | 'down' | 'same'; diff: number }

/** 지금 값과 이전 값의 차이(원). 이전 값이 없으면 null */
export function change(cur: DatedPrice, past: DatedPrice | null): Change | null {
  if (!past) return null
  const diff = cur.price - past.price
  return { dir: diff > 0 ? 'up' : diff < 0 ? 'down' : 'same', diff: Math.abs(diff) }
}

/** "▲ 100원", "▼ 100원", "변동 없음", 비교할 값이 없으면 "확인 못 함" */
export function changeText(c: Change | null): string {
  if (!c) return '확인 못 함'
  if (c.dir === 'same') return '변동 없음'
  return `${c.dir === 'up' ? '▲' : '▼'} ${won(c.diff)}`
}

/** 날짜 글자: 기준 날짜와 연도가 같으면 "10월 16일", 다르면 "2025년 10월 16일"(1년 전 값이 올해로 읽히지 않게) */
export function dayText(on: string, ref: string): string {
  return on.slice(0, 4) === ref.slice(0, 4) ? koDay(on) : koFullDay(on)
}

export type Period = 'w1' | 'm1' | 'y1'
export const PERIOD_LABEL: Record<Period, string> = { w1: '1주 전', m1: '1개월 전', y1: '1년 전' }

/** 비교 한 줄: "1주 전(10월 8일) 2,060원" */
export function pastText(period: Period | 'prev', p: DatedPrice | null): string {
  const label = period === 'prev' ? '이전 조사일' : PERIOD_LABEL[period]
  return p ? `${label}(${koFullDay(p.on)}) ${won(p.price)}` : `${label} 확인 못 함`
}

/** 주변 범위: "서울·수원·성남 12곳 1,990~4,780원". 조사처가 하나뿐이거나 축산물이면 null */
export function rangeText(s: Pick<MarketSeries, 'sgg' | 'low' | 'high' | 'markets'>): string | null {
  // 축산물(전국 값)은 조사처 범위가 없다. 예전에 저장된 지역 행이 있어도 쓰지 않는다
  if (s.sgg === '1000' || s.low === null || s.high === null || s.markets < 2) return null
  return `서울·수원·성남 ${s.markets}곳 ${s.low === s.high ? won(s.low) : `${won(s.low).replace('원', '')}~${won(s.high)}`}`
}

/** 기록 기간: "9월 9일부터, 최근 45일 중 24일 조사" */
export function recordText(s: Pick<MarketSeries, 'firstOn' | 'days' | 'cur'>): string {
  return `${dayText(s.firstOn, s.cur.on)}부터 기록, 최근 45일 중 ${s.days}일 조사`
}

/**
 * 장보기 품목 → 시세판에서 보여 줄 시리즈.
 * 같은 품목 중 품종이 정해졌으면 그 품종, 아니면 품목 기본 품종 → 아무 품종. 등급은 '상품'(04) → 코드 순.
 */
export function pickSeries(series: MarketSeries[], m: MarketMatch | null): MarketSeries | null {
  if (!m) return null
  const same = series.filter((s) => s.item === m.item)
  const wanted = m.vrty ?? marketItem(m.item)?.defaultVrty ?? null
  let pool = wanted ? same.filter((s) => s.vrty === wanted) : []
  // 이름으로 품종을 정했는데(쪽파) 그 값이 없으면 다른 품종(대파)으로 바꾸지 않는다
  if (pool.length === 0) pool = m.vrty ? [] : same
  const order = (s: MarketSeries) => [s.grd === '04' ? 0 : 1, s.vrty, s.grd] as const
  return [...pool].sort((a, b) => {
    const x = order(a)
    const y = order(b)
    return x[0] - y[0] || x[1].localeCompare(y[1]) || x[2].localeCompare(y[2])
  })[0] ?? null
}

/** 장보기 품목 이름·용량으로 시리즈 찾기 */
export function seriesForItem(series: MarketSeries[], name: string, spec: string | null): MarketSeries | null {
  return pickSeries(series, matchMarket(name, spec))
}

/** 같은 품목의 다른 품종·등급(상세에서 바꿔 보기) */
export function siblings(series: MarketSeries[], s: SeriesKey): MarketSeries[] {
  return series.filter((x) => x.item === s.item).sort((a, b) => a.vrty.localeCompare(b.vrty) || a.grd.localeCompare(b.grd))
}

export type Mover = { s: MarketSeries; past: DatedPrice; c: Change }

/**
 * 이번 주 움직임: 비교 값이 있는 시리즈 중 많이 내린 것·많이 오른 것 n개씩.
 * 순서는 변동 비율로 정하지만 화면에는 비율을 쓰지 않는다(이전 값 → 지금 값과 차이만).
 * 같은 품목·품종은 한 줄만(등급이 여럿이면 순위가 높은 것).
 */
export function movers(series: MarketSeries[], period: Period, n = 5): { down: Mover[]; up: Mover[] } {
  const all: (Mover & { r: number })[] = []
  for (const s of series) {
    const past = s[period]
    const c = change(s.cur, past)
    if (!past || !c || c.dir === 'same') continue
    all.push({ s, past, c, r: (s.cur.price - past.price) / past.price })
  }
  const pick = (list: (Mover & { r: number })[]) => {
    const seen = new Set<string>()
    const out: Mover[] = []
    for (const m of list) {
      const k = `${m.s.item}|${m.s.vrty}`
      if (seen.has(k)) continue
      seen.add(k)
      out.push({ s: m.s, past: m.past, c: m.c })
      if (out.length === n) break
    }
    return out
  }
  return {
    down: pick(all.filter((m) => m.r < 0).sort((a, b) => a.r - b.r)),
    up: pick(all.filter((m) => m.r > 0).sort((a, b) => b.r - a.r)),
  }
}

/** 목록 줄의 시세 칸 */
export type RowQuote = { price: string; unit: string; note: string }
export function rowQuote(s: MarketSeries): RowQuote {
  return { price: won(s.cur.price), unit: unitOf(s), note: `${s.sgg === '1000' ? '전국' : s.sggNm} ${koDay(s.cur.on)}` }
}

/** 시세판 맨 위 한 줄: "KAMIS 소매가격(공공데이터포털), 10월 17일 07:10 받음" */
export function boardSource(syncedAt: string | null, now: Date = new Date()): string {
  if (!syncedAt) return 'KAMIS 소매가격(공공데이터포털), 아직 받지 못했어요'
  const k = new Date(Date.parse(syncedAt) + 9 * 3600_000)
  const hm = `${String(k.getUTCHours()).padStart(2, '0')}:${String(k.getUTCMinutes()).padStart(2, '0')}`
  const today = new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10)
  const d = k.toISOString().slice(0, 10) === today ? '오늘' : koDay(syncedAt)
  return `KAMIS 소매가격(공공데이터포털), ${d} ${hm} 받음`
}

/** 시세판의 가장 늦은 조사일 */
export function latestOn(series: MarketSeries[]): string | null {
  return series.reduce<string | null>((m, s) => (m && m > s.cur.on ? m : s.cur.on), null)
}
