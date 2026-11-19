// 숫자 찾기(V1 기계 검사의 바탕). 근거 글의 한국어 수·분수·T·t 표기를 같은 꼴로 바꾸고,
// 재료 이름 가까이에 그 숫자가 있는지 본다. 순수 함수만 둔다.
// 맞는 숫자를 지우는 것이 틀린 숫자를 놓치는 것보다 나쁘다. 그래서 이름은 너그럽게(띄어쓰기, 괄호 속 다른 이름,
// 머리 낱말) 찾고, 단위 없이 적힌 숫자("달걀 2")는 어느 단위와도 맞는 것으로 본다. 단위가 적혀 있으면 그대로 견준다.
import { UNIT_ML } from '../../../../supabase/functions/_shared/recipeUnits.ts'

// T·t는 단위 표(recipeUnits)에서 큰술·작은술과 같은 ml로 묶인다. 대소문자를 그대로 본다(T=큰술, t=작은술).
const SPOONS: [string, string][] = Object.entries(UNIT_ML).map(([u, ml]) => [u, ml === 15 ? '큰술' : ml === 5 ? '작은술' : u])

const COUNTERS = [
  '개', '대', '모', '장', '알', '쪽', '줄기', '줄', '봉지', '봉', '캔', '마리', '꼬집', '줌', '톨', '뿌리', '포기', '근',
  '덩이', '덩어리', '조각', '팩', '통', '단', '송이', '공기', '국자', '방울', '잎', '토막', '그릇',
]

/** 적힌 단위 → 같은 꼴. 스푼·숟가락·밥숟가락은 어느 도구인지 모르는 표기라 큰술과도, 서로와도 다른 단위로 둔다. */
const ALIASES: [string, string][] = [
  ...SPOONS,
  ['큰 술', '큰술'], ['테이블스푼', '큰술'], ['테이블 스푼', '큰술'], ['tablespoons', '큰술'], ['tablespoon', '큰술'],
  ['Tbsp', '큰술'], ['tbsp', '큰술'], ['TBSP', '큰술'], ['Tbs', '큰술'], ['tbs', '큰술'],
  ['작은 술', '작은술'], ['티스푼', '작은술'], ['티 스푼', '작은술'], ['teaspoons', '작은술'], ['teaspoon', '작은술'],
  ['tsp', '작은술'], ['Tsp', '작은술'], ['TSP', '작은술'],
  ['밥숟가락', '밥숟가락'], ['밥 숟가락', '밥숟가락'], ['밥숟갈', '밥숟가락'], ['밥스푼', '밥숟가락'],
  ['숟가락', '숟가락'], ['숟갈', '숟가락'], ['수저', '숟가락'],
  ['큰스푼', '큰스푼'], ['작은스푼', '작은스푼'], ['스푼', '스푼'],
  ['종이컵', '종이컵'], ['컵', '컵'],
  ['킬로그램', 'kg'], ['킬로', 'kg'], ['kg', 'kg'], ['Kg', 'kg'], ['KG', 'kg'],
  ['그램', 'g'], ['g', 'g'], ['G', 'g'],
  ['밀리리터', 'ml'], ['밀리', 'ml'], ['미리', 'ml'], ['ml', 'ml'], ['mL', 'ml'], ['ML', 'ml'], ['cc', 'ml'], ['CC', 'ml'],
  ['리터', 'l'], ['L', 'l'], ['l', 'l'],
  ['인분', '인분'], ['명분', '인분'], ['인용', '인분'], ['인', '인분'], ['명', '인분'], ['사람', '인분'],
  ['시간', '시간'], ['분', '분'], ['초', '초'],
  ...COUNTERS.map((c): [string, string] => [c, c]),
]
const ALIAS_MAP = new Map(ALIASES)

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const isLatin = (s: string) => /^[A-Za-z]/.test(s)
/** 긴 낱말부터 고르는 대안 목록. 로마자 단위는 뒤에 로마자가 붙으면 단위가 아니다("1 tomato"의 t). */
const alt = (words: string[]) =>
  [...new Set(words)].sort((a, b) => b.length - a.length).map((w) => (isLatin(w) ? `${esc(w)}(?![A-Za-z])` : esc(w))).join('|')

