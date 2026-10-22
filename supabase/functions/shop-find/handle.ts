// 몰 주소 자동 찾기(D-024): 품목이 고른 상품을 컬리·홈플러스·쿠팡(로우차트)에서 한 번 찾는다.
// 웹 검색은 주소를 찾는 데만 쓰고, 가격·이름·용량은 그 상품 페이지에서 직접 읽는다(_shared/shops.ts, robots 허용 경로).
// 이름·용량이 분명히 같으면 shop_links에 바로 넣고(saved), 아니면 후보로 남겨 사람이 고르게 한다. 같은 상품은 다시 찾지 않는다(검색은 돈이 든다).
// 실제 저장·검색은 deps가 하고(index.ts), 여기는 순서와 판단만 한다(Vitest로 시험).
import { bestPerSource, FIND_SOURCES, matchShop, pickLinks, type FoundShop, type Match } from '../_shared/shopFind.ts'
import { parseShopProduct, ShopParseError, type ShopLink, type ShopProduct, type ShopSource } from '../_shared/shops.ts'

export type FindItem = { householdId: string; productId: string | null; productName: string | null; spec: string | null }
export type FindState = { status: 'searching' | 'done' | 'failed'; searchedAt: string; error: string | null }
/** 페이지에서 읽은 값(오늘 이미 읽었으면 그 기록) */
export type PageRead = { name: string; size: string | null; price: number; checkedAt: string }

export class SearchError extends Error {
  constructor(public code: string) {
    super(code)
    this.name = 'SearchError'
  }
}

export type FindDeps = {
  /** 사용자 권한(RLS): 내 가구 품목과 고른 상품 */
  item(itemId: string): Promise<FindItem | null>
  state(householdId: string, productId: string): Promise<FindState | null>
  /** 'searching'으로 잡는다(없으면 넣고, 있으면 그 상태일 때만 바꾼다). 다른 요청이 먼저 잡았으면 false */
  claim(householdId: string, productId: string, at: string, prev: FindState | null): Promise<boolean>
  /** 이 가구가 이 상품에 이미 넣은 주소의 출처 */
  linked(householdId: string, productId: string): Promise<ShopSource[]>
  /** 웹 검색 결과 주소(검색 순서). 실패는 SearchError */
  search(name: string, spec: string | null): Promise<string[]>
  /** 오늘(한국 시간) 성공한 그 페이지 확인 */
  todayCheck(link: ShopLink): Promise<PageRead | null>
  fetchHtml(url: string): Promise<{ status: number; text: string }>
  saveCheck(link: ShopLink, p: ShopProduct, at: string): Promise<void>
  failCheck(link: ShopLink, error: string, at: string): Promise<void>
  saveLink(householdId: string, productId: string, link: ShopLink): Promise<void>
  finish(householdId: string, productId: string, status: 'done' | 'failed', candidates: FoundShop[], error: string | null): Promise<void>
  now(): Date
}

/** 'searching'이 이보다 오래 남아 있으면 멈춘 것으로 보고 다시 찾는다 */
export const STALE_SEARCH_MS = 5 * 60_000
/** 실패한 찾기는 이만큼 지난 뒤에 다시 한다(로그인 토큰 문제는 바로) */
export const RETRY_FAILED_MS = 60 * 60_000

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })

/** 페이지를 읽어 확인 기록을 남긴다. 실패면 null(이유는 failCheck로 남긴다) */
async function readPage(link: ShopLink, deps: FindDeps, at: string): Promise<PageRead | null> {
  const cached = await deps.todayCheck(link)
  if (cached) return cached
  let res: { status: number; text: string }
  try {
    res = await deps.fetchHtml(link.url)
  } catch {
    await deps.failCheck(link, 'network_error', at)
    return null
  }
  if (res.status !== 200) {
    await deps.failCheck(link, `http_${res.status}`, at)
    return null
  }
  let p: ShopProduct
  try {
    p = parseShopProduct(res.text)
  } catch (e) {
    await deps.failCheck(link, e instanceof ShopParseError ? 'parse_failed' : 'parse_error', at)
    return null
  }
  await deps.saveCheck(link, p, at)
  return { name: p.name, size: p.size, price: p.price, checkedAt: at }
}

export async function handle(req: Request, deps: FindDeps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  let body: { itemId?: unknown }
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'bad_request' })
  }
  const itemId = typeof body?.itemId === 'string' ? body.itemId : ''
  if (!UUID.test(itemId)) return json(400, { error: 'bad_request' })
  const item = await deps.item(itemId)
  if (!item) return json(403, { error: 'forbidden' })
  if (!item.productId || !item.productName) return json(409, { error: 'no_product' })
  const { householdId, productId, productName, spec } = item

  const now = deps.now()
  const prev = await deps.state(householdId, productId)
  const age = prev ? now.getTime() - Date.parse(prev.searchedAt) : Infinity
  if (prev?.status === 'done') return json(200, { status: 'cached' })
  if (prev?.status === 'searching' && age < STALE_SEARCH_MS) return json(200, { status: 'busy' })
  if (prev?.status === 'failed' && age < RETRY_FAILED_MS && !prev.error?.startsWith('wif_')) return json(200, { status: 'cached_failed' })
  const at = now.toISOString()
  if (!(await deps.claim(householdId, productId, at, prev))) return json(200, { status: 'busy' })

  try {
    const have = await deps.linked(householdId, productId)
    const wanted = FIND_SOURCES.filter((s) => !have.includes(s))
    if (wanted.length === 0) {
      await deps.finish(householdId, productId, 'done', [], null)
      return json(200, { status: 'done', saved: 0, candidates: 0 })
    }
    let urls: string[]
    try {
      urls = await deps.search(productName, spec)
    } catch (e) {
      const code = e instanceof SearchError ? e.code : 'search_failed'
      await deps.finish(householdId, productId, 'failed', [], code)
      return json(502, { status: 'error', error: code })
    }
    const read: { link: ShopLink; source: ShopSource; page: PageRead; match: Match }[] = []
    for (const link of pickLinks(urls, wanted)) {
      const page = await readPage(link, deps, at)
      if (page) read.push({ link, source: link.source, page, match: matchShop({ name: productName, spec }, page) })
    }
    const found: FoundShop[] = []
    for (const c of bestPerSource(read)) {
      let saved = false
      if (c.match.grade === 'auto') {
        try {
          await deps.saveLink(householdId, productId, c.link)
          saved = true
        } catch {
          saved = false // 저장을 못 했으면 후보로 남겨 사람이 고르게 한다
        }
      }
      found.push({
        source: c.source, sourceId: c.link.sourceId, url: c.link.url, name: c.page.name.slice(0, 200), size: c.page.size,
        price: c.page.price, checkedAt: c.page.checkedAt, grade: c.match.grade === 'auto' ? 'auto' : 'maybe', saved,
      })
    }
    await deps.finish(householdId, productId, 'done', found, null)
    return json(200, { status: 'done', saved: found.filter((f) => f.saved).length, candidates: found.length })
  } catch (e) {
    await deps.finish(householdId, productId, 'failed', [], 'error').catch(() => {})
    throw e
  }
}
