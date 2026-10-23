// 상품을 고른 품목의 성분 자동 맞춤(food-info product_auto, D-026): 다나와 제조사로 찾고, 원재료와 같은 보고번호의 영양성분을 함께 저장하고, 옛 자동 줄은 지운다.
import { describe, expect, it } from 'vitest'
import { handle, type FoodInfoDeps, type MatchedBy } from '../../supabase/functions/food-info/handle'
import type { NutritionRow } from '../../supabase/functions/_shared/foodInfo'
import type { ProductFacts } from '../../supabase/functions/_shared/productMatch'

const ITEM = '33333333-3333-4333-8333-333333333333'
const post = (body: unknown) => new Request('https://x/functions/v1/food-info', { method: 'POST', body: JSON.stringify(body) })
const svcOf = (url: string) => url.match(/\/(C002|I1310|C006|C003)\/json\//)?.[1] ?? null
const NONE = (svc: string) => ({ [svc]: { RESULT: { CODE: 'INFO-200', MSG: '해당하는 데이터가 없습니다.' } } })
const ROWS = (svc: string, row: Record<string, string>[]) => ({ [svc]: { RESULT: { CODE: 'INFO-000' }, total_count: String(row.length), row } })
const param = (url: string, k: string) => {
  const m = url.match(new RegExp(`[/&]${k}=([^&]*)`))
  return m ? decodeURIComponent(m[1]) : null
}
const NUTRI = (items: Record<string, unknown>[]) => ({ header: { resultCode: '00' }, body: { items } })

const GOCHUJANG: ProductFacts = { maker: '대상', brand: '청정원 순창', origin: '고추양념(중국산), 현미(외국산)', materials: '현미 20.2%, 태양초 11.3%' }
// 2026-10-23 sample 실제 응답의 대상(주) 고추장 줄(원재료는 앞부분만)
const DAESANG = [
  { PRDLST_REPORT_NO: '1985049901172', PRDLST_NM: '청정원 순창 태양초 찰고추장', BSSH_NM: '대상(주)', PRDLST_DCNM: '고추장', RAWMTRL_NM: '찹쌀, 고춧가루, 밀가루, 혼합양념', CHNG_DT: '20240117' },
  { PRDLST_REPORT_NO: '19850499011151', PRDLST_NM: '청정원순창태양초찰고추장', BSSH_NM: '대상(주)', PRDLST_DCNM: '고추장', RAWMTRL_NM: '고추양념, 물엿, 현미, 정제수, 천일염', CHNG_DT: '20240117' },
  { PRDLST_REPORT_NO: '19850499011186', PRDLST_NM: '우리쌀로만든태양초찰골드고추장S', BSSH_NM: '대상(주)', PRDLST_DCNM: '고추장', RAWMTRL_NM: '쌀, 고춧가루', CHNG_DT: '20230101' },
]

type Log = { urls: string[]; ing: unknown[]; nut: { foodCd: string | null; auto: boolean; by: MatchedBy }[]; cleared: number[]; facts: string[] }
function deps(over: Partial<FoodInfoDeps>, fetchJson: (url: string) => unknown) {
  const log: Log = { urls: [], ing: [], nut: [], cleared: [], facts: [] }
  const d: FoodInfoDeps = {
    foodKey: 'FOODKEY',
    dataKey: 'DATAKEY',
    fetchJson: async (url) => {
      log.urls.push(url)
      return fetchJson(url)
    },
    allowedItem: async () => ({ householdId: 'hh-1', name: '고추장', spec: null, productName: '청정원 순창 100% 현미 태양초 찰고추장 2kg', product: { id: 'p1', sourceId: '4497661', facts: GOCHUJANG } }),
    loadFacts: async (p) => {
      log.facts.push(p.sourceId)
      return GOCHUJANG
    },
    clearAuto: async (_i, v) => {
      log.cleared.push(v)
    },
    saveNutrition: async (_i, r: NutritionRow, auto, by) => {
      log.nut.push({ foodCd: r.foodCd, auto, by })
    },
    saveIngredients: async (_i, info, auto) => {
      log.ing.push({ reportNo: info.reportNo, auto })
    },
    now: () => new Date('2026-10-23T03:00:00Z'),
    ...over,
  }
  return { d, log }
}
/** 업체명 대상 + 낱말이면 대상 고추장 줄 중 이름에 낱말이 든 것, 영양성분은 보고번호 19850499011151만 있다 */
const daesangApi = (url: string) => {
  const svc = svcOf(url)
  if (url.includes('FoodNtrCpntDbInfo03')) {
    return param(url, 'ITEM_REPORT_NO') === '19850499011151'
      ? NUTRI([{ FOOD_CD: 'P1', FOOD_NM_KR: '청정원순창태양초찰고추장', MAKER_NM: '대상(주)', ITEM_REPORT_NO: '19850499011151', DB_CLASS_NM: '상용제품', AMT_NUM1: '210' }])
      : NUTRI([])
  }
  if (svc === 'C002' && param(url, 'BSSH_NM') === '대상') {
    const w = param(url, 'PRDLST_NM') ?? ''
    return ROWS('C002', DAESANG.filter((r) => r.PRDLST_NM.includes(w)))
  }
  return NONE(svc ?? 'C002')
}

describe('product_auto', () => {
  it('다나와 제조사(대상)를 업체명으로 상품 낱말마다 세 목록을 한 번에 찾고, 원산지 단서가 든 19850499011151을 저장한다. 영양성분은 같은 보고번호로', async () => {
    const { d, log } = deps({}, daesangApi)
    const res = await handle(post({ itemId: ITEM, action: 'product_auto' }), d)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ status: 'done', reason: null, candidates: [], maker: '대상', origin: '고추양념(중국산), 현미(외국산)', matchedBy: 'report', words: ['찰고추장', '태양초', '현미'] })
    expect(body.ingredients).toMatchObject({ origin: 'C002', reportNo: '19850499011151', name: '청정원순창태양초찰고추장' })
    expect(body.nutrition).toMatchObject({ foodCd: 'P1', reportNo: '19850499011151' })
    const food = log.urls.filter((u) => svcOf(u))
    expect(food).toHaveLength(9) // 낱말 3 × 목록 3, 한 단계
    expect(food.every((u) => param(u, 'BSSH_NM') === '대상')).toBe(true)
    expect(log.ing).toEqual([{ reportNo: '19850499011151', auto: true }])
    expect(log.nut).toEqual([{ foodCd: 'P1', auto: true, by: 'report' }])
    expect(log.cleared).toEqual([2])
    expect(log.facts).toEqual([]) // 읽어 둔 다나와 정보가 있으면 페이지를 다시 읽지 않는다
  })

  it('다나와 정보를 아직 안 읽었으면 상품 페이지를 한 번 읽어 쓴다. 못 읽으면 상품명 첫 낱말(청정원)을 업체로 쓴다', async () => {
    const noFacts = { allowedItem: async () => ({ householdId: 'hh-1', name: '고추장', spec: null, productName: '청정원 순창 100% 현미 태양초 찰고추장 2kg', product: { id: 'p1', sourceId: '4497661', facts: null } }) }
    const a = deps(noFacts, daesangApi)
    expect((await (await handle(post({ itemId: ITEM, action: 'product_auto' }), a.d)).json()).ingredients).toMatchObject({ reportNo: '19850499011151' })
    expect(a.log.facts).toEqual(['4497661'])
    const b = deps({ ...noFacts, loadFacts: async () => { throw new Error('http_503') } }, daesangApi)
    const body = await (await handle(post({ itemId: ITEM, action: 'product_auto' }), b.d)).json()
    expect(body.ingredients).toBeNull()
    expect(b.log.urls.filter((u) => svcOf(u)).some((u) => param(u, 'BSSH_NM') === '청정원')).toBe(true)
    expect(b.log.ing).toEqual([])
  })

  it('업체+낱말로 세 목록 모두 0건이면 maker_missing(수입품일 수 있다), 원재료는 저장하지 않고 옛 자동 줄은 지운다. 영양은 품목대표만(상용제품 이름 맞춤은 안 한다)', async () => {
    const { d, log } = deps(
      { allowedItem: async () => ({ householdId: 'hh-1', name: '굴소스', spec: null, productName: '이금기 프리미엄 굴소스 510g', product: { id: 'p2', sourceId: '246993', facts: { maker: '이금기', brand: null, origin: '홍콩산', materials: '굴추출물농축액 95%' } } }) },
      (url) => {
        if (url.includes('FoodNtrCpntDbInfo03')) {
          if (url.includes('DB_CLASS_NM=')) return NUTRI([{ FOOD_CD: 'R1', FOOD_NM_KR: '굴소스', DB_CLASS_NM: '품목대표', DB_GRP_NM: '가공식품', AMT_NUM1: '100' }])
          return NUTRI([{ FOOD_CD: 'P9', FOOD_NM_KR: '프리미엄 굴소스', MAKER_NM: '다른식품(주)', DB_CLASS_NM: '상용제품', AMT_NUM1: '120' }])
        }
        return NONE(svcOf(url) ?? 'C002')
      },
    )
    const body = await (await handle(post({ itemId: ITEM, action: 'product_auto' }), d)).json()
    expect(body).toMatchObject({ ingredients: null, reason: 'maker_missing', candidates: [], maker: '이금기', origin: '홍콩산', words: ['굴소스', '프리미엄'], matchedBy: 'name' })
    expect(body.nutrition).toMatchObject({ foodCd: 'R1' })
    expect(log.urls.filter((u) => svcOf(u)).map((u) => param(u, 'BSSH_NM'))).toEqual([...Array(6).fill('이금기'), ...Array(6).fill('이금')])
    expect(log.ing).toEqual([])
    expect(log.nut).toEqual([{ foodCd: 'R1', auto: true, by: 'name' }])
    expect(log.cleared).toEqual([2])
  })

  it('후보는 있지만 같은 상품이라고 볼 만큼 맞지 않으면 unsure와 앞 3개 후보(업체가 맞는 것부터). 상품명이 단어로만 든 상용제품("미림 구운계란")은 영양에 붙이지 않는다', async () => {
    const { d, log } = deps(
      { allowedItem: async () => ({ householdId: 'hh-1', name: '미림', spec: null, productName: '롯데푸드 맛술 미림 500ml', product: { id: 'p3', sourceId: '32671475', facts: { maker: '롯데푸드', brand: null, origin: null, materials: null } } }) },
      (url) => {
        if (url.includes('FoodNtrCpntDbInfo03')) return url.includes('DB_CLASS_NM=') ? NUTRI([]) : NUTRI([{ FOOD_CD: 'P7', FOOD_NM_KR: '미림 구운계란', MAKER_NM: '미림유통', DB_CLASS_NM: '상용제품', AMT_NUM1: '150' }])
        if (svcOf(url) === 'C002' && param(url, 'BSSH_NM') === '롯데' && param(url, 'PRDLST_NM') === '미림') {
          return ROWS('C002', [
            { PRDLST_REPORT_NO: 'm1', PRDLST_NM: '미림 양념 소스 업소용 대용량', BSSH_NM: '롯데칠성음료(주)군산공장', PRDLST_DCNM: '소스' },
            { PRDLST_REPORT_NO: 'm2', PRDLST_NM: '미림', BSSH_NM: '미림유통', PRDLST_DCNM: '소스' }, // 업체명 부분 일치로 함께 와도 다른 업체
          ])
        }
        return NONE(svcOf(url) ?? 'C002')
      },
    )
    const body = await (await handle(post({ itemId: ITEM, action: 'product_auto' }), d)).json()
    expect(body).toMatchObject({ ingredients: null, nutrition: null, reason: 'unsure' })
    expect(body.candidates.map((c: { reportNo: string }) => c.reportNo)).toEqual(['m1', 'm2'])
    expect(log.ing).toEqual([])
    expect(log.nut).toEqual([])
    expect(log.cleared).toEqual([2])
  })

  it('업체+낱말 결과가 받은 줄(100)보다 많으면(total_count) 한 쪽 더 받는다: 이름 순이라 "청정원…"이 뒤에 온다', async () => {
    const filler = Array.from({ length: 100 }, (_, i) => ({ PRDLST_REPORT_NO: `f${i}`, PRDLST_NM: `가나다 찰고추장 ${i}`, BSSH_NM: '대상(주)', PRDLST_DCNM: '고추장' }))
    const { d, log } = deps({}, (url) => {
      if (url.includes('FoodNtrCpntDbInfo03')) return NUTRI([])
      if (svcOf(url) === 'C002' && param(url, 'BSSH_NM') === '대상' && param(url, 'PRDLST_NM') === '찰고추장') {
        const page = url.match(/\/json\/(\d+)\/(\d+)\//)!
        const all = [...filler, DAESANG[1]]
        return { C002: { RESULT: { CODE: 'INFO-000' }, total_count: String(all.length), row: all.slice(Number(page[1]) - 1, Math.min(Number(page[2]), 100 + Number(page[1]) - 1)) } }
      }
      return NONE(svcOf(url) ?? 'C002')
    })
    const body = await (await handle(post({ itemId: ITEM, action: 'product_auto' }), d)).json()
    expect(body.ingredients).toMatchObject({ reportNo: '19850499011151' })
    expect(log.urls.filter((u) => u.includes('/C002/json/101/101/'))).toHaveLength(1)
  })

  it('상품을 안 고른 품목은 no_product(부르지 않음), 세 목록이 모두 실패하면 502이고 옛 줄을 지우지 않는다', async () => {
    const none = deps({ allowedItem: async () => ({ householdId: 'hh-1', name: '대파', spec: null, productName: null, product: null }) }, () => ({}))
    expect(await (await handle(post({ itemId: ITEM, action: 'product_auto' }), none.d)).json()).toMatchObject({ status: 'done', reason: 'no_product', ingredients: null })
    expect(none.log.urls).toEqual([])
    const bad = deps({}, () => {
      throw new TypeError('fetch failed')
    })
    const res = await handle(post({ itemId: ITEM, action: 'product_auto' }), bad.d)
    expect(res.status).toBe(502)
    expect(bad.log.cleared).toEqual([])
    expect((await handle(post({ itemId: 'x', action: 'product_auto' }), bad.d)).status).toBe(400)
    expect((await handle(post({ itemId: ITEM, action: 'product_auto' }), deps({ allowedItem: async () => null }, () => ({})).d)).status).toBe(403)
  })
})
