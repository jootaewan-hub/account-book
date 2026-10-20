// 성분 함수(food-info, P7): 고른 상품의 식약처 품목(C002) 후보 찾기와, 사람이 고른 품목의 원재료·영양성분 저장.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { handle, type FoodInfoDeps } from '../../supabase/functions/food-info/handle'

const read = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/foodsafety/${f}`, import.meta.url), 'utf8'))
const PRODUCT = '22222222-2222-4222-8222-222222222222'
const post = (body: unknown) => new Request('https://x/functions/v1/food-info', { method: 'POST', body: JSON.stringify(body) })

function deps(over: Partial<FoodInfoDeps> = {}) {
  const log = { urls: [] as string[], saved: [] as unknown[] }
  const d: FoodInfoDeps = {
    foodKey: 'FOODKEY',
    dataKey: 'DATAKEY',
    allowed: async () => 'hh-1',
    productName: async () => 'CJ제일제당 비비고 왕교자 1.05kg (3개)',
    fetchJson: async (url) => {
      log.urls.push(url)
      if (url.includes('/C002/')) return read('C002-sample.json')
      if (url.includes('FoodNtrCpntDbInfo03')) return read('nutrition-sample.json')
      return { unreadable: 404 }
    },
    save: async (hh, _id, info) => {
      log.saved.push({ hh, ...info })
    },
    allowedItem: async () => ({ householdId: 'hh-1', name: '대파', spec: null }),
    saveNutrition: async () => {},
    now: () => new Date('2026-10-20T01:00:00Z'),
    ...over,
  }
  return { d, log }
}

describe('food-info: 검사', () => {
  it('POST가 아니면 405, productId·action이 틀리면 400, 남의 상품이면 403, 상품이 없으면 404', async () => {
    const { d } = deps()
    expect((await handle(new Request('https://x', { method: 'GET' }), d)).status).toBe(405)
    expect((await handle(post({ productId: 'x', action: 'search' }), d)).status).toBe(400)
    expect((await handle(post({ productId: PRODUCT, action: 'nope' }), d)).status).toBe(400)
    expect((await handle(post({ productId: PRODUCT, action: 'choose' }), d)).status).toBe(400) // reportNo 없음
    expect((await handle(post({ productId: PRODUCT, action: 'search' }), deps({ allowed: async () => null }).d)).status).toBe(403)
    expect((await handle(post({ productId: PRODUCT, action: 'search' }), deps({ productName: async () => null }).d)).status).toBe(404)
  })
  it('식약처 키가 없으면 500', async () => {
    expect((await handle(post({ productId: PRODUCT, action: 'search' }), deps({ foodKey: undefined }).d)).status).toBe(500)
  })
})

describe('food-info: search', () => {
  it('상품명의 가장 구체적인 말로 C002를 찾고, 단어가 많이 맞는 순으로 후보를 돌려준다', async () => {
    const { d, log } = deps()
    const res = await handle(post({ productId: PRODUCT, action: 'search' }), d)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('done')
    expect(body.term).toBe('왕교자')
    expect(log.urls).toEqual(['https://openapi.foodsafetykorea.go.kr/api/FOODKEY/C002/json/1/20/PRDLST_NM=%EC%99%95%EA%B5%90%EC%9E%90'])
    expect(body.candidates).toHaveLength(3)
    // 사본의 세 건은 '왕교자'와 맞는 단어가 없어 변경일이 늦은 순
    expect(body.candidates.map((c: { changedOn: string }) => c.changedOn)).toEqual([...body.candidates.map((c: { changedOn: string }) => c.changedOn)].sort().reverse())
    expect(body.candidates.map((c: { reportNo: string }) => c.reportNo).sort()).toEqual(['1997040105528', '2022051450995', ...body.candidates.map((c: { reportNo: string }) => c.reportNo).filter((r: string) => !['1997040105528', '2022051450995'].includes(r))].sort())
  })
  it('첫 말로 못 찾으면(INFO-200) 다음 말로 한 번 더', async () => {
    const calls: string[] = []
    const { d } = deps({
      fetchJson: async (url) => {
        calls.push(url)
        return calls.length === 1 ? { C002: { RESULT: { CODE: 'INFO-200', MSG: '없음' } } } : read('C002-sample.json')
      },
    })
    const body = await (await handle(post({ productId: PRODUCT, action: 'search' }), d)).json()
    expect(calls).toHaveLength(2)
    expect(calls[1]).toContain('PRDLST_NM=%EB%B9%84%EB%B9%84%EA%B3%A0')
    expect(body.term).toBe('비비고')
    expect(body.candidates).toHaveLength(3)
  })
  it('찾을 말이 없거나 둘 다 없으면 빈 후보, API 오류·네트워크 오류는 502', async () => {
    const { d } = deps({ fetchJson: async () => ({ C002: { RESULT: { CODE: 'INFO-200', MSG: '없음' } } }) })
    expect((await (await handle(post({ productId: PRODUCT, action: 'search' }), d)).json()).candidates).toEqual([])
    const bad = deps({ fetchJson: async () => ({ RESULT: { CODE: 'ERROR-300', MSG: 'x' } }) })
    const r = await handle(post({ productId: PRODUCT, action: 'search' }), bad.d)
    expect(r.status).toBe(502)
    expect(await r.json()).toEqual({ status: 'error', reason: 'ERROR-300' })
    const net = deps({ fetchJson: async () => { throw new TypeError('fetch failed') } })
    expect(await (await handle(post({ productId: PRODUCT, action: 'search' }), net.d)).json()).toEqual({ status: 'error', reason: 'network_error' })
  })
})

describe('food-info: choose', () => {
  it('보고번호로 C002 한 건을 다시 받고 영양성분을 붙여 저장한다', async () => {
    const { d, log } = deps()
    const res = await handle(post({ productId: PRODUCT, action: 'choose', reportNo: '1997040105528' }), d)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('done')
    expect(log.urls[0]).toBe('https://openapi.foodsafetykorea.go.kr/api/FOODKEY/C002/json/1/5/PRDLST_REPORT_NO=1997040105528')
    expect(log.urls[1]).toContain('FoodNtrCpntDbInfo03/getFoodNtrCpntDbInq03?serviceKey=DATAKEY&type=json&pageNo=1&numOfRows=5&ITEM_REPORT_NO=1997040105528')
    expect(log.saved[0]).toMatchObject({
      hh: 'hh-1', reportNo: '1997040105528', name: '가시오가피 냉면', maker: '주식회사 금성에프앤비', kind: '숙면', changedOn: '2023-06-10',
      nutrition: { basis: '100g', kcal: 232, sodium: 540 }, nutritionError: null,
    })
    expect(body.info).toMatchObject({ reportNo: '1997040105528', nutrition: { kcal: 232 } })
  })
  it('영양성분을 못 받아도 원재료는 저장하고 이유를 남긴다(키 없음·오류·없음)', async () => {
    const noKey = deps({ dataKey: undefined })
    await handle(post({ productId: PRODUCT, action: 'choose', reportNo: '1997040105528' }), noKey.d)
    expect(noKey.log.saved[0]).toMatchObject({ nutrition: null, nutritionError: 'missing_api_key' })
    const err = deps({ fetchJson: async (url) => (url.includes('/C002/') ? read('C002-sample.json') : { header: { resultCode: '30', resultMsg: 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR' } }) })
    await handle(post({ productId: PRODUCT, action: 'choose', reportNo: '1997040105528' }), err.d)
    expect(err.log.saved[0]).toMatchObject({ nutrition: null, nutritionError: '30' })
    const none = deps({ fetchJson: async (url) => (url.includes('/C002/') ? read('C002-sample.json') : { header: { resultCode: '00' }, body: { items: [] } }) })
    await handle(post({ productId: PRODUCT, action: 'choose', reportNo: '1997040105528' }), none.d)
    expect(none.log.saved[0]).toMatchObject({ nutrition: null, nutritionError: 'not_found' })
  })
  it('보고번호가 C002에 없으면 404, 저장 실패는 502', async () => {
    const none = deps({ fetchJson: async () => ({ C002: { RESULT: { CODE: 'INFO-200', MSG: '없음' } } }) })
    expect((await handle(post({ productId: PRODUCT, action: 'choose', reportNo: '9' }), none.d)).status).toBe(404)
    const bad = deps({ save: async () => { throw new Error('db') } })
    expect(await (await handle(post({ productId: PRODUCT, action: 'choose', reportNo: '1997040105528' }), bad.d)).json()).toEqual({ status: 'error', reason: 'save_failed' })
  })
})

describe('food-info: 영양성분 이름 검색·고르기(P9, D-018)', () => {
  const ITEM = '33333333-3333-4333-8333-333333333333'
  const nd = (over: Partial<FoodInfoDeps> = {}) => {
    const saved: unknown[] = []
    const { d, log } = deps({ saveNutrition: async (itemId, row) => { saved.push({ itemId, foodCd: row.foodCd, foodName: row.foodName }) }, ...over })
    return { d, log, saved }
  }
  it('품목 이름(또는 준 검색어)으로 FOOD_NM_KR 검색해 후보를 돌려준다', async () => {
    const { d, log } = nd()
    const res = await handle(post({ itemId: ITEM, action: 'nutrition_search' }), d)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.term).toBe('대파')
    expect(body.candidates[0]).toMatchObject({ foodCd: 'P000000001', foodName: '왕교자', kcal: 232 })
    expect(log.urls[0]).toContain('FOOD_NM_KR=%EB%8C%80%ED%8C%8C')
    const r2 = await handle(post({ itemId: ITEM, action: 'nutrition_search', query: ' 쪽파 ' }), d)
    expect((await r2.json()).term).toBe('쪽파')
  })
  it('고르기: 같은 검색으로 다시 받아 식품코드가 맞는 줄만 저장한다. 없으면 404', async () => {
    const { d, saved } = nd()
    const res = await handle(post({ itemId: ITEM, action: 'nutrition_choose', query: '왕교자', foodCd: 'P000000001' }), d)
    expect(res.status).toBe(200)
    expect(saved).toEqual([{ itemId: ITEM, foodCd: 'P000000001', foodName: '왕교자' }])
    expect((await handle(post({ itemId: ITEM, action: 'nutrition_choose', query: '왕교자', foodCd: 'NOPE' }), d)).status).toBe(404)
  })
  it('남의 품목이면 403, itemId·foodCd 모양이 틀리면 400, 공공데이터포털 키가 없으면 500, API 오류는 502', async () => {
    expect((await handle(post({ itemId: ITEM, action: 'nutrition_search' }), nd({ allowedItem: async () => null }).d)).status).toBe(403)
    expect((await handle(post({ itemId: 'x', action: 'nutrition_search' }), nd().d)).status).toBe(400)
    expect((await handle(post({ itemId: ITEM, action: 'nutrition_choose', query: '왕교자' }), nd().d)).status).toBe(400)
    expect((await handle(post({ itemId: ITEM, action: 'nutrition_search' }), nd({ dataKey: undefined }).d)).status).toBe(500)
    expect((await handle(post({ itemId: ITEM, action: 'nutrition_search' }), nd({ fetchJson: async () => ({ header: { resultCode: '30', resultMsg: 'KEY' } }) }).d)).status).toBe(502)
  })
})
