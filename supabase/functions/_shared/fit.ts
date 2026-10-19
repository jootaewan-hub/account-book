// 2~3인 가구에 맞는 크기 고르기(사용자 요청 2026-10-20, D-014). 다나와 후보의 상품 이름에서 크기(무게·부피·개수)를 읽어,
// 품목의 기준 크기(규격 × 개수, 없으면 아래 표)의 1.5배를 넘는 큰 용량·묶음은 화면에서 기본으로 숨기고 수량 줄도 기준 안의 것만 남긴다.
// Deno(Edge Function)와 브라우저·Vitest가 함께 import하므로 외부 라이브러리를 쓰지 않는다. 숫자 규칙(1.5배, 2kg·2.5L·30개, 표 값)은
// 추측이라 docs/grocery/tracking/status.md "확정할 결정"에 올려 두고 쓰면서 고친다. 크기를 못 읽은 상품은 거르지 않는다.

export type SizeFamily = 'mass' | 'volume' | 'count'
/** 무게는 g, 부피는 ml, 개수는 개 */
export type Size = { family: SizeFamily; n: number }

export const BULK_FACTOR = 1.5
/** 기준 크기를 모를 때 큰 용량으로 보는 선 */
export const BULK_CAP: Record<SizeFamily, number> = { mass: 2000, volume: 2500, count: 30 }
export const BULK_WORDS = /업소용|대용량|벌크|박스|식자재|도매|업무용|대량/

/** 2~3인 가구의 보통 크기(추측입니다): 규격을 안 적은 품목의 기준. 품목 이름에 들어 있는 말로 찾고, 긴 말이 먼저 맞는다. */
export const HOUSEHOLD_SIZES: readonly (readonly [string, string])[] = [
  ['쌀', '10kg'], ['현미', '4kg'], ['잡곡', '2kg'], ['생수', '12L'], ['탄산수', '6L'], ['우유', '1L'], ['두유', '3L'],
  ['계란', '30구'], ['달걀', '30구'], ['휴지', '30롤'], ['화장지', '30롤'], ['키친타월', '12롤'], ['물티슈', '10팩'],
  ['세탁세제', '3L'], ['세제', '3L'], ['섬유유연제', '3L'], ['주방세제', '1.2L'], ['샴푸', '1L'], ['린스', '1L'], ['바디워시', '1L'],
  ['김치', '3kg'], ['라면', '10개'], ['햇반', '12개'], ['식용유', '1.8L'], ['올리브유', '1L'], ['간장', '1.8L'], ['고추장', '1kg'], ['된장', '1kg'],
  ['설탕', '1kg'], ['소금', '1kg'], ['밀가루', '1kg'], ['참기름', '320ml'], ['커피', '500g'], ['만두', '1kg'], ['치즈', '400g'], ['버터', '450g'],
]
const SIZES_BY_LENGTH = [...HOUSEHOLD_SIZES].sort((a, b) => b[0].length - a[0].length)

// "1.05kg", "420g x 2", "1.05kg 2개", "2L x 6", "500ml 20병", "(300g×3)": 크기 뒤에 곱(x·×·* 또는 바로 숫자)이 붙을 수 있다
const SIZE_RE = /(\d+(?:\.\d+)?)\s*(kg|g|ml|l|리터)(?![a-z])(?:\s*(?:[x×*]\s*)?(\d{1,3})\s*(?:개입|개|팩|봉|병|캔|입|포|매|통)?(?![\d.]))?/gi
// "30구", "30롤", "5개입", "12개": 개수 단위. 크기 표시를 지운 뒤에 읽는다(곱으로 쓴 "2개"를 다시 세지 않게)
const COUNT_RE = /(\d{1,4})\s*(개입|개|구|롤|입|매|장|캔|병|팩|스틱|정)(?![a-z가-힣])(?:\s*(?:[x×*]\s*)?(\d{1,3})(?:개|팩|묶음|세트)?(?![\d.]))?/g

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

const round = (n: number) => Math.round(n * 1000) / 1000

/** 품목의 기준 크기: 규격 × 개수. 규격이 판매 단위(1단, 1/2포기)면 비교할 크기가 아니라 null. 규격이 없으면 2~3인 기본 크기 표 × 개수 */
export function referenceSize(name: string, spec: string | null, count = 1): Size | null {
  const k = Math.max(1, Math.floor(count) || 1)
  if (spec && spec.trim()) {
    const s = parseSize(spec)
    return s ? { family: s.family, n: round(s.n * k) } : null
  }
  const key = name.replace(/\s+/g, '')
  const hit = SIZES_BY_LENGTH.find(([word]) => key.includes(word))
  const s = hit ? parseSize(hit[1]) : null
  return s ? { family: s.family, n: round(s.n * k) } : null
}

type Variant = { qty: number }
type Cand<V extends Variant> = { name: string; variants: V[] }

const limitFor = (s: Size, ref: Size | null): number | null =>
  ref ? (s.family === ref.family ? ref.n * BULK_FACTOR : null) : BULK_CAP[s.family]

/** 큰 용량·묶음인가: 업소용 같은 말이 있거나, 크기가 기준(없으면 BULK_CAP)을 넘는다. 크기를 모르거나 단위 종류가 다르면 아니다 */
export function isBulk(c: { name: string }, ref: Size | null): boolean {
  if (BULK_WORDS.test(c.name)) return true
  const s = parseSize(c.name)
  if (!s) return false
  const limit = limitFor(s, ref)
  return limit !== null && s.n > limit + 1e-9
}

/** 수량 줄 중 기준 안에 드는 것(수량 × 크기 ≤ 기준). 크기를 모르거나 비교할 수 없으면 3개까지. 다 걸러지면 가장 적은 줄 하나 */
export function fitVariants<V extends Variant>(c: Cand<V>, ref: Size | null): V[] {
  const s = parseSize(c.name)
  const limit = s ? limitFor(s, ref) : null
  const ok = c.variants.filter((v) => (s && limit !== null ? v.qty * s.n <= limit + 1e-9 : v.qty <= 3))
  if (ok.length > 0) return ok
  const min = [...c.variants].sort((a, b) => a.qty - b.qty)[0]
  return min ? [min] : []
}

/** 후보를 맞는 것(수량 줄 다듬음)과 큰 용량·묶음(줄 그대로)으로 나눈다. 순서는 그대로 */
export function splitCandidates<V extends Variant, C extends Cand<V>>(list: readonly C[], ref: Size | null): { fit: C[]; bulk: C[] } {
  const fit: C[] = []
  const bulk: C[] = []
  for (const c of list) {
    if (isBulk(c, ref)) bulk.push(c)
    else fit.push({ ...c, variants: fitVariants(c, ref) })
  }
  return { fit, bulk }
}
