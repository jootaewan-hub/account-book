// V1 기계 검사(설계 "검증" V1). 정리 결과의 숫자(분량·인분·시간)가 근거에 글자로 있는지 보고, 규칙으로 고칠 수 있는 것은
// 고치고(고친 곳, method 'rule'), 판단이 안 서는 것은 확인 필요로 남긴다. 모델에게 숫자를 다시 만들게 하지 않는다.
// 순수 함수. 고친 곳·확인 필요에는 근거 원문(자막·화면 글자·설명란 문장)을 넣지 않고 값·출처·시각만 둔다(P-06).
// 출처가 user(사람이 앱에서 고친 값)인 분량·인분·타이머는 무엇보다 앞서므로 찾지도, 고치지도, 지우지도 않는다.
// 출처를 바꿀 때는 출처와 시각을 따로 남겨(origin, at_seconds) 나중에 둘 다 되돌릴 수 있게 한다.
//
// 넘겨주는 꼴: 돌려주는 recipe의 corrections·review_items에는 받은 것 뒤에 새로 만든 것을 이미 붙였다(각 40개까지).
// corrections·reviews는 이번에 새로 만든 것만이다(요약과 시험용). 다음 단계는 이것을 recipe에 다시 붙이지 않는다.
import type { Correction, Origin, RecipeV2, ReviewItem } from '../../../../supabase/functions/_shared/recipeContract.ts'
import {
  formatAmountValue, formatSecondsValue, formatServingsValue, parseAmountValue, parseSecondsValue, parseServingsValue,
} from '../../../../supabase/functions/_shared/recipeValue.ts'
import type { Evidence } from '../evidence.ts'
import {
  containsName, containsTerm, findAmount, fmt, hasDuration, hasQuantity, hasServings, nearbyQuantities, sameName, servingsIn,
  type Quantity,
} from './grounding.ts'

type Ingredient = RecipeV2['ingredients'][number]
type Line = { t: number; text: string }
type Found = { origin: Origin; at: number | null }

/** 확인 필요의 까닭(화면에 그대로 보인다) */
export const REASONS = {
  amount: '출처에서 숫자를 찾지 못함',
  timer: '출처에서 시간을 찾지 못함',
  unused: '어느 단계에도 쓰이지 않음',
  spoon: '계량스푼인지 밥숟가락인지 확인 못 함',
  flagged: '정리할 때 확인 필요로 표시함',
  unit: '단위를 읽지 못했어요',
} as const

/** 자막·받아쓰기는 단 시각 ±10초의 조각, 화면 글자는 ±3초의 줄을 본다 */
const SPEECH_PAD = 10
const SCREEN_PAD = 3
// 자막 조각은 말 중간에서 끊기므로("두" | "큰술") 띄어 이어 한 줄로, 화면 글자 줄은 따로 읽힌 줄이라 "|"로 이어 줄마다 한 덩이로 본다
// (쉼표로 이으면 "2" | "3" 두 줄이 "2, 3" 범위로 읽힌다)
const SPEECH_JOIN = ' '
const SCREEN_JOIN = ' | '
const MAX_LIST = 40
const MAX_CANDIDATES = 6
const TIMED: readonly Origin[] = ['caption_manual', 'caption_auto', 'asr', 'screen']
const SPEECH: readonly Origin[] = ['caption_manual', 'caption_auto', 'asr']
// 어느 도구인지 정하지 않은 표기. 테이블스푼·티스푼·밥숟가락·계량스푼은 도구가 드러난 말이라 뺀다.
const AMBIGUOUS_SPOON = /스푼|숟가락|숟갈|수저/
const NAMED_SPOON = /테이블\s*스푼|티\s*스푼|밥\s*(?:숟가락|숟갈|스푼)|계량\s*스푼/g

type SpeechKind = NonNullable<Evidence['transcript']>['kind']
type Sources = { description: string; screen: Line[]; speech: Line[]; speechKind: SpeechKind | null }

function sourcesOf(e: Evidence): Sources {
  const byTime = (a: Line, b: Line) => a.t - b.t
  return {
    description: e.meta.description ?? '',
    screen: e.ocr.map((l) => ({ t: l.t, text: l.text })).sort(byTime),
    speech: (e.transcript?.segments ?? []).map((s) => ({ t: s.start, text: s.text })).sort(byTime),
    speechKind: e.transcript?.kind ?? null,
  }
}

const around = (lines: Line[], from: number, to: number, sep: string) =>
  lines.filter((l) => l.t >= from && l.t <= to).map((l) => l.text).join(sep)

