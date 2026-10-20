// 성분(P7): 고른 상품의 식약처 품목(C002) 후보 찾기(search)와, 사람이 고른 품목의 원재료·영양성분 저장(choose).
// 후보는 사람이 고른다(상품명과 식약처 품목명이 같다는 보장이 없다). 고른 것은 부른 사람의 가구에만 저장한다(다른 가구 화면을 바꾸지 못하게). 숫자는 출처 값 그대로.
// 식약처 키(FOODSAFETY_API_KEY)와 공공데이터포털 키(DATA_GO_KR_SERVICE_KEY)는 서버에만 있다. 오류 문구에는 코드만 남긴다.
import {
  c002ByReportUrl, c002Terms, c002Url, FoodInfoError, nutritionSearchUrl, nutritionUrl, parseC002, parseNutrition, parseNutritionRows, rankC002, rankNutrition,
  type C002Row, type Nutrition, type NutritionRow,
} from '../_shared/foodInfo.ts'

export type ProductInfo = {
  reportNo: string
  name: string
  maker: string | null
  kind: string | null
  rawMaterials: string | null
  changedOn: string | null
  nutrition: Nutrition | null
  nutritionError: string | null
}

export type FoodInfoDeps = {
  foodKey: string | undefined
  dataKey: string | undefined
  /** 사용자 권한(RLS): 내 가구 품목 중 이 상품을 고른 것이 있으면 그 가구 id, 아니면 null */
  allowed(productId: string): Promise<string | null>
  productName(productId: string): Promise<string | null>
  /** 주소를 불러 JSON을 돌려준다(읽지 못하면 아무 객체). 네트워크 오류는 던진다 */
  fetchJson(url: string): Promise<unknown>
  /** 부른 사람의 가구에만 저장한다(가구, 상품마다 하나) */
  save(householdId: string, productId: string, info: ProductInfo): Promise<void>
  /** 사용자 권한(RLS): 내 가구 품목이면 가구 id·이름·규격, 아니면 null(P9) */
  allowedItem(itemId: string): Promise<{ householdId: string; name: string; spec: string | null } | null>
  /** 품목(이름·규격 열쇠)에 고른 식품을 저장(grocery.set_item_nutrition, 서비스 롤). auto면 이름으로 자동 맞춘 것(고른 사람 없음) */
  saveNutrition(itemId: string, row: NutritionRow, auto: boolean): Promise<void>
  now(): Date
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_TERMS = 2
const MAX_CANDIDATES = 20
const MAX_QUERY = 60
const ACTIONS = new Set(['search', 'choose', 'nutrition_search', 'nutrition_choose', 'nutrition_auto'])

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })
const reason = (e: unknown) => (e instanceof FoodInfoError ? e.code : 'network_error')

