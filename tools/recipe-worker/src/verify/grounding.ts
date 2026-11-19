// 숫자 찾기(V1 기계 검사의 바탕). 근거 글의 한국어 수·분수·T·t 표기를 같은 꼴로 바꾸고,
// 재료 이름 가까이에 그 숫자가 있는지 본다. 순수 함수만 둔다.
// 맞는 숫자를 지우는 것이 틀린 숫자를 놓치는 것보다 나쁘다. 그래서 이름은 너그럽게(띄어쓰기, 괄호 속 다른 이름,
// 머리 낱말) 찾고, 단위 없이 적힌 숫자("달걀 2")는 어느 단위와도 맞는 것으로 본다. 단위가 적혀 있으면 그대로 견준다.
import { canonUnit, fmt, normalizeNumbers, quantities, type Quantity } from '../../../../supabase/functions/_shared/recipeNumbers.ts'

// 수 꼴 바꾸기(normalizeNumbers·quantities·canonUnit·fmt)는 _shared/recipeNumbers.ts에 있다. 처리기 안에서 쓰던 이름을 그대로 내보낸다.
export { canonUnit, fmt, normalizeNumbers, quantities }
export type { Quantity }

const key = (s: string) => s.replace(/\s+/g, '')
// 머리 낱말로 쓰지 않는 꾸밈말("다진 마늘"의 다진, "대파 흰 부분"의 부분)
const NAME_STOP = new Set(['다진', '부분', '채썬', '썬', '손질한', '불린', '삶은', '데친', '볶은', '구운'])

/** 재료 이름을 찾을 꼴들(띄어쓰기 없앰): 이름 전체, 괄호를 뺀 이름, 괄호 속 다른 이름, 여러 낱말이면 첫·끝 낱말 */
export function nameVariants(name: string): string[] {
  const out = new Set<string>()
  const add = (s: string) => {
    const k = key(s)
    if (k) out.add(k)
  }
  for (const n of new Set([name, normalizeNumbers(name)])) {
    add(n)
    const stripped = n.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    add(stripped)
    for (const m of n.matchAll(/\(([^)]*)\)/g)) for (const part of (m[1] ?? '').split(/[,/·]/)) add(part)
    const words = stripped.trim().split(/\s+/)
    if (words.length > 1) {
      const heads = words.filter((w) => w.length >= 2 && !NAME_STOP.has(w))
      if (heads.length > 0) {
        add(heads[0]!)
        add(heads[heads.length - 1]!)
      }
    }
  }
  return [...out]
}

/** 이름이 같은 재료인지(띄어쓰기·괄호만 다름). 머리 낱말은 보지 않는다. */
export function sameName(a: string, b: string): boolean {
  const exact = (s: string) => {
    const set = new Set([key(s), key(s.replace(/\([^)]*\)|\[[^\]]*\]/g, ''))])
    for (const m of s.matchAll(/\(([^)]*)\)/g)) for (const part of (m[1] ?? '').split(/[,/·]/)) if (key(part)) set.add(key(part))
    set.delete('')
    return set
  }
  const sb = exact(b)
  return [...exact(a)].some((v) => sb.has(v))
}

type Hit = { start: number; end: number }

// 짧은 이름(2글자 이하) 바로 뒤에 붙어도 되는 말(조사). 그 밖의 한글이 붙으면 다른 낱말이다("물엿"의 물, "깨소금"의 깨).
const FOLLOW_OK = /^(?:을|를|이|가|은|는|도|만|에|와|과|랑|하고|으로|로|의|부터|까지|처럼|보다|씩|이랑|이나|나|만큼|쯤|정도|요)/

/** 글에서 이름 꼴들이 나오는 자리(띄어쓰기 무시, 원래 글의 위치) */
function nameHits(text: string, variants: string[]): Hit[] {
  const idx: number[] = []
  let k = ''
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i]!)) continue
    idx.push(i)
    k += text[i]
  }
  const out: Hit[] = []
  for (const v of variants) {
    for (let p = k.indexOf(v); p >= 0; p = k.indexOf(v, p + 1)) {
      const hit = { start: idx[p]!, end: idx[p + v.length - 1]! + 1 }
      const next = text.slice(hit.end)
      if (v.length <= 2 && /^[가-힣]/.test(next) && !FOLLOW_OK.test(next)) continue
      out.push(hit)
    }
  }
  return out.sort((a, b) => a.start - b.start || b.end - a.end)
}

const hasVariant = (text: string, variants: string[]) => nameHits(text, variants).length > 0

/** 글에 재료 이름(nameVariants)이 있는지 */
export function containsName(text: string, name: string): boolean {
  const variants = nameVariants(name)
  return hasVariant(text, variants) || hasVariant(normalizeNumbers(text), variants)
}

