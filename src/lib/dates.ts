// 날짜는 모두 'YYYY-MM-DD' 문자열(기기 현지 시간 기준)로 다룬다. 월은 'YYYY-MM'.
export const DOW = ['일', '월', '화', '수', '목', '금', '토'] as const

const pad = (n: number) => String(n).padStart(2, '0')

export function ymd(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`
}

export function todayLocal(now: Date = new Date()): string {
  return ymd(now.getFullYear(), now.getMonth() + 1, now.getDate())
}

export function parseYM(ym: string): { y: number; m: number } {
  const [y, m] = ym.split('-').map(Number)
  return { y, m }
}

export function addMonths(ym: string, n: number): string {
  const { y, m } = parseYM(ym)
  const idx = y * 12 + (m - 1) + n
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`
}

export function daysInMonth(ym: string): number {
  const { y, m } = parseYM(ym)
  return new Date(y, m, 0).getDate()
}

export function monthRange(ym: string): { start: string; end: string } {
  return { start: `${ym}-01`, end: `${ym}-${pad(daysInMonth(ym))}` }
}

export function dowOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).getDay()
}

export function dayOf(date: string): number {
  return Number(date.slice(8, 10))
}

/** 달력 칸: 일요일 시작, 앞뒤 빈칸은 null */
export function monthGrid(ym: string): (string | null)[] {
  const { y, m } = parseYM(ym)
  const lead = new Date(y, m - 1, 1).getDay()
  const days = daysInMonth(ym)
  const cells: (string | null)[] = Array(lead).fill(null)
  for (let d = 1; d <= days; d++) cells.push(ymd(y, m, d))
  while (cells.length % 7) cells.push(null)
  return cells
}

export function formatDateLong(date: string): string {
  const [, m, d] = date.split('-').map(Number)
  return `${m}월 ${d}일 ${DOW[dowOf(date)]}요일`
}
