import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { handle, itemsWithPcode, MAX_WAIT_MS, queryKey, type LatestCheck, type ExploreItem, type PriceDeps, type ShopItem, type ShopSource } from '../../supabase/functions/explore-price/handle'

const SEARCH_HTML = readFileSync(new URL('../grocery/fixtures/danawa/search-bibigo.html', import.meta.url), 'utf8')
const KURLY_JSON = readFileSync(new URL('./fixtures/kurly-search-bibigo.json', import.meta.url), 'utf8')
const DAISO_JSON = readFileSync(new URL('./fixtures/daiso-search-riddleshot.json', import.meta.url), 'utf8')
const fixture = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8')
const NOW = new Date('2026-10-28T02:30:00Z') // 한국 2026-10-28 11:30

function deps(over: Partial<PriceDeps> = {}) {
  const log = { urls: [] as string[], slept: [] as number[], saved: [] as [string, string, string, ExploreItem[]][], checks: [] as string[], fails: [] as string[], reserved: [] as number[], inserted: [] as [string, string][], shopReserved: [] as [ShopSource, number][], shopSaved: [] as [ShopSource, string, string, string, ShopItem[], string | undefined][] }
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
    cachedShop: async () => null,
    reserveShop: async (source, max) => {
      log.shopReserved.push([source, max])
      return 0
    },
    fetchText: async (url) => {
      log.urls.push(url)
      const text = url.includes('kurly') ? KURLY_JSON : url.includes('daisomall') ? DAISO_JSON : url.includes('ohou.se') ? fixture('ohou-search-storage.html')
        : url.includes('bunjang') ? fixture('bunjang-search-ipad.json') : url.includes('regions/keyword') ? fixture('daangn-region-yeosu.json') : fixture('daangn-search-ipad.html')
      return { status: 200, text }
    },
    saveShop: async (source, scope, k, day, _q, items, _at, region) => {
      log.shopSaved.push([source, scope, k, day, items, region])
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

describe('explore-price: 검색 결과에서 상품 찾기 조건', () => {
  it('실제 supabase-js가 items=cs.[{"pcode":"…"}](jsonb @>)로 보낸다', async () => {
    const urls: string[] = []
    const client = createClient('https://x.supabase.co', 'k', {
      global: { fetch: (async (u: string | URL | Request) => {
        urls.push(String(u))
        return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
      }) as typeof fetch },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    await client.schema('grocery').from('explore_searches').select('items').filter('items', 'cs', itemsWithPcode('5643303')).limit(1)
    expect(decodeURIComponent(urls[0])).toContain('items=cs.[{"pcode":"5643303"}]')
  })
})

describe('explore-price: 몰 검색(D-036)', () => {
  it('출처가 kurly·daiso·danawa가 아니면 400', async () => {
    const { d, log } = deps()
    expect((await handle(post({ query: '우유', source: 'coupang' }), d)).status).toBe(400)
    expect(log.urls).toHaveLength(0)
  })

  it('컬리: 출처별 자리를 잡고 앱 검색 API를 불러 할인가·정가·배송 유형을 돌려주고 오늘 캐시에 넣는다', async () => {
    const { d, log } = deps()
    const res = await handle(post({ query: '비비고 왕교자', source: 'kurly' }), d)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(log.shopReserved).toEqual([['kurly', MAX_WAIT_MS]])
    expect(log.urls).toEqual(['https://api.kurly.com/search/v4/sites/market/normal-search?keyword=%EB%B9%84%EB%B9%84%EA%B3%A0%20%EC%99%95%EA%B5%90%EC%9E%90&page=1'])
    expect(body.status).toBe('done')
    expect(body.source).toBe('kurly')
    expect(body.items[0]).toEqual({
      id: '5082274', name: '[비비고] 왕교자 만두 대용량 1.05kg', price: 10480, listPrice: 11480, discountRate: 8, soldOut: false,
      url: 'https://www.kurly.com/goods/5082274', reviews: '9,999+', rating: null, tags: ['샛별배송'],
    })
    expect(log.shopSaved[0].slice(0, 4)).toEqual(['kurly', '', '비비고 왕교자', '2026-10-28'])
  })

  it('다이소: 상품 문서가 있는 결과 묶음에서 가격·평점·픽업 여부, 상품 페이지 주소', async () => {
    const { d } = deps()
    const body = await (await handle(post({ query: '리들샷', source: 'daiso' }), d)).json()
    const item = body.items.find((i: ShopItem) => i.id === '1049275')
    expect(item).toEqual({
      id: '1049275', name: '[피부결케어]VT 리들샷 100 페이셜 부스팅 퍼스트 앰플 2 ml*6개입', price: 3000, listPrice: null, discountRate: null, soldOut: false,
      url: 'https://www.daisomall.co.kr/pd/pdr/SCR_PDR_0001?pdNo=1049275', reviews: '17,392', rating: 4.9, tags: ['매장 픽업', '택배'],
    })
  })

  it('같은 날 같은 출처·검색어는 부르지 않고 cached, 자리가 밀리면 busy, 모양이 다르면 502', async () => {
    const items: ShopItem[] = [{ id: '1', name: 'x', price: 1, listPrice: null, discountRate: null, soldOut: false, url: 'u', reviews: null, rating: null, tags: [] }]
    const { d, log } = deps({ cachedShop: async (s, scope, k, day) => (s === 'kurly' && scope === '' && k === '우유' && day === '2026-10-28' ? { items, foundAt: 'f' } : null) })
    expect(await (await handle(post({ query: '우유', source: 'kurly' }), d)).json()).toEqual({ status: 'cached', source: 'kurly', query: '우유', foundAt: 'f', items })
    expect(log.urls).toHaveLength(0)

    const { d: d2 } = deps({ reserveShop: async () => -1 })
    const busy = await handle(post({ query: '우유', source: 'daiso' }), d2)
    expect(busy.status).toBe(202)
    expect(await busy.json()).toEqual({ status: 'busy', source: 'daiso' })

    const { d: d3, log: log3 } = deps({ fetchText: async () => ({ status: 200, text: '{"data":{}}' }) })
    expect(await (await handle(post({ query: '우유', source: 'kurly' }), d3)).json()).toEqual({ status: 'error', source: 'kurly', reason: 'parse_failed' })
    expect(log3.shopSaved).toHaveLength(0)

    const { d: d4 } = deps({ fetchText: async () => ({ status: 403, text: '' }) })
    expect(await (await handle(post({ query: '우유', source: 'daiso' }), d4)).json()).toEqual({ status: 'error', source: 'daiso', reason: 'http_403' })
  })
})

describe('explore-price: 오늘의집·번개장터·당근(D-036 보충)', () => {
  it('오늘의집: 검색 화면의 압축 데이터(turbo-stream)에서 상품 카드의 판매가·정가·할인율·후기·브랜드', async () => {
    const { d, log } = deps()
    const body = await (await handle(post({ query: '수납장', source: 'ohou' }), d)).json()
    expect(log.urls).toEqual(['https://ohou.se/search/index?query=%EC%88%98%EB%82%A9%EC%9E%A5'])
    expect(log.shopReserved).toEqual([['ohou', MAX_WAIT_MS]])
    expect(body.items[0]).toEqual({
      id: '3320009', name: '[오늘의집 단독] E0 에이미 1200 2단/3단 서랍장 시스템 선반장 수납 책장', price: 144900, listPrice: 194000, discountRate: 25, soldOut: false,
      url: 'https://store.ohou.se/goods/3320009', reviews: '1,249', rating: 4.7, tags: ['리샘', '특가', '무료배송'],
    })
    expect(body.items.map((i: ShopItem) => i.id)).toEqual(['3320009', '3987839', '2281959'])
  })

  it('번개장터: 본 목록 블록의 매물(광고 표시, 올린 시각), 상품 페이지 주소', async () => {
    const { d } = deps()
    const body = await (await handle(post({ query: '아이패드', source: 'bunjang' }), d)).json()
    expect(body.items[0]).toEqual({
      id: '442132021', name: '[미개봉 새상품] 애플 아이패드 11세대 WIFI전용 128G (색상 선택가능) 1년 무상AS', price: 679000, listPrice: null, discountRate: null, soldOut: false,
      url: 'https://m.bunjang.co.kr/products/442132021', reviews: null, rating: null, tags: ['광고'], place: null, postedAt: '2026-10-22T06:49:25Z',
    })
  })

  it('당근: 동네(기본 여수동)를 찾아 그 동네로 찾고, 동네 이름·매물 동네·끌어올린 시각을 돌려준다. 캐시 범위는 동네', async () => {
    const { d, log } = deps()
    const body = await (await handle(post({ query: '아이패드', source: 'daangn' }), d)).json()
    expect(log.urls).toEqual([
      'https://www.daangn.com/kr/api/v1/regions/keyword?keyword=%EC%97%AC%EC%88%98%EB%8F%99',
      'https://www.daangn.com/kr/buy-sell/?in=%EC%97%AC%EC%88%98%EB%8F%99-4522&search=%EC%95%84%EC%9D%B4%ED%8C%A8%EB%93%9C&only_on_sale=true',
    ])
    expect(body.region).toBe('경기도 성남시 중원구 여수동')
    expect(body.items[0]).toMatchObject({ id: 'b2v3w6r6vh1i', name: '아이패드 8세대 스그 애플펜슬 포함 32기가', price: 170000, place: '행암동', postedAt: '2026-10-28T03:25:53.464Z' })
    expect(body.items[0].url).toMatch(/^https:\/\/www\.daangn\.com\/kr\/buy-sell\//)
    expect(log.shopSaved[0].slice(0, 4)).toEqual(['daangn', '여수동', '아이패드', '2026-10-28'])
    expect(log.shopSaved[0][5]).toBe('경기도 성남시 중원구 여수동')
  })

  it('당근 동네는 한글·숫자 1~20자만, 동네를 못 찾으면 502 no_region', async () => {
    const { d, log } = deps()
    expect((await handle(post({ query: '아이패드', source: 'daangn', region: 'a&b' }), d)).status).toBe(400)
    expect(log.urls).toHaveLength(0)
    const { d: d2 } = deps({ fetchText: async () => ({ status: 200, text: '{"locations":[]}' }) })
    expect(await (await handle(post({ query: '아이패드', source: 'daangn', region: '없는동' }), d2)).json()).toEqual({ status: 'error', source: 'daangn', reason: 'no_region' })
  })

  it('오늘의집 화면 데이터가 없으면 parse_failed', async () => {
    const { d } = deps({ fetchText: async () => ({ status: 200, text: '<html>바뀐 화면</html>' }) })
    expect(await (await handle(post({ query: '수납장', source: 'ohou' }), d)).json()).toEqual({ status: 'error', source: 'ohou', reason: 'parse_failed' })
  })
})

