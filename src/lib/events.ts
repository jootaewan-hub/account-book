// 일정의 기간·중요도(D-054). 날짜는 'YYYY-MM-DD' 문자열.
//  - 기간: end_on(끝나는 날, 그날 포함)이 시작보다 뒤면 여러 날 일정. 달력 칸에는 기간 안의 날마다 보인다.
//  - 중요도: 보통·중요·꼭. 중요·꼭은 일정마다 고른 표시 효과(테두리·채움·숨쉬기·점과 별·굵은 글자)로 구별한다.
import { daysBetween } from './anniversaries'
import { DOW } from './dates'
import type { CalEvent, EventEffect, EventPriority } from './types'

export const PRIORITIES: EventPriority[] = ['normal', 'high', 'must']
export const PRIORITY_LABEL: Record<EventPriority, string> = { normal: '보통', high: '중요', must: '꼭' }
export const EFFECTS: EventEffect[] = ['outline', 'fill', 'breathe', 'mark', 'bold']
export const EFFECT_LABEL: Record<EventEffect, string> = { outline: '테두리', fill: '채움', breathe: '숨쉬기', mark: '점·별', bold: '굵은 글자' }
/** 기간은 1년까지(DB events_range_check와 같다) */
export const MAX_RANGE_DAYS = 366

type Ranged = Pick<CalEvent, 'date' | 'end_on'>
type Marked = Pick<CalEvent, 'priority' | 'effect'>

const DATE = /^\d{4}-\d{2}-\d{2}$/
const pad = (n: number) => String(n).padStart(2, '0')

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

/** 달력에 필요한 기간의 반복 회차만 계산한다. id는 원래 일정의 id를 유지한다. */
export function expandEvents(events: CalEvent[], from: string, to: string): CalEvent[] {
  const rows: CalEvent[] = []
  for (const event of events) {
    if (!event.repeat_weeks) { rows.push(event); continue }
    const step = event.repeat_weeks * 7
    const skip = new Set(event.skipped_on)
    const offset = Math.max(0, Math.ceil(daysBetween(event.date, from) / step)) * step
    for (let day = addDays(event.date, offset); day <= to && (!event.repeat_until || day <= event.repeat_until); day = addDays(day, step)) {
      if (!skip.has(day)) rows.push({ ...event, date: day, end_on: null, series_start: event.date })
    }
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''))
}

/** 끝나는 날. 하루 일정이면 시작 날 */
export const eventEnd = (e: Ranged): string => (e.end_on && e.end_on > e.date ? e.end_on : e.date)
export const isRange = (e: Ranged): boolean => eventEnd(e) !== e.date
/** 며칠 동안인지(하루 일정은 1) */
export const rangeDays = (e: Ranged): number => daysBetween(e.date, eventEnd(e)) + 1
export const eventPriority = (e: Marked): EventPriority => (e.priority === 'high' || e.priority === 'must' ? e.priority : 'normal')
export const eventEffect = (e: Marked): EventEffect => (e.effect && EFFECTS.includes(e.effect) ? e.effect : 'outline')

/** "11월 7일", "11월 7일 ~ 9일", "11월 28일 ~ 12월 2일", 해가 다르면 "2026년 12월 30일 ~ 2027년 1월 2일" */
export function rangeLabel(e: Ranged): string {
  const [y1, m1, d1] = e.date.split('-').map(Number)
  const [y2, m2, d2] = eventEnd(e).split('-').map(Number)
  if (!isRange(e)) return `${m1}월 ${d1}일`
  if (y1 !== y2) return `${y1}년 ${m1}월 ${d1}일 ~ ${y2}년 ${m2}월 ${d2}일`
  return m1 === m2 ? `${m1}월 ${d1}일 ~ ${d2}일` : `${m1}월 ${d1}일 ~ ${m2}월 ${d2}일`
}

/** 다가오는 목록의 날짜 글: "11월 8일 (일)" */
export function shortDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return `${m}월 ${d}일 (${DOW[new Date(y, m - 1, d).getDay()]})`
}

