// 몰 상품 페이지(컬리·홈플러스·로우차트)에서 가격을 읽는다(P3, D-013). 사람이 붙여 넣은 주소를 정리하고,
// 그 페이지의 JSON-LD `Product`에서 이름·가격·평점·관측값을 읽는다. Deno(Edge Function)와 Node(Vitest)가 함께 import하므로
// 외부 라이브러리 없이 URL과 정규식만 쓴다. 확인한 구조: 2026-10-19 사본(tests/grocery/fixtures/shops, docs/grocery/data-sources.md 1-2).
// 쿠팡 페이지에는 요청하지 않는다(약관·403): 쿠팡 주소는 로우차트 주소로 바꿔 로우차트만 읽는다.
// 여기서 읽은 값은 고른 상품과 같다는 보장이 없어 "가장 싼 값"에는 넣지 않고 따로 보여 준다(D-013 ⑤).

export type ShopSource = 'kurly' | 'homeplus' | 'lowchart'
export type ShopLink = { source: ShopSource; sourceId: string; url: string }
export type ShopUrlReason = 'not_url' | 'unsupported' | 'short_link' | 'item_id_missing'
export type ShopUrlResult = { ok: true; link: ShopLink } | { ok: false; reason: ShopUrlReason }

export const SHOP_LABEL: Record<ShopSource, string> = { kurly: '컬리', homeplus: '홈플러스', lowchart: '로우차트(쿠팡)' }

/** 로우차트가 적어 둔 쿠팡 관측값(원). 못 읽은 것은 null. changedOn은 "최근 가격 변동일"(YYYY-MM-DD). */
export type ShopObserved = { low: number | null; high: number | null; avg: number | null; changedOn: string | null }
export type ShopProduct = {
  name: string
  /** 페이지 JSON-LD offers.price. 양의 정수만(0·음수·소수·글자는 ShopParseError) */
  price: number
  imageUrl: string | null
  rating: number | null
  reviewCount: number | null
  /** 컬리 "중량/용량" 같은 용량 표기. 없으면 null */
  size: string | null
  /** 로우차트 offers.validFrom의 날짜(YYYY-MM-DD). 없으면 null */
  priceFrom: string | null
  observed: ShopObserved | null
}

export class ShopParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ShopParseError'
  }
}

const DIGITS = /^\d{1,20}$/

function toUrl(text: string): URL | null {
  const t = text.trim()
  if (!t || /\s/.test(t)) return null
  try {
    return new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`)
  } catch {
    return null
  }
}

/** 붙여 넣은 주소를 출처·출처 id·받을 주소로 정리한다. 모르는 사이트·경로는 거절한다. */
export function parseShopUrl(text: string): ShopUrlResult {
  const u = toUrl(text)
  if (!u) return { ok: false, reason: 'not_url' }
  const host = u.hostname.toLowerCase()
  if (host === 'kurly.com' || host.endsWith('.kurly.com')) {
    const m = u.pathname.match(/^\/goods\/(\d{1,20})\/?$/)
    if (!m) return { ok: false, reason: 'unsupported' }
    return { ok: true, link: { source: 'kurly', sourceId: m[1], url: `https://www.kurly.com/goods/${m[1]}` } }
  }
  if (host === 'homeplus.co.kr' || host.endsWith('.homeplus.co.kr')) {
    const itemNo = u.searchParams.get('itemNo') ?? ''
    if (u.pathname.replace(/\/$/, '') !== '/item' || !DIGITS.test(itemNo)) return { ok: false, reason: 'unsupported' }
    const storeType = (u.searchParams.get('storeType') ?? 'HYPER').toUpperCase()
    if (!/^[A-Z]{1,10}$/.test(storeType)) return { ok: false, reason: 'unsupported' }
    return {
      ok: true,
      link: {
        source: 'homeplus',
        sourceId: `${itemNo}:${storeType}`,
        url: `https://mfront.homeplus.co.kr/item?itemNo=${itemNo}&storeType=${storeType}`,
      },
    }
  }
  if (host === 'link.coupang.com') return { ok: false, reason: 'short_link' }
  if (host === 'coupang.com' || host.endsWith('.coupang.com')) {
    const m = u.pathname.match(/^\/v[pm]\/products\/(\d{1,20})\/?$/)
    if (!m) return { ok: false, reason: 'unsupported' }
    const itemId = u.searchParams.get('itemId') ?? ''
    if (!DIGITS.test(itemId)) return { ok: false, reason: 'item_id_missing' }
    return lowchart(m[1], itemId)
  }
  if (host === 'lowchart.com' || host.endsWith('.lowchart.com')) {
    const m = u.pathname.match(/^\/(\d{1,20})-(\d{1,20})\/?$/)
    if (!m) return { ok: false, reason: 'unsupported' }
    return lowchart(m[1], m[2])
  }
  return { ok: false, reason: 'unsupported' }
}

