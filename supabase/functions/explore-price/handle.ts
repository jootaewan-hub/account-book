// 알아보기 탭 가격 비교(D-035): 검색어로 다나와 상품 후보를, 고른 상품의 다나와 상품 페이지 가격 줄을 돌려준다.
// source가 kurly·daiso면(D-036) 마켓컬리 앱 검색·다이소몰 상품 검색 결과를 같은 날 캐시(explore_shop_searches)와 출처별 전역 간격으로 돌려준다.
// 검색은 장보기와 같은 전역 10초 자리(reserve_fetch 'danawa-search', robots Crawl-delay 10)를 쓰고, 한국 날짜·검색어가 같으면
// grocery.explore_searches의 결과를 돌려준다. 상품 가격은 장보기와 같은 price_checks(같은 상품 같은 날 한 번)를 쓴다.
// 가구 데이터를 읽거나 쓰지 않는다. Deno 전용 API를 쓰지 않아 Vitest로 시험한다.
import { danawaSearchUrl, DanawaParseError, parseDanawaSearch, type DanawaVariant } from '../_shared/danawa.ts'
import { checkDanawa, type PriceCheckDeps } from '../_shared/priceCheck.ts'
import { parseShopSearch, ShopSearchError, shopSearchUrl, type ShopItem, type ShopSource } from '../_shared/shopSearch.ts'

export type { ShopItem, ShopSource }

export type ExploreItem = { pcode: string; name: string; imageUrl: string | null; rating: number | null; reviewCount: number | null; variants: DanawaVariant[] }
export type Quote = { qty: number; seller: string | null; price: number; delivery: number | null; unitPrice: number | null; unitLabel: string | null; mallCount: number | null }
export type LatestCheck = { checkedAt: string; pageQty: number | null; quotes: Quote[] }
export type ProductRow = { id: string; sourceId: string; name: string; rating: number | null; reviewCount: number | null; ratedAt: string | null }

export type PriceDeps = Pick<PriceCheckDeps, 'fetchHtml' | 'save' | 'fail'> & {
  /** 그 한국 날짜에 같은 검색어로 찾은 결과 */
  cached(queryKey: string, day: string): Promise<{ items: ExploreItem[]; foundAt: string } | null>
  /** reserve_fetch('danawa-search', 10000, maxWaitMs): 기다릴 ms, 한도를 넘으면 -1 */
  reserve(maxWaitMs: number): Promise<number>
  sleep(ms: number): Promise<void>
  /** explore_searches에 넣고 30일 지난 줄은 지운다 */
  saveSearch(queryKey: string, day: string, query: string, items: ExploreItem[], foundAt: string): Promise<void>
  /** (danawa, pcode) 상품, 없으면 null */
  product(pcode: string): Promise<ProductRow | null>
  /** 최근 30일 explore_searches 결과에 있던 그 상품의 이름(서버가 다나와에서 읽은 값), 없으면 null */
  searchedName(pcode: string): Promise<string | null>
  /** 공용 상품 목록에 넣는다(이름은 searchedName에서 온 것만) */
  insertProduct(pcode: string, name: string): Promise<ProductRow>
  /** 오늘(한국 날짜) 성공한 다나와 확인이 있는가 */
  todayOk(productId: string, day: string): Promise<boolean>
  /** 가장 최근 성공 확인과 그 가격 줄 */
  latest(productId: string): Promise<LatestCheck | null>
  /** 몰 검색(D-036): 그 한국 날짜에 같은 출처·검색어로 찾은 결과 */
  cachedShop(source: ShopSource, queryKey: string, day: string): Promise<{ items: ShopItem[]; foundAt: string } | null>
  /** reserve_fetch('<출처>-search', 간격, maxWaitMs) */
  reserveShop(source: ShopSource, maxWaitMs: number): Promise<number>
  /** JSON API를 받는다(본문 글자) */
  fetchJson(url: string): Promise<{ status: number; text: string }>
  saveShop(source: ShopSource, queryKey: string, day: string, query: string, items: ShopItem[], foundAt: string): Promise<void>
  now(): Date
}

export const MAX_WAIT_MS = 30_000
const MAX_ITEMS = 20

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })

const kstDay = (d: Date) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10)
export const queryKey = (q: string) => q.toLowerCase().replace(/\s+/g, ' ').trim()
/**
 * explore_searches.items(jsonb 배열)에 그 상품이 들었는지 보는 PostgREST 조건 값(`cs` = `@>`).
 * supabase-js의 contains()에 객체 배열을 넘기면 Postgres 배열 글자 "{[object Object]}"로 보내므로 JSON 글자로 준다.
 */
export const itemsWithPcode = (pcode: string) => JSON.stringify([{ pcode }])