/**
 * 시각이 있는 출처를 훑는다: 그 분량이 적힌 줄을 먼저, 단 시각(hint)에 가까운 줄부터, 그 줄 앞뒤 pad초를 묶어 본다.
 * 찾으면 그 줄의 시각(정수 초).
 */
function searchLines(lines: Line[], pad: number, sep: string, hint: number | null, ok: (text: string) => boolean, first: (text: string) => boolean): number | null {
  const dist = (l: Line) => (hint === null ? l.t : Math.abs(l.t - hint))
  const ranked = lines.map((l) => ({ l, first: first(l.text) })).sort((a, b) => Number(b.first) - Number(a.first) || dist(a.l) - dist(b.l))
  for (const { l } of ranked) if (ok(around(lines, l.t - pad, l.t + pad, sep))) return Math.floor(l.t)
  return null
}

/** 단 출처의 단 시각을 먼저 보고, 없으면 설명란 > 화면 > 작성자 자막 > 자동 자막·받아쓰기(R-02) 차례로 찾는다 */
function locateAmount(g: Ingredient, amount: number, s: Sources, others: readonly string[]): Found | null {
  const ok = (text: string) => findAmount(text, g.name, amount, g.unit, others)
  const first = (text: string) => hasQuantity(text, amount, g.unit)
  const at = g.at_seconds ?? null
  if (g.origin === 'description' && ok(s.description)) return { origin: 'description', at }
  if (g.origin === 'screen' && at !== null && ok(around(s.screen, at - SCREEN_PAD, at + SCREEN_PAD, SCREEN_JOIN))) return { origin: 'screen', at }
  if (SPEECH.includes(g.origin) && s.speechKind !== null && at !== null && ok(around(s.speech, at - SPEECH_PAD, at + SPEECH_PAD, SPEECH_JOIN))) {
    return { origin: s.speechKind, at }
  }
  if (ok(s.description)) return { origin: 'description', at: null }
  const onScreen = searchLines(s.screen, SCREEN_PAD, SCREEN_JOIN, at, ok, first)
  if (onScreen !== null) return { origin: 'screen', at: onScreen }
  if (s.speechKind !== null) {
    const spoken = searchLines(s.speech, SPEECH_PAD, SPEECH_JOIN, at, ok, first)
    if (spoken !== null) return { origin: s.speechKind, at: spoken }
  }
  return null
}

function quantityLabel(q: Quantity): string | null {
  if (q.range || q.word !== null) return null
  return formatAmountValue(q.value, q.unit)
}

type Candidate = ReviewItem['candidates'][number]

function pushCandidate(out: Candidate[], value: string | null, origin: Origin, at: number | null) {
  if (value === null || out.length >= MAX_CANDIDATES) return
  if (out.some((c) => c.value === value && c.origin === origin && c.at_seconds === at)) return
  out.push({ value: value.slice(0, 80), origin, at_seconds: at })
}

/** 숫자를 찾지 못한 재료 이름 가까이에 적힌 다른 수(값과 단위만) */
function amountCandidates(g: Ingredient, s: Sources, others: readonly string[]): Candidate[] {
  const out: Candidate[] = []
  for (const q of nearbyQuantities(s.description, g.name, others)) pushCandidate(out, quantityLabel(q), 'description', null)
  const at = g.at_seconds ?? null
  if (at !== null) {
    const t = Math.floor(at)
    for (const q of nearbyQuantities(around(s.screen, at - SCREEN_PAD, at + SCREEN_PAD, SCREEN_JOIN), g.name, others)) pushCandidate(out, quantityLabel(q), 'screen', t)
    if (s.speechKind !== null) {
      for (const q of nearbyQuantities(around(s.speech, at - SPEECH_PAD, at + SPEECH_PAD, SPEECH_JOIN), g.name, others)) pushCandidate(out, quantityLabel(q), s.speechKind, t)
    }
  }
  return out
}

function locateServings(value: number, cited: Origin | null, s: Sources): 'description' | 'screen' | SpeechKind | null {
  const inDescription = () => hasServings(s.description, value)
  const onScreen = () => hasServings(s.screen.map((l) => l.text).join(SCREEN_JOIN), value)
  const spoken = () => s.speechKind !== null && hasServings(s.speech.map((l) => l.text).join(SPEECH_JOIN), value)
  if (cited === 'description' && inDescription()) return 'description'
  if (cited === 'screen' && onScreen()) return 'screen'
  if (cited !== null && SPEECH.includes(cited) && spoken()) return s.speechKind
  if (inDescription()) return 'description'
  if (onScreen()) return 'screen'
  if (spoken()) return s.speechKind
  return null
}

