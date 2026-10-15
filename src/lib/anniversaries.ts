// 기념일(양력·음력)을 해마다 양력 날짜로 바꿔 달력과 D-day에 쓴다.
import { lunarToSolar } from './lunar'
import type { AnnivKind, Anniversary } from './types'

export const ANNIV_KIND_LABEL: Record<AnnivKind, string> = { birthday: '생일', couple: '우리 둘', memorial: '추모', other: '그 밖' }
export const ANNIV_KINDS: AnnivKind[] = ['birthday', 'couple', 'memorial', 'other']

type When = Pick<Anniversary, 'lunar' | 'month' | 'day'>

const pad = (n: number) => String(n).padStart(2, '0')

/** 양력 y년 m월 d일. 평년의 2월 29일은 2월 28일로 본다 */
function solarDay(y: number, m: number, d: number): string {
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${y}-${pad(m)}-${pad(Math.min(d, last))}`
}

/** 양력 year년에 그 기념일이 오는 날짜. 음력은 음력 표(2025~2037년)가 있는 해만 계산한다 */
export function occurrencesIn(a: When, year: number): string[] {
  if (!a.lunar) return [solarDay(year, a.month, a.day)]
  // 음력 y년의 날짜는 양력 y년이나 y+1년에 온다
  return [year - 1, year]
    .map((ly) => lunarToSolar(ly, a.month, a.day))
    .filter((d): d is string => d !== null && d.startsWith(`${year}-`))
}

/** 그 달(YYYY-MM)의 날짜별 기념일 */
export function anniversariesInMonth<T extends When>(list: T[], ym: string): Map<string, T[]> {
  const year = Number(ym.slice(0, 4))
  const map = new Map<string, T[]>()
  for (const a of list) {
    for (const d of occurrencesIn(a, year)) if (d.startsWith(ym)) map.set(d, [...(map.get(d) ?? []), a])
  }
  return map
}

/** 오늘이나 그 뒤로 가장 가까운 날 (음력 표 밖이면 null) */
export function nextOccurrence(a: When, today: string): string | null {
  const y = Number(today.slice(0, 4))
  for (const year of [y, y + 1, y + 2]) {
    const d = occurrencesIn(a, year).find((x) => x >= today)
    if (d) return d
  }
  return null
}

export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000)

export interface Upcoming<T> { a: T; date: string; days: number }

/** 가까운 순서로. 날짜를 알 수 없는 음력 기념일은 뺀다 */
export function upcomingAnniversaries<T extends When & { name: string }>(list: T[], today: string): Upcoming<T>[] {
  return list
    .flatMap((a) => {
      const date = nextOccurrence(a, today)
      return date ? [{ a, date, days: daysBetween(today, date) }] : []
    })
    .sort((x, y) => x.days - y.days || x.a.name.localeCompare(y.a.name))
}

export const dLabel = (days: number) => (days === 0 ? '오늘' : `D-${days}`)

/** "음력 9월 13일", "10월 18일" */
export const annivDateLabel = (a: When) => `${a.lunar ? '음력 ' : ''}${a.month}월 ${a.day}일`
