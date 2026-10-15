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

/** '2개 × 4,900원' (수량이 1이고 개당 가격이 없으면 null) */
export function qtyPriceLabel(it: { quantity: number; unit_price: number | null }): string | null {
  const q = Number(it.quantity)
  const qty = `${Number.isInteger(q) ? q : Math.round(q * 100) / 100}개`
  if (it.unit_price !== null && it.unit_price !== undefined) return `${qty} × ${it.unit_price.toLocaleString('ko-KR')}원`
  return q !== 1 ? qty : null
}