function servingsCandidates(s: Sources): Candidate[] {
  const out: Candidate[] = []
  for (const v of servingsIn(s.description)) pushCandidate(out, formatServingsValue(v), 'description', null)
  for (const l of s.screen) for (const v of servingsIn(l.text)) pushCandidate(out, formatServingsValue(v), 'screen', Math.floor(l.t))
  if (s.speechKind !== null) for (const l of s.speech) for (const v of servingsIn(l.text)) pushCandidate(out, formatServingsValue(v), s.speechKind, Math.floor(l.t))
  return out
}

/** 타이머는 그 단계 동안(시작 시각부터 다음 단계 시작까지, 앞뒤 여유를 두고)의 말·화면, 또는 설명란에 있어야 한다 */
function timerFound(seconds: number, span: [number, number] | null, s: Sources): boolean {
  if (s.description.split(/\r?\n/).some((line) => hasDuration(line, seconds))) return true
  const [from, to] = span ?? [-Infinity, Infinity]
  if (hasDuration(around(s.screen, from - SCREEN_PAD, to + SCREEN_PAD, SCREEN_JOIN), seconds)) return true
  return s.speechKind !== null && hasDuration(around(s.speech, from - SPEECH_PAD, to + SPEECH_PAD, SPEECH_JOIN), seconds)
}

/** 용어 풀이의 말이 그 출처의 그 시각 근거에 있는지. 있으면 근거의 출처(자막 종류가 다르면 근거 쪽), 없으면 null */
function locateTerm(term: string, origin: Origin, at: number | null, s: Sources): Origin | null {
  if (origin === 'description') return containsTerm(s.description, term) ? 'description' : null
  if (at === null) return null
  if (origin === 'screen') return containsTerm(around(s.screen, at - SCREEN_PAD, at + SCREEN_PAD, SCREEN_JOIN), term) ? 'screen' : null
  if (SPEECH.includes(origin) && s.speechKind !== null) {
    return containsTerm(around(s.speech, at - SPEECH_PAD, at + SPEECH_PAD, SPEECH_JOIN), term) ? s.speechKind : null
  }
  return null
}

// ── 모델이 낸 후보·다른 곳 확인(I6) ─────────────────────────────────
// 정리(첫 읽기)가 review_items의 후보와 conflicts를 직접 낼 수 있다. 그 값과 출처는 V3의 후보처럼 근거에서 찾은 것만 남긴다:
// 그 출처의 그 시각 근처(설명란은 전체) 글에 값이 글자로 있어야 하고, 출처·시각은 근거 쪽의 것을 쓴다. 못 찾은 후보는 버린다.

/** 출처 하나의 그 시각 근처 글과, 근거에서 본 출처(자막 종류는 근거 쪽). 시각이 있어야 하는 출처인데 시각이 없으면 null(whole이면 그 출처 전체) */
function windowOf(origin: Origin, at: number | null, s: Sources, whole = false): { text: string; origin: Origin; at: number | null } | null {
  if (origin === 'description') return { text: s.description, origin: 'description', at: null }
  if (origin === 'screen') {
    if (at === null) return whole ? { text: s.screen.map((l) => l.text).join(SCREEN_JOIN), origin: 'screen', at: null } : null
    return { text: around(s.screen, at - SCREEN_PAD, at + SCREEN_PAD, SCREEN_JOIN), origin: 'screen', at: Math.floor(at) }
  }
  if (SPEECH.includes(origin) && s.speechKind !== null) {
    if (at === null) return whole ? { text: s.speech.map((l) => l.text).join(SPEECH_JOIN), origin: s.speechKind, at: null } : null
    return { text: around(s.speech, at - SPEECH_PAD, at + SPEECH_PAD, SPEECH_JOIN), origin: s.speechKind, at: Math.floor(at) }
  }
  return null
}

type Field = { kind: 'amount'; g: Ingredient; others: string[] } | { kind: 'servings' } | { kind: 'timer' } | { kind: 'text' }

function fieldOf(target: string, ingredients: Ingredient[]): Field {
  const a = /^ingredients\[(\d+)\]\.(?:amount|suggested_amount)$/.exec(target)
  const g = a ? ingredients[Number(a[1])] : undefined
  if (g) return { kind: 'amount', g, others: ingredients.filter((x) => x !== g).map((x) => x.name) }
  if (target === 'servings.value') return { kind: 'servings' }
  if (/^steps\[\d+\]\.timer_seconds$/.test(target)) return { kind: 'timer' }
  return { kind: 'text' }
}

