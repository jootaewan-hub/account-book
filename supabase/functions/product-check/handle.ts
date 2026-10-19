// 고른 상품의 가격 확인 요청(사용자가 부름): 다나와 상품 페이지와 가구들이 넣은 몰 주소를 읽어 저장한다(_shared/priceCheck.ts).
// 같은 상품·같은 출처를 오늘(한국 시간) 이미 확인했으면 다시 받지 않는다. 내 가구가 고른 상품만 확인한다.
import { checkDanawa, checkShops, type PriceCheckDeps } from '../_shared/priceCheck.ts'

export type { ShopSummary } from '../_shared/priceCheck.ts'

export type CheckDeps = PriceCheckDeps & {
  /** 사용자 권한: 내 가구 품목 중 이 상품을 고른 것이 있는가 */
  allowed(productId: string): Promise<boolean>
  product(productId: string): Promise<{ id: string; sourceId: string } | null>
  /** 오늘(한국 시간) 성공한 다나와 확인이 있는가 */
  todayOk(productId: string): Promise<boolean>
  now(): Date
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })

export async function handle(req: Request, deps: CheckDeps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  let body: { productId?: unknown }
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'bad_request' })
  }
  const productId = typeof body?.productId === 'string' ? body.productId : ''
  if (!UUID.test(productId)) return json(400, { error: 'bad_request' })
  if (!(await deps.allowed(productId))) return json(403, { error: 'forbidden' })
  const product = await deps.product(productId)
  if (!product) return json(404, { error: 'not_found' })

  const at = deps.now().toISOString()
  let danawa: { status: number; body: { status: string } }
  if (await deps.todayOk(productId)) danawa = { status: 200, body: { status: 'cached' } }
  else {
    const out = await checkDanawa(product, deps, at)
    danawa = out === 'done' ? { status: 200, body: { status: 'done' } } : { status: 502, body: { status: 'error' } }
  }
  const shops = await checkShops(productId, deps, at)
  return json(danawa.status, shops ? { ...danawa.body, shops } : danawa.body)
}
