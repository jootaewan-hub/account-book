// 고른 상품 하나의 가격 확인(product-check가 요청마다, price-recheck가 하루 한 번 안 산 품목에 대해 함께 쓴다).
// 다나와 상품 페이지에서 수량별 최저가·쇼핑몰별 최저가·평점을 읽어 저장하고, 가구들이 그 상품에 붙여 넣은 몰 주소
// (컬리·홈플러스·로우차트, P3 D-013)의 페이지를 출처마다 하루 한 번 읽어 저장한다. 몰 주소 하나가 실패해도 나머지는 저장한다.
// 쇼핑몰 줄은 페이지 수량(pageQty) 기준이라, 그 수량을 못 읽으면 어느 수량인지 모르는 값이므로 버린다.
import { danawaProductUrl, DanawaParseError, parseDanawaProduct, type DanawaProduct } from './danawa.ts'
import { parseShopProduct, ShopParseError, type ShopLink, type ShopProduct, type ShopSource } from './shops.ts'

export type PriceCheckDeps = {
  fetchHtml(url: string): Promise<{ status: number; text: string }>
  /** products 평점 갱신 + price_checks(ok) + price_quotes */
  save(productId: string, p: DanawaProduct, checkedAt: string): Promise<void>
  /** price_checks(ok = false) */
  fail(productId: string, error: string, checkedAt: string): Promise<void>
  /** 이 상품에 가구들이 넣은 몰 주소(출처·id가 같은 것은 하나) */
  shopLinks(productId: string): Promise<ShopLink[]>
  /** 오늘(한국 시간) 성공한 그 출처 확인이 있는가 */
  shopTodayOk(source: ShopSource, sourceId: string): Promise<boolean>
  /** shop_checks(ok) */
  saveShop(link: ShopLink, p: ShopProduct, checkedAt: string): Promise<void>
  /** shop_checks(ok = false) */
  failShop(link: ShopLink, error: string, checkedAt: string): Promise<void>
}

export type ShopSummary = { done: number; cached: number; failed: number }
export type DanawaOutcome = 'done' | 'network_error' | `http_${number}` | 'parse_failed' | 'parse_error' | 'parse_empty' | 'save_failed'

/** 다나와 상품 페이지를 받아 저장한다. 실패는 price_checks에 남기고 그 이유를 돌려준다. */
export async function checkDanawa(product: { id: string; sourceId: string }, deps: Pick<PriceCheckDeps, 'fetchHtml' | 'save' | 'fail'>, at: string): Promise<DanawaOutcome> {
  const failWith = async (reason: Exclude<DanawaOutcome, 'done'>) => {
    await deps.fail(product.id, reason, at)
    return reason
  }
  let res: { status: number; text: string }
  try {
    res = await deps.fetchHtml(danawaProductUrl(product.sourceId))
  } catch {
    return failWith('network_error')
  }
  if (res.status !== 200) return failWith(`http_${res.status}`)
  let parsed: DanawaProduct
  try {
    parsed = parseDanawaProduct(res.text, product.sourceId)
  } catch (e) {
    return failWith(e instanceof DanawaParseError ? 'parse_failed' : 'parse_error')
  }
  if (parsed.pageQty === null) parsed = { ...parsed, offers: [] }
  // 가격 줄을 하나도 못 읽었으면 성공으로 저장하지 않는다(구조 변경이 하루 종일 캐시로 숨지 않게)
  if (parsed.variants.length === 0 && parsed.offers.length === 0) return failWith('parse_empty')
  try {
    await deps.save(product.id, parsed, at)
  } catch {
    return failWith('save_failed')
  }
  return 'done'
}

/** 넣은 주소마다 하루 한 번 읽는다. 주소가 없으면 null. */
export async function checkShops(productId: string, deps: PriceCheckDeps, at: string): Promise<ShopSummary | null> {
  const links = await deps.shopLinks(productId)
  if (links.length === 0) return null
  const sum: ShopSummary = { done: 0, cached: 0, failed: 0 }
  for (const link of links) {
    if (await deps.shopTodayOk(link.source, link.sourceId)) {
      sum.cached++
      continue
    }
    const reason = await readShop(link, deps, at)
    if (reason === null) sum.done++
    else {
      sum.failed++
      await deps.failShop(link, reason, at)
    }
  }
  return sum
}

/** 성공이면 null, 실패면 이유 */
async function readShop(link: ShopLink, deps: PriceCheckDeps, at: string): Promise<string | null> {
  let res: { status: number; text: string }
  try {
    res = await deps.fetchHtml(link.url)
  } catch {
    return 'network_error'
  }
  if (res.status !== 200) return `http_${res.status}`
  let p: ShopProduct
  try {
    p = parseShopProduct(res.text)
  } catch (e) {
    return e instanceof ShopParseError ? 'parse_failed' : 'parse_error'
  }
  try {
    await deps.saveShop(link, p, at)
  } catch {
    return 'save_failed'
  }
  return null
}