/** 용어 풀이의 말이 글에 있는지. 띄어쓰기를 무시하고, 끝의 "하게·하다·기"를 뗀 꼴도 본다("깍둑썰기" ↔ "깍둑 썰어"). */
export function containsTerm(text: string, term: string): boolean {
  const k = key(text)
  const t = key(term)
  if (!t) return false
  if (k.includes(t)) return true
  const stem = t.replace(/(?:하게|하다|하기|히|게|기)$/, '')
  return stem.length >= 2 && stem !== t && k.includes(stem)
}

// 한 줄을 덩이로 가르는 표시(괄호 안은 가르지 않는다). "·"·"/"는 가르지 않고 이름을 함께 묶는 표시로 본다(아래 JOIN).
const CLAUSE = /[,，;|•]/
// 덩이 안에서 이름을 함께 묶는 표시("소금·후추 약간", "다리/가슴"). 분수는 이미 소수로 바뀌어 있다.
const JOIN = /[·/]/

/** 괄호 밖에서 sep에 맞는 글자의 자리 */
function outsideParens(line: string, sep: RegExp): number[] {
  const out: number[] = []
  let depth = 0
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!
    if (c === '(' || c === '[') depth++
    else if ((c === ')' || c === ']') && depth > 0) depth--
    else if (depth === 0 && sep.test(c)) out.push(i)
  }
  return out
}

function splitClauses(line: string): string[] {
  const out: string[] = []
  let from = 0
  for (const i of outsideParens(line, CLAUSE)) {
    out.push(line.slice(from, i))
    from = i + 1
  }
  out.push(line.slice(from))
  return out
}

// 분량이 아닌 수(시간·인분). "구분"이 "9분"으로 읽히는 것 같은 잘못 읽은 수를 분량 후보로 쓰지 않는다.
const NOT_AMOUNT = new Set(['인분', '시간', '분', '초'])
const amountsIn = (normalized: string) => quantities(normalized).filter((q) => q.unit === null || !NOT_AMOUNT.has(q.unit))