/** 값 글 하나를 근거 글에서 찾는다. 숫자 칸은 같은 꼴로 다시 쓴 값, 글 칸은 받은 값. 못 찾으면 null */
function groundValue(value: string, field: Field, text: string): string | null {
  if (field.kind === 'amount') {
    const p = parseAmountValue(value)
    if (!p) return null
    return findAmount(text, field.g.name, p.amount, p.unit ?? field.g.unit, field.others) ? formatAmountValue(p.amount, p.unit) : null
  }
  if (field.kind === 'servings') {
    const n = parseServingsValue(value)
    return n !== null && hasServings(text, n) ? formatServingsValue(n) : null
  }
  if (field.kind === 'timer') {
    const n = parseSecondsValue(value)
    return n !== null && hasDuration(text, n) ? formatSecondsValue(n) : null
  }
  return value.trim() !== '' && containsTerm(text, value) ? value : null
}

/** 모델이 낸 후보 하나. 덧붙임(editor)은 글 칸에서만 남기고(숫자는 덧붙임일 수 없다), user는 모델이 쓸 수 없는 출처라 버린다 */
function groundCandidate(c: Candidate, field: Field, s: Sources): Candidate | null {
  if (c.origin === 'user') return null
  if (c.origin === 'editor') return field.kind === 'text' ? { ...c, at_seconds: null } : null
  const w = windowOf(c.origin, c.at_seconds, s, field.kind === 'servings')
  if (!w) return null
  const value = groundValue(c.value, field, w.text)
  return value === null ? null : { value: value.slice(0, 80), origin: w.origin, at_seconds: w.at }
}

type Conflict = NonNullable<RecipeV2['conflicts']>[number]

/** 다른 곳 한 쪽이 그 출처 근거에 있는지. 있으면 근거 쪽 출처·시각 */
function groundSide(text: string, origin: Origin, at: number | null, about: string, ingredients: Ingredient[], s: Sources): { origin: Origin; at: number | null } | null {
  if (origin === 'user' || origin === 'editor') return null
  const w = windowOf(origin, at, s)
  if (!w) return null
  const g = ingredients.find((x) => sameName(x.name, about))
  const amount = parseAmountValue(text)
  let ok: boolean
  if (amount && g) ok = findAmount(w.text, g.name, amount.amount, amount.unit ?? g.unit, ingredients.filter((x) => x !== g).map((x) => x.name))
  else if (amount) ok = hasQuantity(w.text, amount.amount, amount.unit)
  else ok = groundValue(text, { kind: 'text' }, w.text) !== null
  return ok ? { origin: w.origin, at: w.at } : null
}

/**
 * 모델이 낸 다른 곳을 근거와 맞춘다. 두 쪽 다 못 찾으면 그 다른 곳을 뺀다. 한쪽만 찾으면 다른 쪽을 덧붙임(editor)으로 바꿔
 * 출처 이름이 보이지 않게 하고, 영상 시각은 찾은 쪽 것만 둔다. 돌려주는 map은 옛 번호 → 새 번호(뺀 것은 없음).
 */
function groundConflicts(list: Conflict[], ingredients: Ingredient[], s: Sources): { kept: Conflict[]; map: Map<number, number> } {
  const kept: Conflict[] = []
  const map = new Map<number, number>()
  list.forEach((c, i) => {
    const at = c.video_start_seconds ?? null
    const timeOf = (o: Origin) => (o === 'description' ? null : at)
    const chosen = groundSide(c.chosen, c.chosen_origin, timeOf(c.chosen_origin), c.about, ingredients, s)
    const other = groundSide(c.other, c.other_origin, timeOf(c.other_origin), c.about, ingredients, s)
    if (!chosen && !other) return
    const time = [chosen, other].map((x) => x?.at ?? null).find((t) => t !== null) ?? null
    map.set(i, kept.length)
    kept.push({
      ...c,
      chosen_origin: chosen ? chosen.origin : 'editor',
      other_origin: other ? other.origin : 'editor',
      video_start_seconds: time,
    })
  })
  return { kept, map }
}

