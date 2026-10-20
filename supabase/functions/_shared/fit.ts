// 2~3인 가구에 맞는 크기 고르기(D-014·D-015, 사용자 결정 2026-10-20). 다나와 후보의 상품 이름에서 크기(무게·부피·개수, 묶음은 합)를 읽어
// 품목의 "완전 대용량 선"을 넘는 한 봉지는 화면에서 기본으로 숨기고(버튼으로 볼 수 있다), 수량 줄은 담은 양의 2배까지만 남긴다.
// 선: 품목 표(BULK_LINES)에 있으면 표 값(직접 적은 규격이 더 크면 규격의 1.5배), 표에 없으면 규격의 2.5배, 둘 다 없으면 3kg·3L·50개.
// 휴지·화장지는 큰 것으로 사므로 거르지 않는다. 업소용·대용량·박스 같은 말은 크기와 상관없이 숨긴다(예외 품목은 빼고).
// 사용자가 든 예: 쌀 10kg·생수 2L×6·우유 1.8L·간장 3L(보통 크기)는 보이고, 만두 2kg·된장 14kg은 완전 대용량. 표 값은 추측이라 쓰면서 고친다.
// Deno와 브라우저·Vitest가 함께 import하므로 외부 라이브러리를 쓰지 않는다. 크기를 못 읽은 상품은 거르지 않는다.

export type SizeFamily = 'mass' | 'volume' | 'count'
/** 무게는 g, 부피는 ml, 개수는 개 */
export type Size = { family: SizeFamily; n: number }
/** line: 한 봉지가 이보다 크면 완전 대용량(null이면 BULK_CAP). total: 수량 줄의 합계 선. unlimited: 크기로 거르지 않는 품목 */
export type FitRule = { line: Size | null; total: Size | null; unlimited: boolean }

/** 표가 있어도 직접 적은 규격의 1.5배까지는 보인다 */
export const SPEC_FACTOR = 1.5
/** 표에 없는 품목: 규격의 2.5배까지 */
export const NO_TABLE_FACTOR = 2.5
/** 수량 줄: 담은 양(규격 × 개수, 없으면 표 값)의 2배까지 */
export const TOTAL_FACTOR = 2
/** 표도 규격도 없을 때 완전 대용량으로 보는 선 */
export const BULK_CAP: Record<SizeFamily, number> = { mass: 3000, volume: 3000, count: 50 }
export const BULK_WORDS = /업소용|대용량|벌크|박스|식자재|도매|업무용|대량/
/** 큰 것으로 사는 품목: 크기로 거르지 않는다(사용자 2026-10-20) */
export const NO_LIMIT_WORDS: readonly string[] = ['휴지', '화장지']

/** 품목마다 "이보다 큰 한 봉지는 완전 대용량"인 선(추측입니다). 품목 이름에 들어 있는 말로 찾고, 긴 말이 먼저 맞는다. */
export const BULK_LINES: readonly (readonly [string, string])[] = [
  ['쌀', '10kg'], ['현미', '5kg'], ['잡곡', '5kg'], ['밀가루', '3kg'], ['부침가루', '2kg'], ['튀김가루', '2kg'], ['설탕', '3kg'], ['소금', '3kg'],
  ['생수', '12L'], ['탄산수', '12L'], ['우유', '2.5L'], ['두유', '4L'], ['주스', '2L'], ['계란', '30구'], ['달걀', '30구'],
  ['키친타월', '12롤'], ['물티슈', '10팩'], ['세탁세제', '4L'], ['세제', '4L'], ['섬유유연제', '4L'], ['주방세제', '2L'], ['샴푸', '1.5L'], ['린스', '1.5L'], ['바디워시', '1.5L'],
  ['김치', '5kg'], ['라면', '20개'], ['햇반', '24개'], ['즉석밥', '24개'], ['식용유', '4L'], ['올리브유', '1L'], ['간장', '6L'], ['된장', '3kg'], ['고추장', '3kg'], ['쌈장', '1kg'],
  ['참기름', '500ml'], ['들기름', '500ml'], ['식초', '3L'], ['커피', '1kg'], ['만두', '1.5kg'], ['교자', '1.5kg'], ['치즈', '1kg'], ['버터', '500g'], ['요거트', '2kg'],
  ['참치액', '2L'], ['액젓', '5L'], ['참치', '1kg'], ['스팸', '2kg'], ['어묵', '1.5kg'], ['떡', '2kg'], ['국수', '3kg'], ['소면', '3kg'], ['과자', '1kg'], ['견과', '1kg'],
  ['꿀', '2kg'], ['잼', '1kg'], ['고춧가루', '2kg'], ['케첩', '1kg'],
]
const LINES_BY_LENGTH = [...BULK_LINES].sort((a, b) => b[0].length - a[0].length)

