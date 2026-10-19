// 농수산물 시세 수집(D-012). 정해 둔 품목(MARKET_ITEMS)의 소매 조사값을 시군구마다 받아 grocery.price_points에 upsert한다.
// 비밀번호 없이 부를 수 있으므로 함수가 스스로 막는다(food-alerts-sync와 같은 방식):
//   20시간 안에 성공한 실행이 있으면 받지 않고, DB 잠금(id 2, 30분에 한 번)을 얻지 못하면 429.
// 받는 범위: 최근 15일 안에 값이 있는 품목은 10일, 없으면 45일(처음 채우기). 1년 전(379~358일 전)은 값이 없을 때만.
//   10일을 다시 받는 이유: 지난 조사일 값이 며칠 뒤에 등록되기도 한다(10-06 값이 10-13에 등록됨, data-sources 3-1).
// 한 번에 4개까지 부르고, 시작한 지 100초가 넘으면 남은 일은 다음 실행으로 미룬다(207, 실패로 기록해 30분 뒤 다시 받을 수 있다).
// 트래픽 초과(-10)면 바로 멈춘다. sync_runs.error는 로그인한 사용자가 읽으므로 정해진 분류와 키를 가린 짧은 문구만 남긴다.
// Deno 전용 API를 쓰지 않아 Vitest에서 그대로 시험한다(진입점은 index.ts).
import { MARKET_ITEMS, MarketApiError, marketUrl, PAGE_ROWS, parseMarket, regionsOf, type MarketItem, type MarketRow } from '../_shared/market.ts'
import { kstDate, sanitize } from '../_shared/sync.ts'

// 예전처럼 여기서도 내보낸다(tests/grocery/marketSync.test.ts가 kstDate를 쓴다)
export { kstDate, sanitize }

export type MarketSyncDeps = {
  apiKey: string | undefined
  /** 주소를 불러 JSON을 돌려준다(HTTP 오류여도 본문을 읽어 돌려준다). 네트워크 오류는 던진다 */
  fetchJson(url: string): Promise<unknown>
  now(): Date
  /** sinceIso 이후 성공한 시세 실행이 있는가 */
  recentOk(sinceIso: string): Promise<boolean>
  /** 잠금이 cutoffIso보다 오래됐을 때만 atIso로 바꾸고 true. 동시에 불러도 하나만 true */
  acquire(cutoffIso: string, atIso: string): Promise<boolean>
  /** 품목 코드 중 [from, to] 사이에 값이 하나라도 있는 것 */
  covered(items: string[], from: string, to: string): Promise<Set<string>>
  upsert(rows: MarketRow[]): Promise<void>
  recordRun(run: { source: 'kamis'; ok: boolean; rows: number; total: number | null; error: string | null }): Promise<void>
  log?(event: Record<string, unknown>): void
  /** 기본 100초 */
  budgetMs?: number
  /** 기본 4 */
  concurrency?: number
  /** 경과 시간 재기(테스트용). 기본 Date.now */
  clock?: () => number
}

export const FRESH_MS = 20 * 3600_000
export const COOLDOWN_MS = 30 * 60_000
const MAX_PAGES = 10
const CHUNK = 500
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })

type Job = { m: MarketItem; sgg: string | null; from: string; to: string; kind: 'recent' | 'year' }

const pk = (r: MarketRow) => `${r.item_cd}|${r.vrty_cd}|${r.grd_cd}|${r.sgg_cd}|${r.mrkt_cd}|${r.exmn_ymd}`

export async function handle(req: Request, deps: MarketSyncDeps): Promise<Response> {
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
  const today = kstDate(now)
  const codes = MARKET_ITEMS.map((m) => m.item)
  const recentHave = await deps.covered(codes, kstDate(now, 15), today)
  const yearFrom = kstDate(now, 379)
  const yearTo = kstDate(now, 358)
  const yearHave = await deps.covered(codes, yearFrom, yearTo)

  const jobs: Job[] = []
  for (const m of MARKET_ITEMS) {
    for (const sgg of regionsOf(m)) {
      jobs.push({ m, sgg, from: kstDate(now, recentHave.has(m.item) ? 10 : 45), to: today, kind: 'recent' })
      if (!yearHave.has(m.item)) jobs.push({ m, sgg, from: yearFrom, to: yearTo, kind: 'year' })
    }
  }

  let saved = 0
  let done = 0
  let deferred = 0
  let stop = false
  const errors = new Map<string, number>()
  const fail = (kind: string) => errors.set(kind, (errors.get(kind) ?? 0) + 1)

  const runJob = async (job: Job) => {
    const byKey = new Map<string, MarketRow>()
    for (let page = 1; page <= MAX_PAGES; page++) {
      const body = await deps.fetchJson(marketUrl(apiKey, job.m, job.from, job.to, page, job.sgg))
      const { rows, total, seen } = parseMarket(body)
      for (const r of rows) byKey.set(pk(r), r)
      if (seen < PAGE_ROWS || page * PAGE_ROWS >= total) break
    }
    const rows = [...byKey.values()]
    for (let i = 0; i < rows.length; i += CHUNK) await deps.upsert(rows.slice(i, i + CHUNK))
    saved += rows.length
  }

  let next = 0
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++]
      if (stop || clock() - started > budget) {
        deferred++
        continue
      }
      try {
        await runJob(job)
        done++
      } catch (e) {
        if (e instanceof MarketApiError) {
          const msg = sanitize(e.message, apiKey)
          fail(msg)
          if (/^-10\b/.test(msg)) stop = true // 트래픽 초과: 더 불러도 같은 오류
        } else if (e instanceof Error && e.message === 'save_failed') {
          fail('save_failed')
        } else {
          fail('network_error')
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, deps.concurrency ?? 4) }, worker))

  const errorText = errors.size || deferred
    ? sanitize(
        [...[...errors].map(([k, n]) => `${k} ×${n}`), deferred ? `미룸 ${deferred}건` : ''].filter(Boolean).join(', '),
        apiKey,
      )
    : null
  const ok = errors.size === 0 && deferred === 0
  deps.log?.({ jobs: jobs.length, done, deferred, saved, errors: Object.fromEntries(errors), ms: clock() - started })
  await deps.recordRun({ source: 'kamis', ok, rows: saved, total: jobs.length, error: errorText })
  return ok ? json(200, { status: 'done' }) : json(207, { status: 'partial' })
}