/** 확인 필요·고친 곳의 conflicts[i] 번호를 새 번호로 바꾼다. 뺀 다른 곳을 가리키면 null */
function remapConflict(target: string, map: Map<number, number>): string | null {
  const m = /^conflicts\[(\d+)\](.*)$/.exec(target)
  if (!m) return target
  const to = map.get(Number(m[1]))
  return to === undefined ? null : `conflicts[${to}]${m[2]}`
}

// ── 단위 없는 숫자(R3) ──────────────────────────────────────────────
// 단위 없이 적힌 수는 개수로 세는 재료일 때만 다 된 분량이다("달걀 2"). 그 밖에는 확인 필요로 남긴다.
const COUNTED = new Set([
  '달걀', '계란', '메추리알', '양파', '감자', '고구마', '왕고구마', '당근', '오이', '애호박', '호박', '가지', '토마토', '방울토마토',
  '사과', '배', '레몬', '라임', '아보카도', '바나나', '고추', '청양고추', '홍고추', '풋고추', '피망', '파프리카', '대파', '쪽파',
  '깻잎', '김', '두부', '새우', '전복', '오징어', '소시지', '떡', '만두', '식빵', '또띠아', '토르티야', '버섯', '표고버섯', '새송이버섯',
])
const countedName = (name: string) => COUNTED.has(name.replace(/\([^)]*\)|\[[^\]]*\]/g, '').replace(/\s+/g, ''))

/**
 * 숫자는 있는데 단위가 비었고 세는 재료가 아닌 줄을 확인 필요로 올린다(까닭 "단위를 읽지 못했어요").
 * 후보는 그 재료 가까이에 적힌, 같은 수에 단위가 붙은 분량이다. 사람이 고친 줄(user)과 이미 같은 항목이 있는 줄은 건너뛴다.
 * only를 주면 그 번호의 재료만 본다(V3가 값을 바꾼 줄).
 */
export function unitlessReviews(recipe: RecipeV2, e: Evidence, only?: readonly number[]): ReviewItem[] {
  const s = sourcesOf(e)
  const out: ReviewItem[] = []
  const prior = recipe.review_items ?? []
  recipe.ingredients.forEach((g, i) => {
    if (only && !only.includes(i)) return
    if (g.amount === null || g.origin === 'user' || (g.unit != null && g.unit.trim() !== '') || countedName(g.name)) return
    const target = `ingredients[${i}].amount`
    if (prior.some((x) => x.target === target && x.reason === REASONS.unit)) return
    const others = recipe.ingredients.filter((_, j) => j !== i).map((x) => x.name)
    const candidates = amountCandidates(g, s, others).filter((c) => {
      const p = parseAmountValue(c.value)
      return p !== null && p.unit !== null && Math.abs(p.amount - (g.amount ?? 0)) < 0.01
    })
    out.push({ target, reason: REASONS.unit, candidates })
  })
  return out
}

// ── 계량 도구(M9) ────────────────────────────────────────────────────
// 계량 도구는 근거 글에 그 도구의 말이 있어야 한다(설명란, 또는 근거로 단 시각 근처의 말·화면 글자). 장면 그림만으로는 정하지 않는다.
const TOOL_WORDS = {
  spoon: /계량\s*(?:스푼|숟가락|숟갈)|테이블\s*스푼|티\s*스푼|tbsp|tsp/i,
  rice: /밥\s*(?:숟가락|숟갈|스푼|수저)|어른\s*(?:숟가락|숟갈)/,
} as const

/** 근거에서 찾은 기준(시각)만 남긴 measuring_tool_basis. 도구의 말을 못 찾으면 null */
function groundTool(tool: RecipeV2['measuring_tool'], basis: NonNullable<RecipeV2['measuring_tool_basis']>, s: Sources) {
  if (tool === undefined || tool === '확인 못 함') return { tool, basis }
  const need = tool === '계량스푼' ? [TOOL_WORDS.spoon] : tool === '밥숟가락' ? [TOOL_WORDS.rice] : [TOOL_WORDS.spoon, TOOL_WORDS.rice]
  const kept: typeof basis = []
  const seen = new Set<RegExp>()
  for (const b of basis) {
    const w = windowOf(b.origin, b.at_seconds, s)
    if (!w) continue
    const hits = need.filter((re) => re.test(w.text))
    if (hits.length === 0) continue
    hits.forEach((re) => seen.add(re))
    kept.push({ origin: w.origin, at_seconds: w.at })
  }
  return need.every((re) => seen.has(re)) ? { tool, basis: kept } : null
}

const clip = (v: string | null) => (v === null ? null : v.slice(0, 80))
const num = (v: number | null | undefined) => (v == null ? null : fmt(v))

