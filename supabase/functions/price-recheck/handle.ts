// 하루 한 번 가격 다시 확인(P3-7): 안 산 품목이 고른 상품(가구 상관없이)마다 다나와 상품 페이지와 넣은 몰 주소를 읽어 저장한다.
// 비밀번호 없이 부를 수 있으므로 함수가 스스로 막는다(식약처·시세·참가격과 같은 방식): 20시간 안에 성공한 실행이 있으면 받지 않고,
// DB 잠금(id 4, 30분에 한 번)을 얻지 못하면 429. 다나와는 상품 사이에 10초를 둔다(robots Crawl-delay 10과 같은 예의).
// 100초가 넘으면 남은 상품은 다음 실행으로 미룬다(207 → 워크플로가 31분 뒤 한 번 더 부른다). 오늘 이미 성공한 상품은 건너뛴다.
// Deno 전용 API를 쓰지 않아 Vitest로 시험한다(진입점은 index.ts).
import { checkDanawa, checkShops, type PriceCheckDeps } from '../_shared/priceCheck.ts'

export type RecheckDeps = PriceCheckDeps & {
  now(): Date
  /** sinceIso 이후 성공한 다시 확인 실행이 있는가 */
  recentOk(sinceIso: string): Promise<boolean>
  /** 잠금이 cutoffIso보다 오래됐을 때만 atIso로 바꾸고 true. 동시에 불러도 하나만 true */
  acquire(cutoffIso: string, atIso: string): Promise<boolean>
  /** 안 산 품목이 고른 상품(가구 상관없이, 같은 상품은 하나). lastOk: 마지막으로 성공한 다나와 확인 시각(없으면 null) */
  products(): Promise<{ id: string; sourceId: string; lastOk?: string | null }[]>
  /** 오늘(한국 시간) 성공한 다나와 확인이 있는가 */
  todayOk(productId: string): Promise<boolean>
  sleep(ms: number): Promise<void>
  recordRun(run: { source: 'recheck'; ok: boolean; rows: number; total: number | null; error: string | null }): Promise<void>
  log?(event: Record<string, unknown>): void
  /** 기본 100초 */
  budgetMs?: number
  /** 다나와 상품 사이 간격, 기본 10초 */
  gapMs?: number
  /** 경과 시간 재기(테스트용). 기본 Date.now */
  clock?: () => number
}

export const FRESH_MS = 20 * 3600_000
export const COOLDOWN_MS = 30 * 60_000

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })

export async function handle(req: Request, deps: RecheckDeps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  const now = deps.now()
  if (await deps.recentOk(new Date(now.getTime() - FRESH_MS).toISOString())) return json(200, { status: 'skipped' })
  if (!(await deps.acquire(new Date(now.getTime() - COOLDOWN_MS).toISOString(), now.toISOString()))) {
    return json(429, { status: 'cooldown' })
  }

  const clock = deps.clock ?? Date.now
  const started = clock()
  const budget = deps.budgetMs ?? 100_000
  const gap = deps.gapMs ?? 10_000
  const errors = new Map<string, number>()
  const fail = (kind: string, n = 1) => errors.set(kind, (errors.get(kind) ?? 0) + n)
  // 마지막 확인이 오래된 상품부터(확인한 적 없는 상품이 맨 앞). 한 실행에 9개쯤이라 뒤쪽이 매일 미뤄지지 않게(리뷰 ①)
  const products = [...(await deps.products())].sort((a, b) => {
    const x = a.lastOk ?? ''
    const y = b.lastOk ?? ''
    return x < y ? -1 : x > y ? 1 : 0
  })
  let rows = 0
  let deferred = 0
  let fetched = 0
  for (const product of products) {
    if (clock() - started > budget) {
      deferred++
      continue
    }
    const at = deps.now().toISOString()
    if (!(await deps.todayOk(product.id))) {
      if (fetched > 0) await deps.sleep(gap)
      fetched++
      const out = await checkDanawa(product, deps, at)
      if (out === 'done') rows++
      else fail(out)
    }
    const shops = await checkShops(product.id, deps, at)
    if (shops) {
      rows += shops.done
      if (shops.failed > 0) fail('shop_failed', shops.failed)
    }
  }
  const errorText = errors.size || deferred
    ? [...[...errors].map(([k, n]) => `${k} ×${n}`), deferred ? `미룸 ${deferred}건` : ''].filter(Boolean).join(', ').slice(0, 200)
    : null
  const ok = errors.size === 0 && deferred === 0
  deps.log?.({ products: products.length, fetched, rows, deferred, errors: Object.fromEntries(errors), ms: clock() - started })
  await deps.recordRun({ source: 'recheck', ok, rows, total: products.length, error: errorText })
  return ok ? json(200, { status: 'done' }) : json(207, { status: 'partial' })
}
