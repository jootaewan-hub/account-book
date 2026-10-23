// 상품명 → 식약처 품목 맞춤(D-026, 설계 docs/superpowers/specs/2026-10-23-product-match-design.md): 찾을 말 고르기, 업체 일치, 후보 점수, 자동 저장 기준.
// 순수 함수만 둔다(Deno·Node가 함께 import). 업체는 다나와 상품 페이지의 제조사(청정원 상품은 "대상")를 쓴다. 상표로는 식약처 업체명이 맞지 않는다(2026-10-23 sample 실제 호출).
import { brandVariants, isNoiseWord, squash } from './foodInfo.ts'

/** 자동 맞춤 버전(D-026). 저장한 줄의 v가 이보다 작으면(없으면 1) 화면이 성분 탭을 열 때 다시 맞춘다 */
export const MATCH_VERSION = 2

/** 다나와 상품 페이지에서 읽은 값(`grocery.products`의 maker·brand·origin·materials). 모르면 null */
export type ProductFacts = { maker: string | null; brand: string | null; origin: string | null; materials: string | null }

export type MatchPlan = {
  /** 식약처 업체명(BSSH_NM)에 걸 열쇠: 다나와 제조사, 3자 이상이면 앞 2자도("롯데푸드"→"롯데": 미림은 롯데칠성음료가 보고). 모르면 상품명 첫 낱말 */
  makers: string[]
  /** 이름(PRDLST_NM)으로 찾을 낱말: 상표·업체·용량·숫자 말을 뺀 것을 뒤(핵심어)부터, 한글 낱말 먼저, 3개까지. 대소문자 그대로 */
  words: string[]
  /** 후보 이름에 들어 있어야 할 말(recall): 상표를 뺀 낱말 전부와 숫자("1%"→"1"). 견줄 꼴(squash) */
  need: string[]
  /** 후보 이름을 설명하는 말(cover): 상품명 낱말 전부 + 다나와 상표·제조사. 견줄 꼴 */
  explain: string[]
  /** 다나와 원산지·원재료명에 적힌 원재료 이름("고추양념(중국산), 현미(외국산)"→고추양념, 현미). 나라 이름뿐이면 없다 */
  cues: string[]
}

/** 비교에 쓰는 후보 한 줄(원재료 C002·I1310·C003 줄, 영양성분 상용제품 줄 모두) */
export type MatchCandidate = { name: string; maker: string | null; rawMaterials: string | null; changedOn: string | null }

export type MatchScore<T extends MatchCandidate = MatchCandidate> = {
  row: T
  /** 후보 업체가 업체 열쇠와 같은가(법인 표기 뺀 앞부분) */
  makerOk: boolean
  /** 첫째 열쇠(다나와 제조사 그대로)로 맞았나. 앞 2자 열쇠("롯데")로만 맞으면 false: "롯데"는 롯데칠성음료도 롯데리아도 맞는다 */
  makerFull: boolean
  /** 후보 이름 글자 중 상품 말로 설명되는 비율(0~1): "수출올리브짜파게티과립스프"는 낮다 */
  cover: number
  /** 상품 말(need) 중 후보 이름에 든 비율(0~1): "백일된장"은 "국산콩 백일된장"보다 낮다 */
  recall: number
  /** 다나와 원재료 단서가 후보 원재료에 든 수 */
  cueHits: number
}

const LEGAL = /\(주\)|㈜|주식회사|\(유\)|유한회사|\(합\)|농업회사법인|영농조합법인/g

/** 낱말로 자르고 괄호·쉼표를 뗀다. 용량·수량·광고 말은 뺀다(대소문자 그대로) */
function tokens(text: string): string[] {
  const out: string[] = []
  for (const w of text.split(/\s+/)) {
    const t = w.replace(/[()[\]{},/]/g, '').trim()
    if (!t || isNoiseWord(t.toLowerCase())) continue
    if (!out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t)
  }
  return out
}

/** "고추양념(중국산), 현미(외국산)"·"현미 20.2%, 태양초 11.3%"에서 원재료 이름. 괄호 안 쉼표는 나누지 않고, 괄호 없는 원산지 칸("홍콩산")은 나라라서 뺀다 */
function cueNames(text: string | null, needParen: boolean): string[] {
  if (!text) return []
  const parts: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of text) {
    if (ch === '(') depth++
    if (ch === ')') depth = Math.max(0, depth - 1)
    if (ch === ',' && depth === 0) {
      parts.push(cur)
      cur = ''
    } else cur += ch
  }
  parts.push(cur)
  const out: string[] = []
  for (const p of parts) {
    if (needParen && !p.includes('(')) continue
    const name = squash(p.split('(')[0].replace(/[\d.,]+\s*%?/g, ''))
    if (name.length >= 2 && !out.includes(name)) out.push(name)
  }
  return out
}