const UNIT_WORD = alt(ALIASES.map(([a]) => a))
const CANON_WORD = alt(ALIASES.map(([, c]) => c))
// 한국어 수 뒤에 올 수 있는 단위. "인"은 "한 인기 메뉴" 같은 말과 헷갈려 뺀다.
const HANGUL_UNIT = alt(ALIASES.map(([a]) => a).filter((a) => !isLatin(a) && a !== '인'))
// 한자어 수(일·이·삼…)는 이 단위 바로 앞에서만 수로 본다("이 양념", "이 컵에"는 수가 아니다).
const SINO_UNIT = alt(['분', '초', '인분', '그램', '킬로그램', '킬로', '밀리리터', '밀리', '미리', '리터', '큰술', '작은술'])

const NUM = '\\d+(?:\\.\\d+)?'
// 가로 띄어쓰기만(줄을 넘어 숫자와 단위를 잇지 않는다)
const H = '[^\\S\\r\\n]'
const NOT_WORD_BEFORE = '(?<![가-힣\\d.])'

export const fmt = (n: number) => String(Math.round(n * 1000) / 1000)

const VULGAR: Record<string, number> = { '½': 1 / 2, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 1 / 4, '¾': 3 / 4, '⅕': 1 / 5, '⅛': 1 / 8 }
const NATIVE: Record<string, number> = { 한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9 }
const NATIVE_RANGE: Record<string, string> = {
  한두: '1~2', 두세: '2~3', 두어: '2~3', 서너: '3~4', 너덧: '4~5', 너댓: '4~5', 네댓: '4~5', 네다섯: '4~5',
  대여섯: '5~6', 예닐곱: '6~7', 일고여덟: '7~8', 일여덟: '7~8',
}
const STANDALONE: Record<string, number> = { 하나: 1, 둘: 2, 셋: 3, 넷: 4 }
const SINO: Record<string, number> = { 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9 }

const re = (src: string) => new RegExp(src, 'g')
const RE = {
  vulgar: re(`(?:(\\d+)${H}*(?:과|와)?${H}*)?([½⅓⅔¼¾⅕⅛])`),
  thousands: re(`(?<![\\d.,])(\\d{1,3}(?:,\\d{3})+)(?![\\d])`),
  mixed: re(`(?<![\\d./])(\\d+)(?:${H}*(?:과|와)${H}*|${H}+)(\\d{1,2})/(\\d{1,2})(?![\\d/])`),
  fraction: re(`(?<![\\d./])(\\d{1,2})/(\\d{1,2})(?![\\d/])`),
  bunui: re(`(?<![\\d.])(\\d+)${H}*분의${H}*(\\d+)`),
  nativeRange: re(`(?<![가-힣\\d])(${Object.keys(NATIVE_RANGE).sort((a, b) => b.length - a.length).join('|')})${H}*(?=(?:${HANGUL_UNIT}))`),
  native: re(`(?<![가-힣\\d])(열(?:다섯|여섯|일곱|여덟|아홉|한|두|세|네)?|스무|다섯|여섯|일곱|여덟|아홉|한|두|세|네)${H}*(?=(?:${HANGUL_UNIT}))`),
  sino: re(
    `(?<![가-힣\\d])(?=[일이삼사오육칠팔구십백천])((?:[이삼사오육칠팔구]?천)?(?:[이삼사오육칠팔구]?백)?(?:[이삼사오육칠팔구]?십)?[일이삼사오육칠팔구]?)${H}*(?=(?:${SINO_UNIT}))`,
  ),
  standalone: re(`(?<![가-힣\\d])(하나|둘|셋|넷)(?=$|[^가-힣]|을|를|이|가|만|씩|쯤|정도|와|랑)`),
  leadingHalf: re(`${NOT_WORD_BEFORE}반${H}*(?=(?:${HANGUL_UNIT}))`),
  unit: re(`(${NUM})${H}*(${UNIT_WORD})`),
  // "한 큰술 반", "1개 반이면". "1개 반으로 썰어"(반으로 자른다)는 1.5가 아니다.
  trailingHalf: re(`(${NUM})(${CANON_WORD})${H}*반(?=$|[^가-힣]|을|이|만|씩|쯤|정도)`),
  standaloneHalf: re(`${NOT_WORD_BEFORE}반(?=$|[^가-힣]|을|이|만|씩|쯤|정도)`),
  range: re(`(\\d(?:${CANON_WORD})?)${H}*[~∼〜–—-]${H}*(?=\\d)`),
}

