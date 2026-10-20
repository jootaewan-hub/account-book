// 참가격 수집 함수(tprice-sync): 판매점(성남만)·상품 목록을 받아 두고, 성남 판매점 × 최근 금요일 5개의 가격을 받는다.
// 식약처·시세 동기화처럼 스스로 막는다(20시간 1회, 잠금 id 3). 응답 사본은 tests/grocery/fixtures/tprice.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { TpriceGood, TpricePrice, TpriceStore } from '../../supabase/functions/_shared/tprice'
import { handle, type TpriceSyncDeps } from '../../supabase/functions/tprice-sync/handle'

type Run = Parameters<TpriceSyncDeps['recordRun']>[0]
const read = (f: string) => readFileSync(new URL(`./fixtures/tprice/${f}`, import.meta.url), 'utf8')
const NOW = new Date('2026-10-19T22:20:00Z') // 한국 시간 10월 20일(화) 07:20
const KEY = 'abc123SECRET'
const FRIDAYS = ['2026-10-16', '2026-10-09', '2026-10-02', '2026-09-25', '2026-09-18']
const SEONGNAM = ['7', '912', '82', '1948']
const post = () => new Request('https://x/functions/v1/tprice-sync', { method: 'POST' })

type Fake = { status: number; text: string } | 'throw'
function api(opts: { stores?: Fake; goods?: Fake; prices?: (u: URL) => Fake | undefined } = {}) {
  const urls: URL[] = []
  const give = (f: Fake | undefined, fallback: string) => {
    if (f === 'throw') throw new TypeError('fetch failed')
    return f ?? { status: 200, text: fallback }
  }
  const fetchText = async (url: string) => {
    const u = new URL(url)
    urls.push(u)
    if (u.pathname.endsWith('getStoreInfoSvc.do')) return give(opts.stores, read('stores.xml'))
    if (u.pathname.endsWith('getProductInfoSvc.do')) return give(opts.goods, read('goods.xml'))
    // 사본의 판매점 id(7)를 요청한 판매점 id로 바꿔 돌려준다
    return give(opts.prices?.(u), read('prices.xml').replaceAll('<entpId>7</entpId>', `<entpId>${u.searchParams.get('entpId')}</entpId>`))
  }
  return { urls, fetchText }
}

function deps(over: Partial<TpriceSyncDeps> = {}, a = api()) {
  const log = { stores: [] as TpriceStore[][], goods: [] as TpriceGood[][], prices: [] as TpricePrice[][], runs: [] as Run[], covered: [] as [string[], string[]][] }
  const d: TpriceSyncDeps = {
    apiKey: ` ${KEY}\n`,
    fetchText: a.fetchText,
    now: () => NOW,
    recentOk: async () => false,
    acquire: async () => true,
    covered: async (entpIds, days) => {
      log.covered.push([entpIds, days])
      return new Set()
    },
    upsertStores: async (rows) => { log.stores.push(rows) },
    upsertGoods: async (rows) => { log.goods.push(rows) },
    upsertPrices: async (rows) => { log.prices.push(rows) },
    recordRun: async (r) => { log.runs.push(r) },
    ...over,
  }
  return { d, log, urls: a.urls }
}
const priceUrls = (urls: URL[]) => urls.filter((u) => u.pathname.endsWith('getProductPriceInfoSvc'))

describe('tprice-sync: 스스로 막기', () => {
  it('POST가 아니면 405, 키가 없거나 공백뿐이면 500', async () => {
    expect((await handle(new Request('https://x', { method: 'GET' }), deps().d)).status).toBe(405)
    expect((await handle(post(), deps({ apiKey: '  ' }).d)).status).toBe(500)
  })

  it('20시간 안에 성공했으면 받지 않는다', async () => {
    let since = ''
    const { d, urls, log } = deps({ recentOk: async (s) => { since = s; return true } })
    expect(await (await handle(post(), d)).json()).toEqual({ status: 'skipped' })
    expect(since).toBe(new Date(NOW.getTime() - 20 * 3600_000).toISOString())
    expect(urls).toHaveLength(0)
    expect(log.runs).toHaveLength(0)
  })

  it('잠금을 못 얻으면 429, 잠금은 30분 전 기준', async () => {
    const calls: string[][] = []
    const { d, urls } = deps({ acquire: async (c, at) => { calls.push([c, at]); return false } })
    expect((await handle(post(), d)).status).toBe(429)
    expect(calls).toEqual([[new Date(NOW.getTime() - 30 * 60_000).toISOString(), NOW.toISOString()]])
    expect(urls).toHaveLength(0)
  })
})

