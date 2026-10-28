import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { handle, MAX_WAIT_MS, queryKey, type LatestCheck, type ExploreItem, type PriceDeps } from '../../supabase/functions/explore-price/handle'

const SEARCH_HTML = readFileSync(new URL('../grocery/fixtures/danawa/search-bibigo.html', import.meta.url), 'utf8')
const NOW = new Date('2026-10-28T02:30:00Z') // 한국 2026-10-28 11:30

function deps(over: Partial<PriceDeps> = {}) {
  const log = { urls: [] as string[], slept: [] as number[], saved: [] as [string, string, string, ExploreItem[]][], checks: [] as string[], fails: [] as string[], reserved: [] as number[], inserted: [] as [string, string][] }
  const latest: LatestCheck = {
    checkedAt: '2026-10-28T02:31:00.000Z', pageQty: 3,
    quotes: [
      { qty: 1, seller: null, price: 10380, delivery: null, unitPrice: 989, unitLabel: '100g', mallCount: 33 },
      { qty: 3, seller: '옥션', price: 28800, delivery: 0, unitPrice: null, unitLabel: null, mallCount: null },
      { qty: 3, seller: '11번가', price: 28900, delivery: null, unitPrice: null, unitLabel: null, mallCount: null },
    ],
  }
  const d: PriceDeps = {
    cached: async () => null,
    reserve: async (max) => {
      log.reserved.push(max)
      return 4000
    },
    sleep: async (ms) => {
      log.slept.push(ms)
    },
    fetchHtml: async (url) => {
      log.urls.push(url)
      return { status: 200, text: SEARCH_HTML }
    },
    saveSearch: async (k, day, q, items) => {
      log.saved.push([k, day, q, items])
    },
    product: async () => null,
    searchedName: async (pcode) => (pcode === '5643303' ? 'CJ제일제당 비비고 왕교자 1.05kg' : null),
    insertProduct: async (pcode, name) => {
      log.inserted.push([pcode, name])
      return { id: 'p1', sourceId: pcode, name, rating: 4.8, reviewCount: 9217, ratedAt: '2026-10-28T02:31:00.000Z' }
    },
    todayOk: async () => false,
    latest: async () => latest,
    save: async (id) => {
      log.checks.push(id)
    },
    fail: async (_id, err) => {
      log.fails.push(err)
    },
    now: () => NOW,
    ...over,
  }
  return { d, log }
}

const post = (body: unknown) =>
  new Request('https://x/functions/v1/explore-price', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) })

describe('explore-price: 입력', () => {
  it('405·400(짧거나 긴 검색어, 숫자가 아닌 pcode)이고 다나와를 부르지 않는다', async () => {
    const { d, log } = deps()
    expect((await handle(new Request('https://x/', { method: 'GET' }), d)).status).toBe(405)
    expect((await handle(post('x'), d)).status).toBe(400)
    expect((await handle(post({ query: 'a' }), d)).status).toBe(400)
    expect((await handle(post({ query: 'x'.repeat(61) }), d)).status).toBe(400)
    expect((await handle(post({ pcode: '12a4' }), d)).status).toBe(400)
    expect((await handle(post({ pcode: 1234567 }), d)).status).toBe(400)
    expect(log.urls).toHaveLength(0)
  })
  it('검색어 키는 소문자·공백 정리', () => {
    expect(queryKey('  Bibigo   왕교자 ')).toBe('bibigo 왕교자')
  })
})