function sinoValue(s: string): number {
  let rest = s
  let total = 0
  for (const [mark, place] of [['천', 1000], ['백', 100], ['십', 10]] as const) {
    const i = rest.indexOf(mark)
    if (i < 0) continue
    const d = rest.slice(0, i)
    total += (d ? (SINO[d] ?? 1) : 1) * place
    rest = rest.slice(i + 1)
  }
  return total + (rest ? (SINO[rest] ?? 0) : 0)
}

function nativeValue(s: string): number {
  if (s === '스무') return 20
  if (s.startsWith('열')) return 10 + (NATIVE[s.slice(1)] ?? 0)
  return NATIVE[s] ?? 0
}

/**
 * 근거 글의 수와 단위를 같은 꼴로 바꾼다. 한국어 수(한·두·세…열, 하나·둘, 단위 앞의 일·이·삼…), 반, 분수(1/2, ½, 1과 1/2),
 * 천 단위 쉼표, 범위(두세 → 2~3, 2-3 → 2~3), 단위 표기(T → 큰술, t → 작은술, 그램 → g, mL → ml …).
 * 단위는 숫자 바로 뒤에 붙여 쓴다("설탕 2T" → "설탕 2큰술"). 숫자가 아닌 말은 그대로 둔다.
 */
export function normalizeNumbers(text: string): string {
  let s = text.replace(RE.vulgar, (_, whole: string | undefined, f: string) => fmt(Number(whole ?? 0) + (VULGAR[f] ?? 0)))
  s = s.normalize('NFKC').replace(/⁄/g, '/')
  s = s.replace(RE.thousands, (m) => m.replace(/,/g, ''))
  s = s.replace(RE.mixed, (m, w: string, n: string, d: string) => (Number(d) > 0 ? fmt(Number(w) + Number(n) / Number(d)) : m))
  s = s.replace(RE.fraction, (m, n: string, d: string) => (Number(d) > 0 ? fmt(Number(n) / Number(d)) : m))
  s = s.replace(RE.bunui, (m, d: string, n: string) => (Number(d) > 0 ? fmt(Number(n) / Number(d)) : m))
  s = s.replace(RE.nativeRange, (_, w: string) => NATIVE_RANGE[w] ?? w)
  s = s.replace(RE.native, (_, w: string) => fmt(nativeValue(w)))
  s = s.replace(RE.sino, (m, w: string) => (w ? fmt(sinoValue(w)) : m))
  s = s.replace(RE.standalone, (_, w: string) => fmt(STANDALONE[w] ?? 0))
  s = s.replace(RE.leadingHalf, '0.5')
  s = s.replace(RE.unit, (_, n: string, u: string) => `${n}${ALIAS_MAP.get(u) ?? u}`)
  s = s.replace(RE.trailingHalf, (_, n: string, u: string) => `${fmt(Number(n) + 0.5)}${u}`)
  s = s.replace(RE.standaloneHalf, '0.5')
  s = s.replace(RE.range, '$1~')
  return s
}

