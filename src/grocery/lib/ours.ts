// "우리가 산 값"(P2, 통합 설계 6-2): 가계부 기록(연결된 내역·"맞아요"·이름이 비슷한 기록)을 품목 상세에 보여 주는 계산.
// 과거 값이라 "가장 싼 값"에는 넣지 않는다(화면 설계 4절). 숫자는 가계부에 적힌 값만 쓴다(개당 가격은 적힌 unit_price, 없으면 금액 ÷ 수량).
import { formatUnitPrice, perUnit } from '../../lib/units'
import { koFullDay } from './alerts'
import { won } from './format'
import type { Member } from './types'

export type OurKind = 'linked' | 'confirmed' | 'similar'
/** grocery.our_purchases() 한 줄 */
export type OurPurchase = {
  kind: OurKind
  transactionId: string
  /** 품목 줄 없이 총액만 넣은 내역이면 null */
  transactionItemId: string | null
  occurredOn: string
  platform: string | null
  /** 내역 제목(가게 이름) */
  place: string
  createdBy: string
  name: string
  quantity: number | null
  unitPrice: number | null
  amount: number
  packSize: number | null
  packUnit: string | null
}

export const OURS_TAG = '우리가 산 값'

export function ourPriceText(p: OurPurchase): string {
  if (p.transactionItemId === null || p.quantity === null || p.quantity <= 0) return `총액 ${won(p.amount)}, 개당 가격 모름`
  return `개당 ${won(p.unitPrice ?? Math.round(p.amount / p.quantity))}`
}

/** 100g·100ml·1개당 가격(가계부 용량으로). 용량이 없으면 null */
export function ourUnitText(p: OurPurchase): string | null {
  if (p.transactionItemId === null || p.quantity === null) return null
  const u = perUnit({ amount: p.amount, quantity: p.quantity, pack_size: p.packSize, pack_unit: p.packUnit })
  return u ? `${u.base}당 ${formatUnitPrice(u.price)}원` : null
}

export function ourMetaText(p: OurPurchase, members: readonly Member[]): { day: string; who: Member | null; where: string } {
  return {
    day: koFullDay(p.occurredOn),
    who: members.find((m) => m.userId === p.createdBy) ?? null,
    where: p.platform || p.place || '어디서 샀는지 모름',
  }
}

/** 연결된 기록과 "맞아요"는 우리가 산 값, similar는 확인 전 */
export function splitOurs(rows: OurPurchase[]): { ours: OurPurchase[]; similar: OurPurchase[] } {
  return { ours: rows.filter((r) => r.kind !== 'similar'), similar: rows.filter((r) => r.kind === 'similar') }
}