export function matchPlan(productName: string, facts: ProductFacts | null): MatchPlan {
  const all = tokens(productName)
  const maker = facts?.maker ? squash(facts.maker.replace(LEGAL, '')) : ''
  const brandWords = new Set(tokens(facts?.brand ?? '').map(squash))
  const first = all.length > 1 ? squash(all[0]) : ''
  // 다나와 정보가 있으면 상표 낱말·제조사와 같은(또는 그 앞부분인) 첫 낱말만 상표로 뺀다. 없으면 지금처럼 첫 낱말을 상표로 본다
  const isBrand = (w: string) => {
    const t = squash(w)
    if (brandWords.has(t)) return true
    if (maker && (t === maker || maker.startsWith(t) || t.startsWith(maker))) return true
    return facts?.maker ? false : t === first
  }
  const rest = all.filter((w) => !isBrand(w))
  const plain = rest.filter((w) => !/\d/.test(w))
  const ko = plain.filter((w) => /[가-힣]/.test(w)).reverse()
  const en = plain.filter((w) => !/[가-힣]/.test(w)).reverse()
  const words = [...ko, ...en].filter((w) => squash(w).length >= 2).slice(0, 3)
  const digits = rest.filter((w) => /\d/.test(w)).map((w) => squash(w)).filter(Boolean)
  const makers = maker ? (maker.length >= 3 ? [maker, maker.slice(0, 2)] : [maker]) : brandVariants(productName)
  const explain = [...new Set([...all.map(squash), ...brandWords, ...(maker ? [maker] : [])].filter(Boolean))]
  const cues = [...new Set([...cueNames(facts?.origin ?? null, true), ...cueNames(facts?.materials ?? null, false)])]
  return { makers, words: words.length > 0 ? words : plain.slice(0, 1), need: [...new Set([...plain.map(squash), ...digits])], explain, cues }
}

/** 업체 일치: 법인 표기를 뺀 후보 업체명이 열쇠로 시작한다("대상(주)오산공장"·"(주)삼양사울산2공장"). 부분 일치로 함께 오는 "현대상회"는 다른 업체 */
export function makerMatches(rowMaker: string | null, makers: readonly string[]): boolean {
  if (!rowMaker) return false
  const m = squash(rowMaker.replace(LEGAL, ''))
  return makers.some((k) => {
    const key = squash(k)
    return key.length >= 2 && m.startsWith(key)
  })
}

export function scoreMatch<T extends MatchCandidate>(row: T, plan: MatchPlan): MatchScore<T> {
  const name = squash(row.name)
  const covered = new Array<boolean>(name.length).fill(false)
  for (const w of plan.explain) {
    if (!w) continue
    for (let i = name.indexOf(w); i >= 0; i = name.indexOf(w, i + 1)) covered.fill(true, i, i + w.length)
  }
  const cover = name.length > 0 ? covered.filter(Boolean).length / name.length : 0
  const recall = plan.need.length > 0 ? plan.need.filter((w) => name.includes(w)).length / plan.need.length : 0
  const raw = squash(row.rawMaterials ?? '')
  const cueHits = raw ? plan.cues.filter((c) => raw.includes(c)).length : 0
  return { row, makerOk: makerMatches(row.maker, plan.makers), makerFull: makerMatches(row.maker, plan.makers.slice(0, 1)), cover, recall, cueHits }
}

/** cover·recall을 하나로(조화 평균): 둘 다 높아야 높다 */
export const fitOf = (s: { cover: number; recall: number }): number => (s.cover + s.recall > 0 ? (2 * s.cover * s.recall) / (s.cover + s.recall) : 0)

/** 순서: 업체 일치 → fitOf → 원재료 단서 → 변경일이 늦은 것 → 짧은 이름 → 받은 순서 */
export function rankMatches<T extends MatchCandidate>(rows: readonly T[], plan: MatchPlan): MatchScore<T>[] {
  return rows
    .map((row, i) => ({ s: scoreMatch(row, plan), i }))
    .sort((a, b) =>
      Number(b.s.makerOk) - Number(a.s.makerOk) ||
      fitOf(b.s) - fitOf(a.s) ||
      b.s.cueHits - a.s.cueHits ||
      (b.s.row.changedOn ?? '').localeCompare(a.s.row.changedOn ?? '') ||
      a.s.row.name.length - b.s.row.name.length ||
      a.i - b.i)
    .map((x) => x.s)
}

/**
 * 자동으로 저장해도 되는가(D-026). 틀린 자동 저장은 못 찾는 것보다 나쁘다(D-018 보충 2). 아니면 화면이 "같은 상품인지 확인해 주세요"로 후보를 보여 준다.
 * best는 rankMatches의 첫째, runnerUp은 둘째(없으면 undefined).
 */
export function shouldAutoSave(best: MatchScore, runnerUp: MatchScore | undefined): boolean {
  // TODO(사용자): 자동 저장 기준
  void best
  void runnerUp
  return false
}