// 이름 사이·뒤에 이것만 있으면 건너뛴다: 묶는 말(과·와·및·그리고·랑·하고), 조사 하나, 각·모두·씩("간장·설탕 각 2큰술")
const SKIP = /^(?:과|와|및|그리고|랑|이랑|하고|은|는|을|를|이|가|도|각|각각|모두|씩|다|등)?요?$/
const PUNCT = /[\s\-–—•·*:：()[\]{}【】<>「」『』"'.!?…/]/g

/**
 * 한 덩이 안에서 이 재료의 분량 글. 이름 뒤에서 앞으로 가며 묶는 말과 묶인 다른 이름("소금·후추", "소금과 후추")은 건너뛰고,
 * 처음 나오는 다른 글이 묶음 전체의 분량 글이다. 거기서 멈춘다(다음 재료 이름 앞까지, "간장 3큰술 설탕 2큰술"의 간장 → "3큰술").
 * 분량 글에 수가 없으면("약간") 이 재료의 수는 없다. 덩이 끝까지 건너뛸 것만 있으면 이름뿐인 덩이(nameOnly)다.
 * 다른 재료 이름 안에 든 이름("국간장"의 간장)은 이 재료가 아니다.
 */
function clauseAmounts(clause: string, ours: string[], theirs: string[]): { found: Quantity[]; nameOnly: boolean } {
  const their = nameHits(clause, theirs)
  const mine = nameHits(clause, ours).filter((o) => !their.some((t) => t.start <= o.start && t.end >= o.end && t.end - t.start > o.end - o.start))
  const names = their.filter((t) => !mine.some((o) => t.start < o.end && o.start < t.end))
  const joins = outsideParens(clause, JOIN)
  const found: Quantity[] = []
  let nameOnly = false
  for (const o of mine) {
    let pos = o.end
    for (;;) {
      const nextName = names.find((t) => t.start >= pos)
      const nextJoin = joins.find((j) => j >= pos)
      const stop = Math.min(nextName?.start ?? Infinity, nextJoin ?? Infinity, clause.length)
      const piece = clause.slice(pos, stop)
      if (!SKIP.test(piece.replace(PUNCT, ''))) {
        found.push(...amountsIn(piece))
        break
      }
      if (stop === clause.length) {
        nameOnly = true
        break
      }
      pos = nextName !== undefined && nextName.start === stop ? nextName.end : stop + 1
    }
  }
  return { found, nameOnly }
}

function otherVariants(name: string, others: readonly string[]): string[] {
  const mine = new Set(nameVariants(name))
  const out = new Set<string>()
  for (const o of others) {
    if (sameName(o, name)) continue
    for (const v of nameVariants(o)) if (!mine.has(v)) out.add(v)
  }
  return [...out]
}

/**
 * 재료 이름 가까이의 분량 수. 이름이 든 줄마다, 이름이 든 덩이(쉼표 등으로 가른 몫)에서 이 재료(와 함께 묶인 이름들)의 분량 글의 수.
 * 덩이가 이름뿐이면("간장, 설탕 각 2큰술"의 간장) 그 줄의 수를 본다. "소금 약간, 설탕 1작은술"·"소금·후추 약간, 설탕 2T"의 소금은 수가 없다.
 * others는 같은 레시피의 다른 재료 이름(몫을 자르고 묶음을 알아보는 데 쓴다). 시간·인분 수는 뺀다.
 */
export function nearbyQuantities(text: string, name: string, others: readonly string[] = []): Quantity[] {
  const ours = nameVariants(name)
  const theirs = otherVariants(name, others)
  const out: Quantity[] = []
  for (const raw of text.split(/\r?\n/)) {
    if (!hasVariant(raw, ours)) continue // 이름 꼴에 바꾸기 전 이름도 있으니 바꾸기 전 줄로 먼저 거른다
    const line = normalizeNumbers(raw)
    if (!hasVariant(line, ours)) continue
    let clauses = splitClauses(line).filter((c) => hasVariant(c, ours))
    if (clauses.length === 0) clauses = [line] // 이름이 가르는 표시에 걸친 때
    const parts = clauses.map((c) => clauseAmounts(c, ours, theirs))
    const near = parts.flatMap((p) => p.found)
    if (near.length > 0) out.push(...near)
    else if (parts.some((p) => p.nameOnly)) out.push(...amountsIn(line))
  }
  return out
}

/** 수 하나가 레시피의 분량(숫자·단위)과 맞는지. 범위는 맞지 않는다. 단위 없이 적힌 수는 어느 단위와도 맞는다. */
export function amountMatches(q: Quantity, amount: number, unit: string | null): boolean {
  if (q.range || Math.abs(q.value - amount) > 0.01) return false
  if (unit === null || unit.trim() === '') return true
  const cu = canonUnit(unit)
  if (q.unit !== null) return q.unit === cu
  if (q.word !== null) return q.word.startsWith(key(unit)) || q.word.startsWith(cu)
  return true
}

/**
 * 글에 재료 이름과 그 분량이 같은 줄에 있는지. 줄은 \n으로 가른다(설명란은 줄마다, 자막·화면 글자는 묶은 조각을 한 줄로 넘긴다).
 * T·t는 대소문자를 그대로 보고(소금 1t는 1큰술이 아니다), 범위("두세 큰술", "2~3큰술")는 한 숫자로 쓰지 않는다.
 * others(같은 레시피의 다른 재료 이름)를 주면 다른 재료의 숫자를 이 재료의 근거로 쓰지 않는다.
 */
export function findAmount(text: string, name: string, amount: number, unit: string | null, others: readonly string[] = []): boolean {
  return nearbyQuantities(text, name, others).some((q) => amountMatches(q, amount, unit))
}

/** 이름 없이 그 분량이 적혀 있는지(다른 출처를 시각으로 훑을 때 먼저 볼 줄을 고른다) */
export function hasQuantity(text: string, amount: number, unit: string | null): boolean {
  return quantities(normalizeNumbers(text)).some((q) => amountMatches(q, amount, unit))
}

/** 인분: "2인분", "2인 기준", "두 사람" 같은 단위가 있어야 한다. 범위는 안 된다. */
export function hasServings(text: string, value: number): boolean {
  return servingsIn(text).some((v) => Math.abs(v - value) < 0.01)
}

/** 글에 적힌 인분 숫자들(범위 뺌) */
export function servingsIn(text: string): number[] {
  return quantities(normalizeNumbers(text)).filter((q) => !q.range && q.unit === '인분').map((q) => q.value)
}

const SECONDS: Record<string, number> = { 시간: 3600, 분: 60, 초: 1 }

/** 시간: "3분" = 180초, "30초" = 30초, "1분 30초" = 90초, "1시간 반" = 5400초. 단위가 있어야 하고 범위는 안 된다. */
export function hasDuration(text: string, seconds: number): boolean {
  const norm = normalizeNumbers(text)
  const qs = quantities(norm)
  for (let i = 0; i < qs.length; i++) {
    let total = 0
    let last = Infinity
    for (let j = i; j < qs.length; j++) {
      const q = qs[j]!
      const mult = q.unit === null ? undefined : SECONDS[q.unit]
      if (mult === undefined || q.range || mult >= last) break
      if (j > i && norm.slice(qs[j - 1]!.end, q.index).trim() !== '') break
      total += q.value * mult
      last = mult
      if (Math.abs(total - seconds) < 0.5) return true
    }
  }
  return false
}
