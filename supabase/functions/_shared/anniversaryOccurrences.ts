import { lunarToSolar } from './lunar.ts'

/** 날짜 계산에 필요한 기념일 값. 달력과 예약 알림에서 함께 쓴다. */
export interface AnniversarySchedule {
  lunar: boolean
  month: number
  day: number
  repeat_unit?: 'year' | 'month'
  repeat_every?: number
  start_year?: number | null
}

const pad = (n: number) => String(n).padStart(2, '0')

/** 양력 y년 m월 d일. 그 달에 없는 날(2월 30일, 4월 31일)은 그 달 마지막 날로 본다 */
function solarDay(y: number, m: number, d: number): string {
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${y}-${pad(m)}-${pad(Math.min(d, last))}`
}

/** 시작 해부터 every년마다인 해인지. 시작 해가 없으면(해마다) 모든 해 */
const yearHits = (a: AnniversarySchedule, y: number) => {
  const every = a.repeat_every ?? 1
  if (a.start_year == null) return every === 1
  return y >= a.start_year && (y - a.start_year) % every === 0
}

/**
 * 양력 year년에 그 기념일이 오는 날짜들. 개월 반복은 시작 해 month월부터 every개월마다(양력),
 * 해 반복은 시작 해부터 every년마다(음력은 음력 해로 세고, 음력 표 2025~2037년이 있는 해만)
 */
export function occurrencesIn(a: AnniversarySchedule, year: number): string[] {
  if (a.repeat_unit === 'month') {
    if (a.start_year == null) return []
    const every = a.repeat_every ?? 1
    const out: string[] = []
    for (let m = 1; m <= 12; m++) {
      const diff = (year - a.start_year) * 12 + (m - a.month)
      if (diff >= 0 && diff % every === 0) out.push(solarDay(year, m, a.day))
    }
    return out
  }
  if (!a.lunar) return yearHits(a, year) ? [solarDay(year, a.month, a.day)] : []
  // 음력 y년의 날짜는 양력 y년이나 y+1년에 온다
  return [year - 1, year]
    .filter((ly) => yearHits(a, ly))
    .map((ly) => lunarToSolar(ly, a.month, a.day))
    .filter((d): d is string => d !== null && d.startsWith(`${year}-`))
}
