// 성분(P7, 화면 설계 5절; D-020): 식약처 품목제조보고 원재료(식품 C002, 축산물 I1310→C006, 건강기능식품 C003)와 식품영양성분DB(공공데이터포털 15127578)를 읽는다.
// Deno(Edge Function)와 Node(Vitest)가 함께 import하므로 런타임 전용 API를 쓰지 않는다. 키는 URL에만 들어가고 오류 문구에 넣지 않는다.
// 확인한 사실: C002·I1310·C006·C003은 `sample` 키 실제 응답(tests/grocery/fixtures/foodsafety/*.json)으로 항목 이름을 확인했다.
// 확인 필요: 영양성분DB는 명세(swagger)의 항목 이름으로만 만들었다(키 활용신청 뒤 실제 호출로 확인, 응답의 items 모양이 배열인지 {item: …}인지 둘 다 읽는다).

export class FoodInfoError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'FoodInfoError'
  }
}

const FOOD_BASE = 'https://openapi.foodsafetykorea.go.kr/api'
const NUTRI_BASE = 'https://apis.data.go.kr/1471000/FoodNtrCpntDbInfo03/getFoodNtrCpntDbInq03'

/** 원재료를 이름으로 찾는 식약처 목록(D-020): 식품 품목제조보고 원재료(C002), 축산물 품목제조보고(I1310: 원재료는 C006에서 보고번호로 받는다), 건강기능식품 품목제조신고 원재료(C003).
 *  C006은 PRDLST_NM 조회를 받지 않는다(2026-10-21 sample 키 실제 응답: "지원하지 않는 요청인자", 쓸 수 있는 것은 PRDLST_REPORT_NO·CHNG_DT·PRMS_DT·LCNS_NO). */
export type IngredientSource = 'C002' | 'I1310' | 'C003'
/** 원재료를 받은 목록(저장하는 origin): 축산물은 C006 */
export type IngredientOrigin = 'C002' | 'C006' | 'C003'
export const INGREDIENT_SOURCES: readonly IngredientSource[] = ['C002', 'I1310', 'C003']
export const SOURCE_NAME: Record<IngredientSource | IngredientOrigin, string> = { C002: '식품', I1310: '축산물', C006: '축산물', C003: '건강기능식품' }
/** 그 목록에서 원재료를 받는 서비스 */
export const originOf = (s: IngredientSource): IngredientOrigin => (s === 'I1310' ? 'C006' : s)
const familyOf = (s: IngredientSource | 'C006'): IngredientSource => (s === 'C006' ? 'I1310' : s)

/** 이름(PRDLST_NM 부분 일치)으로 찾기, start~end번째 줄 */
export function reportSearchUrl(key: string, service: IngredientSource, name: string, start = 1, end = 20): string {
  return `${FOOD_BASE}/${encodeURIComponent(key)}/${service}/json/${start}/${end}/PRDLST_NM=${encodeURIComponent(name)}`
}

/** 품목제조보고번호로 한 건(같은 번호가 여러 줄이면 앞 5줄). C006은 원재료마다 줄이 나뉠 수 있어 20줄 */
export function reportByNoUrl(key: string, service: IngredientSource | 'C006', reportNo: string): string {
  return `${FOOD_BASE}/${encodeURIComponent(key)}/${service}/json/1/${service === 'C006' ? 20 : 5}/PRDLST_REPORT_NO=${encodeURIComponent(reportNo)}`
}

/** 식품유형(PRDLST_DCNM 부분 일치)으로 찾기: C002·I1310만 받는다(C003은 식품유형 항목이 없다). 이름 검색은 결과가 이름 순이라 "버터" 같은 흔한 말은 앞 20건이
 *  "(냉)…버터소금빵"·"AF 가공버터"처럼 기호·영문으로 시작하는 것뿐인데, 식품유형이 "버터"인 줄은 실제 버터다(2026-10-21 sample 키 실제 호출로 확인, D-020 보충) */
export function reportTypeUrl(key: string, service: 'C002' | 'I1310', type: string, start = 1, end = 20): string {
  return `${FOOD_BASE}/${encodeURIComponent(key)}/${service}/json/${start}/${end}/PRDLST_DCNM=${encodeURIComponent(type)}`
}