/** 레시피에 적힌 단위를 근거 글과 같은 꼴로. 모르는 단위는 그대로. */
export function canonUnit(unit: string): string {
  const u = unit.trim()
  return ALIAS_MAP.get(u) ?? ALIAS_MAP.get(u.replace(/\s+/g, '')) ?? u
}

/** 바꾼 글 속의 수 하나. unit은 아는 단위(같은 꼴), word는 모르는 낱말이 바로 붙은 것("2번"), 둘 다 없으면 단위 없이 적힌 수 */
export type Quantity = { value: number; unit: string | null; word: string | null; range: boolean; index: number; end: number }

// 수 뒤에 붙은 조사는 단위가 아니다("하나를" → "1를")
const PARTICLE = /^(?:을|를|이|가|은|는|도|만|씩|쯤|정도|에|와|과|로|으로|의|만큼|이나|나|랑|하고|보다)/
const TOKEN = new RegExp(`(?<![\\d.~])(${NUM})(?:(${CANON_WORD})|([가-힣A-Za-z]+))?(?:~(${NUM})(?:(${CANON_WORD})|([가-힣A-Za-z]+))?)?`, 'g')

/** normalizeNumbers를 거친 글에서 수를 모두 꺼낸다. 범위("2~3큰술")는 range로 표시한다(한 숫자로 쓰지 않는다). */
export function quantities(normalized: string): Quantity[] {
  const out: Quantity[] = []
  for (const m of normalized.matchAll(TOKEN)) {
    const range = m[4] !== undefined
    const unit = (range ? (m[5] ?? m[2]) : m[2]) ?? null
    const rawWord = (range ? (m[6] ?? m[3]) : m[3]) ?? null
    const word = rawWord !== null && !PARTICLE.test(rawWord) ? rawWord : null
    out.push({ value: Number(m[1]), unit, word: unit === null ? word : null, range, index: m.index, end: m.index + m[0].length })
  }
  return out
}

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
    const words = stripped.trim().split(/\s+/).filter((w) => w.length >= 2 && !NAME_STOP.has(w))
    if (words.length > 1) {
      add(words[0]!)
      add(words[words.length - 1]!)
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

const hasVariant = (text: string, variants: string[]) => {
  const k = key(text)
  return variants.some((v) => k.includes(v))
}

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

// 한 줄 안에서 재료 하나의 몫을 가르는 표시. 분수는 이미 소수로 바뀌어 있다.
const CLAUSE = /[,，;|·•/]/

// 분량이 아닌 수(시간·인분). "구분"이 "9분"으로 읽히는 것 같은 잘못 읽은 수가 분량 찾기를 막지 않게 뺀다.
const NOT_AMOUNT = new Set(['인분', '시간', '분', '초'])
const amountsIn = (normalized: string) => quantities(normalized).filter((q) => q.unit === null || !NOT_AMOUNT.has(q.unit))

/**
 * 재료 이름 가까이의 분량 수: 이름이 든 줄마다, 이름이 든 덩이(쉼표 등으로 가른 몫)의 수.
 * 그 덩이에 수가 하나도 없으면("간장, 설탕 각 2큰술") 그 줄의 수를 본다. 시간·인분 수는 뺀다.
 */
export function nearbyQuantities(text: string, name: string): Quantity[] {
  const variants = nameVariants(name)
  const out: Quantity[] = []
  for (const raw of text.split(/\r?\n/)) {
    if (!hasVariant(raw, variants)) continue // 이름 꼴에 바꾸기 전 이름도 있으니 바꾸기 전 줄로 먼저 거른다
    const line = normalizeNumbers(raw)
    if (!hasVariant(line, variants)) continue
    const near = line.split(CLAUSE).filter((c) => hasVariant(c, variants)).flatMap((c) => amountsIn(c))
    out.push(...(near.length > 0 ? near : amountsIn(line)))
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
 */
export function findAmount(text: string, name: string, amount: number, unit: string | null): boolean {
  return nearbyQuantities(text, name).some((q) => amountMatches(q, amount, unit))
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
