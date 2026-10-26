// 기념일(양력·음력)을 양력 날짜로 바꿔 달력과 D-day에 쓴다. 해마다만이 아니라 N년마다·N개월마다도 된다(D-033).
import { lunarToSolar } from './lunar'
import type { AnnivKind, Anniversary, AnniversaryInput } from './types'

/** 카테고리를 고를 때 보이는 기본 말. 가구에서 이미 쓴 카테고리가 앞에 온다 */
export const ANNIV_CATEGORY_DEFAULTS = ['생일', '기념일', '추모', '명절', '병원', '갱신']

type When = Pick<Anniversary, 'lunar' | 'month' | 'day'> & Partial<Pick<Anniversary, 'repeat_unit' | 'repeat_every' | 'start_year'>>

const pad = (n: number) => String(n).padStart(2, '0')

/** 양력 y년 m월 d일. 그 달에 없는 날(2월 30일, 4월 31일)은 그 달 마지막 날로 본다 */
function solarDay(y: number, m: number, d: number): string {
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${y}-${pad(m)}-${pad(Math.min(d, last))}`
}

/** 시작 해부터 every년마다인 해인지. 시작 해가 없으면(해마다) 모든 해 */
const yearHits = (a: When, y: number) => {
  const every = a.repeat_every ?? 1
  if (a.start_year == null) return every === 1
  return y >= a.start_year && (y - a.start_year) % every === 0
}

/**
 * 양력 year년에 그 기념일이 오는 날짜들. 개월 반복은 시작 해 month월부터 every개월마다(양력),
 * 해 반복은 시작 해부터 every년마다(음력은 음력 해로 세고, 음력 표 2025~2037년이 있는 해만)
 */
export function occurrencesIn(a: When, year: number): string[] {
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

/** 그 달(YYYY-MM)의 날짜별 기념일 */
export function anniversariesInMonth<T extends When>(list: T[], ym: string): Map<string, T[]> {
  const year = Number(ym.slice(0, 4))
  const map = new Map<string, T[]>()
  for (const a of list) {
    for (const d of occurrencesIn(a, year)) if (d.startsWith(ym)) map.set(d, [...(map.get(d) ?? []), a])
  }
  return map
}

/** 오늘이나 그 뒤로 가장 가까운 날 (음력 표 밖이면 null). N년마다는 N년 뒤까지 찾는다 */
export function nextOccurrence(a: When, today: string): string | null {
  const y = Number(today.slice(0, 4))
  const every = a.repeat_every ?? 1
  const span = a.repeat_unit === 'month' ? Math.ceil(every / 12) + 1 : Math.max(2, every)
  for (let year = y; year <= y + span; year++) {
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

/** 반복 말: 해마다, 2년마다, 매달, 3개월마다 */
export function repeatLabel(a: Pick<When, 'repeat_unit' | 'repeat_every'>): string {
  const every = a.repeat_every ?? 1
  if (a.repeat_unit === 'month') return every === 1 ? '매달' : `${every}개월마다`
  return every === 1 ? '해마다' : `${every}년마다`
}

/** "음력 9월 13일", "10월 18일", "2년마다 10월 18일", "매달 18일", "3개월마다 18일" */
export function annivDateLabel(a: When): string {
  const md = a.repeat_unit === 'month' ? `${a.day}일` : `${a.lunar ? '음력 ' : ''}${a.month}월 ${a.day}일`
  const every = a.repeat_every ?? 1
  return a.repeat_unit === 'month' || every > 1 ? `${repeatLabel(a)} ${md}` : md
}

/** 카테고리(없으면 이름)의 말로 아이콘 종류를 정한다: 생일 케이크, 추모 초, 우리 둘 하트, 그 밖 별 */
export function annivKindOf(category: string | null, name: string): AnnivKind {
  for (const s of [category ?? '', name]) {
    if (/생일|생신|탄생|돌잔치|백일/.test(s)) return 'birthday'
    if (/추모|기일|제사|추도|별세|기제/.test(s)) return 'memorial'
    if (/기념|결혼|연애|만난|우리|사랑|커플|데이트|프러포즈|약혼/.test(s)) return 'couple'
  }
  return 'other'
}

/** 고를 수 있는 카테고리: 가구에서 이미 쓴 것(많이 쓴 순서) 뒤에 기본 말 */
export function annivCategories(list: Pick<Anniversary, 'category'>[]): string[] {
  const count = new Map<string, number>()
  for (const a of list) if (a.category) count.set(a.category, (count.get(a.category) ?? 0) + 1)
  const used = [...count].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).map(([c]) => c)
  return [...used, ...ANNIV_CATEGORY_DEFAULTS.filter((c) => !count.has(c))]
}

/** 저장한 기념일을 고치기 폼 값으로(모든 칸을 옮겨 반복이 풀리지 않게 한다) */
export function annivInput(a: Anniversary): AnniversaryInput {
  return {
    name: a.name, kind: a.kind, category: a.category, lunar: a.lunar, month: a.month, day: a.day,
    repeat_unit: a.repeat_unit, repeat_every: a.repeat_every, start_year: a.start_year,
  }
}

/** 새 기념일 폼 값: 해마다, 그 날짜(없으면 1월 1일)의 월·일, 시작 해는 그 날짜의 해 */
export function newAnnivInput(date?: string, monthDay?: Pick<AnniversaryInput, 'month' | 'day'>): AnniversaryInput {
  const md = monthDay ?? (date ? { month: Number(date.slice(5, 7)), day: Number(date.slice(8, 10)) } : { month: 1, day: 1 })
  return {
    name: '', kind: 'other', category: null, lunar: false, ...md,
    repeat_unit: 'year', repeat_every: 1, start_year: date ? Number(date.slice(0, 4)) : null,
  }
}

/**
 * 저장할 값으로 다듬기: 카테고리 앞뒤 빈칸을 지우고(빈 말은 null), 아이콘 종류를 카테고리로 정하고,
 * 해마다(1년)는 시작 해를 두지 않아 지난 해 달력에도 보이게 한다. 개월 반복은 양력만이고 시작 해가 꼭 있다
 */
export function finishAnnivInput(v: AnniversaryInput, thisYear: number): AnniversaryInput {
  const category = v.category?.trim().slice(0, 12) || null
  const every = Math.min(100, Math.max(1, Math.round(v.repeat_every) || 1))
  const month = v.repeat_unit === 'month'
  const needsStart = month || every > 1
  return {
    ...v, name: v.name.trim(), category, kind: annivKindOf(category, v.name), repeat_every: every,
    lunar: month ? false : v.lunar, start_year: needsStart ? v.start_year ?? thisYear : null,
  }
}
