// 주유 기록 계산(설계 2026-10-21 fuel-and-grocery-compare 3-1). 숫자는 영수증에서 읽은 리터·단가와 그 합·차이뿐이다.
// 연비(100km당)는 주행거리를 모르므로 계산하지 않는다.
import { won } from './format'
import { pctChange } from './stats'
import type { FuelFill, TxFuel } from './types'

/** 최근 날짜 먼저. 같은 날은 들어온 순서 그대로 */
export function sortFills(fills: FuelFill[]): FuelFill[] {
  return [...fills].sort((a, b) => (a.occurred_on < b.occurred_on ? 1 : a.occurred_on > b.occurred_on ? -1 : 0))
}

/** 유종을 견줄 때만 쓰는 이름: 고급휘발유·휘발유·경유·LPG, 그 밖은 적힌 대로. 저장은 영수증 표기 그대로 둔다 */
export function fuelKind(type: string | null | undefined): string | null {
  const t = (type ?? '').trim()
  if (!t) return null
  const n = t.replace(/\s+/g, '').toLowerCase()
  if (n.includes('고급')) return '고급휘발유'
  if (n.includes('휘발유') || n.includes('가솔린') || n.includes('gasoline')) return '휘발유'
  if (n.includes('경유') || n.includes('디젤') || n.includes('diesel')) return '경유'
  if (n.includes('lpg') || n.includes('부탄') || n.includes('프로판')) return 'LPG'
  return t
}

export interface FuelDelta {
  latest: FuelFill
  /** 같은 유종의 바로 앞 주유. 없으면 null */
  prev: FuelFill | null
  /** 리터당 가격 차이(원). prev가 없으면 null */
  diff: number | null
  pct: number | null
}

/** 가장 최근 주유와 같은 유종의 지난 주유를 견준다. 기록이 없으면 null */
export function fuelDelta(fills: FuelFill[]): FuelDelta | null {
  const sorted = sortFills(fills)
  const latest = sorted[0]
  if (!latest) return null
  const kind = fuelKind(latest.fuel_type)
  const prev = sorted.slice(1).find((f) => fuelKind(f.fuel_type) === kind) ?? null
  if (!prev) return { latest, prev: null, diff: null, pct: null }
  return { latest, prev, diff: latest.price_per_liter - prev.price_per_liter, pct: pctChange(latest.price_per_liter, prev.price_per_liter) }
}

export interface FuelMonth {
  ym: string
  count: number
  liters: number
  amount: number
}

const round3 = (n: number) => Math.round(n * 1000) / 1000

/** 한 달의 주유 횟수·리터·금액 */
export function fuelMonth(fills: FuelFill[], ym: string): FuelMonth {
  const m = fills.filter((f) => f.occurred_on.startsWith(ym))
  return { ym, count: m.length, liters: round3(m.reduce((s, f) => s + f.liters, 0)), amount: m.reduce((s, f) => s + f.amount, 0) }
}

const dayNumber = (date: string) => Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000)

/** 최근 n번 주유의 이웃 날짜 간격 평균(일, 반올림). 2번 미만이면 null */
export function fuelInterval(fills: FuelFill[], n = 6): number | null {
  const recent = sortFills(fills).slice(0, n)
  if (recent.length < 2) return null
  const gaps = recent.slice(1).map((f, i) => dayNumber(recent[i].occurred_on) - dayNumber(f.occurred_on))
  return Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length)
}

/** 추이 그래프용: 최근 n번을 오래된 것부터 */
export function fuelTrend(fills: FuelFill[], n = 12): FuelFill[] {
  return sortFills(fills).slice(0, n).reverse()
}

/** '35.2L', '30L'. 소수 둘째 자리까지 */
export function litersText(l: number): string {
  return `${(Math.round(l * 100) / 100).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}L`
}

/** '휘발유 35.2L, 1,652원/L' (유종이 없으면 생략). 내역 행·수정 시트에 쓴다 */
export function fuelText(f: TxFuel): string {
  const type = f.fuel_type?.trim()
  return `${type ? `${type} ` : ''}${litersText(f.liters)}, ${won(f.price_per_liter)}원/L`
}

const md = (date: string) => `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일`

/** '10월 18일, 휘발유 35.2L, 1,652원/L, 58,150원' */
export function fillLine(f: FuelFill): string {
  return `${md(f.occurred_on)}, ${fuelText(f)}, ${won(f.amount)}원`
}
