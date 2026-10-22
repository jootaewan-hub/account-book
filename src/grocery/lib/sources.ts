// 가격 출처 넓히기(P3, D-013) 화면 계산: 넣은 몰 주소의 값(컬리·홈플러스·로우차트)과 참가격 매장 가격의 문구.
// 숫자는 출처 값만 쓰고, 출처와 확인 시각·조사일을 늘 함께 쓴다(CLAUDE.md). 넣은 주소의 값은 "가장 싼 값"에 넣지 않는다(D-013 ⑤).
import { SHOP_LABEL, type ShopSource, type ShopUrlReason } from '../../../supabase/functions/_shared/shops'
import { koDay, koFullDay } from './alerts'
import { won } from './format'
import { checkedText } from './products'

export type { ShopLink, ShopSource } from '../../../supabase/functions/_shared/shops'

/** grocery.shop_prices() 한 줄: 넣은 주소와 마지막 확인 상태, 마지막 성공 값 */
export type ShopPrice = {
  source: ShopSource
  sourceId: string
  url: string
  addedAt: string
  /** 마지막 확인(실패 포함). 한 번도 안 읽었으면 null */
  checkedAt: string | null
  ok: boolean | null
  error: string | null
  /** 마지막 성공한 확인과 그 값 */
  pricedAt: string | null
  name: string | null
  price: number | null
  imageUrl: string | null
  rating: number | null
  reviewCount: number | null
  size: string | null
  /** 로우차트: 현재가가 적용된 날(YYYY-MM-DD) */
  priceFrom: string | null
  obsLow: number | null
  obsHigh: number | null
  obsAvg: number | null
  changedOn: string | null
}

export type StoreGood = { goodId: string; name: string; detail: string | null }
export type StoreOption = { entpId: string; name: string; typeCode: string }
/** grocery.item_store_prices() 한 줄: 매장마다 마지막 조사값(없으면 null) */
export type StorePrice = {
  goodId: string
  goodName: string
  entpId: string
  entpName: string
  typeCode: string
  inspectedOn: string | null
  price: number | null
  dc: boolean
  plusOne: boolean
}
export type StoreSection = { good: { goodId: string; name: string } | null; prices: StorePrice[] }
export type { FoundShop } from '../../../supabase/functions/_shared/shopFind'
import type { FoundShop } from '../../../supabase/functions/_shared/shopFind'

/** 몰 주소 자동 찾기 결과(grocery.shop_finds, D-024). 찾은 적 없으면 null */
export type ShopFind = { status: 'searching' | 'done' | 'failed'; searchedAt: string; error: string | null; candidates: FoundShop[] }

export type ItemSources = { shops: ShopPrice[]; store: StoreSection; find: ShopFind | null }

/** 자동 찾기 상태 줄. 보여 줄 것이 없으면 null. "AI"라는 말 없이 하는 일 그대로 쓴다(CLAUDE.md) */
export function findStateText(find: ShopFind | null, linked: number): string | null {
  if (!find) return null
  if (find.status === 'searching') return '컬리·홈플러스·쿠팡에서 같은 상품 찾는 중'
  if (find.status === 'failed') {
    if (find.error === 'search_disabled') return '몰 찾기를 쓸 수 없어요(검색 설정이 꺼져 있어요). 주소를 직접 넣어 주세요.'
    return '몰에서 상품을 찾지 못했어요. 주소를 직접 넣을 수 있어요.'
  }
  if (find.candidates.length === 0 && linked === 0) return '컬리·홈플러스·쿠팡에서 이름·용량이 같은 상품을 찾지 못했어요. 주소를 직접 넣을 수 있어요.'
  return null
}

/** 후보 줄의 출처·시각: "컬리 페이지, 오늘 10:05 확인" */
export function candidateSourceText(c: FoundShop, now: Date = new Date()): string {
  return `${SHOP_LABEL[c.source]} 페이지, ${checkedText(c.checkedAt, now)} 확인`
}

