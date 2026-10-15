import { perUnitLabel, qtyPriceLabel, type PackInfo } from '../lib/units'

/** 품목 이름과 '2개 × 4,900원, 1매당 9.8원' 줄 (배송비·할인 줄은 이름만) */
export function ItemInfo({ it }: { it: PackInfo & { name: string; unit_price: number | null } }) {
  const sub = it.amount > 0 ? [qtyPriceLabel(it), perUnitLabel(it)].filter(Boolean).join(', ') : ''
  return (
    <span className="item-info">
      <span className="item-name">{it.name}</span>
      {sub && <span className="item-sub num">{sub}</span>}
    </span>
  )
}
