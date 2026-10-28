// 다나와 상품 페이지 확인 결과를 grocery.products·price_checks·price_quotes에 쓰는 코드(서비스 롤).
// product-check(index.ts)의 save·fail과 같은 규칙이다. explore-price(D-035)가 쓰고, product-check·price-recheck도 옮겨 올 수 있다.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3'
import type { PriceCheckDeps } from './priceCheck.ts'

export function danawaStore(admin: SupabaseClient): Pick<PriceCheckDeps, 'save' | 'fail'> {
  const g = () => admin.schema('grocery')
  return {
    save: async (id, p, at) => {
      // 평점을 못 읽었으면 이전 평점과 그 시각을 그대로 둔다. 제조사·상표 등(D-026)은 읽은 값만 새로 쓴다
      const facts = { ...Object.fromEntries(Object.entries(p.facts).filter(([, v]) => v !== null)), facts_at: at }
      const patch = p.rating === null ? { ...facts, updated_at: at } : { ...facts, rating: p.rating, review_count: p.reviewCount, rated_at: at, updated_at: at }
      const up = await g().from('products').update(patch).eq('id', id)
      if (up.error) throw up.error
      const { data: check, error } = await g().from('price_checks')
        .insert({ product_id: id, source: 'danawa', checked_at: at, ok: true, page_qty: p.pageQty })
        .select('id').single()
      if (error) throw error
      const rows = [
        ...p.variants.map((v) => ({
          check_id: check.id, product_id: id, qty: v.qty, seller: null, price: v.price, delivery: null,
          unit_price: v.unitPrice, unit_label: v.unitLabel, mall_count: v.mallCount,
        })),
        ...(p.pageQty === null ? [] : p.offers.map((o) => ({
          check_id: check.id, product_id: id, qty: p.pageQty, seller: o.seller, price: o.price, delivery: o.delivery,
          unit_price: null, unit_label: null, mall_count: null,
        }))),
      ]
      const ins = await g().from('price_quotes').insert(rows)
      if (ins.error) {
        // 줄 없는 성공 기록이 남아 오늘 캐시로 쓰이지 않게 방금 넣은 확인을 지운다
        await g().from('price_checks').delete().eq('id', check.id)
        throw ins.error
      }
    },
    fail: async (id, err, at) => {
      const { error } = await g().from('price_checks').insert({ product_id: id, source: 'danawa', checked_at: at, ok: false, error: err })
      if (error) console.error('price_checks 기록 실패', error.message)
    },
  }
}