export const NOTE_NOT_BEST = '넣은 주소의 값은 같은 상품인지 확인되지 않아 가장 싼 값에는 넣지 않아요.'

/** 줄 위 상태 문구. 값을 잘 읽었으면 null */
export function shopStateText(p: ShopPrice, now: Date = new Date()): string | null {
  if (p.ok === null) return '아직 확인 전'
  if (p.ok) return null
  const kept = p.pricedAt ? ` ${checkedText(p.pricedAt, now)}에 확인한 값을 보여 드려요.` : ''
  return `${SHOP_LABEL[p.source]} 가격을 지금 불러오지 못했어요.${kept}`
}

export function shopPriceText(p: ShopPrice): string {
  return p.price !== null ? won(p.price) : '확인 못 함'
}

/** 출처와 확인 시각. 로우차트는 현재가 적용 시작일도 */
export function shopSourceText(p: ShopPrice, now: Date = new Date()): string {
  const parts = [SHOP_LABEL[p.source]]
  if (p.pricedAt) parts.push(checkedText(p.pricedAt, now))
  if (p.source === 'lowchart' && p.priceFrom) parts.push(`${koDay(p.priceFrom)}부터 이 값`)
  return parts.join(', ')
}

/** 로우차트 관측값(쿠팡 가격 추적). 다른 출처는 null */
export function observedText(p: ShopPrice): string | null {
  if (p.source !== 'lowchart' || (p.obsLow === null && p.obsHigh === null && p.obsAvg === null)) return null
  const v = (n: number | null) => (n !== null ? won(n) : '확인 못 함')
  const parts = [`최저 ${v(p.obsLow)}`, `최고 ${v(p.obsHigh)}`, `평균 ${v(p.obsAvg)}`]
  if (p.changedOn) parts.push(`최근 변동 ${koDay(p.changedOn)}`)
  return `로우차트 관측: ${parts.join(', ')}`
}

export function urlRejectText(reason: ShopUrlReason): string {
  switch (reason) {
    case 'not_url':
      return '상품 페이지 주소를 붙여 넣어 주세요.'
    case 'unsupported':
      return '컬리·홈플러스·쿠팡 상품 페이지 주소만 넣을 수 있어요(쿠팡은 로우차트 관측값으로 보여요).'
    case 'short_link':
      return '쿠팡 짧은 주소(link.coupang.com)에는 상품 번호가 없어요. 상품 페이지의 주소를 넣어 주세요.'
    case 'item_id_missing':
      return '쿠팡 주소에 itemId가 없어요. 상품 페이지에서 옵션을 고른 뒤 주소를 복사해 주세요.'
  }
}

const STORE_TYPES: Record<string, string> = { LM: '대형마트', SM: '슈퍼마켓', DP: '백화점', CS: '편의점', MF: '제조사' }
export function storeTypeName(code: string): string {
  return STORE_TYPES[code] ?? code
}

export function storeRowText(p: StorePrice): string {
  if (p.price === null) return '확인 못 함'
  return [won(p.price), p.dc ? '할인' : '', p.plusOne ? '1+1' : ''].filter(Boolean).join(', ')
}

export function storeSourceText(p: StorePrice): string {
  return p.inspectedOn ? `참가격, ${koFullDay(p.inspectedOn)} 조사` : '참가격, 최근 조사값 없음'
}

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, '')
const MAX_GOODS = 50

/** 참가격 상품 찾기: 검색어의 단어를 모두 담은(띄어쓰기 무시) 이름·상세만, 50개까지 */
export function filterGoods(goods: StoreGood[], query: string): StoreGood[] {
  const words = query.split(/\s+/).map(squash).filter(Boolean)
  const out = words.length === 0 ? goods : goods.filter((g) => {
    const hay = squash(`${g.name} ${g.detail ?? ''}`)
    return words.every((w) => hay.includes(w))
  })
  return out.slice(0, MAX_GOODS)
}
