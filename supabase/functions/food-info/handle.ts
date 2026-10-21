// 성분(P7·D-020): 식약처 품목제조보고 원재료 — 식품 C002, 축산물 I1310(이름으로 찾고 원재료는 C006에서 보고번호로), 건강기능식품 C003 — 를
// 고른 상품명(상표+낱말 → 상표+식품유형 → 낱말, D-020 보충 2)·품목 이름(이름+식품유형)으로 찾아(ingredients_search) 후보를 주고, 상품명으로 맞으면 성분 탭을 열 때 자동으로(ingredients_auto),
// 아니면 사람이 고른 것(ingredients_choose)을 품목(이름·규격 열쇠)에 저장한다. 영양성분(P9)은 식품영양성분DB. 글·숫자는 출처 값 그대로.
// 식약처 키(FOODSAFETY_API_KEY)와 공공데이터포털 키(DATA_GO_KR_SERVICE_KEY)는 서버에만 있다. 오류 문구에는 코드만 남긴다.
import {
  brandVariants, FoodInfoError, INGREDIENT_SOURCES, ingredientFit, isDish, nutritionSearchUrl, nutritionTier, originOf, parseNutritionRows, parseReport, productFit, productPhrases,
  productSearchWords, pruneUnrelated, queryWords, rankByProduct, rankIngredients, rankNutrition, REPRESENTATIVE, reportBrandUrl, reportByNoUrl, reportSearchUrl, reportTypeUrl,
  type IngredientOrigin, type IngredientRow, type IngredientSource, type NutritionRow,
} from '../_shared/foodInfo.ts'

/** 자동 맞춤이 무엇으로 맞췄나: 고른 상품의 이름(product) 또는 품목 이름(name) */
export type MatchedBy = 'product' | 'name'

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
  /** 사용자 권한(RLS): 내 가구 품목이면 가구 id·이름·규격·고른 상품 이름(없으면 null), 아니면 null */
  allowedItem(itemId: string): Promise<{ householdId: string; name: string; spec: string | null; productName: string | null } | null>
  /** 품목(이름·규격 열쇠)에 고른 식품을 저장(grocery.set_item_nutrition, 서비스 롤). auto면 자동 맞춘 것(고른 사람 없음), matchedBy는 무엇으로 맞췄나 */
  saveNutrition(itemId: string, row: NutritionRow, auto: boolean, matchedBy: MatchedBy): Promise<void>
  /** 품목(이름·규격 열쇠)에 원재료를 저장(grocery.set_item_ingredients, 서비스 롤). auto면 상품명으로 자동 맞춘 것(고른 사람 없음) */
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
const ACTIONS = new Set(['ingredients_search', 'ingredients_auto', 'ingredients_choose', 'nutrition_search', 'nutrition_choose', 'nutrition_auto'])

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
  if (action.startsWith('nutrition_')) return nutritionByName(body, action, deps)
  return ingredients(body, action, deps)
}

type Failed = { source: IngredientSource; reason: string }
type Call = { source: IngredientSource; url: string }
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

/** 상품을 고른 품목(D-020 보충 2): ① 상표 + 상품 낱말(뒤부터 2개; 앞 2자 상표는 첫 낱말만) ② 상표 + 품목 이름을 식품유형으로(C002·I1310) ③ 상품 낱말만 100건.
 *  "매일유업 매일우유 저지방 1% 900ml"(품목 우유) → 매일유업+저지방, 매일유업+매일우유, 매일+저지방, 매일유업+유형 우유, 저지방, 매일우유 */
