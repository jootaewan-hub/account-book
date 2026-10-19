// 성분(P7): 고른 상품의 식약처 품목(C002) 후보 찾기(search)와, 사람이 고른 품목의 원재료·영양성분 저장(choose).
// 후보는 사람이 고른다(상품명과 식약처 품목명이 같다는 보장이 없다). 숫자는 출처 값 그대로 저장한다.
// 식약처 키(FOODSAFETY_API_KEY)와 공공데이터포털 키(DATA_GO_KR_SERVICE_KEY)는 서버에만 있다. 오류 문구에는 코드만 남긴다.
import { c002ByReportUrl, c002Terms, c002Url, FoodInfoError, nutritionUrl, parseC002, parseNutrition, rankC002, type C002Row, type Nutrition } from '../_shared/foodInfo.ts'

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
  /** 사용자 권한: 내 가구 품목 중 이 상품을 고른 것이 있는가 */
  allowed(productId: string): Promise<boolean>
  productName(productId: string): Promise<string | null>
  /** 주소를 불러 JSON을 돌려준다(읽지 못하면 아무 객체). 네트워크 오류는 던진다 */
  fetchJson(url: string): Promise<unknown>
  save(productId: string, info: ProductInfo): Promise<void>
  now(): Date
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_TERMS = 2
const MAX_CANDIDATES = 20

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })
const reason = (e: unknown) => (e instanceof FoodInfoError ? e.code : 'network_error')

export async function handle(req: Request, deps: FoodInfoDeps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  let body: { productId?: unknown; action?: unknown; reportNo?: unknown }
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'bad_request' })
  }
  const productId = typeof body?.productId === 'string' ? body.productId : ''
  const action = body?.action
  const reportNo = typeof body?.reportNo === 'string' ? body.reportNo.trim() : ''
  if (!UUID.test(productId) || (action !== 'search' && action !== 'choose')) return json(400, { error: 'bad_request' })
  if (action === 'choose' && !/^[0-9A-Za-z-]{1,30}$/.test(reportNo)) return json(400, { error: 'bad_request' })
  const foodKey = deps.foodKey?.trim()
  if (!foodKey) return json(500, { error: 'missing_api_key' })
  if (!(await deps.allowed(productId))) return json(403, { error: 'forbidden' })
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
    await deps.save(productId, info)
  } catch {
    return json(502, { status: 'error', reason: 'save_failed' })
  }
  return json(200, { status: 'done', info })
}
