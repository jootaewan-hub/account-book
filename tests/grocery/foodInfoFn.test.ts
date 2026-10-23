// 성분 함수(food-info, P7·D-020): 식약처 품목제조보고 원재료(식품 C002, 축산물 I1310→C006, 건강기능식품 C003) 찾기·자동 맞춤·고르기와 영양성분(P9).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { handle, type FoodInfoDeps } from '../../supabase/functions/food-info/handle'

const read = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/foodsafety/${f}`, import.meta.url), 'utf8'))
const ITEM = '33333333-3333-4333-8333-333333333333'
const post = (body: unknown) => new Request('https://x/functions/v1/food-info', { method: 'POST', body: JSON.stringify(body) })
const NONE = (svc: string) => ({ [svc]: { RESULT: { CODE: 'INFO-200', MSG: '해당하는 데이터가 없습니다.' } } })
const svcOf = (url: string) => url.match(/\/(C002|I1310|C006|C003)\/json\//)?.[1] ?? null

function deps(over: Partial<FoodInfoDeps> = {}) {
  const log = { urls: [] as string[], saved: [] as unknown[] }
  const d: FoodInfoDeps = {
    foodKey: 'FOODKEY',
    dataKey: 'DATAKEY',
    fetchJson: async (url) => {
      log.urls.push(url)
      const svc = svcOf(url)
      if (svc === 'C002') return read('C002-sample.json')
      if (svc === 'I1310') return read('I1310-name.json')
      if (svc === 'C003') return read('C003-name.json')
      if (svc === 'C006') return read('C006-byno.json')
      if (url.includes('FoodNtrCpntDbInfo03')) return read('nutrition-sample.json')
      return { unreadable: 404 }
    },
    allowedItem: async () => ({ householdId: 'hh-1', name: '대파', spec: null, productName: null }),
    loadFacts: async () => {
      throw new Error('no page')
    },
    clearAuto: async () => {},
    saveNutrition: async () => {},
    saveIngredients: async (itemId, info, auto) => {
      log.saved.push({ itemId, auto, ...info })
    },
    now: () => new Date('2026-10-20T01:00:00Z'),
    ...over,
  }
  return { d, log }
}
const withItem = (name: string, productName: string | null): Partial<FoodInfoDeps> => ({ allowedItem: async () => ({ householdId: 'hh-1', name, spec: null, productName }) })

describe('food-info: 검사', () => {
  it('POST가 아니면 405, itemId·action이 틀리면 400, 남의 품목이면 403, 식약처 키가 없으면 500', async () => {
    const { d } = deps()
    expect((await handle(new Request('https://x', { method: 'GET' }), d)).status).toBe(405)
    expect((await handle(post({ itemId: 'x', action: 'ingredients_search' }), d)).status).toBe(400)
    expect((await handle(post({ itemId: ITEM, action: 'nope' }), d)).status).toBe(400)
    expect((await handle(post({ itemId: ITEM, action: 'ingredients_choose' }), d)).status).toBe(400) // source·reportNo 없음
    expect((await handle(post({ itemId: ITEM, action: 'ingredients_choose', source: 'C006', reportNo: '1' }), d)).status).toBe(400) // 찾는 목록이 아님
    expect((await handle(post({ itemId: ITEM, action: 'ingredients_search' }), deps({ allowedItem: async () => null }).d)).status).toBe(403)
    expect((await handle(post({ itemId: ITEM, action: 'ingredients_search' }), deps({ foodKey: undefined }).d)).status).toBe(500)
  })
})

describe('food-info: 원재료 찾기(ingredients_search, D-020)', () => {
  it('상품을 안 고른 품목은 품목 이름으로 세 목록을 이름으로, C002·I1310을 식품유형으로 한꺼번에 찾아 합치고 순서를 매긴다', async () => {
    const { d, log } = deps(withItem('우유', null))
    const res = await handle(post({ itemId: ITEM, action: 'ingredients_search' }), d)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('done')
    expect(body.term).toBe('우유')
    expect(log.urls.filter((u) => u.includes('PRDLST_NM=')).map(svcOf).sort()).toEqual(['C002', 'C003', 'I1310'])
    expect(log.urls.filter((u) => u.includes('PRDLST_DCNM=')).map(svcOf).sort()).toEqual(['C002', 'I1310'])
    expect(log.urls.every((u) => u.includes('/json/1/50/') && u.endsWith('=%EC%9A%B0%EC%9C%A0'))).toBe(true)
    expect(body.candidates).toHaveLength(8) // 식품유형 검색이 같은 사본을 돌려줘도 보고번호로 하나만
    expect(body.failed).toEqual([])
    expect(body.candidates[0].source).not.toBe('C002')
    expect(body.candidates.map((c: { source: string }) => c.source).slice(-3)).toEqual(['C002', 'C002', 'C002'])
    expect(body.candidates.find((c: { source: string }) => c.source === 'I1310')).toMatchObject({ rawMaterials: null, shelfLife: expect.any(String) })
    expect(body.candidates.find((c: { source: string }) => c.source === 'C003')).toMatchObject({ health: { function: expect.any(String) } })
  })
  it('상품을 고른 품목(다나와 정보 없음): 상표(첫 낱말)를 업체명으로 상품 낱말마다 → 낱말(100건) → 품목 이름 순으로 찾고, 후보가 모이면 멈춘다. 후보는 업체·이름이 맞는 순(D-026)', async () => {
    const { d, log } = deps({
      ...withItem('된장', '샘표 국산콩 100% 백일된장 900g'),
      fetchJson: async (url) => {
        log.urls.push(url)
        const svc = svcOf(url)!
        if (svc === 'C002' && url.includes('BSSH_NM=%EC%83%98%ED%91%9C&PRDLST_NM=%EB%B0%B1%EC%9D%BC%EB%90%9C%EC%9E%A5')) {
          return { C002: { RESULT: { CODE: 'INFO-000' }, total_count: '3', row: [
            { PRDLST_REPORT_NO: '1', PRDLST_NM: '2년숙성백일된장', BSSH_NM: '샘표식품(주)영동공장', PRDLST_DCNM: '된장', RAWMTRL_NM: '대두, 소금' },
            { PRDLST_REPORT_NO: '2', PRDLST_NM: '국산콩백일된장', BSSH_NM: '샘표식품(주)영동공장', PRDLST_DCNM: '된장', RAWMTRL_NM: '대두(국산), 천일염' },
            { PRDLST_REPORT_NO: '3', PRDLST_NM: '백일된장', BSSH_NM: '샘표식품(주)영동공장', PRDLST_DCNM: '된장', RAWMTRL_NM: '대두, 천일염' },
          ] } }
        }
        return NONE(svc)
      },
    })
    const body = await (await handle(post({ itemId: ITEM, action: 'ingredients_search' }), d)).json()
    expect(body.term).toBe('샘표 백일된장 국산콩')
    // 띄어쓴 구절("국산콩 백일된장")은 쓰지 않는다. 첫 단계(샘표 × 백일된장·국산콩 × 세 목록)에서 3건, 5건이 안 되면 낱말 100건 → 품목 이름까지
    expect(log.urls.some((u) => u.includes(encodeURIComponent('국산콩 백일된장')))).toBe(false)
    expect(log.urls[0]).toContain('/C002/json/1/100/BSSH_NM=%EC%83%98%ED%91%9C&PRDLST_NM=%EB%B0%B1%EC%9D%BC%EB%90%9C%EC%9E%A5')
    expect(log.urls.slice(0, 6).every((u) => u.includes('BSSH_NM=%EC%83%98%ED%91%9C&PRDLST_NM='))).toBe(true)
    expect(log.urls.some((u) => u.includes('BSSH_NM=') && u.includes('PRDLST_DCNM='))).toBe(false)
    expect(log.urls.some((u) => u.includes('/json/1/100/PRDLST_NM=%EB%B0%B1%EC%9D%BC%EB%90%9C%EC%9E%A5'))).toBe(true)
    expect(body.candidates.map((c: { name: string }) => c.name)).toEqual(['국산콩백일된장', '백일된장', '2년숙성백일된장'])
  })
  it('검색어를 주면 그 낱말로만 찾는다(상품명은 쓰지 않는다). 두 낱말이면 낱말마다 이름으로, 전체를 식품유형으로', async () => {
    const { d, log } = deps(withItem('된장', '샘표 국산콩 100% 백일된장 900g'))
    const body = await (await handle(post({ itemId: ITEM, action: 'ingredients_search', query: ' 쌈장 ' }), d)).json()
    expect(body.term).toBe('쌈장')
    expect(log.urls.filter((u) => u.includes('PRDLST_NM=')).map(svcOf).sort()).toEqual(['C002', 'C003', 'I1310'])
    expect(log.urls.every((u) => !u.includes('BSSH_NM=') && u.endsWith('=%EC%8C%88%EC%9E%A5'))).toBe(true)
    log.urls.length = 0
    await handle(post({ itemId: ITEM, action: 'ingredients_search', query: '서울우유 버터' }), d)
    expect(log.urls.filter((u) => u.includes('PRDLST_NM=%EC%84%9C%EC%9A%B8%EC%9A%B0%EC%9C%A0'))).toHaveLength(3)
    expect(log.urls.filter((u) => u.includes('PRDLST_NM=%EB%B2%84%ED%84%B0'))).toHaveLength(3)
    expect(log.urls.filter((u) => u.includes('PRDLST_DCNM=' + encodeURIComponent('서울우유 버터')))).toHaveLength(2)
  })
  it('한 목록이 실패하면(활용신청 없음 INFO-110 등) 나머지로 이어 가고 failed에 적는다. 그 목록은 다음 단계에서 다시 부르지 않는다', async () => {
    const { d, log } = deps({
      ...withItem('우유', '서울우유 1L'),
      fetchJson: async (url) => {
        log.urls.push(url)
        const svc = svcOf(url)!
        if (svc === 'I1310') return { I1310: { RESULT: { CODE: 'INFO-110', MSG: '활용신청을 하지 않았습니다' } } }
        if (svc === 'C003') throw new TypeError('fetch failed')
        return url.includes(encodeURIComponent('서울우유')) ? NONE('C002') : read('C002-name.json')
      },
    })
    const res = await handle(post({ itemId: ITEM, action: 'ingredients_search' }), d)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.failed).toEqual([{ source: 'I1310', reason: 'INFO-110' }, { source: 'C003', reason: 'network_error' }])
    expect(body.candidates.map((c: { source: string }) => c.source)).toEqual(['C002', 'C002'])
    // 낱말 하나뿐이라 상표 단계가 없다: 낱말 '서울우유'(세 목록) → 품목 이름 '우유'(살아 있는 C002만, 이름과 식품유형)
    expect(log.urls.map(svcOf)).toEqual(['C002', 'I1310', 'C003', 'C002', 'C002'])
  })
  it('세 목록이 모두 실패하면 502, 찾을 말이 없으면 빈 후보', async () => {
    const bad = deps({ ...withItem('우유', null), fetchJson: async () => ({ RESULT: { CODE: 'ERROR-300', MSG: 'x' } }) })
    const r = await handle(post({ itemId: ITEM, action: 'ingredients_search' }), bad.d)
    expect(r.status).toBe(502)
    expect(await r.json()).toEqual({ status: 'error', reason: 'ERROR-300' })
    const empty = deps(withItem('  ', null))
    expect(await (await handle(post({ itemId: ITEM, action: 'ingredients_search' }), empty.d)).json()).toEqual({ status: 'done', term: null, candidates: [], failed: [] })
  })
  it('품목 이름으로 찾을 때 식품유형이 맞는 줄이 있으면 그것부터, 식품유형도 안 맞고 이름에 낱말로도 안 든 것(에그콘버터·우유케이크)은 뺀다(사용자 2026-10-21: 버터에 쿠키가 뜸)', async () => {
    const BUTTER_TYPE = { I1310: { RESULT: { CODE: 'INFO-000' }, row: [
      { PRDLST_REPORT_NO: 'b1', PRDLST_NM: '임실무염버터', BSSH_NM: '임실치즈축산업협동조합', PRDLST_DCNM: '버터' },
      { PRDLST_REPORT_NO: 'b2', PRDLST_NM: 'AF 가공버터', BSSH_NM: '롯데웰푸드', PRDLST_DCNM: '가공버터' },
    ] } }
    const BUTTER_NAME = { I1310: { RESULT: { CODE: 'INFO-000' }, row: [
      { PRDLST_REPORT_NO: 'b2', PRDLST_NM: 'AF 가공버터', BSSH_NM: '롯데웰푸드', PRDLST_DCNM: '가공버터' },
      { PRDLST_REPORT_NO: 'n1', PRDLST_NM: '1am 닭가슴살 에그콘버터', BSSH_NM: '이유푸드', PRDLST_DCNM: '분쇄가공육제품' },
    ] } }
    const { d, log } = deps({
      ...withItem('버터', null),
      fetchJson: async (url) => {
        log.urls.push(url)
        const svc = svcOf(url)!
        if (svc === 'I1310') return url.includes('PRDLST_DCNM=') ? BUTTER_TYPE : BUTTER_NAME
        if (svc === 'C002') return url.includes('PRDLST_DCNM=') ? NONE('C002') : read('C002-name.json')
        return NONE(svc)
      },
    })
    const body = await (await handle(post({ itemId: ITEM, action: 'ingredients_search' }), d)).json()
    expect(body.candidates.map((c: { reportNo: string }) => c.reportNo)).toEqual(['b1', 'b2'])
    expect(body.failed).toEqual([])
  })
})

describe('food-info: 원재료 자동 맞춤(ingredients_auto, 캐시된 옛 화면용: 안은 product_auto와 같은 맞춤, D-026)', () => {
  const POULTRY = { I1310: { RESULT: { CODE: 'INFO-000' }, row: [
    { PRDLST_REPORT_NO: '199900307705', PRDLST_NM: '닭꼬치', BSSH_NM: '노벨유통', PRDLST_DCNM: '포장육', POG_DAYCNT: '제조일로부터 7일', LAST_UPDT_DTM: '20240101' },
  ] } }
  it('상품을 안 고른 품목은 찾지 않고 null(no_product)', async () => {
    const { d, log } = deps(withItem('우유', null))
    const body = await (await handle(post({ itemId: ITEM, action: 'ingredients_auto' }), d)).json()
    expect(body).toEqual({ status: 'done', term: null, ingredients: null, reason: 'no_product' })
    expect(log.urls).toEqual([])
  })
  it('업체+낱말로 찾은 축산물(I1310)이 맞으면 C006에서 원재료를 받아 소비기한과 함께 auto로 저장한다. 품목 이름으로는 찾지 않는다', async () => {
    const { d, log } = deps({
      ...withItem('우유', '노벨유통 닭꼬치 300g'),
      fetchJson: async (url) => {
        log.urls.push(url)
        const svc = svcOf(url)!
        if (svc === 'I1310') return POULTRY
        if (svc === 'C006') return read('C006-byno.json')
        return NONE(svc)
      },
    })
    const res = await handle(post({ itemId: ITEM, action: 'ingredients_auto' }), d)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.term).toBe('닭꼬치')
    expect(log.urls[0]).toContain('BSSH_NM=%EB%85%B8%EB%B2%A8%EC%9C%A0%ED%86%B5&PRDLST_NM=%EB%8B%AD%EA%BC%AC%EC%B9%98')
    expect(body.ingredients).toMatchObject({ origin: 'C006', reportNo: '199900307705', name: '닭꼬치', maker: '노벨유통', rawMaterials: '닭고기', shelfLife: '제조일로부터 7일' })
    expect(log.saved).toEqual([{ itemId: ITEM, auto: true, ...body.ingredients }])
    expect(log.urls.some((u) => u.includes('PRDLST_NM=%EC%9A%B0%EC%9C%A0') || u.includes('PRDLST_DCNM=%EC%9A%B0%EC%9C%A0'))).toBe(false)
    expect(log.urls.at(-1)).toContain('/C006/json/1/20/PRDLST_REPORT_NO=199900307705')
  })
  it('다나와 제조사를 모르면 상표(청정원)로는 대상(주) 제품이 업체 일치가 되지 않아 낱말 100건에서 찾아도 저장하지 않는다(다른 회사 제품을 붙이지 않는다)', async () => {
    const { d, log } = deps({
      ...withItem('고추장', '청정원 순창 100% 현미 태양초 찰고추장 2kg'),
      fetchJson: async (url) => {
        log.urls.push(url)
        const svc = svcOf(url)!
        if (svc === 'C002' && url.includes('/json/1/100/PRDLST_NM=' + encodeURIComponent('찰고추장'))) {
          return { C002: { RESULT: { CODE: 'INFO-000' }, row: [
            { PRDLST_REPORT_NO: 'g1', PRDLST_NM: '기픈샘순창태양초찰고추장', BSSH_NM: '(주)기픈샘', PRDLST_DCNM: '고추장', RAWMTRL_NM: '고춧가루' },
            { PRDLST_REPORT_NO: 'g2', PRDLST_NM: '청정원순창태양초찰고추장', BSSH_NM: '대상(주)', PRDLST_DCNM: '고추장', RAWMTRL_NM: '고추양념, 현미' },
          ] } }
        }
        return NONE(svc)
      },
      saveIngredients: async () => { throw new Error('must not save') },
    })
    const body = await (await handle(post({ itemId: ITEM, action: 'ingredients_auto' }), d)).json()
    expect(body).toMatchObject({ ingredients: null, reason: 'no_fit' })
    expect(log.urls.filter((u) => u.includes('BSSH_NM=%EC%B2%AD%EC%A0%95%EC%9B%90')).length).toBeGreaterThan(0)
  })
  it('맞는 것이 없으면(단어 하나만 맞고 업체도 다름) 저장하지 않고 null(no_fit). 찾은 말은 처음 후보가 나온 단계', async () => {
    const { d, log } = deps({ ...withItem('된장', '샘표 국산콩 100% 백일된장 900g'), saveIngredients: async () => { throw new Error('must not save') } })
    const body = await (await handle(post({ itemId: ITEM, action: 'ingredients_auto' }), d)).json()
    expect(body).toEqual({ status: 'done', term: '백일된장 국산콩', ingredients: null, reason: 'no_fit' })
    expect(log.urls.length).toBeGreaterThan(0)
  })
  it('세 목록이 모두 실패하면 502', async () => {
    const bad = deps({ ...withItem('된장', '샘표 백일된장'), fetchJson: async () => { throw new TypeError('fetch failed') } })
    expect(await (await handle(post({ itemId: ITEM, action: 'ingredients_auto' }), bad.d)).json()).toEqual({ status: 'error', reason: 'network_error' })
  })
})

describe('food-info: 원재료 고르기(ingredients_choose, D-020)', () => {
  it('C002는 보고번호로 한 건을 다시 받아 고른 사람 것으로 저장한다', async () => {
    const { d, log } = deps(withItem('냉면', null))
    const res = await handle(post({ itemId: ITEM, action: 'ingredients_choose', source: 'C002', reportNo: '1997040105528' }), d)
    expect(res.status).toBe(200)
    const body = await res.json()
    // 고른 보고번호로 식품영양성분DB도 부른다(D-026)
    expect(log.urls).toEqual([
      'https://openapi.foodsafetykorea.go.kr/api/FOODKEY/C002/json/1/5/PRDLST_REPORT_NO=1997040105528',
      'https://apis.data.go.kr/1471000/FoodNtrCpntDbInfo03/getFoodNtrCpntDbInq03?serviceKey=DATAKEY&type=json&pageNo=1&numOfRows=5&ITEM_REPORT_NO=1997040105528',
    ])
    expect(body.ingredients).toMatchObject({ origin: 'C002', reportNo: '1997040105528', name: '가시오가피 냉면', maker: '주식회사 금성에프앤비', kind: '숙면', changedOn: '2023-06-10' })
    expect(log.saved).toEqual([{ itemId: ITEM, auto: false, ...body.ingredients }])
  })
  it('축산물(I1310)은 C006에서 원재료를, I1310에서 소비기한을 받아 origin C006으로 저장한다', async () => {
    const { d, log } = deps({
      ...withItem('닭꼬치', null),
      fetchJson: async (url) => {
        log.urls.push(url)
        const svc = svcOf(url)!
        if (svc === 'C006') return read('C006-byno.json')
        if (svc === 'I1310') return { I1310: { RESULT: { CODE: 'INFO-000' }, row: [{ PRDLST_REPORT_NO: '199900307705', PRDLST_NM: '닭꼬치', BSSH_NM: '노벨유통', PRDLST_DCNM: '포장육', POG_DAYCNT: '제조일로부터 7일' }] } }
        return NONE(svc)
      },
    })
    const body = await (await handle(post({ itemId: ITEM, action: 'ingredients_choose', source: 'I1310', reportNo: '199900307705' }), d)).json()
    expect(body.ingredients).toMatchObject({ origin: 'C006', rawMaterials: '닭고기', shelfLife: '제조일로부터 7일', kind: '포장육' })
    expect(log.urls.map(svcOf).filter(Boolean).sort()).toEqual(['C006', 'I1310'])
  })
  it('보고번호가 없으면 404, 저장 실패는 502, 목록 오류는 502', async () => {
    const none = deps({ ...withItem('냉면', null), fetchJson: async () => NONE('C002') })
    expect((await handle(post({ itemId: ITEM, action: 'ingredients_choose', source: 'C002', reportNo: '9' }), none.d)).status).toBe(404)
    const bad = deps({ ...withItem('냉면', null), saveIngredients: async () => { throw new Error('db') } })
    expect(await (await handle(post({ itemId: ITEM, action: 'ingredients_choose', source: 'C002', reportNo: '1997040105528' }), bad.d)).json()).toEqual({ status: 'error', reason: 'save_failed' })
    const err = deps({ ...withItem('냉면', null), fetchJson: async () => ({ C002: { RESULT: { CODE: 'INFO-110', MSG: 'x' } } }) })
    expect(await (await handle(post({ itemId: ITEM, action: 'ingredients_choose', source: 'C002', reportNo: '1' }), err.d)).json()).toEqual({ status: 'error', reason: 'INFO-110' })
  })
})

describe('food-info: 영양성분 이름 검색·고르기(P9, D-018)', () => {
  const ITEM = '33333333-3333-4333-8333-333333333333'
  const nd = (over: Partial<FoodInfoDeps> = {}) => {
    const saved: unknown[] = []
    const { d, log } = deps({ saveNutrition: async (itemId, row, auto) => { saved.push({ itemId, foodCd: row.foodCd, foodName: row.foodName, auto }) }, ...over })
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
    expect(saved).toEqual([{ itemId: ITEM, foodCd: 'P000000001', foodName: '왕교자', auto: false }])
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

describe('food-info: 영양성분 자동 맞춤(nutrition_auto, 사용자 2026-10-20: 버튼 없이 탭을 열면 나오게)', () => {
  const ITEM = '33333333-3333-4333-8333-333333333333'
  it('품목 이름으로 찾아 가장 잘 맞는 식품을 auto로 저장하고 돌려준다. 후보가 없으면 저장하지 않고 null', async () => {
    const saved: unknown[] = []
    const { d } = deps({ allowedItem: async () => ({ householdId: 'hh-1', name: '왕교자', spec: null, productName: null }), saveNutrition: async (itemId, row, auto) => { saved.push({ itemId, foodCd: row.foodCd, auto }) } })
    const res = await handle(post({ itemId: ITEM, action: 'nutrition_auto' }), d)
    expect(res.status).toBe(200)
    expect((await res.json()).nutrition).toMatchObject({ foodCd: 'P000000001', foodName: '왕교자' })
    expect(saved).toEqual([{ itemId: ITEM, foodCd: 'P000000001', auto: true }])
    const none = deps({ fetchJson: async () => ({ header: { resultCode: '00' }, body: { totalCount: 0, items: [] } }), saveNutrition: async () => { throw new Error('must not save') } })
    const r2 = await handle(post({ itemId: ITEM, action: 'nutrition_auto' }), none.d)
    expect(r2.status).toBe(200)
    expect((await r2.json()).nutrition).toBeNull()
  })
  it('이름 검색 결과도 순서를 매겨 돌려준다(이름이 같은 것이 먼저)', async () => {
    const two = {
      header: { resultCode: '00' },
      body: { items: [
        { FOOD_CD: 'A', FOOD_NM_KR: '대파김치', AMT_NUM1: '40' },
        { FOOD_CD: 'B', FOOD_NM_KR: '대파', AMT_NUM1: '30' },
      ] },
    }
    const { d } = deps({ fetchJson: async () => two })
    const body = await (await handle(post({ itemId: ITEM, action: 'nutrition_search' }), d)).json()
    expect(body.candidates.map((c: { foodCd: string }) => c.foodCd)).toEqual(['B', 'A'])
  })
})

describe('food-info: 자동 맞춤은 품목대표부터, 이름이 단어로만 든 상용제품은 자동으로 쓰지 않는다(사용자 2026-10-20 12:03: "우유"에 도넛이 맞춰짐, D-018 보충 2)', () => {
  const ITEM = '33333333-3333-4333-8333-333333333333'
  const row = (cd: string, name: string, cls: string) => ({ FOOD_CD: cd, FOOD_NM_KR: name, DB_CLASS_NM: cls, AMT_NUM1: '60' })
  const api = (rep: Record<string, unknown>[], all: Record<string, unknown>[], urls: string[] = []) => async (url: string) => {
    urls.push(url)
    return { header: { resultCode: '00' }, body: { items: url.includes('DB_CLASS_NM=') ? rep : all } }
  }
  const milk = { allowedItem: async () => ({ householdId: 'hh-1', name: '우유', spec: '900ml', productName: null }) }
  const donut = row('D202', '도넛_제주말차 우유 도넛', '상용제품')
  it('품목대표 "우유_일반"이 있으면 그것을 저장한다(상용제품 도넛보다 먼저)', async () => {
    const saved: unknown[] = []
    const urls: string[] = []
    const { d } = deps({ ...milk, fetchJson: api([row('G1', '우유_일반', '품목대표')], [donut], urls), saveNutrition: async (_i, r, auto) => { saved.push({ foodCd: r.foodCd, auto }) } })
    const body = await (await handle(post({ itemId: ITEM, action: 'nutrition_auto' }), d)).json()
    expect(body.nutrition).toMatchObject({ foodCd: 'G1', foodName: '우유_일반', dbClass: '품목대표' })
    expect(saved).toEqual([{ foodCd: 'G1', auto: true }])
    expect(urls.filter((u) => u.includes('DB_CLASS_NM=%ED%92%88%EB%AA%A9%EB%8C%80%ED%91%9C'))).toHaveLength(1)
    expect(urls).toHaveLength(2)
  })
  it('품목대표가 없고 상용제품은 "우유"가 단어로만 들어 있으면(도넛) 저장하지 않고 null', async () => {
    const { d } = deps({ ...milk, fetchJson: api([], [donut]), saveNutrition: async () => { throw new Error('must not save') } })
    const body = await (await handle(post({ itemId: ITEM, action: 'nutrition_auto' }), d)).json()
    expect(body).toEqual({ status: 'done', term: '우유', nutrition: null })
  })
  it('품목대표가 없어도 상용제품 이름이 같거나 이름으로 시작하면 저장한다', async () => {
    const saved: (string | null)[] = []
    const { d } = deps({ ...milk, fetchJson: api([], [donut, row('S1', '우유(멸균)', '상용제품')]), saveNutrition: async (_i, r) => { saved.push(r.foodCd) } })
    expect((await (await handle(post({ itemId: ITEM, action: 'nutrition_auto' }), d)).json()).nutrition.foodCd).toBe('S1')
    expect(saved).toEqual(['S1'])
  })
  it('품목대표 호출이 실패해도 전체 검색으로 이어 간다', async () => {
    const { d } = deps({
      ...milk,
      fetchJson: async (url) => {
        if (url.includes('DB_CLASS_NM=')) throw new TypeError('fetch failed')
        return { header: { resultCode: '00' }, body: { items: [row('S0', '우유', '상용제품')] } }
      },
    })
    expect((await (await handle(post({ itemId: ITEM, action: 'nutrition_auto' }), d)).json()).nutrition.foodCd).toBe('S0')
  })
  it('이름 검색·고르기도 품목대표와 전체를 합쳐(식품코드로 중복 제거) 순서를 매긴다', async () => {
    const { d } = deps({ ...milk, fetchJson: api([row('G1', '우유_일반', '품목대표')], [donut, row('G1', '우유_일반', '품목대표')]) })
    const body = await (await handle(post({ itemId: ITEM, action: 'nutrition_search' }), d)).json()
    expect(body.candidates.map((c: { foodCd: string }) => c.foodCd)).toEqual(['G1', 'D202'])
    const saved: (string | null)[] = []
    const c = deps({ ...milk, fetchJson: api([row('G1', '우유_일반', '품목대표')], [donut]), saveNutrition: async (_i, r) => { saved.push(r.foodCd) } })
    expect((await handle(post({ itemId: ITEM, action: 'nutrition_choose', query: '우유', foodCd: 'G1' }), c.d)).status).toBe(200)
    expect(saved).toEqual(['G1'])
  })
})

describe('food-info: 상품을 고른 품목은 상품명으로 먼저 찾는다(사용자 2026-10-20 12:39: 된장에 취나물_된장이 맞춰짐, D-018 보충 3)', () => {
  const ITEM = '33333333-3333-4333-8333-333333333333'
  const row = (cd: string, name: string, cls: string, maker: string | null = null, grp: string | null = null) => ({ FOOD_CD: cd, FOOD_NM_KR: name, DB_CLASS_NM: cls, MAKER_NM: maker, DB_GRP_NM: grp, AMT_NUM1: '60' })
  const dish = row('D113-595050000-0001', '취나물_된장', '품목대표', null, '음식')
  const generic = row('P112-003000900-F001-001', '된장', '품목대표', null, '가공식품')
  const jang = [row('P112-009000900-0038', '백일된장', '상용제품', '샘표식품(주)영동공장', '가공식품'), row('P112-009000900-0017', '국산콩백일된장', '상용제품', '샘표식품주식회사', '가공식품')]
  const q = (u: string) => decodeURIComponent(u.split('FOOD_NM_KR=')[1]?.split('&')[0] ?? '')
  /** 검색어별 응답. 품목대표 호출은 'rep:' 접두어로 따로 둔다 */
  const api = (table: Record<string, Record<string, unknown>[]>, urls: string[] = []) => async (url: string) => {
    urls.push(url)
    const key = (url.includes('DB_CLASS_NM=') ? 'rep:' : '') + q(url)
    return { header: { resultCode: '00' }, body: { items: table[key] ?? [] } }
  }
  const jangItem = { allowedItem: async () => ({ householdId: 'hh-1', name: '된장', spec: null, productName: '샘표 국산콩 100% 백일된장 900g' }) }
  it('상품명 말을 구체적인 것부터 찾아, 상품 단어가 가장 많이 맞는 식품을 "상품명으로" 저장한다', async () => {
    const saved: unknown[] = []
    const urls: string[] = []
    const { d } = deps({ ...jangItem, fetchJson: api({ '백일된장': jang, '된장': [dish], 'rep:된장': [dish] }, urls), saveNutrition: async (_i, r, auto, by) => { saved.push({ foodCd: r.foodCd, auto, by }) } })
    const body = await (await handle(post({ itemId: ITEM, action: 'nutrition_auto' }), d)).json()
    expect(body.nutrition).toMatchObject({ foodCd: 'P112-009000900-0017', foodName: '국산콩백일된장' })
    expect(body.matchedBy).toBe('product')
    expect(saved).toEqual([{ foodCd: 'P112-009000900-0017', auto: true, by: 'product' }])
    expect(urls.map(q).slice(0, 2)).toEqual(['국산콩 백일된장', '백일된장'])
  })
  it('상품명으로 못 찾으면 품목 이름 흐름으로 간다. 음식(취나물_된장)은 쓰지 않고 가공식품 일반 "된장"을 쓴다', async () => {
    const saved: unknown[] = []
    const { d } = deps({ ...jangItem, fetchJson: api({ '된장': [dish], 'rep:된장': [dish, generic] }), saveNutrition: async (_i, r, _a, by) => { saved.push({ foodCd: r.foodCd, by }) } })
    const body = await (await handle(post({ itemId: ITEM, action: 'nutrition_auto' }), d)).json()
    expect(body.nutrition).toMatchObject({ foodCd: 'P112-003000900-F001-001', foodName: '된장' })
    expect(body.matchedBy).toBe('name')
    expect(saved).toEqual([{ foodCd: 'P112-003000900-F001-001', by: 'name' }])
  })
  it('음식 일반 품목(취나물_된장)만 있으면 자동으로 저장하지 않고 null. 품목대표 호출은 300건을 청한다', async () => {
    const urls: string[] = []
    const { d } = deps({ ...jangItem, fetchJson: api({ '된장': [dish], 'rep:된장': [dish] }, urls), saveNutrition: async () => { throw new Error('must not save') } })
    const body = await (await handle(post({ itemId: ITEM, action: 'nutrition_auto' }), d)).json()
    expect(body.nutrition).toBeNull()
    expect(urls.find((u) => u.includes('DB_CLASS_NM='))).toContain('numOfRows=300')
  })
  it('이름 검색(검색어 없음)은 상품명 후보를 앞에 두고 합친다. 검색어를 주면 상품명은 쓰지 않는다. 고르기는 상품명 후보도 찾는다', async () => {
    const { d } = deps({ ...jangItem, fetchJson: api({ '백일된장': jang, '된장': [dish], 'rep:된장': [dish, generic] }) })
    const body = await (await handle(post({ itemId: ITEM, action: 'nutrition_search' }), d)).json()
    expect(body.candidates.map((c: { foodCd: string }) => c.foodCd)).toEqual(['P112-009000900-0017', 'P112-009000900-0038', 'P112-003000900-F001-001', 'D113-595050000-0001'])
    const urls: string[] = []
    const typed = deps({ ...jangItem, fetchJson: api({ '쌈장': [row('P1', '쌈장', '상용제품')] }, urls) })
    const b2 = await (await handle(post({ itemId: ITEM, action: 'nutrition_search', query: '쌈장' }), typed.d)).json()
    expect(b2.candidates.map((c: { foodCd: string }) => c.foodCd)).toEqual(['P1'])
    expect(urls.map(q)).toEqual(['쌈장', '쌈장'])
    const saved: (string | null)[] = []
    const c = deps({ ...jangItem, fetchJson: api({ '백일된장': jang, '된장': [dish], 'rep:된장': [dish] }), saveNutrition: async (_i, r) => { saved.push(r.foodCd) } })
    expect((await handle(post({ itemId: ITEM, action: 'nutrition_choose', query: '', foodCd: 'P112-009000900-0038' }), c.d)).status).toBe(200)
    expect(saved).toEqual(['P112-009000900-0038'])
  })
})