function productSteps(key: string, productName: string, itemName: string): Step[] {
  const words = productSearchWords(productName).slice(0, 2)
  const brands = brandVariants(productName)
  const steps: Step[] = []
  brands.forEach((brand, i) => {
    for (const w of words.slice(0, i === 0 ? 2 : 1)) {
      steps.push({ label: `${brand} ${w}`, calls: INGREDIENT_SOURCES.map((source) => ({ source, url: reportBrandUrl(key, source, brand, { name: w }) })) })
    }
  })
  if (brands[0] && itemName) steps.push({ label: `${brands[0]} ${itemName}`, calls: TYPED.map((source) => ({ source, url: reportBrandUrl(key, source, brands[0], { type: itemName }) })) })
  for (const w of words) steps.push({ label: w, calls: INGREDIENT_SOURCES.map((source) => ({ source, url: reportSearchUrl(key, source, w, 1, WORD_ROWS) })) })
  return steps
}

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
        return parseReport(await deps.fetchJson(c.url), c.source).rows
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
  const productName = item.productName?.trim() || null
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
    return json(200, { status: 'done', ingredients: info })
  }

  const dead = new Set<IngredientSource>()
  const failed: Failed[] = []

  if (action === 'ingredients_auto') {
    // 상품을 안 고른 품목은 이름만으로 자동으로 맞추지 않는다(된장 수천 건 중 아무거나 붙을 수 있다): 사람이 고른다
    if (!productName) return json(200, { status: 'done', term: null, ingredients: null, reason: 'no_product' })
    let term: string | null = null
    for (const step of productSteps(key, productName, itemName)) {
      const rows = await runStep(deps, step, dead, failed)
      if (rows.length === 0) continue
      term ??= step.label
      const pick = rankIngredients(rows, productName, '').find((r) => ingredientFit(r, productName))
      if (!pick) continue
      let info: IngredientInfo | null
      try {
        info = pick.source === 'I1310' ? await fetchByNo(deps, key, 'I1310', pick.reportNo, pick) : toInfo(pick, originOf(pick.source))
      } catch (e) {
        return json(502, { status: 'error', reason: reason(e) })
      }
      if (!info) continue
      try {
        await deps.saveIngredients(itemId, info, true)
      } catch {
        return json(502, { status: 'error', reason: 'save_failed' })
      }
      return json(200, { status: 'done', term: step.label, ingredients: info })
    }
    if (term === null && failed.length === INGREDIENT_SOURCES.length) return json(502, { status: 'error', reason: failed[0].reason })
    return json(200, { status: 'done', term, ingredients: null, reason: 'no_fit' })
  }

  // ingredients_search: 검색어가 있으면 그것(낱말은 이름, 전체는 식품유형)만. 없으면 상품 단계들 뒤에 품목 이름(이름+식품유형). 후보가 MIN_CANDIDATES 모이면 멈춘다
  const steps = query
    ? nameSteps(key, query, queryWords(query))
    : [...(productName ? productSteps(key, productName, itemName) : []), ...nameSteps(key, itemName, [itemName])]
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
  const byWords = query ? (queryWords(query).length > 1 ? query : null) : productName
  const ranked = byWords
    ? rankIngredients(rows, byWords, '')
    : rankIngredients(pruneUnrelated(rows, query || itemName), null, query || itemName)
  return json(200, { status: 'done', term: term ?? steps[0].label, candidates: ranked.slice(0, MAX_CANDIDATES), failed })
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
  const productName = query ? null : item.productName?.trim() || null
  const byProduct = productName ? await searchByProduct(deps, dataKey, productName) : []
  // 자동 맞춤은 상품명으로 맞는 것이 있으면 이름 검색을 부르지 않는다(호출 아낌)
  const productPick = auto && productName ? byProduct.find((r) => r.foodCd !== null && productFit(r, productName)) : undefined
  let byName: NutritionRow[] = []
  if (!productPick) {
    try {
      byName = await searchNutrition(deps, dataKey, term)
    } catch (e) {
      return json(502, { status: 'error', reason: reason(e) })
    }
  }
  const merged = dedupe([...byProduct, ...byName])
  if (action === 'nutrition_search') return json(200, { status: 'done', term, candidates: merged.slice(0, MAX_CANDIDATES) })
  const matchedBy: MatchedBy = productPick ? 'product' : 'name'
  const row = auto ? productPick ?? byName.find((r) => autoFit(r, term)) : merged.find((r) => r.foodCd === foodCd)
  if (!row) return auto ? json(200, { status: 'done', term, nutrition: null }) : json(404, { error: 'not_found' })
  try {
    await deps.saveNutrition(itemId, row, auto, matchedBy)
  } catch {
    return json(502, { status: 'error', reason: 'save_failed' })
  }
  return json(200, { status: 'done', term, nutrition: row, matchedBy: auto ? matchedBy : null })
}
