// 몰 주소 자동 찾기(D-024)의 순수 부분: 검색 결과에서 상품 페이지 주소를 고르고, 그 페이지 이름·용량이 고른 상품과 같은지 견준다.
// Deno(Edge Function shop-find)와 Node(Vitest)가 함께 import하므로 외부 라이브러리 없이 쓴다.
// 검색은 주소를 찾는 데만 쓰고 가격은 그 페이지에서 직접 읽는다(_shared/shops.ts). 쿠팡 주소는 로우차트 주소로 바꾼다.
import { parseSize, type Size } from './fit.ts'
import { parseShopUrl, type ShopLink, type ShopSource } from './shops.ts'

export const FIND_SOURCES: readonly ShopSource[] = ['kurly', 'homeplus', 'lowchart']
/** 웹 검색을 이 사이트들의 결과로만 좁힌다(주소 모양은 parseShopUrl이 다시 거른다) */
export const FIND_DOMAINS: readonly string[] = ['kurly.com', 'homeplus.co.kr', 'coupang.com', 'lowchart.com']
/** 출처마다 읽어 볼 페이지 수(검색 순위 앞에서부터) */
export const PER_SOURCE = 2

/** 검색 응답의 content 블록들에서 결과 주소를 순서대로 모은다(모델이 쓴 글은 보지 않는다) */
export function searchResultUrls(content: readonly unknown[]): string[] {
  const out: string[] = []
  for (const b of content) {
    if (!b || typeof b !== 'object' || (b as { type?: unknown }).type !== 'web_search_tool_result') continue
    const results = (b as { content?: unknown }).content
    if (!Array.isArray(results)) continue // 오류 응답은 객체 하나
    for (const r of results) {
      const url = (r as { url?: unknown })?.url
      if (typeof url === 'string') out.push(url)
    }
  }
  return out
}

/** 주소들을 몰 주소로 정리해 출처마다 앞에서 perSource개까지(같은 상품은 한 번). wanted에 없는 출처는 뺀다 */
export function pickLinks(urls: readonly string[], wanted: readonly ShopSource[] = FIND_SOURCES, perSource = PER_SOURCE): ShopLink[] {
  const seen = new Set<string>()
  const count = new Map<ShopSource, number>()
  const out: ShopLink[] = []
  for (const u of urls) {
    const r = parseShopUrl(u)
    if (!r.ok || !wanted.includes(r.link.source)) continue
    const key = `${r.link.source}|${r.link.sourceId}`
    if (seen.has(key)) continue
    const n = count.get(r.link.source) ?? 0
    if (n >= perSource) continue
    seen.add(key)
    count.set(r.link.source, n + 1)
    out.push(r.link)
  }
  return out
}

const norm = (s: string) => s.replace(/[\s[\]()★☆*·,/+_-]+/g, '').toLowerCase()
// 용량·수량 토큰과 꾸밈말은 단어로 치지 않는다(src/lib/shopCompare.ts nameTokens와 같은 규칙)
const SIZE_TOKEN = /^x?\d+(?:[.,]\d+)?(?:g|kg|mg|ml|l|리터|cc|구|개입|개|팩|봉|병|캔|장|롤|입|ea|매|p|단|망|모|판|근|마리|포기|box|박스|세트)?(?:[x×*]\d+)?$/i
const FILLER = new Set(['국산', '수입', '특가', '행사', '기획', '증정', '세트', '묶음', '할인', '대용량', '무료배송', '당일배송', '정품', '최저가', '신상', '신제품', '본품', '프리미엄', '냉동', '냉장', '실온'])

/** 고른 상품 이름의 단어: 2자 이상, 용량·수량·꾸밈말 제외 */
export function findTokens(s: string): string[] {
  return [...new Set(s.split(/[\s,/()[\]★☆*·+]+/)
    .map((t) => t.replace(/[^가-힣a-z0-9.]/gi, '').replace(/\.+$/, '').toLowerCase())
    .filter((t) => t.length >= 2 && !SIZE_TOKEN.test(t) && !FILLER.has(t)))]
}

const sameSize = (a: Size, b: Size) => a.family === b.family && Math.abs(a.n - b.n) <= Math.max(a.n, b.n) * 0.02

/** 페이지 이름의 낱말(1자도 남긴다: "왕 교자"를 이어 붙여 보려고) */
function pageWords(s: string): string[] {
  return s.split(/[\s,/()[\]★☆*·+]+/).map((t) => t.replace(/[^가-힣a-z0-9.]/gi, '').replace(/\.+$/, '').toLowerCase()).filter(Boolean)
}