/** 출처·출처 id로 받을 주소를 만든다(DB check와 같은 규칙). id 모양이 틀리면 null. 저장된 url을 믿지 않고 이것으로 받는다. */
export function shopUrl(source: ShopSource, sourceId: string): string | null {
  if (source === 'kurly') return DIGITS.test(sourceId) ? `https://www.kurly.com/goods/${sourceId}` : null
  if (source === 'homeplus') {
    const m = sourceId.match(/^(\d{1,20}):([A-Z]{1,10})$/)
    return m ? `https://mfront.homeplus.co.kr/item?itemNo=${m[1]}&storeType=${m[2]}` : null
  }
  return /^\d{1,20}-\d{1,20}$/.test(sourceId) ? `https://www.lowchart.com/${sourceId}` : null
}

function lowchart(productId: string, itemId: string): ShopUrlResult {
  const id = `${productId}-${itemId}`
  return { ok: true, link: { source: 'lowchart', sourceId: id, url: `https://www.lowchart.com/${id}` } }
}

type Ld = Record<string, unknown>

function* ldObjects(html: string): Generator<Ld> {
  for (const m of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    let d: unknown
    try {
      d = JSON.parse(m[1])
    } catch {
      continue // 다른 블록이 깨져 있어도 나머지를 본다
    }
    for (const x of Array.isArray(d) ? d : [d]) {
      if (!x || typeof x !== 'object') continue
      const graph = (x as Ld)['@graph']
      if (Array.isArray(graph)) for (const g of graph) if (g && typeof g === 'object') yield g as Ld
      yield x as Ld
    }
  }
}

function findProduct(html: string): Ld {
  for (const o of ldObjects(html)) if (o['@type'] === 'Product') return o
  throw new ShopParseError('no JSON-LD Product')
}

/** 양의 정수만. "4150"(글자)도 받되 "10,980원"·소수·0·음수는 null */
function posInt(v: unknown): number | null {
  if (typeof v === 'number') return Number.isInteger(v) && v > 0 ? v : null
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) return posInt(Number(v))
  return null
}

/** "28,920원" → 28920. 모양이 다르면 null */
function won(v: unknown): number | null {
  if (typeof v !== 'string') return null
  const m = v.replace(/,/g, '').match(/^\s*(\d+)\s*원?\s*$/)
  return m ? posInt(Number(m[1])) : null
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function dateOf(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const m = v.match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : null
}

function property(ld: Ld, name: string): unknown {
  const list = ld.additionalProperty
  if (!Array.isArray(list)) return undefined
  const hit = list.find((p) => p && typeof p === 'object' && (p as Ld).name === name) as Ld | undefined
  return hit?.value
}

/** 상품 페이지 HTML의 JSON-LD Product를 읽는다. 가격을 못 읽거나 0이면 ShopParseError(성공으로 저장하지 않게). */
export function parseShopProduct(html: string): ShopProduct {
  const ld = findProduct(html)
  const name = typeof ld.name === 'string' ? ld.name.replace(/\s+/g, ' ').trim() : ''
  if (!name) throw new ShopParseError('product without name')
  const offers = (Array.isArray(ld.offers) ? ld.offers[0] : ld.offers) as Ld | undefined
  const price = posInt(offers?.price)
  if (price === null) throw new ShopParseError('product without positive integer price')
  const image = Array.isArray(ld.image) ? ld.image[0] : ld.image
  const rating = (ld.aggregateRating ?? {}) as Ld
  const size = property(ld, '중량/용량')
  const low = property(ld, '관측 최저가')
  const high = property(ld, '관측 최고가')
  const avg = property(ld, '관측 평균가')
  const changed = property(ld, '최근 가격 변동일')
  const hasObserved = [low, high, avg, changed].some((v) => v !== undefined)
  return {
    name,
    price,
    imageUrl: typeof image === 'string' && image.startsWith('https://') ? image : null,
    rating: numOrNull(rating.ratingValue),
    reviewCount: numOrNull(rating.reviewCount),
    size: typeof size === 'string' && size.trim() ? size.trim() : null,
    priceFrom: dateOf(offers?.validFrom),
    observed: hasObserved ? { low: won(low), high: won(high), avg: won(avg), changedOn: dateOf(changed) } : null,
  }
}
