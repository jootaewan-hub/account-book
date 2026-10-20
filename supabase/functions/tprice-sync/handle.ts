// 참가격(한국소비자원 생필품 가격, 15158701) 수집(P3, D-013 ①). 판매점(성남만)·상품 목록을 받아 두고,
// 성남 판매점 × 최근 금요일 5개의 가격을 받아 grocery.tprice_*에 upsert한다(조사는 격주 금요일, 값은 며칠 뒤 들어온다).
// 비밀번호 없이 부를 수 있으므로 함수가 스스로 막는다(식약처·시세와 같은 방식): 20시간 안에 성공한 실행이 있으면 받지 않고,
// DB 잠금(id 3, 30분에 한 번)을 얻지 못하면 429. 이미 저장된 (판매점, 조사일)은 다시 받지 않는다.
// 한 번에 3개까지 부르고, 시작한 지 100초가 넘으면 남은 일은 다음 실행으로 미룬다(207). 한도 초과(22·23)면 바로 멈춘다.
// sync_runs.error는 로그인한 사용자가 읽으므로 정해진 분류와 키를 가린 짧은 문구만 남긴다. Deno 전용 API를 쓰지 않아 Vitest로 시험한다.
import {
  isSeongnam,
  parseTpriceGoods,
  parseTpricePrices,
  parseTpriceStores,
  recentFridays,
  TpriceApiError,
  tpriceUrl,
  type TpriceGood,
  type TpricePrice,
  type TpriceStore,
} from '../_shared/tprice.ts'
import { sanitize } from '../_shared/sync.ts'

export type TpriceSyncDeps = {
  apiKey: string | undefined
  /** 주소를 불러 상태와 본문을 돌려준다. 네트워크 오류는 던진다 */
  fetchText(url: string): Promise<{ status: number; text: string }>
  now(): Date
  /** sinceIso 이후 성공한 참가격 실행이 있는가 */
  recentOk(sinceIso: string): Promise<boolean>
  /** 잠금이 cutoffIso보다 오래됐을 때만 atIso로 바꾸고 true. 동시에 불러도 하나만 true */
  acquire(cutoffIso: string, atIso: string): Promise<boolean>
  /** 이미 저장된 "판매점 id|조사일(YYYY-MM-DD)" 쌍 */
  covered(entpIds: string[], days: string[]): Promise<Set<string>>
  upsertStores(rows: TpriceStore[]): Promise<void>
  upsertGoods(rows: TpriceGood[]): Promise<void>
  upsertPrices(rows: TpricePrice[]): Promise<void>
  recordRun(run: { source: 'tprice'; ok: boolean; rows: number; total: number | null; error: string | null }): Promise<void>
  log?(event: Record<string, unknown>): void
  /** 기본 100초 */
  budgetMs?: number
  /** 기본 3 */
  concurrency?: number
  /** 경과 시간 재기(테스트용). 기본 Date.now */
  clock?: () => number
}

export const FRESH_MS = 20 * 3600_000
export const COOLDOWN_MS = 30 * 60_000
export const FRIDAYS = 5

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })

class HttpError extends Error {
  constructor(public status: number) {
    super(`http_${status}`)
  }
}

export async function handle(req: Request, deps: TpriceSyncDeps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  const apiKey = deps.apiKey?.trim()
  if (!apiKey) return json(500, { error: 'missing_api_key' })

  const now = deps.now()
  if (await deps.recentOk(new Date(now.getTime() - FRESH_MS).toISOString())) return json(200, { status: 'skipped' })
  if (!(await deps.acquire(new Date(now.getTime() - COOLDOWN_MS).toISOString(), now.toISOString()))) {
    return json(429, { status: 'cooldown' })
  }

  const clock = deps.clock ?? Date.now
  const started = clock()
  const budget = deps.budgetMs ?? 100_000
  const errors = new Map<string, number>()
  const fail = (kind: string) => errors.set(kind, (errors.get(kind) ?? 0) + 1)
  const reason = (e: unknown): string => {
    if (e instanceof TpriceApiError) return sanitize(`${e.code} ${e.message}`, apiKey)
    if (e instanceof HttpError) return e.message
    if (e instanceof Error && e.message === 'save_failed') return 'save_failed'
    return 'network_error'
  }
  const get = async (url: string) => {
    const r = await deps.fetchText(url)
    if (r.status !== 200) throw new HttpError(r.status)
    return r.text
  }
  let saved = 0
  let done = 0
  let deferred = 0
  let skipped = 0
  const finish = async (total: number | null) => {
    const errorText = errors.size || deferred
      ? sanitize([...[...errors].map(([k, n]) => `${k} ×${n}`), deferred ? `미룸 ${deferred}건` : ''].filter(Boolean).join(', '), apiKey)
      : null
    const ok = errors.size === 0 && deferred === 0
    deps.log?.({ total, done, deferred, saved, skipped, errors: Object.fromEntries(errors), ms: clock() - started })
    await deps.recordRun({ source: 'tprice', ok, rows: saved, total, error: errorText })
    return ok ? json(200, { status: 'done' }) : json(207, { status: 'partial' })
  }

  // 1. 판매점(성남만 저장)
  let stores: TpriceStore[]
  try {
    stores = parseTpriceStores(await get(tpriceUrl('stores', apiKey))).filter(isSeongnam)
    await deps.upsertStores(stores).catch(() => {
      throw new Error('save_failed')
    })
  } catch (e) {
    fail(reason(e))
    return finish(null)
  }
  // 성남 판매점이 없으면 받을 가격이 없다(빈 in() 조회로 500이 나지 않게, 리뷰 ⑥)
  if (stores.length === 0) return finish(0)
  // 2. 상품(전부)
  let goods: TpriceGood[]
  try {
    goods = parseTpriceGoods(await get(tpriceUrl('goods', apiKey)))
    await deps.upsertGoods(goods).catch(() => {
      throw new Error('save_failed')
    })
  } catch (e) {
    fail(reason(e))
    return finish(null)
  }
  const known = new Set(goods.map((g) => g.goodId))

  // 3. 성남 판매점 × 최근 금요일 중 아직 없는 것
  const days = recentFridays(now, FRIDAYS)
  const have = await deps.covered(stores.map((s) => s.entpId), days)
  const jobs = stores.flatMap((s) => days.filter((d) => !have.has(`${s.entpId}|${d}`)).map((d) => ({ entpId: s.entpId, day: d })))
  let stop = false
  let next = 0
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++]
      if (stop || clock() - started > budget) {
        deferred++
        continue
      }
      try {
        const all = parseTpricePrices(await get(tpriceUrl('prices', apiKey, { day: job.day, entpId: job.entpId })))
        const rows = all.filter((r) => known.has(r.goodId))
        skipped += all.length - rows.length
        if (rows.length > 0) {
          await deps.upsertPrices(rows).catch(() => {
            throw new Error('save_failed')
          })
        }
        saved += rows.length
        done++
      } catch (e) {
        fail(reason(e))
        if (e instanceof TpriceApiError && (e.code === '22' || e.code === '23')) stop = true // 한도 초과: 더 불러도 같은 오류
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, deps.concurrency ?? 3) }, worker))
  return finish(jobs.length)
}