/** 단어가 페이지 낱말 하나와 같거나, 이어진 낱말 2~3개를 붙인 것과 같은가(띄어쓰기만 다른 것). "김치왕교자" 안의 "왕교자"는 아니다 */
function exactIn(word: string, words: readonly string[]): boolean {
  for (let i = 0; i < words.length; i++) {
    let joined = ''
    for (let j = i; j < Math.min(words.length, i + 3); j++) {
      joined += words[j]
      if (joined === word) return true
      if (joined.length >= word.length) break
    }
  }
  return false
}

export type MatchGrade = 'auto' | 'maybe' | 'no'
export type Match = { grade: MatchGrade; overlap: number; size: 'same' | 'different' | 'unknown'; exact: number }

/**
 * 몰 페이지가 고른 상품과 같은지 견준다.
 * - 용량을 둘 다 읽었는데 다르면 'no'(묶음·다른 용량은 다른 상품으로 본다).
 * - 'auto'(자동 저장): 용량이 같고, 고른 상품 단어가 2개 이상·절반 이상 페이지 낱말과 **그대로** 같고(띄어쓰기만 다른 것은 같음),
 *   마지막 단어(대개 상품 이름, "왕교자")도 그대로 같을 때. "김치왕교자"처럼 다른 말이 붙은 이름은 자동으로 넣지 않는다.
 * - 'maybe'(사람이 고른다): 단어가 하나라도 페이지 이름 안에 들어 있고 용량이 다르지 않을 때. 그 밖은 'no'.
 */
export function matchShop(target: { name: string; spec: string | null }, page: { name: string; size: string | null }): Match {
  const want = parseSize(target.name) ?? (target.spec ? parseSize(target.spec) : null)
  const got = parseSize(page.name) ?? (page.size ? parseSize(page.size) : null)
  const size: Match['size'] = !want || !got ? 'unknown' : sameSize(want, got) ? 'same' : 'different'
  const words = findTokens(target.name)
  const hay = norm(page.name)
  const pw = pageWords(page.name)
  const overlap = words.filter((w) => hay.includes(norm(w))).length
  const exactWords = words.filter((w) => exactIn(norm(w), pw))
  const exact = exactWords.length
  const mainExact = words.length > 0 && exactWords.includes(words[words.length - 1])
  if (size === 'different') return { grade: 'no', overlap, size, exact }
  if (size === 'same' && exact >= 2 && exact * 2 >= words.length && mainExact) return { grade: 'auto', overlap, size, exact }
  if (overlap >= 1) return { grade: 'maybe', overlap, size, exact }
  return { grade: 'no', overlap, size, exact }
}

/** 찾은 후보 하나(shop_finds.candidates의 한 줄). 가격은 그 페이지에서 읽은 값과 읽은 시각 */
export type FoundShop = {
  source: ShopSource
  sourceId: string
  url: string
  name: string
  size: string | null
  price: number
  checkedAt: string
  grade: Exclude<MatchGrade, 'no'>
  /** 자동으로 shop_links에 저장했는가 */
  saved: boolean
}

const RANK: Record<Exclude<MatchGrade, 'no'>, number> = { auto: 2, maybe: 1 }

/** 출처마다 가장 잘 맞는 하나를 고른다(등급 → 겹친 단어 수 → 검색 순서). 'no'는 버린다 */
export function bestPerSource<T extends { source: ShopSource; match: Match }>(list: readonly T[]): T[] {
  const best = new Map<ShopSource, T>()
  for (const c of list) {
    if (c.match.grade === 'no') continue
    const cur = best.get(c.source)
    const better = !cur
      || RANK[c.match.grade as 'auto' | 'maybe'] > RANK[cur.match.grade as 'auto' | 'maybe']
      || (c.match.grade === cur.match.grade && c.match.overlap > cur.match.overlap)
    if (better) best.set(c.source, c)
  }
  return FIND_SOURCES.flatMap((s) => (best.has(s) ? [best.get(s)!] : []))
}

/** 웹 검색에 보낼 사용자 글. 상품 이름과 규격만 넣는다 */
export function findPrompt(name: string, spec: string | null): string {
  return [
    `상품: ${name}${spec ? ` (규격 ${spec})` : ''}`,
    '이 상품의 상품 페이지를 컬리(kurly.com), 홈플러스(homeplus.co.kr), 쿠팡(coupang.com)에서 각각 찾아 주세요.',
    '몰마다 한 번씩 상품 이름으로 검색하고, 찾은 뒤에는 "끝"이라고만 답하세요.',
  ].join('\n')
}

export const FIND_SYSTEM = '당신은 한국 쇼핑몰에서 상품 페이지를 찾는 검색 도우미입니다. 검색만 하고 설명은 쓰지 않습니다.'
