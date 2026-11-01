// 일정·예약 캡처에서 읽은 값을 달력 일정(public.events)에 넣을 수 있게 정리하는 로직(D-039).
// Edge Function과 앱(저장 전 검사)·vitest가 함께 쓰므로 zod·런타임 전용 API를 쓰지 않는다.

/** public.events 검사와 같은 길이: 제목 1~40자(앞뒤 공백 뺀 길이), 메모 200자 */
export const EVENT_TITLE_MAX = 40
export const EVENT_MEMO_MAX = 200
/** 연도가 안 보이는 날짜: 이만큼 지난 날까지는 올해로 본다(그보다 전이면 내년). 예약 캡처는 대개 다가오는 일이다 */
export const PAST_GRACE_DAYS = 30

export type EventNotice = 'booking' | 'change' | 'cancel'

/** 모델이 캡처에서 읽은 일정 하나(events.ts의 EventSchema와 같은 모양) */
export interface RawEvent {
  title: string
  year: number | null
  month: number | null
  day: number | null
  weekday: string | null
  start_time: string | null
  end_time: string | null
  place: string | null
  address: string | null
  people: number | null
  booking_no: string | null
  phone: string | null
  detail: string | null
  notice: EventNotice
  images: number[]
}

/** 앱으로 보내는 정리한 일정. date·time·title·memo는 그대로 public.events에 넣을 수 있다(date가 null이면 사람이 넣어야 한다) */
export interface CheckedEvent {
  title: string
  date: string | null
  time: string | null
  memo: string | null
  notice: EventNotice
  /** 확인해 달라는 문장(날짜를 못 읽음, 요일이 안 맞음, 지난 날짜, 취소·변경 안내) */
  warnings: string[]
  /** 이 일정을 읽은 이미지 번호(1부터) */
  images: number[]
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']
const pad = (n: number) => String(n).padStart(2, '0')
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`
const dayMs = (s: string) => Date.parse(`${s}T00:00:00Z`)

/** 있는 날짜면 YYYY-MM-DD, 아니면 null (2월 30일 등) */
export function validDate(y: number, m: number, d: number): string | null {
  if (![y, m, d].every(Number.isInteger) || y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? iso(y, m, d) : null
}

/** YYYY-MM-DD의 요일 한 글자 */
export function weekdayOf(date: string): string {
  return WEEKDAYS[new Date(dayMs(date)).getUTCDay()]
}

/** '토', '토요일', '(토)', 'Sat' → '토'. 모르면 null */
export function normWeekday(w: string | null | undefined): string | null {
  const s = (w ?? '').replace(/[()\s]/g, '')
  if (!s) return null
  const ko = WEEKDAYS.find((k) => s.startsWith(k))
  if (ko) return ko
  const en = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(s.slice(0, 3).toLowerCase())
  return en >= 0 ? WEEKDAYS[en] : null
}

const monthDay = (date: string) => `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일`

/**
 * 캡처의 연·월·일·요일로 일정 날짜를 정한다.
 * - 연도가 적혀 있으면 그 날짜. 적힌 요일과 다르면 확인 문장.
 * - 연도가 없고 요일이 있으면: 작년·올해·내년 중 요일이 맞는 날짜 가운데 오늘에 가장 가까운 것(요일이 해마다 1~2일씩 밀려 대개 하나다).
 * - 연도도 요일도 없으면(또는 요일이 맞는 해가 없으면): PAST_GRACE_DAYS일 전부터 앞으로 오는 첫 날짜.
 * - 정한 날짜가 오늘보다 앞이면 확인 문장.
 */
export function resolveEventDate(
  p: { year: number | null; month: number | null; day: number | null; weekday: string | null },
  today: string,
): { date: string | null; warnings: string[] } {
  const warnings: string[] = []
  const shown = normWeekday(p.weekday)
  if (p.month === null || p.day === null) return { date: null, warnings: ['날짜를 읽지 못했어요. 날짜를 넣어 주세요.'] }
  let date: string | null = null
  if (p.year !== null) {
    // 예약 문자에 흔한 두 자리 연도('26.11.15)는 2000년대로 본다
    date = validDate(p.year >= 0 && p.year < 100 ? 2000 + p.year : p.year, p.month, p.day)
    if (date && shown && weekdayOf(date) !== shown) {
      warnings.push(`화면의 요일(${shown})과 날짜(${monthDay(date)}, ${weekdayOf(date)}요일)가 안 맞아요. 날짜를 확인해 주세요.`)
    }
  } else {
    const ty = Number(today.slice(0, 4))
    const candidates = [ty - 1, ty, ty + 1].map((y) => validDate(y, p.month!, p.day!)).filter((d): d is string => d !== null)
    const matching = shown ? candidates.filter((d) => weekdayOf(d) === shown) : []
    if (matching.length) {
      date = matching.reduce((a, b) => (Math.abs(dayMs(b) - dayMs(today)) < Math.abs(dayMs(a) - dayMs(today)) ? b : a))
    } else {
      const from = dayMs(today) - PAST_GRACE_DAYS * 86_400_000
      date = candidates.find((d) => dayMs(d) >= from) ?? null
      if (date && shown) warnings.push(`화면의 요일(${shown})과 맞는 ${monthDay(date)}이 없어요. 날짜를 확인해 주세요.`)
    }
  }
  if (!date) return { date: null, warnings: ['날짜를 읽지 못했어요. 날짜를 넣어 주세요.'] }
  if (date < today) warnings.push(`지난 날짜예요(${date.slice(0, 4)}년 ${monthDay(date)}). 맞는지 확인해 주세요.`)
  return { date, warnings }
}

/** 'HH:MM'(00:00~23:59)이면 그대로, '9:05'는 '09:05'로. 아니면 null */
export function checkTime(t: string | null | undefined): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((t ?? '').trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  return h <= 23 && min <= 59 ? `${pad(h)}:${pad(min)}` : null
}

const squash = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()

/** 길이를 넘으면 끝을 줄임표로 */
export function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s
}

/** 메모: 시간 범위, 인원, 장소(제목에 없으면), 주소, 예약번호, 연락처, 그 밖 안내를 ' · '로 잇는다. 200자 안 */
export function eventMemo(e: RawEvent, title: string, time: string | null): string | null {
  const end = checkTime(e.end_time)
  const place = squash(e.place)
  const people = Number.isInteger(e.people) && e.people! > 0 && e.people! < 1000 ? `${e.people}명` : null
  const booking = squash(e.booking_no)
  const parts = [
    time && end ? `${time}~${end}` : null,
    people,
    place && !title.replace(/\s/g, '').includes(place.replace(/\s/g, '')) ? place : null,
    squash(e.address) || null,
    booking ? `예약번호 ${booking}` : null,
    squash(e.phone) || null,
    squash(e.detail) || null,
  ].filter((p): p is string => Boolean(p))
  return parts.length ? clip(parts.join(' · '), EVENT_MEMO_MAX) : null
}

const NOTICE_WARNING: Record<EventNotice, string | null> = {
  booking: null,
  change: '변경 안내로 보여요. 전에 넣은 일정이 있으면 달력에서 고치거나 지워 주세요.',
  cancel: '취소 안내로 보여요. 넣지 않게 빼 두었어요. 전에 넣은 일정은 달력에서 지워 주세요.',
}

/** 모델 출력 → 저장할 수 있는 일정. 제목도 날짜도 없는 것은 버린다 */
export function checkEvents(raw: RawEvent[], today: string, imageCount: number): CheckedEvent[] {
  return raw.flatMap((e) => {
    const title = clip(squash(e.title) || squash(e.place) || '', EVENT_TITLE_MAX)
    const { date, warnings } = resolveEventDate(e, today)
    if (!title && !date) return []
    const time = checkTime(e.start_time)
    const notice: EventNotice = e.notice === 'change' || e.notice === 'cancel' ? e.notice : 'booking'
    const noticeWarning = NOTICE_WARNING[notice]
    const images = Array.isArray(e.images)
      ? [...new Set(e.images.filter((n) => Number.isInteger(n) && n >= 1 && n <= imageCount))].sort((a, b) => a - b)
      : []
    return [{
      title: title || '일정',
      date,
      time,
      memo: eventMemo(e, title, time),
      notice,
      warnings: noticeWarning ? [noticeWarning, ...warnings] : warnings,
      images,
    }]
  })
}
