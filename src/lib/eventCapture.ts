// 캡처로 일정 넣기(D-039): 일정·예약 캡처를 서버(extract-entries, kind 'event')에서 읽고,
// 읽은 일정을 고칠 수 있는 초안으로 만들어 이미 있는 일정과 견준 뒤, 저장하기 전에 표 검사와 같은 기준으로 확인한다.
import { checkTime, EVENT_ADDRESS_MAX, EVENT_MEMO_MAX, EVENT_PLACE_MAX, EVENT_TITLE_MAX, validDate, type CheckedEvent } from '../../supabase/functions/extract-entries/eventCheck'
import { daysBetween } from './anniversaries'
import { addDays } from './events'
import { invoke, SmartError } from './smart'
import type { CalEvent, EventInput, Scope } from './types'

export type { CheckedEvent }

/** 한 번에 읽는 캡처 수(서버 events.ts EVENT_IMAGES_MAX와 같다. 그 파일은 zod를 불러 앱에 넣지 않는다) */
export const EVENT_PHOTOS_MAX = 5

type Img = { media_type: 'image/jpeg'; data: string; width: number; height: number }

export interface EventCaptureResult {
  events: CheckedEvent[]
  note: string | null
  model: string
}

export async function analyzeEvents(images: Img[], today: string): Promise<EventCaptureResult> {
  return checkResult(await invoke<Partial<EventCaptureResult>>({ kind: 'event', images, today }))
}

/** 문자로 온 일정 안내(학회·심포지엄·숙박 예약 등)를 붙여넣은 글에서 읽는다(D-046) */
export async function analyzeEventText(text: string, today: string): Promise<EventCaptureResult> {
  return checkResult(await invoke<Partial<EventCaptureResult>>({ kind: 'event', text, today }))
}

function checkResult(res: Partial<EventCaptureResult>): EventCaptureResult {
  // 모양이 다른 응답(영수증 결과 등)을 '일정 없음'으로 보이지 않게 한다
  if (!Array.isArray(res.events)) throw new SmartError('bad_response', '서버가 일정을 돌려주지 않았어요. 잠시 후 다시 해 주세요.')
  return { events: res.events, note: res.note ?? null, model: res.model ?? '' }
}

export interface EventDraft {
  key: string
  include: boolean
  title: string
  /** YYYY-MM-DD. 캡처에서 날짜를 못 읽었으면 '' (넣기 전에 사람이 채운다) */
  date: string
  /** HH:MM, 하루 종일이면 null */
  time: string | null
  memo: string
  /** 장소 이름·주소(D-041). 칸을 고치면 좌표를 지운다(엉뚱한 곳으로 길찾기가 열리지 않게) */
  place: string
  address: string
  lat: number | null
  lng: number | null
  /** 누구 일정(D-044). 캡처에서는 알 수 없어 함께로 두고 사람이 고른다 */
  scope: Scope
  warnings: string[]
  revision?: {
    notice: 'change' | 'cancel'
    candidates: CalEvent[]
  }
}

