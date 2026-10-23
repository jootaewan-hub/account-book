// 성분(P7·D-020): 식약처 품목제조보고 원재료 — 식품 C002, 축산물 I1310(이름으로 찾고 원재료는 C006에서 보고번호로), 건강기능식품 C003 — 를
// 고른 상품(다나와 제조사를 업체명으로 + 상품 낱말, D-026)·품목 이름(이름+식품유형)으로 찾아(ingredients_search) 후보를 주고, 상품을 고른 품목은 성분 탭을 열 때
// 원재료와 영양성분을 한 번에 자동으로 맞추고(product_auto: 같은 보고번호로 영양성분), 아니면 사람이 고른 것(ingredients_choose)을 품목(이름·규격 열쇠)에 저장한다.
// 영양성분(P9)은 식품영양성분DB. 글·숫자는 출처 값 그대로.
// 식약처 키(FOODSAFETY_API_KEY)와 공공데이터포털 키(DATA_GO_KR_SERVICE_KEY)는 서버에만 있다. 오류 문구에는 코드만 남긴다.
import {
  FoodInfoError, INGREDIENT_SOURCES, isDish, nutritionSearchUrl, nutritionTier, originOf, parseNutritionRows, parseReport, productPhrases,
  pruneUnrelated, queryWords, rankByProduct, rankIngredients, rankNutrition, REPRESENTATIVE, reportBrandUrl, reportByNoUrl, reportSearchUrl, reportTypeUrl,
  nutritionUrl, type IngredientOrigin, type IngredientRow, type IngredientSource, type NutritionRow,
} from '../_shared/foodInfo.ts'
import { MATCH_VERSION, matchPlan, rankMatches, shouldAutoSave, type MatchPlan, type MatchScore, type ProductFacts } from '../_shared/productMatch.ts'

/** 자동 맞춤이 무엇으로 맞췄나: 맞춘 원재료의 보고번호(report), 고른 상품의 이름(product), 품목 이름(name) */
export type MatchedBy = 'report' | 'product' | 'name'

/** product_auto가 자동으로 저장하지 못한 까닭: 업체+낱말로 세 목록 모두 0건(maker_missing, 다른 회사가 만들었거나 수입품일 수 있다),
 *  후보는 있지만 같은 상품이라고 볼 만큼 맞지 않음(unsure), 다나와 제조사도 모르고 아무 결과도 없음(no_rows) */
export type NoMatch = 'maker_missing' | 'unsure' | 'no_rows'

/** 저장하는 원재료 한 건(grocery.item_ingredients). 값은 식약처 응답 그대로 */
export type IngredientInfo = {
  /** 원재료를 받은 목록: C002 식품, C006 축산물, C003 건강기능식품 */
  origin: IngredientOrigin
  reportNo: string
  name: string
  maker: string | null
  kind: string | null
  rawMaterials: string | null
  changedOn: string | null
  shelfLife: string | null
  health: IngredientRow['health']
}

