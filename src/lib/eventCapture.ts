// 캡처로 일정 넣기(D-039): 일정·예약 캡처를 서버(extract-entries, kind 'event')에서 읽고,
// 읽은 일정을 고칠 수 있는 초안으로 만들어 이미 있는 일정과 견준 뒤, 저장하기 전에 표 검사와 같은 기준으로 확인한다.
import { checkTime, EVENT_ADDRESS_MAX, EVENT_MEMO_MAX, EVENT_PLACE_MAX, EVENT_TITLE_MAX, validDate, type CheckedEvent } from '../../supabase/functions/extract-entries/eventCheck'
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

/**
 * 서버가 읽은 일정 → 초안. 취소 안내, 이미 달력에 있는 일정, 앞 초안과 같은 일정은 빼 둔다(체크를 켜면 넣을 수 있다).
 * existing은 초안 날짜 범위의 일정이다(eventDateRange로 읽는다).
 */
export function toEventDrafts(events: CheckedEvent[], existing: CalEvent[]): EventDraft[] {
  const out: EventDraft[] = []
  events.forEach((e, i) => {
    const warnings = [...e.warnings]
    const d = { date: e.date ?? '', time: e.time, title: e.title }
    const dup = existing.find((x) => sameEvent(d, x))
    const again = out.find((x) => sameEvent(d, x))
    if (dup) warnings.push(`같은 날 "${dup.title}"${dup.time ? `(${dup.time})` : ''} 일정이 이미 있어서 빼 두었어요.`)
    else if (again) warnings.push('위 일정과 같아 보여서 빼 두었어요.')
    // 좌표는 둘 다 있을 때만(이 기능 전 서버의 응답에는 장소 칸이 없다)
    const coords = typeof e.lat === 'number' && typeof e.lng === 'number' ? { lat: e.lat, lng: e.lng } : { lat: null, lng: null }
    out.push({ key: String(i), include: e.notice !== 'cancel' && !dup && !again, title: e.title, date: d.date, time: e.time, memo: e.memo ?? '',
      place: e.place ?? '', address: e.address ?? '', ...coords, scope: 'shared', warnings })
  })
  return out
}

/** 초안 날짜의 처음·끝(이미 있는 일정을 읽을 범위). 날짜가 하나도 없으면 null */
export function eventDateRange(events: Pick<CheckedEvent, 'date'>[]): { from: string; to: string } | null {
  const dates = events.map((e) => e.date).filter((d): d is string => Boolean(d)).sort()
  return dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null
}

/** 확인 없이 바로 넣는 일정 수 상한(D-046). 붙여넣은 글은 믿을 수 없는 입력이라 많이 나오면 사람이 본다 */
export const AUTO_SAVE_MAX = 3

/**
 * 붙여넣은 문자를 확인 없이 바로 넣어도 되는지(D-046): 일정이 1~3개이고, 모두 넣기로 남아 있고(같은 일정·취소 안내 없음),
 * 확인 문장이 하나도 없으며(날짜 못 읽음·지난 날짜·요일 안 맞음·변경 안내 없음), 서버가 알린 말(note)이 없고, 표 검사도 통과할 때만
 */
export function canAutoSave(drafts: EventDraft[], note: string | null = null): boolean {
  return drafts.length > 0 && drafts.length <= AUTO_SAVE_MAX && !note?.trim()
    && drafts.every((d) => d.include && d.warnings.length === 0 && typeof eventInput(d) !== 'string')
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