/** 고른 날 줄의 오른쪽 글: 하루 일정은 시간(없으면 '하루 종일'), 기간 일정은 기간(+ 시작 시간) */
export function whenLabel(e: Ranged & Pick<CalEvent, 'time'>): string {
  if (!isRange(e)) return e.time ?? '하루 종일'
  return e.time ? `${rangeLabel(e)}, ${e.time}` : rangeLabel(e)
}

/** 끝나는 날을 받을 수 없는 까닭(없으면 null). 비어 있으면 하루 일정이라 괜찮다 */
export function rangeError(date: string, end: string | null | undefined): string | null {
  if (!end) return null
  if (!DATE.test(date) || !DATE.test(end)) return '날짜를 다시 골라 주세요.'
  if (end < date) return '끝나는 날이 시작하는 날보다 앞이에요.'
  if (daysBetween(date, end) > MAX_RANGE_DAYS) return '기간은 1년까지 정할 수 있어요.'
  return null
}

/** 그날이 기간의 어디인지: 하루 일정(only), 첫날, 가운데, 마지막 날 */
export function rangePart(e: Ranged, date: string): 'only' | 'start' | 'mid' | 'end' {
  if (!isRange(e)) return 'only'
  return date === e.date ? 'start' : date === eventEnd(e) ? 'end' : 'mid'
}

/** from~to(포함) 안의 날짜마다 그날에 걸친 일정. 기간 일정은 날마다 들어간다. 순서는 받은 순서(시작 날·시간) */
export function eventsByDate(events: CalEvent[], from: string, to: string): Map<string, CalEvent[]> {
  const m = new Map<string, CalEvent[]>()
  for (const e of events) {
    const last = eventEnd(e) < to ? eventEnd(e) : to
    for (let d = e.date > from ? e.date : from; d <= last; d = addDays(d, 1)) m.set(d, [...(m.get(d) ?? []), e])
  }
  return m
}

const RANK: Record<EventPriority, number> = { must: 0, high: 1, normal: 2 }
/** 꼭 → 중요 → 보통 순서로(같으면 받은 순서). 달력 칸은 두 개까지만 보여서 중요한 일정이 +N에 숨지 않게 한다 */
export function byPriority<T extends Marked>(list: T[]): T[] {
  return list.map((e, i) => ({ e, i })).sort((a, b) => RANK[eventPriority(a.e)] - RANK[eventPriority(b.e)] || a.i - b.i).map((x) => x.e)
}

/** 중요·꼭 일정에 붙는 클래스("p-must fx-fill"). 보통 일정은 빈 문자열 */
export function fxClass(e: Marked): string {
  const p = eventPriority(e)
  return p === 'normal' ? '' : `p-${p} fx-${eventEffect(e)}`
}

/** 읽기 이름에 붙이는 말: 중요·꼭만 */
export const priorityWord = (e: Marked): string | null => (eventPriority(e) === 'normal' ? null : PRIORITY_LABEL[eventPriority(e)])

export interface UpcomingEvent { e: CalEvent; /** 눌렀을 때 갈 날: 시작 전이면 시작 날, 하고 있으면 오늘 */ date: string; days: number; ongoing: boolean }

/** 오늘부터 within일 안에 시작하거나, 이미 시작해 오늘도 이어지는 일정. 가까운 순서 */
export function upcomingEvents(events: CalEvent[], today: string, within = 30): UpcomingEvent[] {
  return events
    .filter((e) => eventEnd(e) >= today)
    .map((e) => {
      const ongoing = e.date < today
      return { e, date: ongoing ? today : e.date, days: ongoing ? 0 : daysBetween(today, e.date), ongoing }
    })
    .filter((u) => u.days <= within)
    .sort((a, b) => a.days - b.days || Number(b.ongoing) - Number(a.ongoing) || a.e.title.localeCompare(b.e.title))
}