describe('explore-price: 검색', () => {
  it('오늘 같은 검색어가 있으면 다나와를 부르지 않고 cached', async () => {
    const items: ExploreItem[] = [{ pcode: '1', name: 'x', imageUrl: null, rating: null, reviewCount: null, variants: [] }]
    const { d, log } = deps({ cached: async (k, day) => (k === '비비고 왕교자' && day === '2026-10-28' ? { items, foundAt: '2026-10-28T01:00:00Z' } : null) })
    const res = await handle(post({ query: '비비고  왕교자' }), d)
    expect(await res.json()).toEqual({ status: 'cached', query: '비비고 왕교자', foundAt: '2026-10-28T01:00:00Z', items })
    expect(log.urls).toHaveLength(0)
    expect(log.reserved).toHaveLength(0)
  })

  it('없으면 전역 자리를 잡고(30초 한도) 기다린 뒤 다나와 검색, 결과를 오늘 캐시에 넣는다', async () => {
    const { d, log } = deps()
    const res = await handle(post({ query: '비비고 왕교자' }), d)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.status).toBe('done')
    expect(log.reserved).toEqual([MAX_WAIT_MS])
    expect(log.slept).toEqual([4000])
    expect(log.urls).toEqual(['https://search.danawa.com/?query=%EB%B9%84%EB%B9%84%EA%B3%A0%20%EC%99%95%EA%B5%90%EC%9E%90'])
    expect(body.items.length).toBeGreaterThan(0)
    expect(body.items.length).toBeLessThanOrEqual(20)
    for (const i of body.items as ExploreItem[]) {
      expect(i.pcode).toMatch(/^\d+$/)
      for (const v of i.variants) expect(v.qty).toBeGreaterThanOrEqual(1)
    }
    expect(log.saved[0].slice(0, 3)).toEqual(['비비고 왕교자', '2026-10-28', '비비고 왕교자'])
  })

  it('자리가 30초 넘게 밀리면 202 busy이고 다나와를 부르지 않는다', async () => {
    const { d, log } = deps({ reserve: async () => -1 })
    const res = await handle(post({ query: '비비고 왕교자' }), d)
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ status: 'busy' })
    expect(log.urls).toHaveLength(0)
  })

  it('다나와가 실패하거나 화면이 바뀌면 502이고 캐시에 넣지 않는다', async () => {
    const { d, log } = deps({ fetchHtml: async () => ({ status: 503, text: '' }) })
    expect(await (await handle(post({ query: '비비고 왕교자' }), d)).json()).toEqual({ status: 'error', reason: 'http_503' })
    const { d: d2, log: log2 } = deps({ fetchHtml: async () => ({ status: 200, text: '<html>바뀐 화면</html>' }) })
    expect((await handle(post({ query: '비비고 왕교자' }), d2)).status).toBe(502)
    expect([...log.saved, ...log2.saved]).toHaveLength(0)
  })

  it('캐시 저장이 실패해도 결과는 돌려준다', async () => {
    const { d } = deps({ saveSearch: async () => { throw new Error('db') } })
    const res = await handle(post({ query: '비비고 왕교자' }), d)
    expect(res.status).toBe(200)
  })
})

describe('explore-price: 상품 가격', () => {
  it('오늘 확인이 없으면 상품 페이지를 읽어 저장하고 가장 최근 확인의 가격 줄을 나눠 돌려준다', async () => {
    const pageHtml = readFileSync(new URL('../grocery/fixtures/danawa/product-5643303.html', import.meta.url), 'utf8')
    const { d, log } = deps({
      fetchHtml: async (url) => {
        log.urls.push(url)
        return { status: 200, text: pageHtml }
      },
    })
    // 앱이 이름을 보내도 쓰지 않는다: 공용 상품 목록에는 서버가 저장한 검색 결과의 이름만 넣는다
    const res = await handle(post({ pcode: '5643303', name: '<지어낸 이름>' }), d)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(log.inserted).toEqual([['5643303', 'CJ제일제당 비비고 왕교자 1.05kg']])
    expect(log.urls).toEqual(['https://prod.danawa.com/info/?pcode=5643303'])
    expect(log.checks).toEqual(['p1'])
    expect(body.status).toBe('done')
    expect(body.product).toEqual({ pcode: '5643303', name: 'CJ제일제당 비비고 왕교자 1.05kg', rating: 4.8, reviewCount: 9217, ratedAt: '2026-10-28T02:31:00.000Z' })
    expect(body.pageQty).toBe(3)
    expect(body.variants).toHaveLength(1)
    expect(body.offers.map((o: { seller: string }) => o.seller)).toEqual(['옥션', '11번가'])
  })

  it('오늘 확인이 있으면 다시 읽지 않고 cached', async () => {
    const { d, log } = deps({ todayOk: async (_id, day) => day === '2026-10-28' })
    const body = await (await handle(post({ pcode: '5643303' }), d)).json()
    expect(body.status).toBe('cached')
    expect(log.urls).toHaveLength(0)
  })

  it('상품 페이지를 못 읽으면 502와 이유, 실패를 기록한다', async () => {
    const { d, log } = deps({ fetchHtml: async () => ({ status: 404, text: '' }) })
    const res = await handle(post({ pcode: '5643303' }), d)
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ status: 'error', reason: 'http_404' })
    expect(log.fails).toEqual(['http_404'])
  })

  it('이미 공용 목록에 있는 상품은 그대로 쓰고 새로 넣지 않는다', async () => {
    const { d, log } = deps({ product: async (pcode) => ({ id: 'p9', sourceId: pcode, name: '장보기에서 고른 이름', rating: null, reviewCount: null, ratedAt: null }), todayOk: async () => true })
    const body = await (await handle(post({ pcode: '1111' }), d)).json()
    expect(body.product.name).toBe('장보기에서 고른 이름')
    expect(log.inserted).toHaveLength(0)
  })

  it('검색 결과에 없던 번호는 404이고 다나와를 부르지도 넣지도 않는다', async () => {
    const { d, log } = deps()
    const res = await handle(post({ pcode: '99999' }), d)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ status: 'not_found' })
    expect(log.urls).toHaveLength(0)
    expect(log.inserted).toHaveLength(0)
  })
})
