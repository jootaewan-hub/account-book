// 하루 한 번 다시 확인(price-recheck, P3-7): 안 산 품목이 고른 상품마다 다나와(10초 간격)와 넣은 몰 주소를 읽어 저장한다.
// 식약처·시세·참가격처럼 스스로 막는다(20시간 1회, 잠금 id 4). 100초가 넘으면 남은 상품은 다음 실행으로 미룬다(207).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { DanawaProduct } from '../../supabase/functions/_shared/danawa'
import type { ShopLink, ShopProduct } from '../../supabase/functions/_shared/shops'
import { handle, type RecheckDeps } from '../../supabase/functions/price-recheck/handle'

type Run = Parameters<RecheckDeps['recordRun']>[0]
const HTML = readFileSync(new URL('./fixtures/danawa/product-5643303.html', import.meta.url), 'utf8')
const KURLY_HTML = readFileSync(new URL('./fixtures/shops/kurly-5082274.html', import.meta.url), 'utf8')
const KURLY: ShopLink = { source: 'kurly', sourceId: '5082274', url: 'https://www.kurly.com/goods/5082274' }
const NOW = new Date('2026-10-19T22:30:00Z') // 한국 10월 20일 07:30
const P = (n: number) => ({ id: `0000000${n}-0000-4000-8000-000000000000`, sourceId: `${5643300 + n}` })
const post = () => new Request('https://x/functions/v1/price-recheck', { method: 'POST' })

function deps(over: Partial<RecheckDeps> = {}) {
  const log = {
    urls: [] as string[], sleeps: [] as number[], saved: [] as string[], failed: [] as [string, string][],
    shops: [] as [string, ShopProduct][], shopFailed: [] as [string, string][], runs: [] as Run[],
  }
  const d: RecheckDeps = {
    now: () => NOW,
    recentOk: async () => false,
    acquire: async () => true,
    products: async () => [P(1), P(2), P(3)],
    todayOk: async () => false,
    sleep: async (ms) => { log.sleeps.push(ms) },
    fetchHtml: async (url) => {
      if (url.startsWith('https://prod.danawa.com/')) return { status: 200, text: HTML }
      if (url === KURLY.url) return { status: 200, text: KURLY_HTML }
      return { status: 404, text: '' }
    },
    save: async (id, _p: DanawaProduct) => { log.saved.push(id) },
    fail: async (id, err) => { log.failed.push([id, err]) },
    shopLinks: async () => [],
    shopTodayOk: async () => false,
    saveShop: async (link, p) => { log.shops.push([link.source, p]) },
    failShop: async (link, err) => { log.shopFailed.push([link.source, err]) },
    recordRun: async (r) => { log.runs.push(r) },
    ...over,
  }
  const inner = d.fetchHtml
  d.fetchHtml = (url) => {
    log.urls.push(url)
    return inner(url)
  }
  return { d, log }
}

describe('price-recheck: 스스로 막기', () => {
  it('POST가 아니면 405', async () => {
    expect((await handle(new Request('https://x', { method: 'GET' }), deps().d)).status).toBe(405)
  })
  it('20시간 안에 성공했으면 받지 않는다', async () => {
    let since = ''
    const { d, log } = deps({ recentOk: async (s) => { since = s; return true } })
    expect(await (await handle(post(), d)).json()).toEqual({ status: 'skipped' })
    expect(since).toBe(new Date(NOW.getTime() - 20 * 3600_000).toISOString())
    expect(log.urls).toHaveLength(0)
  })
  it('잠금을 못 얻으면 429, 잠금은 30분 전 기준', async () => {
    const calls: string[][] = []
    const { d, log } = deps({ acquire: async (c, at) => { calls.push([c, at]); return false } })
    expect((await handle(post(), d)).status).toBe(429)
    expect(calls).toEqual([[new Date(NOW.getTime() - 30 * 60_000).toISOString(), NOW.toISOString()]])
    expect(log.urls).toHaveLength(0)
  })
})

describe('price-recheck: 다시 확인', () => {
  it('안 산 품목이 고른 상품마다 다나와를 10초 간격으로 읽어 저장하고 기록한다', async () => {
    const { d, log } = deps()
    const res = await handle(post(), d)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'done' })
    expect(log.urls).toEqual([1, 2, 3].map((n) => `https://prod.danawa.com/info/?pcode=${5643300 + n}`))
    expect(log.sleeps).toEqual([10_000, 10_000]) // 첫 상품 앞에는 기다리지 않는다
    expect(log.saved).toEqual([P(1).id, P(2).id, P(3).id])
    expect(log.runs).toEqual([{ source: 'recheck', ok: true, rows: 3, total: 3, error: null }])
  })

  it('오늘 이미 성공한 상품은 다나와를 부르지 않는다(간격도 없음)', async () => {
    const { d, log } = deps({ todayOk: async (id) => id === P(2).id })
    await handle(post(), d)
    expect(log.urls).toHaveLength(2)
    expect(log.sleeps).toEqual([10_000])
    expect(log.runs[0]).toMatchObject({ ok: true, rows: 2, total: 3 })
  })

  it('상품 하나가 실패해도 나머지는 저장하고 실패를 종류별로 세어 207', async () => {
    const { d, log } = deps({
      fetchHtml: async (url) => (url.includes('5643302') ? { status: 503, text: '' } : { status: 200, text: HTML }),
    })
    expect((await handle(post(), d)).status).toBe(207)
    expect(log.saved).toEqual([P(1).id, P(3).id])
    expect(log.failed).toEqual([[P(2).id, 'http_503']])
    expect(log.runs[0]).toMatchObject({ ok: false, rows: 2, total: 3, error: 'http_503 ×1' })
  })

  it('넣은 몰 주소도 읽고, 몰 실패는 shop_failed로 센다', async () => {
    const { d, log } = deps({
      products: async () => [P(1), P(2)],
      shopLinks: async (id) => (id === P(1).id ? [KURLY] : id === P(2).id ? [{ ...KURLY, sourceId: '1', url: 'https://www.kurly.com/goods/1' }] : []),
    })
    expect((await handle(post(), d)).status).toBe(207)
    expect(log.shops.map(([s, p]) => [s, p.price])).toEqual([['kurly', 10980]])
    expect(log.shopFailed).toEqual([['kurly', 'http_404']])
    expect(log.runs[0]).toMatchObject({ ok: false, rows: 3, total: 2, error: 'shop_failed ×1' })
  })

  it('시간이 다 되면 남은 상품은 미루고 207', async () => {
    let t = 0
    const { d, log } = deps({ budgetMs: 1000, clock: () => (t += 600) })
    expect((await handle(post(), d)).status).toBe(207)
    expect(log.urls.length).toBeLessThan(3)
    expect(log.runs[0].error).toMatch(/미룸 \d+건/)
  })

  it('마지막 확인이 오래된 상품부터 본다(확인한 적 없는 상품이 맨 앞, 리뷰 ①)', async () => {
    const { d, log } = deps({ products: async () => [{ ...P(1), lastOk: '2026-10-19T00:00:00Z' }, { ...P(2), lastOk: null }, { ...P(3), lastOk: '2026-10-18T00:00:00Z' }] })
    await handle(post(), d)
    expect(log.saved).toEqual([P(2).id, P(3).id, P(1).id])
  })
  it('고른 상품이 없으면 바로 done', async () => {
    const { d, log } = deps({ products: async () => [] })
    expect(await (await handle(post(), d)).json()).toEqual({ status: 'done' })
    expect(log.runs[0]).toEqual({ source: 'recheck', ok: true, rows: 0, total: 0, error: null })
  })
})