async function search(query: string, deps: PriceDeps): Promise<Response> {
  const now = deps.now()
  const day = kstDay(now)
  const key = queryKey(query)
  const hit = await deps.cached(key, day)
  if (hit) return json(200, { status: 'cached', query, foundAt: hit.foundAt, items: hit.items })
  const wait = await deps.reserve(MAX_WAIT_MS)
  if (wait < 0) return json(202, { status: 'busy' })
  if (wait > 0) await deps.sleep(wait)
  let res: { status: number; text: string }
  try {
    res = await deps.fetchHtml(danawaSearchUrl(query))
  } catch {
    return json(502, { status: 'error', reason: 'network_error' })
  }
  if (res.status !== 200) return json(502, { status: 'error', reason: `http_${res.status}` })
  let items: ExploreItem[]
  try {
    items = parseDanawaSearch(res.text)
      .map((i) => ({ pcode: i.pcode, name: i.name, imageUrl: i.imageUrl, rating: i.rating, reviewCount: i.reviewCount, variants: i.variants.filter((v) => v.qty >= 1 && v.qty <= 99) }))
      .slice(0, MAX_ITEMS)
  } catch (e) {
    return json(502, { status: 'error', reason: e instanceof DanawaParseError ? 'parse_failed' : 'parse_error' })
  }
  const foundAt = deps.now().toISOString()
  // 캐시를 못 남겨도 받은 결과는 돌려준다(다음 검색이 다나와를 한 번 더 부를 뿐이다)
  await deps.saveSearch(key, day, query, items, foundAt).catch(() => {})
  return json(200, { status: items.length ? 'done' : 'none', query, foundAt, items })
}

async function shopSearch(source: ShopSource, query: string, deps: PriceDeps): Promise<Response> {
  const day = kstDay(deps.now())
  const key = queryKey(query)
  const hit = await deps.cachedShop(source, key, day)
  if (hit) return json(200, { status: 'cached', source, query, foundAt: hit.foundAt, items: hit.items })
  const wait = await deps.reserveShop(source, MAX_WAIT_MS)
  if (wait < 0) return json(202, { status: 'busy', source })
  if (wait > 0) await deps.sleep(wait)
  let res: { status: number; text: string }
  try {
    res = await deps.fetchJson(shopSearchUrl(source, query))
  } catch {
    return json(502, { status: 'error', source, reason: 'network_error' })
  }
  if (res.status !== 200) return json(502, { status: 'error', source, reason: `http_${res.status}` })
  let items: ShopItem[]
  try {
    items = parseShopSearch(source, res.text).slice(0, MAX_ITEMS)
  } catch (e) {
    return json(502, { status: 'error', source, reason: e instanceof ShopSearchError ? e.code : 'parse_error' })
  }
  const foundAt = deps.now().toISOString()
  await deps.saveShop(source, key, day, query, items, foundAt).catch(() => {})
  return json(200, { status: items.length ? 'done' : 'none', source, query, foundAt, items })
}

async function product(pcode: string, deps: PriceDeps): Promise<Response> {
  // 공용 상품 목록(grocery.products, 장보기와 함께 쓴다)에는 앱이 보낸 글을 넣지 않는다: 이름은 서버가 저장한 검색 결과에서만
  let p = await deps.product(pcode)
  if (!p) {
    const name = await deps.searchedName(pcode)
    if (!name) return json(404, { status: 'not_found' })
    p = await deps.insertProduct(pcode, name)
  }
  const day = kstDay(deps.now())
  let status: 'cached' | 'done' = 'cached'
  if (!(await deps.todayOk(p.id, day))) {
    const out = await checkDanawa({ id: p.id, sourceId: p.sourceId }, deps, deps.now().toISOString())
    if (out !== 'done') return json(502, { status: 'error', reason: out })
    status = 'done'
  }
  const latest = await deps.latest(p.id)
  if (!latest) return json(502, { status: 'error', reason: 'no_check' })
  return json(200, {
    status,
    product: { pcode: p.sourceId, name: p.name, rating: p.rating, reviewCount: p.reviewCount, ratedAt: p.ratedAt },
    checkedAt: latest.checkedAt,
    pageQty: latest.pageQty,
    variants: latest.quotes.filter((q) => q.seller === null),
    offers: latest.quotes.filter((q) => q.seller !== null),
  })
}

export async function handle(req: Request, deps: PriceDeps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  let body: { query?: unknown; pcode?: unknown; source?: unknown }
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'bad_request' })
  }
  if (body?.pcode !== undefined) {
    if (typeof body.pcode !== 'string' || !/^\d{4,12}$/.test(body.pcode)) return json(400, { error: 'bad_request' })
    return product(body.pcode, deps)
  }
  const query = typeof body?.query === 'string' ? body.query.replace(/\s+/g, ' ').trim() : ''
  const source = body?.source ?? 'danawa'
  if (query.length < 2 || query.length > 60 || (source !== 'danawa' && source !== 'kurly' && source !== 'daiso')) return json(400, { error: 'bad_request' })
  return source === 'danawa' ? search(query, deps) : shopSearch(source, query, deps)
}
