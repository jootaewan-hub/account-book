import { discountLabel, packText, perUnitLabel, qtyPriceLabel, type PackInfo } from '../lib/units'

/** 품목 이름과 '2개 × 4,900원, 1매당 9.8원, 할인 1,000원 뺌(원래 10,800원)' 줄 (배송비·할인 줄은 이름만). 할인은 영수증 확인 화면에서만 온다(저장되지 않음) */
export function ItemInfo({ it }: { it: PackInfo & { name: string; unit_price: number | null; discount?: number | null } }) {
  const pack = packText(it.pack_size, it.pack_unit)
  const packLabel = pack && !it.name.replace(/\s+/g, '').toLowerCase().includes(pack.toLowerCase()) ? pack : null
  const sub = it.amount >= 0 ? [qtyPriceLabel(it), packLabel, perUnitLabel(it), discountLabel(it)].filter(Boolean).join(', ') : ''
  return (
    <span className="item-info">
      <span className="item-name">{it.name}</span>
      {sub && <span className="item-sub num">{sub}</span>}
    </span>
  )
}
