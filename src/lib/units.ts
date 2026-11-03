// 품목의 단위당 가격. g·ml는 100g·100ml당, 셈 단위(개·매·구 등)는 1개당으로 보여 준다.

export interface PackInfo {
  amount: number
  quantity: number
  pack_size: number | null
  pack_unit: string | null
}

export function perUnit(it: PackInfo): { base: string; price: number } | null {
  if (!it.pack_size || !it.pack_unit || it.amount <= 0 || it.quantity <= 0) return null
  const metric = it.pack_unit === 'g' || it.pack_unit === 'ml'
  const price = (it.amount / (it.quantity * it.pack_size)) * (metric ? 100 : 1)
  if (!Number.isFinite(price)) return null
  return { base: metric ? `100${it.pack_unit}` : `1${it.pack_unit}`, price }
}

/** 100원 이상은 원 단위, 그보다 작으면 소수 첫째 자리까지 (예: 1매당 9.8원) */
export function formatUnitPrice(price: number): string {
  const v = price >= 100 ? Math.round(price) : Math.round(price * 10) / 10
  return v.toLocaleString('ko-KR')
}

/** '100g당 1,234원' 같은 글자. 용량을 모르면 null */
export function perUnitLabel(it: PackInfo): string | null {
  const u = perUnit(it)
  return u ? `${u.base}당 ${formatUnitPrice(u.price)}원` : null
}

/** '할인 1,360원 뺌(원래 8,360원)'. 서버가 상품 줄에 접은 할인(D-051, 0 또는 음수)이 없으면 null */
export function discountLabel(it: { amount: number; discount?: number | null }): string | null {
  const d = it.discount ?? 0
  if (!(d < 0) || it.amount < 0) return null
  return `할인 ${(-d).toLocaleString('ko-KR')}원 뺌(원래 ${(it.amount - d).toLocaleString('ko-KR')}원)`
}

/** '2개 × 4,900원' (수량이 1이고 개당 가격이 없으면 null) */
export function qtyPriceLabel(it: { quantity: number; unit_price: number | null }): string | null {
  const q = Number(it.quantity)
  const qty = `${Number.isInteger(q) ? q : Math.round(q * 100) / 100}개`
  if (it.unit_price !== null && it.unit_price !== undefined) return `${qty} × ${it.unit_price.toLocaleString('ko-KR')}원`
  return q !== 1 ? qty : null
}

// 영수증 확인 화면의 용량 칸(D-045): '900ml', '1.5kg', '2L', '30롤', '10개입', '1.05kg x2'를 읽는다. kg·L는 g·ml로.
const PACK_TEXT = /^(\d+(?:\.\d+)?)\s*(kg|g|ml|l|리터|개입|개|구|롤|매|입|팩|봉|병|캔|장|단|포|정|알)(?:\s*[x×*]\s*(\d+))?$/i

/** 용량 글자 → 1개(수량 1)에 든 총량과 단위. 못 읽으면 null */
export function parsePackText(text: string): { pack_size: number; pack_unit: string } | null {
  const m = PACK_TEXT.exec(text.replace(/\s+/g, ' ').trim())
  if (!m) return null
  const n = Number(m[1])
  const times = m[3] ? Number(m[3]) : 1
  if (!(n > 0) || !(times >= 1 && times < 1000)) return null
  const u = m[2].toLowerCase()
  const [size, unit] = u === 'kg' ? [n * 1000, 'g'] : u === 'l' || u === '리터' ? [n * 1000, 'ml'] : u === '개입' ? [n, '입'] : [n, m[2]]
  const total = Math.round(size * times * 1000) / 1000
  return total > 0 && total < 1e7 ? { pack_size: total, pack_unit: unit } : null
}

/** 총량·단위 → 칸에 보일 글자('900ml', '1050g', '30롤'). 없으면 '' */
export function packText(size: number | null, unit: string | null): string {
  if (!size || !unit) return ''
  return `${Number.isInteger(size) ? size : Math.round(size * 1000) / 1000}${unit}`
}