function fix(target: string, before: string | null, after: string | null, origin: Origin | null = null, at: number | null = null): Correction {
  return { target, before: clip(before), after: clip(after), origin, at_seconds: at, method: 'rule' }
}

const covers = (target: string, prefix: string) => target === prefix || target.startsWith(`${prefix}.`)

/** 정리 결과(계약 v2)를 근거와 맞춰 본다. 받은 레시피는 바꾸지 않는다. */
export function checkRecipe(r: RecipeV2, e: Evidence): { recipe: RecipeV2; corrections: Correction[]; reviews: ReviewItem[] } {
  const recipe = structuredClone(r)
  const s = sourcesOf(e)
  const corrections: Correction[] = []
  const reviews: ReviewItem[] = []
  const { ingredients, steps } = recipe
  const duration = e.meta.duration

  // 0. 정리가 낸 다른 곳·확인 후보는 근거에서 찾은 것만 남긴다(I6). 다른 곳을 빼면 그것을 가리키던 번호도 바꾼다.
  if (recipe.conflicts && recipe.conflicts.length > 0) {
    const { kept, map } = groundConflicts(recipe.conflicts, ingredients, s)
    recipe.conflicts = kept
    if (recipe.review_items) {
      recipe.review_items = recipe.review_items.flatMap((x) => { const t = remapConflict(x.target, map); return t === null ? [] : [{ ...x, target: t }] })
    }
    if (recipe.corrections) {
      recipe.corrections = recipe.corrections.flatMap((x) => { const t = remapConflict(x.target, map); return t === null ? [] : [{ ...x, target: t }] })
    }
  }
  if (recipe.review_items) {
    recipe.review_items = recipe.review_items.map((item) => {
      const field = fieldOf(item.target, ingredients)
      const candidates: Candidate[] = []
      for (const c of item.candidates) {
        const g = groundCandidate(c, field, s)
        if (g) pushCandidate(candidates, g.value, g.origin, g.at_seconds)
      }
      return { ...item, candidates }
    })
  }

  // 1. 덧붙임이 출처 숫자 칸 옆에 있으면 지운다(R-07, DB 제약): 숫자 분량이 있는 재료의 덧붙인 분량, 출처 인분이 있을 때의 덧붙인 인분
  ingredients.forEach((g, i) => {
    if (g.amount === null || (g.suggested_amount == null && g.suggested_unit == null)) return
    corrections.push(fix(`ingredients[${i}].suggested_amount`, g.suggested_amount != null ? formatAmountValue(g.suggested_amount, g.suggested_unit) : g.suggested_unit ?? null, null))
    g.suggested_amount = null
    g.suggested_unit = null
  })
  if (recipe.servings.value !== null && recipe.servings.suggested != null) {
    corrections.push(fix('servings.suggested', formatServingsValue(recipe.servings.suggested), null))
    recipe.servings.suggested = null
  }

  // 2. 단계에서 쓰는 재료는 재료 목록에 있어야 한다. 띄어쓰기·괄호만 다르면 이름을 맞추고, 없으면 목록 끝에 더한다(앞 번호는 그대로).
  steps.forEach((st, si) => {
    if (!st.uses) return
    const kept: NonNullable<typeof st.uses> = []
    st.uses.forEach((u, ui) => {
      const at = st.video_start_seconds ?? null
      if (ingredients.some((g) => g.name === u.name)) {
        kept.push(u)
        return
      }
      const same = ingredients.find((g) => sameName(u.name, g.name))
      if (same) {
        corrections.push(fix(`steps[${si}].uses[${ui}].name`, u.name, same.name, st.origin, at))
        kept.push({ ...u, name: same.name })
        return
      }
      const name = u.name.trim()
      if (!name || ingredients.length >= 80) {
        corrections.push(fix(`steps[${si}].uses[${ui}].name`, u.name || null, null, null, null))
        return
      }
      ingredients.push({ name, amount: null, unit: null, origin: st.origin })
      corrections.push(fix(`ingredients[${ingredients.length - 1}]`, null, name, st.origin, at))
      kept.push({ ...u, name })
    })
    st.uses = kept
  })

  // 3. 단계·원리·다른 곳의 영상 시각은 영상 길이 안에 있어야 한다(타이머를 찾는 구간이 단계 시각에 기대므로 먼저 본다)
  if (duration > 0) {
    const clamp = (list: { video_start_seconds?: number | null }[] | undefined, name: string) =>
      list?.forEach((x, i) => {
        if (x.video_start_seconds == null || x.video_start_seconds <= duration) return
        corrections.push(fix(`${name}[${i}].video_start_seconds`, num(x.video_start_seconds), null))
        x.video_start_seconds = null
      })
    clamp(steps, 'steps')
    clamp(recipe.principles, 'principles')
    clamp(recipe.conflicts, 'conflicts')
  }

  // 4. 분량 숫자는 근거에 글자로 있어야 한다. 단 출처에 없고 다른 출처에 있으면 출처·시각을 고치고, 어디에도 없으면 숫자만 지운다.
  ingredients.forEach((g, i) => {
    if (g.amount === null || g.origin === 'user') return
    const amount = g.amount
    const others = ingredients.filter((_, j) => j !== i).map((x) => x.name)
    const found = locateAmount(g, amount, s, others)
    if (found === null) {
      corrections.push(fix(`ingredients[${i}].amount`, formatAmountValue(amount, g.unit), null))
      reviews.push({ target: `ingredients[${i}].amount`, reason: REASONS.amount, candidates: amountCandidates(g, s, others) })
      g.amount = null
      g.needs_review = true
      return
    }
    if (found.origin !== g.origin) {
      corrections.push(fix(`ingredients[${i}].origin`, g.origin, found.origin, found.origin, found.at))
      g.origin = found.origin
    }
    if (found.at !== (g.at_seconds ?? null)) {
      corrections.push(fix(`ingredients[${i}].at_seconds`, num(g.at_seconds), num(found.at), found.origin, found.at))
      g.at_seconds = found.at
    }
  })
  if (duration > 0) {
    ingredients.forEach((g, i) => {
      if (g.at_seconds == null || g.at_seconds <= duration) return
      if (g.origin === 'user' || (g.amount !== null && TIMED.includes(g.origin))) return // 말·화면 숫자에는 시각이 있어야 한다(계약)
      corrections.push(fix(`ingredients[${i}].at_seconds`, num(g.at_seconds), null))
      g.at_seconds = null
    })
  }

  // 4-2. 숫자는 있는데 단위가 없으면(세는 재료가 아니면) 확인 필요(R3)
  reviews.push(...unitlessReviews(recipe, e))

  // 5. 인분도 같은 검사(인분은 시각이 없어 출처 전체에서 찾는다)
  const sv = recipe.servings
  if (sv.value !== null && sv.origin !== 'user') {
    const found = locateServings(sv.value, sv.origin, s)
    if (found === null) {
      corrections.push(fix('servings.value', formatServingsValue(sv.value), null))
      reviews.push({ target: 'servings.value', reason: REASONS.amount, candidates: servingsCandidates(s) })
      sv.value = null
      sv.origin = null
    } else if (found !== sv.origin) {
      corrections.push(fix('servings.origin', sv.origin, found, found, null))
      sv.origin = found
    }
  }

  // 6. 시간: 덧붙인 단계에는 타이머를 두지 않고(DB 제약), 나머지는 그 단계 동안의 근거에서 찾는다("3분" = 180초)
  steps.forEach((st, i) => {
    if (st.timer_seconds == null || st.origin === 'user') return
    const before = formatSecondsValue(st.timer_seconds)
    if (st.origin === 'editor') {
      corrections.push(fix(`steps[${i}].timer_seconds`, before, null))
      st.timer_seconds = null
      return
    }
    const start = st.video_start_seconds ?? null
    let span: [number, number] | null = null
    if (start !== null) {
      const later = steps.map((x) => x.video_start_seconds).filter((v): v is number => v != null && v > start)
      span = [start, later.length > 0 ? Math.min(...later) : Infinity]
    }
    if (timerFound(st.timer_seconds, span, s)) return
    corrections.push(fix(`steps[${i}].timer_seconds`, before, null))
    reviews.push({ target: `steps[${i}].timer_seconds`, reason: REASONS.timer, candidates: [] })
    st.timer_seconds = null
    st.needs_review = true
  })

  // 7. 필수 재료는 어느 단계에선가 쓰여야 한다(uses 또는 단계 글에 이름이 나옴)
  const stepTexts = steps.map((st) => [st.title, st.body, st.cue ?? ''].join(' '))
  ingredients.forEach((g, i) => {
    if (g.optional) return
    const used = steps.some((st) => st.uses?.some((u) => sameName(u.name, g.name))) || stepTexts.some((t) => containsName(t, g.name))
    if (used) return
    reviews.push({ target: `ingredients[${i}]`, reason: REASONS.unused, candidates: [] })
    g.needs_review = true
  })

  // 8-1. 계량 도구는 근거 글에 그 도구의 말이 있어야 한다(M9). 없으면 확인 못 함으로 두고 고친 곳에 남긴다.
  if (recipe.measuring_tool !== undefined && recipe.measuring_tool !== '확인 못 함') {
    const grounded = groundTool(recipe.measuring_tool, recipe.measuring_tool_basis ?? [], s)
    if (grounded === null) {
      corrections.push(fix('measuring_tool', recipe.measuring_tool, '확인 못 함'))
      recipe.measuring_tool = '확인 못 함'
      recipe.measuring_tool_basis = []
    } else {
      recipe.measuring_tool_basis = grounded.basis
    }
  }

  // 8. 계량 도구: "스푼"·"숟가락"처럼 도구를 정하지 않은 표기가 분량에 쓰였는데 도구를 확인 못 했으면 확인 필요(하나만)
  const tool = recipe.measuring_tool ?? '확인 못 함'
  const spoon = ingredients.some((g) => [g.unit, g.amount_text].some((t) => t != null && AMBIGUOUS_SPOON.test(t.replace(NAMED_SPOON, ''))))
  const asked = (recipe.review_items ?? []).some((x) => x.target === 'measuring_tool')
  if (spoon && tool === '확인 못 함' && !asked) reviews.push({ target: 'measuring_tool', reason: REASONS.spoon, candidates: [] })

  // 9. 영상(설명란 포함) 출처를 단 용어 풀이의 말은 그 시각 근거에 있어야 한다. 없으면 덧붙임(editor)으로 바꾼다.
  recipe.glossary?.forEach((item, i) => {
    if (item.origin === 'editor' || item.origin === 'user') return
    const found = locateTerm(item.term, item.origin, item.at_seconds, s)
    if (found === item.origin) return
    if (found !== null) {
      corrections.push(fix(`glossary[${i}].origin`, item.origin, found, found, item.at_seconds))
      item.origin = found
      return
    }
    corrections.push(fix(`glossary[${i}].origin`, item.origin, 'editor'))
    if (item.at_seconds !== null) corrections.push(fix(`glossary[${i}].at_seconds`, num(item.at_seconds), null))
    item.origin = 'editor'
    item.at_seconds = null
  })

  // 다시 돌려도 같은 확인 필요가 두 번 생기지 않게(받은 것과 대상·까닭이 같은 것은 뺀다)
  const prior = recipe.review_items ?? []
  for (let k = reviews.length - 1; k >= 0; k--) {
    const item = reviews[k]!
    if (prior.some((x) => x.target === item.target && x.reason === item.reason)) reviews.splice(k, 1)
  }

  // 10. 확인 필요와 needs_review를 맞춘다(재료·단계·원리 모두): 항목이 가리키는 곳은 needs_review, needs_review인데 항목이 없으면 항목을 더한다
  const existing = recipe.review_items ?? []
  const flaggable: Record<string, { needs_review?: boolean }[]> = { ingredients, steps, principles: recipe.principles ?? [] }
  for (const item of [...existing, ...reviews]) {
    const m = /^(ingredients|steps|principles)\[(\d+)\]/.exec(item.target)
    const x = m ? flaggable[m[1]!]?.[Number(m[2])] : undefined
    if (x) x.needs_review = true
  }
  const hasItem = (prefix: string) => [...existing, ...reviews].some((item) => covers(item.target, prefix))
  for (const [name, list] of Object.entries(flaggable)) {
    list.forEach((x, i) => {
      if (x.needs_review && !hasItem(`${name}[${i}]`)) reviews.push({ target: `${name}[${i}]`, reason: REASONS.flagged, candidates: [] })
    })
  }

  // 11. 받은 것 뒤에 붙인다(계약: 각 40개까지). 확인 필요가 넘치면 마지막 칸에 남은 수를 적는다.
  if (recipe.corrections !== undefined || corrections.length > 0) {
    recipe.corrections = [...(recipe.corrections ?? []), ...corrections].slice(0, MAX_LIST)
  }
  if (recipe.review_items !== undefined || reviews.length > 0) {
    const all = [...existing, ...reviews]
    recipe.review_items =
      all.length <= MAX_LIST
        ? all
        : [...all.slice(0, MAX_LIST - 1), { target: '확인 필요', reason: `확인할 곳이 ${all.length - (MAX_LIST - 1)}곳 더 있음`, candidates: [] }]
  }

  return { recipe, corrections, reviews }
}