export async function handle(req: Request, deps: FoodInfoDeps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  let body: { productId?: unknown; itemId?: unknown; action?: unknown; reportNo?: unknown; query?: unknown; foodCd?: unknown }
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'bad_request' })
  }
  const action = typeof body?.action === 'string' ? body.action : ''
  if (!ACTIONS.has(action)) return json(400, { error: 'bad_request' })
  if (action === 'nutrition_search' || action === 'nutrition_choose' || action === 'nutrition_auto') return nutritionByName(body, action, deps)

  const productId = typeof body?.productId === 'string' ? body.productId : ''
  const reportNo = typeof body?.reportNo === 'string' ? body.reportNo.trim() : ''
  if (!UUID.test(productId)) return json(400, { error: 'bad_request' })
  if (action === 'choose' && !/^[0-9A-Za-z-]{1,30}$/.test(reportNo)) return json(400, { error: 'bad_request' })
  const foodKey = deps.foodKey?.trim()
  if (!foodKey) return json(500, { error: 'missing_api_key' })
  const householdId = await deps.allowed(productId)
  if (!householdId) return json(403, { error: 'forbidden' })
  const name = await deps.productName(productId)
  if (!name) return json(404, { error: 'not_found' })

  if (action === 'search') {
    const terms = c002Terms(name)
    try {
      for (const term of terms.slice(0, MAX_TERMS)) {
        const { rows } = parseC002(await deps.fetchJson(c002Url(foodKey, term)))
        if (rows.length > 0) return json(200, { status: 'done', term, candidates: rankC002(rows, terms).slice(0, MAX_CANDIDATES) })
      }
    } catch (e) {
      return json(502, { status: 'error', reason: reason(e) })
    }
    return json(200, { status: 'done', term: terms[0] ?? null, candidates: [] })
  }

  let row: C002Row | undefined
  try {
    const { rows } = parseC002(await deps.fetchJson(c002ByReportUrl(foodKey, reportNo)))
    row = rows.find((r) => r.reportNo === reportNo) ?? rows[0]
  } catch (e) {
    return json(502, { status: 'error', reason: reason(e) })
  }
  if (!row) return json(404, { error: 'not_found' })

  let nutrition: Nutrition | null = null
  let nutritionError: string | null = null
  const dataKey = deps.dataKey?.trim()
  if (!dataKey) nutritionError = 'missing_api_key'
  else {
    try {
      nutrition = parseNutrition(await deps.fetchJson(nutritionUrl(dataKey, reportNo)))
      if (!nutrition) nutritionError = 'not_found'
    } catch (e) {
      nutritionError = reason(e)
    }
  }
  const info: ProductInfo = {
    reportNo: row.reportNo, name: row.name, maker: row.maker, kind: row.kind, rawMaterials: row.rawMaterials, changedOn: row.changedOn, nutrition, nutritionError,
  }
  try {
    await deps.save(householdId, productId, info)
  } catch {
    return json(502, { status: 'error', reason: 'save_failed' })
  }
  return json(200, { status: 'done', info })
}

/** P9(D-018): 품목 이름(또는 준 검색어)으로 식품영양성분DB를 찾고(nutrition_search), 사람이 고른 식품코드를 같은 검색에서 다시 찾아 저장한다(nutrition_choose).
 *  nutrition_auto는 성분 탭을 열 때 버튼 없이 가장 잘 맞는 식품(rankNutrition 맨 앞)을 자동으로 저장해 돌려준다(사용자 2026-10-20). 후보가 없으면 null.
 *  신선 품목처럼 상품이 없어도 된다. 숫자는 응답 값 그대로 저장한다(화면이 그대로 보여 준다). */
async function nutritionByName(body: { itemId?: unknown; query?: unknown; foodCd?: unknown }, action: string, deps: FoodInfoDeps): Promise<Response> {
  const itemId = typeof body?.itemId === 'string' ? body.itemId : ''
  const query = typeof body?.query === 'string' ? body.query.replace(/\s+/g, ' ').trim() : ''
  const foodCd = typeof body?.foodCd === 'string' ? body.foodCd.trim() : ''
  if (!UUID.test(itemId) || query.length > MAX_QUERY) return json(400, { error: 'bad_request' })
  if (action === 'nutrition_choose' && !/^[A-Za-z0-9_-]{1,30}$/.test(foodCd)) return json(400, { error: 'bad_request' })
  const dataKey = deps.dataKey?.trim()
  if (!dataKey) return json(500, { error: 'missing_api_key' })
  const item = await deps.allowedItem(itemId)
  if (!item) return json(403, { error: 'forbidden' })
  const term = query || item.name.replace(/\s+/g, ' ').trim()
  if (!term) return json(200, { status: 'done', term: null, candidates: [] })
  let rows: NutritionRow[]
  try {
    rows = parseNutritionRows(await deps.fetchJson(nutritionSearchUrl(dataKey, term)))
  } catch (e) {
    return json(502, { status: 'error', reason: reason(e) })
  }
  const ranked = rankNutrition(rows, term)
  if (action === 'nutrition_search') return json(200, { status: 'done', term, candidates: ranked.slice(0, MAX_CANDIDATES) })
  const auto = action === 'nutrition_auto'
  const row = auto ? ranked.find((r) => r.foodCd !== null) : ranked.find((r) => r.foodCd === foodCd)
  if (!row) return auto ? json(200, { status: 'done', term, nutrition: null }) : json(404, { error: 'not_found' })
  try {
    await deps.saveNutrition(itemId, row, auto)
  } catch {
    return json(502, { status: 'error', reason: 'save_failed' })
  }
  return json(200, { status: 'done', term, nutrition: row })
}
