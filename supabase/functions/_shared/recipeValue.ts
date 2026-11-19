// 확인 후보(review_items[].candidates[].value)와 고친 곳(corrections[].before/after)의 값 글. 꼴은 여기 한 곳에서 정한다.
// 처리기(verify/rules.ts, verify/second.ts)가 format…으로 쓰고, 앱(store.ts, ReviewSheet.tsx)이 parse…로 읽는다.
//   분량: 숫자 + 단위를 붙여 쓴다("2큰술", "0.5컵", "500g"). 단위를 모르면 숫자만("2").
//   인분: "2인분".
//   시간(타이머): 정수 초("180").
// 읽을 때는 사람이 적은 꼴도 받는다: "1/2컵", "½", "1½큰술", "두 큰술", "반 컵", "2T", "3:00", "3분", "1분 30초".
// 상대 가져오기에는 .ts를 붙이고 enum·namespace는 쓰지 않는다(처리기는 Node 형 지우기로 돈다).
import { canonUnit, fmt, normalizeNumbers, quantities } from './recipeNumbers.ts'

/** DB의 단위 칸 글자 수 한도(recipe.ingredients.unit) */
export const UNIT_MAX = 12

export function formatAmountValue(amount: number, unit: string | null | undefined): string {
  return `${fmt(amount)}${unit ?? ''}`
}

export function formatServingsValue(value: number): string {
  return `${fmt(value)}인분`
}

export function formatSecondsValue(seconds: number): string {
  return String(Math.round(seconds))
}

/** 글 하나가 수 하나와 (있으면) 그 단위뿐일 때 그 수. 범위("2~3큰술")·수가 둘 이상·다른 글이 섞이면 null */
function single(value: string) {
  const s = normalizeNumbers(value.trim())
  const qs = quantities(s)
  if (qs.length !== 1) return null
  const q = qs[0]!
  if (q.range || !Number.isFinite(q.value)) return null
  if ((s.slice(0, q.index) + s.slice(q.end)).trim() !== '') return null
  return q
}

/** 분량 값 글 → 숫자와 단위(같은 꼴, 예: "2T" → 큰술). 단위가 없으면 unit은 null. 0 이하·읽을 수 없으면 null */
export function parseAmountValue(value: string): { amount: number; unit: string | null } | null {
  const q = single(value)
  if (!q || !(q.value > 0)) return null
  const unit = q.unit ?? q.word ?? null
  if (unit !== null && unit.length > UNIT_MAX) return null
  return { amount: q.value, unit }
}

/** 인분 값 글 → 숫자. "2인분", "2인", "두 사람", 단위 없는 "2"를 받는다. 다른 단위가 붙으면 null */
export function parseServingsValue(value: string): number | null {
  const q = single(value)
  if (!q || !(q.value > 0)) return null
  if (q.unit !== null ? q.unit !== '인분' : q.word !== null) return null
  return q.value
}

const SECONDS: Record<string, number> = { 시간: 3600, 분: 60, 초: 1 }

/** 시간 값 글 → 초. 정수 초("180"), 분:초("3:00"), 시:분:초, "3분"·"1분 30초"·"1시간 반". 0 이하·읽을 수 없으면 null */
export function parseSecondsValue(value: string): number | null {
  const v = value.trim()
  if (/^\d+$/.test(v)) return Number(v) > 0 ? Number(v) : null
  const clock = /^(?:(\d+):)?(\d+):([0-5]\d)$/.exec(v)
  if (clock) {
    const n = Number(clock[1] ?? 0) * 3600 + Number(clock[2]) * 60 + Number(clock[3])
    return n > 0 ? n : null
  }
  const s = normalizeNumbers(v)
  const qs = quantities(s)
  if (qs.length === 0) return null
  let total = 0
  let last = Infinity
  let at = 0
  for (const q of qs) {
    const mult = q.unit === null ? undefined : SECONDS[q.unit]
    if (mult === undefined || q.range || mult >= last || s.slice(at, q.index).trim() !== '') return null
    total += q.value * mult
    last = mult
    at = q.end
  }
  if (s.slice(at).trim() !== '') return null
  const n = Math.round(total)
  return n > 0 ? n : null
}

/** 두 단위가 같은 꼴인가(T와 큰술은 같다). 한쪽이 없으면 같지 않다 */
export function sameUnit(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null || a.trim() === '' || b.trim() === '') return false
  return canonUnit(a) === canonUnit(b)
}