const norm = (s: string) => s.replace(/[\s·.,:;()[\]{}'"!?~\-_/]/g, '').toLowerCase()

/** 같은 날 같은 일정으로 볼지: 제목이 같거나 한쪽이 다른 쪽을 품거나(두 글자 이상), 시각이 같고 제목 앞 두 글자가 같으면 */
export function sameEvent(a: Pick<EventInput, 'date' | 'time' | 'title'>, b: Pick<EventInput, 'date' | 'time' | 'title'>): boolean {
  if (!a.date || a.date !== b.date) return false
  const x = norm(a.title)
  const y = norm(b.title)
  if (!x || !y) return false
  if (x === y) return true
  const [short, long] = x.length <= y.length ? [x, y] : [y, x]
  if (short.length >= 2 && long.includes(short)) return true
  return a.time !== null && a.time === b.time && x.slice(0, 2) === y.slice(0, 2)
}

const isRevision = (e: CheckedEvent) => e.notice === 'change' || e.notice === 'cancel'
const bookingNo = (e: Pick<CheckedEvent, 'bookingNo' | 'memo'>) =>
  norm(e.bookingNo || e.memo?.match(/예약번호\s*[:：]?\s*([\p{L}\p{N}_-]+)/u)?.[1] || '')

function similarName(a: string | null | undefined, b: string | null | undefined): boolean {
  const name = (s: string) => norm(s.normalize('NFKC')).replace(/예약|일정|변경|취소|안내|확정|저녁|점심/g, '')
  const x = name(a ?? '')
  const y = name(b ?? '')
  return x.length >= 2 && y.length >= 2 && (x.includes(y) || y.includes(x))
}

/** 예약번호, 변경 전 날짜·시간, 제목·장소가 겹치는 순으로 기존 일정 후보를 보여 준다. */
function revisionCandidates(e: CheckedEvent, existing: CalEvent[]): CalEvent[] {
  const number = bookingNo(e)
  const oldDate = e.notice === 'cancel' ? e.date : e.previousDate
  const oldTime = e.notice === 'cancel' ? e.time : e.previousTime
  const anchor = oldDate ?? e.date
  return existing.flatMap((event) => {
    if (event.repeat_weeks) return []
    const sameNumber = Boolean(number && number === bookingNo(event))
    const sameDate = Boolean(oldDate && oldDate === event.date)
    const sameTime = Boolean(oldTime && oldTime === event.time)
    const sameName = similarName(e.title, event.title) || similarName(e.place, event.place)
      || similarName(e.place, event.title) || similarName(e.title, event.place)
    if (!sameNumber && !sameName && !(sameDate && sameTime)) return []
    const score = (sameNumber ? 100 : 0) + (sameDate ? 30 : 0) + (sameTime ? 10 : 0) + (sameName ? 5 : 0)
    return [{ event, score, distance: anchor ? Math.abs(daysBetween(anchor, event.date)) : 0 }]
  }).sort((a, b) => b.score - a.score || a.distance - b.distance).map(({ event }) => event)
}

/** 서버가 읽은 일정 → 새 일정 초안 또는 기존 일정 변경·취소 검토. */
export function toEventDrafts(events: CheckedEvent[], existing: CalEvent[]): EventDraft[] {
  const out: EventDraft[] = []
  const revisions = events.filter(isRevision)
  events.forEach((e, i) => {
    const warnings = [...e.warnings]
    const d = { date: e.date ?? '', time: e.time, title: e.title }
    const notice = e.notice
    const revision = notice === 'change' || notice === 'cancel' ? { notice, candidates: revisionCandidates(e, existing) } : undefined
    const number = bookingNo(e)
    // 같은 안내에서 바뀌기 전·후를 각각 읽었더라도 같은 예약을 새로 넣지 않는다.
    if (!revision && revisions.some((r) => (number && number === bookingNo(r))
      || ((e.date === r.date || e.date === r.previousDate) && sameEvent(d, { ...r, date: d.date })))) return
    const dup = existing.find((x) => sameEvent(d, x))
    const again = out.find((x) => sameEvent(d, x))
    if (!revision && dup) warnings.push(`같은 날 "${dup.title}"${dup.time ? `(${dup.time})` : ''} 일정이 이미 있어서 빼 두었어요.`)
    else if (again) warnings.push('위 일정과 같아 보여서 빼 두었어요.')
    // 좌표는 둘 다 있을 때만(이 기능 전 서버의 응답에는 장소 칸이 없다)
    const coords = typeof e.lat === 'number' && typeof e.lng === 'number' ? { lat: e.lat, lng: e.lng } : { lat: null, lng: null }
    out.push({ key: String(i), include: !revision && !dup && !again, title: e.title, date: d.date, time: e.time, memo: e.memo ?? '',
      place: e.place ?? '', address: e.address ?? '', ...coords, scope: 'shared', warnings, revision })
  })
  return out
}

/** 초안 날짜의 처음·끝(이미 있는 일정을 읽을 범위). 날짜가 하나도 없으면 null */
export function eventDateRange(events: (Pick<CheckedEvent, 'date' | 'previousDate'> & { notice?: CheckedEvent['notice'] })[], today?: string): { from: string; to: string } | null {
  const dates = events.flatMap((e) => {
    if (!today || !e.notice || e.notice === 'booking') return [e.date]
    // 변경 전 날짜가 빠진 안내는 새 날짜(취소는 원래 예약 날짜) 주변에서도 기존 일정을 찾는다.
    const anchor = e.date ?? today
    return e.previousDate ? [e.previousDate, e.date] : [addDays(anchor, -90), addDays(anchor, 90)]
  }).filter((d): d is string => Boolean(d)).sort()
  return dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null
}

/** 바뀐 날짜·시간만 보낸다. 기간 일정은 원래 길이만큼 끝 날짜도 옮긴다. */
export function eventRevision(d: Pick<EventDraft, 'date' | 'time'>, event: CalEvent): Pick<EventInput, 'date' | 'time' | 'end_on'> | null {
  const date = d.date || event.date
  const time = d.time ?? event.time
  if (date === event.date && time === event.time) return null
  const end = event.end_on && date !== event.date ? addDays(date, daysBetween(event.date, event.end_on)) : undefined
  return { date, time, ...(end && { end_on: end }) }
}

/** 확인 없이 바로 넣는 일정 수 상한(D-046). 붙여넣은 글은 믿을 수 없는 입력이라 많이 나오면 사람이 본다 */
export const AUTO_SAVE_MAX = 3

/** 원문에 그 날짜(월·일)가 글자로 있는지: 11월 21일, 11/21, 11.21, 2026-11-21, 11-21 (앞에 0이 있어도) */
export function dateInText(date: string, text: string): boolean {
  const [, m, d] = date.split('-').map(Number)
  if (!m || !d) return false
  const t = text.normalize('NFKC')
  return new RegExp(`(?<!\\d)0?${m}\\s*(?:월|[./-])\\s*0?${d}(?!\\d)`).test(t)
}

/**
 * 인터넷 주소가 든 문자는 바로 넣지 않는다(낚시 문자 가능성). 끝 이름(.com 등)을 고르지 않고 "글자.영문 두 자 이상"(점 앞뒤 빈칸 하나까지),
 * "글자.글자 두 자 이상"(한글 끝 이름 등), IP를 모두 주소로 본다. "Dr.Kim"처럼 주소가 아닌 것도 걸리지만 그때는 확인 화면으로 갈 뿐이다.
 * 보이지 않는 글자(서식 문자·이체 선택자 등)와 결합 기호(밑줄·인도 문자 모음 기호 등, 한글 음절은 해당 없음)를 빼고 전각·반각 마침표를 '.'로 맞춘 뒤 본다
 */
const URL_LIKE = /https?:|www\.|[\p{L}\p{N}-]+(?:[ \t]?\.[ \t]?[a-z]{2,}|\.\p{L}{2,})|\d{1,3}(?:\.\d{1,3}){3}/iu
const hasUrl = (s: string) =>
  URL_LIKE.test(s.normalize('NFKC').replace(/[\p{Cf}\p{Default_Ignorable_Code_Point}\p{M}]/gu, '').replace(/[。｡]/g, '.'))

/**
 * 붙여넣은 문자를 확인 없이 바로 넣어도 되는지(D-046). 모델이 읽은 결과만 믿지 않고 원문과 견준다:
 * 일정이 1~3개, 모두 넣기로 남아 있음(같은 일정·취소 안내 없음), 확인 문장 없음(날짜 못 읽음·지난 날짜·요일·변경 안내),
 * 서버가 알린 말(note) 없음, 표 검사 통과, 그리고 원문에 각 일정의 날짜(월·일)가 글자로 있고 원문·읽은 칸 어디에도 인터넷 주소가 없을 때만.
 * 바로 넣은 뒤에는 시트에 넣은 것을 보이고 되돌리기를 둔다
 */
export function canAutoSave(drafts: EventDraft[], note: string | null = null, text = ''): boolean {
  return drafts.length > 0 && drafts.length <= AUTO_SAVE_MAX && !note?.trim() && !hasUrl(text)
    && drafts.every((d) => !d.revision && d.include && d.warnings.length === 0 && typeof eventInput(d) !== 'string' && dateInText(d.date, text)
      && !hasUrl([d.title, d.memo, d.place, d.address].join('\n')))
}

/** 저장할 값. 표 검사(제목 1~40자, 메모 200자, 있는 날짜, HH:MM)에 걸릴 것은 문장으로 돌려준다 */
export function eventInput(d: EventDraft): EventInput | string {
  const title = d.title.replace(/\s+/g, ' ').trim()
  if (!title) return '무엇을 칸을 채워 주세요.'
  if (title.length > EVENT_TITLE_MAX) return `무엇을 칸은 ${EVENT_TITLE_MAX}자까지예요.`
  const [y, m, day] = d.date.split('-').map(Number)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date) || !validDate(y, m, day)) return `"${title}"의 날짜를 넣어 주세요.`
  const time = d.time === null ? null : checkTime(d.time)
  if (d.time !== null && time === null) return `"${title}"의 시간을 확인해 주세요.`
  const memo = d.memo.trim()
  if (memo.length > EVENT_MEMO_MAX) return `메모는 ${EVENT_MEMO_MAX}자까지예요.`
  const place = d.place.replace(/\s+/g, ' ').trim()
  const address = d.address.replace(/\s+/g, ' ').trim()
  if (place.length > EVENT_PLACE_MAX) return `장소는 ${EVENT_PLACE_MAX}자까지예요.`
  if (address.length > EVENT_ADDRESS_MAX) return `주소는 ${EVENT_ADDRESS_MAX}자까지예요.`
  const coords = d.lat !== null && d.lng !== null ? { lat: d.lat, lng: d.lng } : { lat: null, lng: null }
  return { title, date: d.date, time, memo: memo || null, place: place || null, address: address || null, ...coords, scope: d.scope }
}