// "1.05kg", "420g x 2", "1.05kg 2개", "2L x 6", "500ml 20병", "(300g×3)": 크기 뒤에 곱(x·×·* 또는 바로 숫자)이 붙을 수 있다
const SIZE_RE = /(\d+(?:\.\d+)?)\s*(kg|g|ml|l|리터)(?![a-z])(?:\s*(?:[x×*]\s*)?(\d{1,3})\s*(?:개입|개|팩|봉|병|캔|입|포|매|통)?(?![\d.]))?/gi
// "30구", "30롤", "5개입", "12개": 개수 단위. 크기 표시를 지운 뒤에 읽는다(곱으로 쓴 "2개"를 다시 세지 않게)
const COUNT_RE = /(\d{1,4})\s*(개입|개|구|롤|입|매|장|캔|병|팩|스틱|정)(?![a-z가-힣])(?:\s*(?:[x×*]\s*)?(\d{1,3})(?:개|팩|묶음|세트)?(?![\d.]))?/g

const round = (n: number) => Math.round(n * 1000) / 1000

/** 상품 이름(또는 규격)에서 크기를 읽는다. 여러 개면 합친다(묶음은 전체 양). 못 읽으면 null */
export function parseSize(text: string): Size | null {
  let mass = 0
  let volume = 0
  const rest = text.replace(SIZE_RE, (_m, num: string, unit: string, mult: string | undefined) => {
    const n = Number(num) * (mult ? Number(mult) : 1)
    const u = unit.toLowerCase()
    if (u === 'kg') mass += n * 1000
    else if (u === 'g') mass += n
    else if (u === 'ml') volume += n
    else volume += n * 1000
    return ' '
  })
  if (mass > 0) return { family: 'mass', n: round(mass) }
  if (volume > 0) return { family: 'volume', n: round(volume) }
  let count = 0
  rest.replace(COUNT_RE, (_m, num: string, _unit: string, mult: string | undefined) => {
    count += Number(num) * (mult ? Number(mult) : 1)
    return ' '
  })
  return count > 0 ? { family: 'count', n: count } : null
}

/** 품목의 기준: 완전 대용량 선(line)과 수량 줄 합계 선(total). 규격이 판매 단위(1단, 1/2포기)면 크기로 읽히지 않아 표 값만 쓴다 */
export function fitRule(name: string, spec: string | null, count = 1): FitRule {
  const key = name.replace(/\s+/g, '')
  if (NO_LIMIT_WORDS.some((w) => key.includes(w))) return { line: null, total: null, unlimited: true }
  const k = Math.max(1, Math.floor(count) || 1)
  const hit = LINES_BY_LENGTH.find(([word]) => key.includes(word))
  const table = hit ? parseSize(hit[1]) : null
  const s = spec && spec.trim() ? parseSize(spec) : null
  let line: Size | null = null
  if (table && s && s.family === table.family) line = { family: s.family, n: round(Math.max(table.n, s.n * SPEC_FACTOR)) }
  else if (table) line = table
  else if (s) line = { family: s.family, n: round(s.n * NO_TABLE_FACTOR) }
  const base = s ? { family: s.family, n: s.n * k } : table
  const total = base ? { family: base.family, n: round(base.n * TOTAL_FACTOR) } : null
  return { line, total, unlimited: false }
}

type Variant = { qty: number }
type Cand<V extends Variant> = { name: string; variants: V[] }

/** 큰 용량·묶음인가: 업소용 같은 말이 있거나, 한 봉지 크기가 선(없으면 BULK_CAP)을 넘는다. 크기를 모르거나 단위 종류가 다르면 아니다 */
export function isBulk(c: { name: string }, rule: FitRule): boolean {
  if (rule.unlimited) return false
  if (BULK_WORDS.test(c.name)) return true
  const s = parseSize(c.name)
  if (!s) return false
  if (rule.line) return s.family === rule.line.family ? s.n > rule.line.n + 1e-9 : false
  return s.n > BULK_CAP[s.family]
}

/** 수량 줄 중 합계 선 안에 드는 것(수량 × 크기 ≤ total). 크기를 모르거나 비교할 수 없으면 3개까지. 다 걸러지면 가장 적은 줄 하나 */
export function fitVariants<V extends Variant>(c: Cand<V>, rule: FitRule): V[] {
  if (rule.unlimited) return c.variants
  const s = parseSize(c.name)
  const limit = s && rule.total ? (s.family === rule.total.family ? rule.total.n : null) : s ? BULK_CAP[s.family] * TOTAL_FACTOR : null
  const ok = c.variants.filter((v) => (s && limit !== null ? v.qty * s.n <= limit + 1e-9 : v.qty <= 3))
  if (ok.length > 0) return ok
  const min = [...c.variants].sort((a, b) => a.qty - b.qty)[0]
  return min ? [min] : []
}

/** 후보를 맞는 것(수량 줄 다듬음)과 큰 용량·묶음(줄 그대로)으로 나눈다. 순서는 그대로 */
export function splitCandidates<V extends Variant, C extends Cand<V>>(list: readonly C[], rule: FitRule): { fit: C[]; bulk: C[] } {
  const fit: C[] = []
  const bulk: C[] = []
  for (const c of list) {
    if (isBulk(c, rule)) bulk.push(c)
    else fit.push({ ...c, variants: fitVariants(c, rule) })
  }
  return { fit, bulk }
}