/** 업체명(BSSH_NM 부분 일치)에 이름 또는 식품유형을 함께 걸어 찾기. C002·I1310·C003 모두 BSSH_NM을 받고 조건은 &로 묶는다(2026-10-21 sample 실제 호출: 샘표+백일된장 → 국산콩백일된장 등 3건,
 *  매일유업+저지방 → 매일우유 저지방 1%). 상표가 업체명에 없으면(청정원→대상(주), 수입 버터) INFO-200이 오고 다음 단계로 간다 */
export function reportBrandUrl(key: string, service: IngredientSource, brand: string, by: { name: string } | { type: string }, end = 50, start = 1): string {
  const cond = 'name' in by ? `PRDLST_NM=${encodeURIComponent(by.name)}` : `PRDLST_DCNM=${encodeURIComponent(by.type)}`
  return `${FOOD_BASE}/${encodeURIComponent(key)}/${service}/json/${start}/${end}/BSSH_NM=${encodeURIComponent(brand)}&${cond}`
}

export type IngredientRow = {
  /** 어느 목록에서 찾았나(C006으로 받은 줄은 I1310) */
  source: IngredientSource
  /** 품목제조보고번호 */
  reportNo: string
  name: string
  maker: string | null
  /** 식품유형(PRDLST_DCNM). 건강기능식품은 제품 형태(PRDT_SHAP_CD_NM) */
  kind: string | null
  /** 원재료(RAWMTRL_NM). I1310 줄은 null(고르면 C006에서 받는다) */
  rawMaterials: string | null
  /** 변경일(CHNG_DT, 없으면 LAST_UPDT_DTM·PRMS_DT) YYYY-MM-DD */
  changedOn: string | null
  /** 소비기한(POG_DAYCNT): I1310·C003에만 있다 */
  shelfLife: string | null
  /** 건강기능식품(C003): 주된 기능성·섭취 방법·섭취 시 주의사항 */
  health: { function: string | null; intake: string | null; caution: string | null } | null
}