export type FoodInfoDeps = {
  foodKey: string | undefined
  dataKey: string | undefined
  /** 주소를 불러 JSON을 돌려준다(읽지 못하면 아무 객체). 네트워크 오류는 던진다 */
  fetchJson(url: string): Promise<unknown>
  /** 사용자 권한(RLS): 내 가구 품목이면 가구 id·이름·규격·고른 상품 이름(없으면 null)과 그 상품(다나와 pcode, 읽어 둔 다나와 정보: 아직 안 읽었으면 null), 아니면 null */
  allowedItem(itemId: string): Promise<{
    householdId: string; name: string; spec: string | null; productName: string | null
    product?: { id: string; sourceId: string; facts: ProductFacts | null } | null
  } | null>
  /** 다나와 상품 페이지를 읽어 제조사·상표·원산지·원재료명을 상품에 저장하고 돌려준다(D-026). 못 읽으면 던진다 */
  loadFacts(product: { id: string; sourceId: string }): Promise<ProductFacts>
  /** 이전 버전이 자동으로 맞춘 줄을 지운다(grocery.clear_item_auto, 서비스 롤). 사람이 고른 줄은 남는다 */
  clearAuto(itemId: string, version: number): Promise<void>
  /** 품목(이름·규격 열쇠)에 고른 식품을 저장(grocery.set_item_nutrition, 서비스 롤). auto면 자동 맞춘 것(고른 사람 없음), matchedBy는 무엇으로 맞췄나 */
  saveNutrition(itemId: string, row: NutritionRow, auto: boolean, matchedBy: MatchedBy): Promise<void>
  /** 품목(이름·규격 열쇠)에 원재료를 저장(grocery.set_item_ingredients, 서비스 롤). auto면 상품명으로 자동 맞춘 것(고른 사람 없음, 있는 사람이 고른 줄은 DB가 덮지 않는다) */
  saveIngredients(itemId: string, info: IngredientInfo, auto: boolean): Promise<void>
  now(): Date
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const REPORT_NO = /^[0-9A-Za-z-]{1,30}$/
const MAX_CANDIDATES = 20
/** 품목 이름·검색어로 찾을 때 한 번에 받는 줄 수(이름·식품유형 각각) */
const NAME_ROWS = 50
/** 상품 낱말 하나로 찾을 때 받는 줄 수: 결과가 이름 순이라 창이 좁으면 "순창찰고추장"(ㅅ)이 들어오지 않는다("찰고추장" 96건, "신라면" 144건) */
const WORD_ROWS = 100
/** 고르기 후보가 이만큼 모이면 다음 단계는 부르지 않는다 */
const MIN_CANDIDATES = 5
const MAX_QUERY = 60
const ACTIONS = new Set(['product_auto', 'ingredients_search', 'ingredients_auto', 'ingredients_choose', 'nutrition_search', 'nutrition_choose', 'nutrition_auto'])
/** 업체명+이름으로 한 번에 받는 줄 수. 결과가 이름 순이라 "청정원…"(ㅊ)은 뒤에 오므로 넘치면 한 쪽(BRAND_MORE번째 줄까지) 더 받는다 */
const BRAND_ROWS = 100
const BRAND_MORE = 300
/** "같은 상품인지 확인해 주세요"로 보여 줄 후보 수 */
const UNSURE_SHOWN = 3

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })
const reason = (e: unknown) => (e instanceof FoodInfoError ? e.code : 'network_error')

type Body = { itemId?: unknown; action?: unknown; reportNo?: unknown; query?: unknown; foodCd?: unknown; source?: unknown }

export async function handle(req: Request, deps: FoodInfoDeps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  let body: Body
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'bad_request' })
  }
  const action = typeof body?.action === 'string' ? body.action : ''
  if (!ACTIONS.has(action)) return json(400, { error: 'bad_request' })
  if (action === 'product_auto') return productAuto(body, deps)
  if (action.startsWith('nutrition_')) return nutritionByName(body, action, deps)
  return ingredients(body, action, deps)
}

type Failed = { source: IngredientSource; reason: string }
/** next가 있으면 응답의 total_count가 받은 줄보다 많을 때 한 쪽 더 받는다(start~end번째 줄 주소) */
type Call = { source: IngredientSource; url: string; next?: (start: number, end: number) => string }
/** 한 단계: 한꺼번에 부르는 호출들과 화면에 보여 줄 "찾은 말" */
type Step = { label: string; calls: Call[] }

const toInfo = (r: IngredientRow, origin: IngredientOrigin): IngredientInfo => ({
  origin, reportNo: r.reportNo, name: r.name, maker: r.maker, kind: r.kind, rawMaterials: r.rawMaterials, changedOn: r.changedOn, shelfLife: r.shelfLife, health: r.health,
})

