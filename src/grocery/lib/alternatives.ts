// 대안 탭(P7, 화면 설계 5절): 같은 품목의 다나와 후보 중 고른 상품보다 나은 점이 있는 것만. 이유는 태그와 숫자로 쓰고 판정 문장은 쓰지 않는다.
// 숫자는 다나와 후보 값(검색 결과의 그 수량 최저가·평점·후기 수) 그대로다. 회수·부적합 기록이 있는 상품(recalled)은 뺀다.
import { won } from './format'
import type { Candidate } from './products'

export type Reason = { kind: 'cheaper' | 'rating'; text: string }
export type Alternative = { productId: string; name: string; imageUrl: string | null; reasons: Reason[] }

const RATING_GAP = 0.2
const MIN_REVIEWS = 100

const priceAt = (c: Candidate, qty: number) => c.variants.find((v) => v.qty === qty)?.price ?? null

/** 고른 상품(chosenId)과 같은 수량(qty)으로 견준다. 더 싸거나(차액), 평점이 0.2 이상 높고 후기 100개 이상이면 대안이다. */
export function alternatives(candidates: Candidate[], chosenId: string, qty: number, recalled: ReadonlySet<string>): Alternative[] {
  const chosen = candidates.find((c) => c.productId === chosenId)
  if (!chosen) return []
  const base = priceAt(chosen, qty)
  const out: Alternative[] = []
  for (const c of candidates) {
    if (c.productId === chosenId || recalled.has(c.productId)) continue
    const reasons: Reason[] = []
    const p = priceAt(c, qty)
    if (base !== null && p !== null && p < base) reasons.push({ kind: 'cheaper', text: `${qty}개 ${won(p)}, ${won(base - p)} 더 쌈` })
    if (c.rating !== null && chosen.rating !== null && c.rating - chosen.rating >= RATING_GAP - 1e-9 && (c.reviewCount ?? 0) >= MIN_REVIEWS) {
      reasons.push({ kind: 'rating', text: `평점 ${c.rating.toFixed(1)}(후기 ${(c.reviewCount ?? 0).toLocaleString('ko-KR')}개), 고른 상품 ${chosen.rating.toFixed(1)}` })
    }
    if (reasons.length > 0) out.push({ productId: c.productId, name: c.name, imageUrl: c.imageUrl, reasons })
  }
  return out
}

/** 요약 칸 "더 나은 상품": 개수만. 후보를 못 읽었으면 "확인 못 함" */
export function betterText(count: number | null): string {
  if (count === null) return '확인 못 함'
  return count === 0 ? '없음' : `${count}개`
}