const text = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const t = v.replace(/\s+/g, ' ').trim()
  return t === '' || t === '-' ? null : t
}
const day = (v: unknown): string | null => {
  const t = text(v)
  const m = t?.match(/^(\d{4})[-.]?(\d{2})[-.]?(\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}
const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const t = text(v)
  if (!t) return null
  const n = Number(t.replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

type Envelope = { RESULT?: { CODE?: string; MSG?: string }; total_count?: unknown; row?: unknown }

/** 식약처 품목제조보고 응답(봉투 키는 서비스 이름). INFO-200은 자료 없음, 다른 코드(INFO-110 활용신청 없음 등)는 FoodInfoError */
export function parseReport(body: unknown, service: IngredientSource | 'C006'): { total: number; rows: IngredientRow[] } {
  if (!body || typeof body !== 'object') throw new FoodInfoError('unreadable', `${service} 응답을 읽지 못함`)
  const b = body as Record<string, unknown>
  const svc = ((b[service] && typeof b[service] === 'object' ? b[service] : b) as Envelope) ?? {}
  const code = svc.RESULT?.CODE ?? 'NO-RESULT'
  if (code === 'INFO-200') return { total: 0, rows: [] }
  if (code !== 'INFO-000') throw new FoodInfoError(code, svc.RESULT?.MSG ?? `${service} 오류`)
  const raw = (Array.isArray(svc.row) ? svc.row : []) as Record<string, unknown>[]
  const rows: IngredientRow[] = []
  for (const r of service === 'C006' ? mergeC006(raw) : raw) {
    const reportNo = text(r.PRDLST_REPORT_NO)
    const name = text(r.PRDLST_NM)
    if (!reportNo || !name) continue
    rows.push({
      source: familyOf(service),
      reportNo,
      name,
      maker: text(r.BSSH_NM),
      kind: service === 'C003' ? text(r.PRDT_SHAP_CD_NM) : text(r.PRDLST_DCNM),
      rawMaterials: service === 'I1310' ? null : text(r.RAWMTRL_NM),
      changedOn: day(r.CHNG_DT) ?? day(r.LAST_UPDT_DTM) ?? day(r.PRMS_DT),
      shelfLife: text(r.POG_DAYCNT),
      health: service === 'C003' ? { function: text(r.PRIMARY_FNCLTY), intake: text(r.NTK_MTHD), caution: text(r.IFTKN_ATNT_MATR_CN) } : null,
    })
  }
  const total = num(svc.total_count)
  return { total: total !== null && total >= 0 ? Math.trunc(total) : rows.length, rows }
}

/** C006은 같은 보고번호의 원재료가 여러 줄로 올 수 있다(RAWMTRL_ORDNO). 번호 순으로 합쳐 한 줄로 만든다(같은 이름은 한 번만) */
function mergeC006(raw: Record<string, unknown>[]): Record<string, unknown>[] {
  const byNo = new Map<string, { row: Record<string, unknown>; parts: { ord: number; name: string }[] }>()
  for (const r of raw) {
    const no = text(r.PRDLST_REPORT_NO)
    if (!no) continue
    const e = byNo.get(no) ?? { row: r, parts: [] }
    const name = text(r.RAWMTRL_NM)
    if (name && !e.parts.some((x) => x.name === name)) e.parts.push({ ord: num(r.RAWMTRL_ORDNO) ?? e.parts.length + 1, name })
    byNo.set(no, e)
  }
  return [...byNo.values()].map(({ row, parts }) => ({ ...row, RAWMTRL_NM: parts.sort((a, b) => a.ord - b.ord).map((x) => x.name).join(', ') }))
}

const AD_WORDS = new Set(['무료배송', '당일배송', '특가', '행사', '기획', '증정', '세트', '묶음', '정품', '최저가', '할인', '대용량'])
/** 견줄 때 쓰는 꼴: 소문자, 한글·영문·숫자만(띄어쓰기·기호·한자 뺌) */
export const squash = (s: string) => s.toLowerCase().replace(/[^가-힣a-z0-9]/g, '')

/** 상품명에서 찾을 낱말(D-020 보충 2): 식약처 품목명은 띄어쓰기가 제각각("국산콩백일된장")이고 띄어쓴 말은 첫 낱말로만 맞춰져("국산콩 백일된장"→두부들)
 *  구절 대신 낱말 하나씩 찾는다. 상표(첫 낱말)·숫자 든 말·용량·광고 말은 빼고, 뒤(상품 이름)부터 앞으로. "샘표 국산콩 100% 백일된장 900g" → ["백일된장", "국산콩"] */
export function productSearchWords(productName: string): string[] {
  const words = productWords(productName)
  const rest = (words.length > 1 ? words.slice(1) : words).filter((w) => !/\d/.test(w))
  return [...rest].reverse()
}

/** 업체명(BSSH_NM)으로 걸 상표 후보: 상품명 첫 낱말(2자 이상, 숫자 없음) 그대로, 3자 이상이면 앞 2자도("임실치즈농협"→"임실치즈축산업협동조합", "롯데제과"→"롯데웰푸드"는 "롯데"로).
 *  낱말이 하나뿐이면 상표가 없다 */
export function brandVariants(productName: string): string[] {
  const words = productWords(productName)
  if (words.length < 2) return []
  const b = words[0].replace(/[^가-힣a-z0-9]/g, '')
  if (b.length < 2 || /\d/.test(b)) return []
  return b.length >= 3 ? [b, b.slice(0, 2)] : [b]
}

/** 사람이 넣은 검색어에서 이름으로 찾을 낱말: 용량·수량·숫자 든 말을 빼고 긴 낱말부터 2개. 아무것도 안 남으면 검색어 그대로 */
export function queryWords(query: string): string[] {
  const words = productWords(query).filter((w) => !/\d/.test(w))
  const out = [...new Set(words)].sort((a, b) => b.length - a.length).slice(0, 2)
  return out.length > 0 ? out : [query.trim()].filter(Boolean)
}

/** 품목 이름으로 찾았을 때 식품유형이 맞는 줄이 하나라도 있으면, 식품유형도 안 맞고 이름에 낱말로도 안 든 것(버터쿠키·에그콘버터)은 뺀다(사용자 2026-10-21: 버터에 쿠키가 뜸) */
export function pruneUnrelated(rows: readonly IngredientRow[], term: string): IngredientRow[] {
  if (!rows.some((r) => kindTier(r.kind, term) <= 1)) return [...rows]
  return rows.filter((r) => kindTier(r.kind, term) <= 1 || nutritionTier(r.name, term) <= 2)
}

/** 식품유형 일치 단계: 0 같음("버터"), 1 식품유형에 든 것("가공버터"·"버터유"·"땅콩버터"·"유당분해우유"), 4 무관 */
export function kindTier(kind: string | null, term: string): number {
  const t = squash(term)
  const k = squash(kind ?? '')
  if (!t || !k) return 4
  if (k === t) return 0
  return k.includes(t) ? 1 : 4
}

/** 원재료 후보 순서: 상품명이 있으면 상품 단어가 많이 든 것부터(rankByProduct).
 *  없으면(품목 이름·검색어) 식품유형 일치 단계(kindTier) → 이름 일치 단계(nutritionTier) → 짧은 이름 → 응답 순서.
 *  "버터"에 식품유형 버터·가공버터가 먼저 오고, 이름에만 든 소금빵·쿠키는 뒤로(사용자 2026-10-21: 화장품·쿠키가 뜸) */
export function rankIngredients(rows: readonly IngredientRow[], productName: string | null, term: string): IngredientRow[] {
  if (productName) return rankByProduct(rows.map((r) => ({ r, foodName: r.name, maker: r.maker })), productName).map((x) => x.r)
  return rows
    .map((r, i) => ({ r, i, kk: kindTier(r.kind, term), k: nutritionTier(r.name, term), len: r.name.length }))
    .sort((a, b) => a.kk - b.kk || a.k - b.k || a.len - b.len || a.i - b.i)
    .map((x) => x.r)
}

/** 상품명으로 원재료 자동 맞춤에 쓸 만한가(productFit과 같은 규칙): 상품 단어 2개 이상, 또는 1개 + 업체 일치 */
export const ingredientFit = (row: IngredientRow, productName: string): boolean => productFit({ foodName: row.name, maker: row.maker }, productName)

/** 이름으로 찾기(FOOD_NM_KR): 품목 이름으로 식품을 고르는 P9 흐름. dbClass('품목대표' 또는 '상용제품')를 주면 DB_CLASS_NM으로 좁힌다(명세의 요청 변수, 예시값 '품목대표'). 응답 모양은 보고번호 조회와 같다 */
export function nutritionSearchUrl(key: string, name: string, rows = 50, dbClass?: string): string {
  const k = key.trim()
  const enc = k.includes('%') ? k : encodeURIComponent(k)
  const cls = dbClass ? `&DB_CLASS_NM=${encodeURIComponent(dbClass)}` : ''
  return `${NUTRI_BASE}?serviceKey=${enc}&type=json&pageNo=1&numOfRows=${rows}&FOOD_NM_KR=${encodeURIComponent(name)}${cls}`
}

/** 식품영양성분DB의 구분(DB_CLASS_NM) 중 일반 식품("우유_일반"처럼 상표 없는 대표 품목). 나머지는 '상용제품' */
export const REPRESENTATIVE = '품목대표'

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const SEG = /[\s,/()_]+/

/** 이름 일치 단계(작을수록 잘 맞음): 0 같음, 1 이름으로 시작("우유, 저지방"·"우유_일반"·"우유(멸균)"), 2 단어로 들어 있음("도넛_제주말차 우유 도넛"),
 *  3 그냥 포함("우유식빵"), 4 무관. 통합 DB의 이름은 "대표명_세부명"(명세 예시 "국밥_돼지머리")이라 밑줄도 구분자로 본다(사용자 2026-10-20 12:03) */
export function nutritionTier(name: string, term: string): number {
  const t = term.replace(/\s+/g, '').toLowerCase()
  if (!t) return 4
  const n = name.replace(/\s+/g, '').toLowerCase()
  if (n === t) return 0
  const head = new RegExp(`^${escapeRe(t)}(?:$|[\\s,(/_])`)
  if (head.test(n) || head.test(name.toLowerCase())) return 1
  if (name.toLowerCase().split(SEG).some((seg) => seg === t)) return 2
  if (n.includes(t)) return 3
  return 4
}

/** 이름 검색 후보 순서(사용자 2026-10-20: "우유"에 관련 없는 것이 너무 많다): 일치 단계(nutritionTier) → 같은 단계면 품목대표가 상용제품보다 먼저 →
 *  짧은 이름이 먼저(더 기본 식품) → 응답 순서. 자동 맞춤은 맨 앞부터 autoFit(handle.ts)에 맞는 것을 쓴다 */
export function rankNutrition<T extends { foodName: string | null; dbClass?: string | null }>(rows: readonly T[], term: string): T[] {
  if (!term.replace(/\s+/g, '')) return [...rows]
  return rows
    .map((r, i) => ({ r, i, k: nutritionTier(r.foodName ?? '', term), rep: r.dbClass === REPRESENTATIVE ? 0 : 1, len: (r.foodName ?? '').length }))
    .sort((a, b) => a.k - b.k || a.rep - b.rep || a.len - b.len || a.i - b.i)
    .map((x) => x.r)
}

export function nutritionUrl(key: string, reportNo: string): string {
  const k = key.trim()
  const enc = k.includes('%') ? k : encodeURIComponent(k)
  return `${NUTRI_BASE}?serviceKey=${enc}&type=json&pageNo=1&numOfRows=5&ITEM_REPORT_NO=${encodeURIComponent(reportNo)}`
}

/** 화면에 쓰는 영양성분(기준량당). 값이 없으면 null. 숫자는 응답 값 그대로(계산하지 않는다) */
export type Nutrition = {
  basis: string | null
  kcal: number | null
  carbs: number | null
  sugars: number | null
  protein: number | null
  fat: number | null
  satFat: number | null
  transFat: number | null
  cholesterol: number | null
  sodium: number | null
  /** 식품중량(Z10500) */
  weight: number | null
  /** 1회 섭취참고량(NUTRI_AMOUNT_SERVING) */
  servingRef: number | null
  source: string | null
  foodName: string | null
  maker: string | null
  updatedOn: string | null
}

/** 응답 한 줄 + 식품코드(FOOD_CD)·품목제조보고번호·구분(DB_CLASS_NM: 품목대표/상용제품)·식품대분류(FOOD_CAT1_NM)·데이터구분(DB_GRP_NM: 음식/가공식품/원재료성식품). 이름 검색 후보로 쓴다 */
export type NutritionRow = Nutrition & { foodCd: string | null; reportNo: string | null; dbClass: string | null; category: string | null; group: string | null }

/** 음식(조리된 요리): 데이터구분이 음식이거나, 없으면 식품코드가 D로 시작(식품안전나라 자료: D 음식, P 가공식품, R 원재료성식품).
 *  일반 품목이라도 "취나물_된장"처럼 재료 이름이 든 음식은 재료 품목에 자동으로 맞추지 않는다(사용자 2026-10-20 12:39) */
export const isDish = (r: { foodCd: string | null; group: string | null }): boolean =>
  r.group === '음식' || (r.group === null && (r.foodCd ?? '').toUpperCase().startsWith('D'))

const SIZE_WORD = /^\d+(?:[.,]\d+)?(?:kg|g|mg|ml|l|리터|cc|oz|개|개입|팩|입|병|봉|캔|구|매|롤|장|포|box|박스|p|ea|세트)$/i
const COUNT_WORD = /^(?:x|×)?\d+(?:개|팩|입|병|봉|캔|구|매|롤|장|포)?$/i

/** 용량("900g")·수량("2개")·광고("무료배송") 말인가. 괄호·쉼표를 뗀 낱말을 받는다(대소문자 무시) */
export const isNoiseWord = (t: string): boolean => SIZE_WORD.test(t) || COUNT_WORD.test(t) || AD_WORDS.has(t.toLowerCase())

/** 상품명에서 찾을 단어(P9 상품 흐름, D-018 보충 3): 용량·수량·연도·광고 말을 빼고, 상표(첫 단어)와 "1%" 같은 비율은 남긴다 */
export function productWords(productName: string): string[] {
  const out: string[] = []
  for (const w of productName.split(/\s+/)) {
    const t = w.toLowerCase().replace(/[()[\]{},/]/g, '').trim()
    if (!t || isNoiseWord(t)) continue
    if (!out.includes(t)) out.push(t)
  }
  return out
}

/** 상품명으로 식품영양성분DB(FOOD_NM_KR 부분 일치)를 찾을 말, 구체적인 것부터: 상표 뒤 단어 전부(숫자 든 말 제외) → 마지막 두 단어 → 마지막 단어.
 *  "샘표 국산콩 100% 백일된장 900g" → "국산콩 백일된장", "백일된장". 단어가 하나면 그대로 */
export function productPhrases(productName: string): string[] {
  const words = productWords(productName)
  const rest = (words.length > 1 ? words.slice(1) : words).filter((w) => !/\d/.test(w))
  const base = rest.length > 0 ? rest : words
  const phrases = [base.join(' '), base.slice(-2).join(' '), base.slice(-1).join(' ')]
  return [...new Set(phrases.filter(Boolean))]
}

/** 상품 단어가 식품 이름에 몇 개 들었나(띄어쓰기·기호 무시)와, 제조사에 상표(첫 단어)가 들었나("샘표"→"샘표식품(주)", "롯데푸드"→"롯데칠성음료") */
export function productScore(row: { foodName: string | null; maker: string | null }, productName: string): { hits: number; makerHit: boolean } {
  const words = productWords(productName)
  const name = squash(row.foodName ?? '')
  const maker = squash(row.maker ?? '')
  const hits = words.filter((w) => {
    const t = squash(w)
    return t.length > 0 && name.includes(t)
  }).length
  const brand = squash(words[0] ?? '')
  const makerHit = brand.length >= 2 && maker.length >= 2 && (maker.includes(brand) || (brand.length >= 3 && brand.includes(maker.slice(0, 2))))
  return { hits, makerHit }
}

/** 상품명 후보 순서: 단어 일치 수 → 제조사 일치 → 짧은 이름 → 응답 순서 */
export function rankByProduct<T extends { foodName: string | null; maker: string | null }>(rows: readonly T[], productName: string): T[] {
  return rows
    .map((r, i) => ({ r, i, ...productScore(r, productName), len: (r.foodName ?? '').length }))
    .sort((a, b) => b.hits - a.hits || Number(b.makerHit) - Number(a.makerHit) || a.len - b.len || a.i - b.i)
    .map((x) => x.r)
}

/** 상품명으로 자동 맞춤에 쓸 만한가: 상품 단어 2개 이상, 또는 1개 + 제조사 일치. "그래놀라" 하나만 맞는 다른 회사 제품은 쓰지 않는다 */
export function productFit(row: { foodName: string | null; maker: string | null }, productName: string): boolean {
  const { hits, makerHit } = productScore(row, productName)
  return hits >= 2 || (hits >= 1 && makerHit)
}

function nutritionRowOf(it: Record<string, unknown>): NutritionRow {
  return {
    basis: text(it.SERVING_SIZE),
    kcal: num(it.AMT_NUM1),
    carbs: num(it.AMT_NUM6),
    sugars: num(it.AMT_NUM7),
    protein: num(it.AMT_NUM3),
    fat: num(it.AMT_NUM4),
    satFat: num(it.AMT_NUM24),
    transFat: num(it.AMT_NUM25),
    cholesterol: num(it.AMT_NUM23),
    sodium: num(it.AMT_NUM13),
    weight: num(it.Z10500),
    servingRef: num(it.NUTRI_AMOUNT_SERVING),
    source: text(it.SUB_REF_NAME),
    foodName: text(it.FOOD_NM_KR),
    maker: text(it.MAKER_NM),
    updatedOn: day(it.UPDATE_DATE) ?? day(it.RESEARCH_YMD),
    foodCd: text(it.FOOD_CD),
    reportNo: text(it.ITEM_REPORT_NO),
    dbClass: text(it.DB_CLASS_NM),
    category: text(it.FOOD_CAT1_NM),
    group: text(it.DB_GRP_NM),
  }
}

/** 응답의 모든 줄(items 배열 또는 {item: …}). 결과 코드가 00이 아니면 FoodInfoError */
export function parseNutritionRows(body: unknown): NutritionRow[] {
  if (!body || typeof body !== 'object') throw new FoodInfoError('unreadable', '영양성분 응답을 읽지 못함')
  const b = body as { header?: { resultCode?: unknown; resultMsg?: unknown }; body?: { items?: unknown } }
  const code = text(b.header?.resultCode)
  if (code === null) throw new FoodInfoError('unreadable', '영양성분 응답에 결과 코드가 없음')
  if (code !== '00') throw new FoodInfoError(code, text(b.header?.resultMsg) ?? '영양성분 오류')
  const items = b.body?.items
  const list = (Array.isArray(items) ? items : items && typeof items === 'object' && 'item' in items
    ? (Array.isArray((items as { item: unknown }).item) ? (items as { item: unknown[] }).item : [(items as { item: unknown }).item])
    : []) as Record<string, unknown>[]
  return list.filter((x) => x && typeof x === 'object').map(nutritionRowOf)
}

/** 보고번호 조회의 첫 줄(식품코드·보고번호는 뺀 영양성분). 없으면 null */
export function parseNutrition(body: unknown): Nutrition | null {
  const [first] = parseNutritionRows(body)
  if (!first) return null
  const { foodCd: _c, reportNo: _r, dbClass: _d, category: _k, group: _g, ...n } = first
  void _c
  void _r
  void _d
  void _k
  void _g
  return n
}
