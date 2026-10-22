// shop-find(D-024) 순서와 판단: 한 번만 찾기, 이미 넣은 출처 빼기, 페이지 직접 읽기, 분명하면 저장·아니면 후보, 실패 기록.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { FoundShop } from '../../supabase/functions/_shared/shopFind'
import type { ShopLink, ShopSource } from '../../supabase/functions/_shared/shops'
import { handle, SearchError, type FindDeps, type FindItem, type FindState } from '../../supabase/functions/shop-find/handle'

const ITEM = '11111111-1111-4111-8111-111111111111'
const fixture = (f: string) => readFileSync(new URL(`./fixtures/shops/${f}.html`, import.meta.url), 'utf8')
// 고정 페이지: 컬리 "[비비고] 왕교자 만두 대용량 1.05kg"(1050g, 10,980원), 홈플러스 "농심 신라면 120G*5입", 로우차트 "오뚜기옛날 참기름, 350ml, 6개"
const PAGES: Record<string, string> = {
  'https://www.kurly.com/goods/5082274': fixture('kurly-5082274'),
  'https://mfront.homeplus.co.kr/item?itemNo=120074651&storeType=HYPER': fixture('homeplus-120074651'),
  'https://www.lowchart.com/9519439579-18170724212': fixture('lowchart-9519439579-18170724212'),
}
const SEARCH = [
  'https://www.kurly.com/goods/5082274',
  'https://front.homeplus.co.kr/item?itemNo=120074651',
  'https://www.coupang.com/vp/products/9519439579?itemId=18170724212&vendorItemId=1',
]
const NOW = new Date('2026-10-22T01:00:00Z')

function deps(over: Partial<FindDeps> = {}, item: Partial<FindItem> = {}) {
  const log = {
    searched: [] as string[], fetched: [] as string[], checks: [] as string[], failedChecks: [] as string[],
    links: [] as ShopLink[], finished: [] as { status: string; candidates: FoundShop[]; error: string | null }[], claimed: 0,
  }
  const d: FindDeps = {
    item: async () => ({ householdId: 'h1', productId: 'p1', productName: 'CJ제일제당 비비고 왕교자 1.05kg', spec: null, ...item }),
    state: async () => null,
    claim: async () => {
      log.claimed++
      return true
    },
    linked: async () => [],
    search: async (name) => {
      log.searched.push(name)
      return SEARCH
    },
    todayCheck: async () => null,
    fetchHtml: async (url) => {
      log.fetched.push(url)
      return PAGES[url] ? { status: 200, text: PAGES[url] } : { status: 404, text: '' }
    },
    saveCheck: async (link) => {
      log.checks.push(link.source)
    },
    failCheck: async (link, err) => {
      log.failedChecks.push(`${link.source}:${err}`)
    },
    saveLink: async (_h, _p, link) => {
      log.links.push(link)
    },
    finish: async (_h, _p, status, candidates, error) => {
      log.finished.push({ status, candidates, error })
    },
    now: () => NOW,
    ...over,
  }
  return { d, log }
}
const post = (body: unknown) => new Request('https://x/functions/v1/shop-find', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) })
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()
const st = (status: FindState['status'], ms: number, error: string | null = null): FindState => ({ status, searchedAt: ago(ms), error })

describe('shop-find 요청 검사', () => {
  it('POST·uuid가 아니면 거절, 내 품목이 아니면 403, 상품을 안 골랐으면 409', async () => {
    const { d } = deps()
    expect((await handle(new Request('https://x/', { method: 'GET' }), d)).status).toBe(405)
    expect((await handle(post({ itemId: 'x' }), d)).status).toBe(400)
    expect((await handle(post({ itemId: ITEM }), { ...d, item: async () => null })).status).toBe(403)
    expect((await handle(post({ itemId: ITEM }), deps({}, { productId: null }).d)).status).toBe(409)
  })
})

describe('한 번만 찾는다', () => {
  it('찾은 적 있으면 다시 검색하지 않는다', async () => {
    const { d, log } = deps({ state: async () => st('done', 30 * 86_400_000) })
    expect(await (await handle(post({ itemId: ITEM }), d)).json()).toEqual({ status: 'cached' })
    expect(log.searched).toEqual([])
  })
  it('찾는 중이면 기다리고, 5분 넘게 멈췄으면 다시 찾는다', async () => {
    expect(await (await handle(post({ itemId: ITEM }), deps({ state: async () => st('searching', 60_000) }).d)).json()).toEqual({ status: 'busy' })
    const { d, log } = deps({ state: async () => st('searching', 6 * 60_000) })
    expect((await (await handle(post({ itemId: ITEM }), d)).json()).status).toBe('done')
    expect(log.searched).toHaveLength(1)
  })
  it('실패는 한 시간 뒤에 다시 하고, 로그인 토큰 문제는 바로 다시 한다', async () => {
    expect(await (await handle(post({ itemId: ITEM }), deps({ state: async () => st('failed', 60_000, 'search_failed') }).d)).json()).toEqual({ status: 'cached_failed' })
    const { d, log } = deps({ state: async () => st('failed', 60_000, 'wif_denied') })
    await handle(post({ itemId: ITEM }), d)
    expect(log.searched).toHaveLength(1)
  })
  it('다른 요청이 먼저 잡았으면 busy', async () => {
    const { d, log } = deps({ claim: async () => false })
    expect(await (await handle(post({ itemId: ITEM }), d)).json()).toEqual({ status: 'busy' })
    expect(log.searched).toEqual([])
  })
})