/** 같은 목록·보고번호는 하나만(이름·식품유형·상표 검색이 겹친다) */
const dedupeRows = (rows: readonly IngredientRow[]): IngredientRow[] => {
  const seen = new Set<string>()
  return rows.filter((r) => {
    const k = `${r.source}|${r.reportNo}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

const TYPED: readonly ('C002' | 'I1310')[] = ['C002', 'I1310']

/** 고른 상품: 이름과 다나와 상품(pcode, 읽어 둔 정보). 상품 행을 모르면 ref가 null(다나와 정보 없이 상품명만 쓴다) */
type ProductRef = { name: string; ref: { id: string; sourceId: string } | null; facts: ProductFacts | null }

/** 상품을 고른 품목의 원재료 찾기 단계(D-026): 다나와 제조사(모르면 상품명 첫 낱말)를 업체명 조건으로, 상품 낱말(핵심어부터 3개)을 이름 조건으로 세 목록을 한꺼번에.
 *  업체 열쇠마다 한 단계("롯데푸드"가 0건이면 "롯데"). 다나와 제조사를 모르면 지금처럼 낱말만으로 100건을 마지막 단계로 둔다(업체 일치 기준에 걸린다) */
function productSteps(key: string, plan: MatchPlan, knownMaker: boolean): Step[] {
  const steps: Step[] = plan.makers.map((maker) => ({
    label: `${maker} ${plan.words.join(' ')}`,
    calls: plan.words.flatMap((w) => INGREDIENT_SOURCES.map((source) => ({
      source,
      url: reportBrandUrl(key, source, maker, { name: w }, BRAND_ROWS),
      next: (start: number, end: number) => reportBrandUrl(key, source, maker, { name: w }, end, start),
    }))),
  }))
  if (!knownMaker) steps.push({ label: plan.words.join(' '), calls: plan.words.flatMap((w) => INGREDIENT_SOURCES.map((source) => ({ source, url: reportSearchUrl(key, source, w, 1, WORD_ROWS) }))) })
  return steps
}

/** 다나와 정보: 읽어 둔 것이 없으면 상품 페이지를 한 번 읽는다. 못 읽으면 null(상품명 첫 낱말을 업체로 쓴다) */
async function factsOf(deps: FoodInfoDeps, product: ProductRef): Promise<ProductFacts | null> {
  if (product.facts) return product.facts
  if (!product.ref) return null
  try {
    return await deps.loadFacts(product.ref)
  } catch {
    return null
  }
}

type ProductMatch = { plan: MatchPlan; facts: ProductFacts | null; ranked: MatchScore<IngredientRow>[]; pick: IngredientRow | null; reason: NoMatch | null }

/** 상품 → 식약처 품목(D-026): 단계를 처음 결과가 있는 데까지 부르고, 모은 후보를 점수로 줄 세워(rankMatches) 첫째가 기준(shouldAutoSave)에 맞으면 고른다 */
async function matchProduct(deps: FoodInfoDeps, key: string, product: ProductRef, dead: Set<IngredientSource>, failed: Failed[]): Promise<ProductMatch> {
  const facts = await factsOf(deps, product)
  const plan = matchPlan(product.name, facts)
  let rows: IngredientRow[] = []
  for (const step of productSteps(key, plan, Boolean(facts?.maker))) {
    rows = await runStep(deps, step, dead, failed)
    if (rows.length > 0) break
  }
  const ranked = rankMatches(rows, plan)
  const ok = ranked.length > 0 && shouldAutoSave(ranked[0], ranked[1])
  const reason: NoMatch | null = ok ? null : rows.length > 0 ? 'unsure' : facts?.maker ? 'maker_missing' : 'no_rows'
  return { plan, facts, ranked, pick: ok ? ranked[0].row : null, reason }
}

const productOf = (item: { productName: string | null; product?: { id: string; sourceId: string; facts: ProductFacts | null } | null }): ProductRef | null =>
  item.productName?.trim()
    ? { name: item.productName.trim(), ref: item.product ? { id: item.product.id, sourceId: item.product.sourceId } : null, facts: item.product?.facts ?? null }
    : null

/** 고른 줄 → 저장할 원재료. 축산물(I1310)은 원재료를 C006에서 받는다 */
const infoOf = (deps: FoodInfoDeps, key: string, row: IngredientRow): Promise<IngredientInfo | null> =>
  row.source === 'I1310' ? fetchByNo(deps, key, 'I1310', row.reportNo, row) : Promise.resolve(toInfo(row, originOf(row.source)))

/** 품목 이름·검색어: 낱말마다 이름으로(세 목록), 말 전체를 식품유형으로(C002·I1310) 한꺼번에. "버터"는 이름 검색 앞 줄이 소금빵·쿠키뿐이지만 식품유형 "버터"는 실제 버터다 */
function nameSteps(key: string, term: string, words: string[]): Step[] {
  if (!term) return []
  const calls: Call[] = []
  for (const w of words) for (const source of INGREDIENT_SOURCES) calls.push({ source, url: reportSearchUrl(key, source, w, 1, NAME_ROWS) })
  for (const source of TYPED) calls.push({ source, url: reportTypeUrl(key, source, term, 1, NAME_ROWS) })
  return [{ label: term, calls }]
}

/** 한 단계를 부른다. 실패한 목록(활용신청 없음 INFO-110·네트워크)은 적어 두고 다음 단계에서 부르지 않는다 */
async function runStep(deps: FoodInfoDeps, step: Step, dead: Set<IngredientSource>, failed: Failed[]): Promise<IngredientRow[]> {
  const results = await Promise.all(
    step.calls.filter((c) => !dead.has(c.source)).map(async (c) => {
      try {
        const first = parseReport(await deps.fetchJson(c.url), c.source)
        if (!c.next || first.total <= first.rows.length || first.rows.length === 0) return first.rows
        const more = parseReport(await deps.fetchJson(c.next(first.rows.length + 1, Math.min(first.total, BRAND_MORE))), c.source).rows
        return [...first.rows, ...more]
      } catch (e) {
        if (!dead.has(c.source)) {
          dead.add(c.source)
          failed.push({ source: c.source, reason: reason(e) })
        }
        return [] as IngredientRow[]
      }
    }),
  )
  return dedupeRows(results.flat())
}

/** 보고번호로 한 건. 축산물(I1310)은 원재료를 C006에서, 소비기한·유형은 I1310에서 받아 합친다. 없으면 null, 목록 오류는 던진다 */
async function fetchByNo(deps: FoodInfoDeps, key: string, source: IngredientSource, reportNo: string, known: IngredientRow | null = null): Promise<IngredientInfo | null> {
  const one = (rows: IngredientRow[]) => rows.find((r) => r.reportNo === reportNo) ?? rows[0] ?? null
  if (source !== 'I1310') {
    const row = one(parseReport(await deps.fetchJson(reportByNoUrl(key, source, reportNo)), source).rows)
    return row ? toInfo(row, originOf(source)) : null
  }
  const [raw, head] = await Promise.all([
    deps.fetchJson(reportByNoUrl(key, 'C006', reportNo)).then((b) => one(parseReport(b, 'C006').rows)),
    known ? Promise.resolve(known) : deps.fetchJson(reportByNoUrl(key, 'I1310', reportNo)).then((b) => one(parseReport(b, 'I1310').rows)).catch(() => null),
  ])
  if (!raw) return null
  return toInfo({ ...raw, kind: raw.kind ?? head?.kind ?? null, shelfLife: head?.shelfLife ?? raw.shelfLife, changedOn: raw.changedOn ?? head?.changedOn ?? null }, 'C006')
}

/** 원재료(D-020): 찾기(ingredients_search)·자동 맞춤(ingredients_auto, 상품을 고른 품목만, 상품명으로 맞는 것이 있을 때만 저장)·고르기(ingredients_choose) */
async function ingredients(body: Body, action: string, deps: FoodInfoDeps): Promise<Response> {
  const itemId = typeof body.itemId === 'string' ? body.itemId : ''
  const query = typeof body.query === 'string' ? body.query.replace(/\s+/g, ' ').trim() : ''
  const reportNo = typeof body.reportNo === 'string' ? body.reportNo.trim() : ''
  const source = typeof body.source === 'string' ? body.source : ''
  if (!UUID.test(itemId) || query.length > MAX_QUERY) return json(400, { error: 'bad_request' })
  if (action === 'ingredients_choose' && (!REPORT_NO.test(reportNo) || !(INGREDIENT_SOURCES as readonly string[]).includes(source))) return json(400, { error: 'bad_request' })
  const key = deps.foodKey?.trim()
  if (!key) return json(500, { error: 'missing_api_key' })
  const item = await deps.allowedItem(itemId)
  if (!item) return json(403, { error: 'forbidden' })
  const itemName = item.name.replace(/\s+/g, ' ').trim()

  if (action === 'ingredients_choose') {
    let info: IngredientInfo | null
    try {
      info = await fetchByNo(deps, key, source as IngredientSource, reportNo)
    } catch (e) {
      return json(502, { status: 'error', reason: reason(e) })
    }
    if (!info) return json(404, { error: 'not_found' })
    try {
      await deps.saveIngredients(itemId, info, false)
    } catch {
      return json(502, { status: 'error', reason: 'save_failed' })
    }
    // 고른 품목의 보고번호로 영양성분도 맞춘다(자동 줄로 저장: 사람이 고른 영양 줄은 DB가 덮지 않는다). 실패해도 원재료 저장은 그대로
    await nutritionByReport(deps, info.reportNo).then((row) => (row ? deps.saveNutrition(itemId, row, true, 'report') : undefined)).catch(() => {})
    return json(200, { status: 'done', ingredients: info })
  }

  const dead = new Set<IngredientSource>()
  const failed: Failed[] = []

  if (action === 'ingredients_auto') {
    // 상품을 안 고른 품목은 이름만으로 자동으로 맞추지 않는다(된장 수천 건 중 아무거나 붙을 수 있다): 사람이 고른다. 화면은 이제 product_auto를 부르고, 이 액션은 캐시된 옛 화면용이다
    const product = productOf(item)
    if (!product) return json(200, { status: 'done', term: null, ingredients: null, reason: 'no_product' })
    const m = await matchProduct(deps, key, product, dead, failed)
    if (!m.pick && failed.length === INGREDIENT_SOURCES.length) return json(502, { status: 'error', reason: failed[0].reason })
    const term = m.plan.words.join(' ') || null
    if (!m.pick) return json(200, { status: 'done', term, ingredients: null, reason: 'no_fit' })
    let info: IngredientInfo | null
    try {
      info = await infoOf(deps, key, m.pick)
    } catch (e) {
      return json(502, { status: 'error', reason: reason(e) })
    }
    if (!info) return json(200, { status: 'done', term, ingredients: null, reason: 'no_fit' })
    try {
      await deps.saveIngredients(itemId, info, true)
    } catch {
      return json(502, { status: 'error', reason: 'save_failed' })
    }
    return json(200, { status: 'done', term, ingredients: info })
  }

  // ingredients_search: 검색어가 있으면 그것(낱말은 이름, 전체는 식품유형)만. 없으면 상품 단계들 뒤에 품목 이름(이름+식품유형). 후보가 MIN_CANDIDATES 모이면 멈춘다
  const product = query ? null : productOf(item)
  const facts = product ? await factsOf(deps, product) : null
  const plan = product ? matchPlan(product.name, facts) : null
  const steps = query
    ? nameSteps(key, query, queryWords(query))
    : [...(plan ? productSteps(key, plan, Boolean(facts?.maker)) : []), ...nameSteps(key, itemName, [itemName])]
  if (steps.length === 0) return json(200, { status: 'done', term: null, candidates: [], failed: [] })
  let rows: IngredientRow[] = []
  let term: string | null = null
  for (const step of steps) {
    const got = await runStep(deps, step, dead, failed)
    if (got.length > 0) {
      rows = dedupeRows([...rows, ...got])
      term ??= step.label
    }
    if (rows.length >= MIN_CANDIDATES) break
  }
  if (rows.length === 0 && failed.length === INGREDIENT_SOURCES.length) return json(502, { status: 'error', reason: failed[0].reason })
  const byWords = query ? (queryWords(query).length > 1 ? query : null) : null
  const ranked = plan
    ? rankMatches(rows, plan).map((x) => x.row)
    : byWords
      ? rankIngredients(rows, byWords, '')
      : rankIngredients(pruneUnrelated(rows, query || itemName), null, query || itemName)
  return json(200, { status: 'done', term: term ?? steps[0].label, candidates: ranked.slice(0, MAX_CANDIDATES), failed })
}

/** 식품영양성분DB에서 보고번호(ITEM_REPORT_NO)가 같은 상용제품(D-026). 공공데이터포털 키가 없거나 없으면 null. 보고번호 검색이 운영에서 되는지는 확인 필요 */
async function nutritionByReport(deps: FoodInfoDeps, reportNo: string): Promise<NutritionRow | null> {
  const dataKey = deps.dataKey?.trim()
  if (!dataKey) return null
  const rows = parseNutritionRows(await deps.fetchJson(nutritionUrl(dataKey, reportNo)))
  return rows.find((r) => r.foodCd !== null && r.reportNo === reportNo) ?? null
}

/** 상품을 고른 품목의 영양성분(D-026): ① 맞춘 원재료의 보고번호 ② 상품명 검색(상용제품)에 같은 기준(업체 일치·cover·recall) ③ 품목 이름의 품목대표(음식 제외)만.
 *  상용제품을 이름으로 붙이지 않는다("미림"에 "미림 구운계란"). 호출이 실패한 단계는 건너뛴다 */
async function nutritionForProduct(deps: FoodInfoDeps, plan: MatchPlan, productName: string, itemName: string, reportNo: string | null): Promise<{ row: NutritionRow; matchedBy: MatchedBy } | null> {
  const dataKey = deps.dataKey?.trim()
  if (!dataKey) return null
  if (reportNo) {
    const row = await nutritionByReport(deps, reportNo).catch(() => null)
    if (row) return { row, matchedBy: 'report' }
  }
  const byName = (await searchByProduct(deps, dataKey, productName))
    .filter((r) => r.foodCd !== null)
    .map((r) => ({ name: r.foodName ?? '', maker: r.maker, rawMaterials: null, changedOn: r.updatedOn, r }))
  const ranked = rankMatches(byName, plan)
  if (ranked.length > 0 && shouldAutoSave(ranked[0], ranked[1])) return { row: ranked[0].row.r, matchedBy: 'product' }
  const general = await searchNutrition(deps, dataKey, itemName).catch(() => [] as NutritionRow[])
  const rep = general.find((r) => r.foodCd !== null && r.dbClass === REPRESENTATIVE && !isDish(r) && nutritionTier(r.foodName ?? '', itemName) <= 2)
  return rep ? { row: rep, matchedBy: 'name' } : null
}

/** 상품을 고른 품목의 성분 탭(D-026): 원재료와 영양성분을 한 번에 맞춰 자동 줄(v)로 저장하고, 옛 버전 자동 줄은 지운다(맞는 것이 없으면 남기지 않는다).
 *  자동으로 못 고르면 까닭(reason)과 "같은 상품인지 확인해 주세요" 후보(앞 3개)를 돌려준다. 목록이 모두 실패하면 아무것도 지우지 않고 502 */
async function productAuto(body: Body, deps: FoodInfoDeps): Promise<Response> {
  const itemId = typeof body.itemId === 'string' ? body.itemId : ''
  if (!UUID.test(itemId)) return json(400, { error: 'bad_request' })
  const key = deps.foodKey?.trim()
  if (!key) return json(500, { error: 'missing_api_key' })
  const item = await deps.allowedItem(itemId)
  if (!item) return json(403, { error: 'forbidden' })
  const product = productOf(item)
  if (!product) return json(200, { status: 'done', ingredients: null, nutrition: null, reason: 'no_product', candidates: [], failed: [] })
  const itemName = item.name.replace(/\s+/g, ' ').trim()
  const dead = new Set<IngredientSource>()
  const failed: Failed[] = []
  const m = await matchProduct(deps, key, product, dead, failed)
  if (!m.pick && failed.length === INGREDIENT_SOURCES.length) return json(502, { status: 'error', reason: failed[0].reason })
  let info: IngredientInfo | null = null
  if (m.pick) {
    try {
      info = await infoOf(deps, key, m.pick)
    } catch (e) {
      return json(502, { status: 'error', reason: reason(e) })
    }
  }
  const nut = await nutritionForProduct(deps, m.plan, product.name, itemName, info?.reportNo ?? null).catch(() => null)
  try {
    if (info) await deps.saveIngredients(itemId, info, true)
    if (nut) await deps.saveNutrition(itemId, nut.row, true, nut.matchedBy)
    await deps.clearAuto(itemId, MATCH_VERSION)
  } catch {
    return json(502, { status: 'error', reason: 'save_failed' })
  }
  return json(200, {
    status: 'done',
    ingredients: info,
    nutrition: nut?.row ?? null,
    matchedBy: nut?.matchedBy ?? null,
    reason: info ? null : (m.reason ?? 'unsure'),
    candidates: info ? [] : m.ranked.slice(0, UNSURE_SHOWN).map((x) => x.row),
    maker: m.facts?.maker ?? null,
    origin: m.facts?.origin ?? null,
    words: m.plan.words,
    failed,
  })
}

/** 품목대표 호출 건수. 응답이 식품코드 순(추측)이라 음식(D…)이 앞에 오고 일반 "된장"(P112-…-F001)이 50건 뒤로 밀린다(사용자 2026-10-20 12:39). 넉넉히 받는다 */
const REP_ROWS = 300

const dedupe = (rows: readonly NutritionRow[]): NutritionRow[] => {
  const seen = new Set<string>()
  return rows.filter((r) => {
    const k = r.foodCd ?? `${r.foodName}|${r.maker}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** 품목대표(일반 식품)와 전체 검색을 함께 불러 식품코드로 중복을 없애고 순서를 매긴다(D-018 보충 2). 이름만으로 찾으면 "우유"에 상용제품 50건이 먼저 와
 *  일반 "우유"가 묻히므로 DB_CLASS_NM=품목대표를 따로 부른다. 그 호출이 실패하면(필터가 안 먹는 경우 포함) 전체 검색만 쓴다 */
async function searchNutrition(deps: FoodInfoDeps, dataKey: string, term: string): Promise<NutritionRow[]> {
  const [rep, all] = await Promise.all([
    deps.fetchJson(nutritionSearchUrl(dataKey, term, REP_ROWS, REPRESENTATIVE)).then(parseNutritionRows).catch(() => [] as NutritionRow[]),
    deps.fetchJson(nutritionSearchUrl(dataKey, term)).then(parseNutritionRows),
  ])
  return rankNutrition(dedupe([...rep, ...all]), term)
}

/** 고른 상품의 이름으로 찾는다(D-018 보충 3, 사용자 2026-10-20 12:39: 상품명이 있는데 엉뚱한 것이 맞춰진다): 구체적인 말부터 차례로 불러 처음 응답이 있는 것을 쓴다.
 *  식품영양성분DB의 상용제품은 "백일된장"(샘표식품(주)), "매일우유 저지방 1%"(매일유업㈜)처럼 상품명 그대로 있다(식품안전나라 자료로 확인). 호출이 실패한 말은 건너뛴다 */
async function searchByProduct(deps: FoodInfoDeps, dataKey: string, productName: string): Promise<NutritionRow[]> {
  for (const phrase of productPhrases(productName)) {
    let rows: NutritionRow[]
    try {
      rows = parseNutritionRows(await deps.fetchJson(nutritionSearchUrl(dataKey, phrase)))
    } catch {
      continue
    }
    if (rows.length > 0) return rankByProduct(rows, productName)
  }
  return []
}

/** 품목 이름으로 자동 맞춤에 쓸 만한가: 음식이 아닌 품목대표는 이름이 단어로 든 것(2)까지, 음식·상용제품은 이름이 같거나 이름으로 시작하는 것(1)까지.
 *  "우유"에 "도넛_제주말차 우유 도넛"(상용제품, 2)이나 "된장"에 "취나물_된장"(음식, 2)이 붙지 않게. 맞는 것이 없으면 저장하지 않고 화면이 "찾지 못했어요"를 낸다 */
const autoFit = (r: NutritionRow, term: string) =>
  r.foodCd !== null && nutritionTier(r.foodName ?? '', term) <= (r.dbClass === REPRESENTATIVE && !isDish(r) ? 2 : 1)

/** P9(D-018): 품목 이름(또는 준 검색어)으로 식품영양성분DB를 찾고(nutrition_search), 사람이 고른 식품코드를 같은 검색에서 다시 찾아 저장한다(nutrition_choose).
 *  nutrition_auto는 성분 탭을 열 때 버튼 없이 가장 잘 맞는 식품을 자동으로 저장해 돌려준다(사용자 2026-10-20). 상품을 고른 품목은 상품명으로 먼저 찾고(productFit),
 *  그것이 없을 때 품목 이름으로 찾는다(autoFit). 둘 다 없으면 null. 검색어를 준 검색은 상품명을 쓰지 않는다. 숫자는 응답 값 그대로 저장한다. */
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
  const auto = action === 'nutrition_auto'
  // 상품을 고른 품목의 자동 맞춤은 product_auto와 같은 기준(D-026: 업체 일치·품목대표만). 화면은 이제 product_auto를 부르고, 이 길은 캐시된 옛 화면용이다
  const product = auto && !query ? productOf(item) : null
  if (product) {
    const nut = await nutritionForProduct(deps, matchPlan(product.name, await factsOf(deps, product)), product.name, term, null).catch(() => null)
    if (!nut) return json(200, { status: 'done', term, nutrition: null })
    try {
      await deps.saveNutrition(itemId, nut.row, true, nut.matchedBy)
    } catch {
      return json(502, { status: 'error', reason: 'save_failed' })
    }
    return json(200, { status: 'done', term, nutrition: nut.row, matchedBy: nut.matchedBy })
  }
  const productName = query ? null : item.productName?.trim() || null
  const byProduct = productName ? await searchByProduct(deps, dataKey, productName) : []
  let byName: NutritionRow[] = []
  try {
    byName = await searchNutrition(deps, dataKey, term)
  } catch (e) {
    return json(502, { status: 'error', reason: reason(e) })
  }
  const merged = dedupe([...byProduct, ...byName])
  if (action === 'nutrition_search') return json(200, { status: 'done', term, candidates: merged.slice(0, MAX_CANDIDATES) })
  const matchedBy: MatchedBy = 'name'
  const row = auto ? byName.find((r) => autoFit(r, term)) : merged.find((r) => r.foodCd === foodCd)
  if (!row) return auto ? json(200, { status: 'done', term, nutrition: null }) : json(404, { error: 'not_found' })
  try {
    await deps.saveNutrition(itemId, row, auto, matchedBy)
  } catch {
    return json(502, { status: 'error', reason: 'save_failed' })
  }
  return json(200, { status: 'done', term, nutrition: row, matchedBy: auto ? matchedBy : null })
}