describe('tprice-sync: 수집', () => {
  it('판매점(성남만)·상품을 저장하고, 성남 판매점 × 최근 금요일 5개의 가격을 받아 아는 상품의 줄만 저장한다', async () => {
    const { d, log, urls } = deps()
    const res = await handle(post(), d)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'done' })
    expect(urls[0].pathname).toBe('/B551919/ProductPriceInfoService/getStoreInfoSvc.do')
    expect(urls[0].searchParams.get('ServiceKey')).toBe(KEY)
    expect(urls[1].pathname).toBe('/B551919/ProductPriceInfoService/getProductInfoSvc.do')
    expect(log.stores).toHaveLength(1)
    expect(log.stores[0].map((s) => s.entpId)).toEqual(SEONGNAM)
    expect(log.goods).toHaveLength(1)
    expect(log.goods[0].map((g) => g.goodId)).toEqual(['1001', '1002', '1003'])
    const pu = priceUrls(urls)
    expect(pu).toHaveLength(SEONGNAM.length * FRIDAYS.length)
    expect(pu.map((u) => `${u.searchParams.get('entpId')}|${u.searchParams.get('goodInspectDay')}`).sort()).toEqual(
      SEONGNAM.flatMap((e) => FRIDAYS.map((f) => `${e}|${f.replace(/-/g, '')}`)).sort(),
    )
    expect(pu.every((u) => u.searchParams.get('serviceKey') === KEY)).toBe(true)
    // 사본의 가격 줄 4개 중 1003(0원)·1004('-')는 읽히지 않고 1001·1002만 남는다
    expect(log.prices).toHaveLength(20)
    expect(log.prices[0].map((p) => p.goodId)).toEqual(['1001', '1002'])
    expect(log.covered).toEqual([[SEONGNAM, FRIDAYS]])
    expect(log.runs).toEqual([{ source: 'tprice', ok: true, rows: 40, total: 20, error: null }])
  })

  it('성남 판매점이 0개면 가격을 부르지 않고 covered도 묻지 않는다(리뷰 ⑥: 빈 in() 500 방지)', async () => {
    const a = api({ stores: { status: 200, text: read('stores.xml').replaceAll('020925000', '020100000').replaceAll('020918000', '020100000').replaceAll('020919000', '020100000') } })
    const { d, log, urls } = deps({}, a)
    const res = await handle(post(), d)
    expect(res.status).toBe(200)
    expect(priceUrls(urls)).toHaveLength(0)
    expect(log.covered).toEqual([])
    expect(log.runs[0]).toMatchObject({ ok: true, rows: 0, total: 0 })
  })
  it('이미 받은 (판매점, 조사일)은 건너뛴다', async () => {
    const { d, urls, log } = deps({ covered: async () => new Set(['7|2026-10-09', '912|2026-10-02']) })
    await handle(post(), d)
    expect(priceUrls(urls)).toHaveLength(18)
    expect(log.runs[0]).toMatchObject({ ok: true, rows: 36, total: 18 })
  })

  it('모르는 상품의 가격 줄은 저장하지 않는다', async () => {
    const xml = read('prices.xml').replace('<goodId>1002</goodId>', '<goodId>9999</goodId>')
    const { d, log } = deps({}, api({ prices: () => ({ status: 200, text: xml }) }))
    expect((await handle(post(), d)).status).toBe(200)
    expect(log.prices.every((rows) => rows.map((p) => p.goodId).join() === '1001')).toBe(true)
    expect(log.runs[0]).toMatchObject({ ok: true, rows: 20 })
  })

  it('판매점 목록을 못 받으면 상품·가격은 부르지 않고 실패로 기록, 207', async () => {
    const { d, urls, log } = deps({}, api({ stores: { status: 200, text: read('gateway-30.xml') } }))
    const res = await handle(post(), d)
    expect(res.status).toBe(207)
    expect(urls).toHaveLength(1)
    expect(log.stores).toHaveLength(0)
    expect(log.runs[0]).toMatchObject({ ok: false, rows: 0 })
    expect(log.runs[0].error).toContain('30')
  })

  it('상품 목록을 못 받으면(HTTP 오류) 가격은 부르지 않는다', async () => {
    const { d, urls, log } = deps({}, api({ goods: { status: 503, text: '' } }))
    expect((await handle(post(), d)).status).toBe(207)
    expect(urls).toHaveLength(2)
    expect(log.stores).toHaveLength(1)
    expect(log.runs[0].error).toContain('http_503')
  })

  it('가격 호출 하나가 실패해도 나머지는 저장하고, 실패는 종류별로 센다', async () => {
    const { d, log } = deps({}, api({ prices: (u) => (u.searchParams.get('entpId') === '7' ? { status: 503, text: '' } : undefined) }))
    expect((await handle(post(), d)).status).toBe(207)
    expect(log.prices).toHaveLength(15)
    expect(log.runs[0]).toMatchObject({ ok: false, rows: 30, total: 20, error: 'http_503 ×5' })
  })

  it('네트워크 오류와 저장 실패도 센다', async () => {
    const a = api({ prices: (u) => (u.searchParams.get('entpId') === '82' ? 'throw' : undefined) })
    const { d, log } = deps({ upsertPrices: async (rows) => { if (rows[0]?.entpId === '7') throw new Error('db') } }, a)
    expect((await handle(post(), d)).status).toBe(207)
    expect(log.runs[0].error).toBe('save_failed ×5, network_error ×5')
  })

  it('한도 초과(22·23)면 남은 호출을 멈춘다', async () => {
    const limit = '<response><result/><resultCode>22</resultCode><resultMsg>LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR</resultMsg></response>'
    const { d, urls, log } = deps({ concurrency: 1 }, api({ prices: () => ({ status: 200, text: limit }) }))
    expect((await handle(post(), d)).status).toBe(207)
    expect(priceUrls(urls)).toHaveLength(1)
    expect(log.runs[0].error).toMatch(/^22 .*미룸 19건$/)
  })

  it('오류 문구에서 키를 가린다', async () => {
    const xml = `<response><result/><resultCode>99</resultCode><resultMsg>bad key ${KEY} ${encodeURIComponent(KEY)}</resultMsg></response>`
    const { d, log } = deps({}, api({ stores: { status: 200, text: xml } }))
    await handle(post(), d)
    expect(log.runs[0].error).not.toContain(KEY)
    expect(log.runs[0].error).toContain('***')
  })

  it('시간이 다 되면 남은 가격 호출은 미루고 207(다음 실행에서 이어 받는다)', async () => {
    let t = 0
    const { d, log, urls } = deps({ budgetMs: 1000, clock: () => (t += 600), concurrency: 1 })
    expect((await handle(post(), d)).status).toBe(207)
    expect(priceUrls(urls).length).toBeLessThan(20)
    expect(log.runs[0].error).toMatch(/미룸 \d+건/)
  })
})