describe('찾기', () => {
  it('페이지를 직접 읽어 이름·용량이 같은 컬리는 저장하고, 다른 상품(신라면·참기름)은 버린다', async () => {
    const { d, log } = deps()
    expect(await (await handle(post({ itemId: ITEM }), d)).json()).toEqual({ status: 'done', saved: 1, candidates: 1 })
    expect(log.fetched).toEqual(Object.keys(PAGES)) // 쿠팡은 부르지 않고 로우차트를 읽는다
    expect(log.checks).toEqual(['kurly', 'homeplus', 'lowchart']) // 읽은 값은 확인 기록으로 남긴다
    expect(log.links.map((l) => l.sourceId)).toEqual(['5082274'])
    expect(log.finished).toEqual([{
      status: 'done', error: null,
      candidates: [{
        source: 'kurly', sourceId: '5082274', url: 'https://www.kurly.com/goods/5082274', name: '[비비고] 왕교자 만두 대용량 1.05kg',
        size: '1050g', price: 10980, checkedAt: NOW.toISOString(), grade: 'auto', saved: true,
      }],
    }])
  })
  it('용량을 모르면 저장하지 않고 후보로 남긴다', async () => {
    const { d, log } = deps({}, { productName: '비비고 왕교자', spec: null })
    await handle(post({ itemId: ITEM }), d)
    expect(log.links).toEqual([])
    expect(log.finished[0].candidates.map((c) => [c.source, c.grade, c.saved])).toEqual([['kurly', 'maybe', false]])
  })
  it('이미 주소를 넣은 출처는 읽지 않는다. 셋 다 넣었으면 검색하지 않는다', async () => {
    const one = deps({ linked: async () => ['kurly'] as ShopSource[] })
    await handle(post({ itemId: ITEM }), one.d)
    expect(one.log.fetched).not.toContain('https://www.kurly.com/goods/5082274')
    const all = deps({ linked: async () => ['kurly', 'homeplus', 'lowchart'] as ShopSource[] })
    expect(await (await handle(post({ itemId: ITEM }), all.d)).json()).toEqual({ status: 'done', saved: 0, candidates: 0 })
    expect(all.log.searched).toEqual([])
  })
  it('오늘 읽은 페이지는 다시 받지 않는다', async () => {
    const { d, log } = deps({ todayCheck: async (link) => (link.source === 'kurly' ? { name: '[비비고] 왕교자 1.05kg', size: null, price: 10500, checkedAt: ago(3600_000) } : null) })
    await handle(post({ itemId: ITEM }), d)
    expect(log.fetched).not.toContain('https://www.kurly.com/goods/5082274')
    expect(log.finished[0].candidates[0]).toMatchObject({ price: 10500, checkedAt: ago(3600_000), saved: true })
  })
  it('페이지를 못 읽으면 확인 실패로 남기고 건너뛴다', async () => {
    const { d, log } = deps({ fetchHtml: async () => ({ status: 503, text: '' }) })
    expect(await (await handle(post({ itemId: ITEM }), d)).json()).toEqual({ status: 'done', saved: 0, candidates: 0 })
    expect(log.failedChecks).toEqual(['kurly:http_503', 'homeplus:http_503', 'lowchart:http_503'])
  })
  it('저장에 실패하면 후보로 남긴다', async () => {
    const { d, log } = deps({ saveLink: async () => { throw new Error('42501') } })
    await handle(post({ itemId: ITEM }), d)
    expect(log.finished[0].candidates[0]).toMatchObject({ grade: 'auto', saved: false })
  })
  it('검색이 실패하면 이유를 남기고 502', async () => {
    const { d, log } = deps({ search: async () => { throw new SearchError('search_disabled') } })
    const res = await handle(post({ itemId: ITEM }), d)
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ status: 'error', error: 'search_disabled' })
    expect(log.finished).toEqual([{ status: 'failed', candidates: [], error: 'search_disabled' }])
  })
})
