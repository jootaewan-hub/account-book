// Edge Function 진입점: 고른 상품의 다나와 가격 확인과 가구가 넣은 몰 주소(컬리·홈플러스·로우차트) 확인.
// 권한 확인은 사용자 권한(RLS), 저장은 서비스 롤로 한다.
import { admin, cors, fetchHtml, userClient, withCors } from '../_shared/edge.ts'
import { shopUrl, type ShopLink, type ShopSource } from '../_shared/shops.ts'
import { handle } from './handle.ts'

const g = () => admin.schema('grocery')
const kstToday = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  const user = userClient(req).schema('grocery')
  const res = await handle(req, {
    allowed: async (productId) => {
      const { data, error } = await user.from('items').select('id').eq('product_id', productId).limit(1)
      if (error) throw error
      return (data ?? []).length > 0
    },
    product: async (id) => {
      const { data, error } = await g().from('products').select('id, source_id').eq('id', id).maybeSingle()
      if (error) throw error
      return data ? { id: data.id, sourceId: data.source_id } : null
    },
    todayOk: async (id) => {
      const { data, error } = await g().from('price_checks').select('id').eq('product_id', id).eq('ok', true)
        .eq('checked_on', kstToday()).limit(1)
      if (error) throw error
      return (data ?? []).length > 0
    },
    fetchHtml,
    save: async (id, p, at) => {
      // 평점을 못 읽었으면 이전 평점과 그 시각을 그대로 둔다
      // 제조사·상표·원산지·원재료명(D-026, 식약처 품목 맞춤의 업체 조건)은 읽은 값만 새로 쓴다(페이지 모양이 바뀌어 못 읽은 칸이 있던 값을 지우지 않게)
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
    now: () => new Date(),
    shopLinks: async (id) => {
      const { data, error } = await g().from('shop_links').select('source, source_id').eq('product_id', id).order('source')
      if (error) throw error
      const seen = new Set<string>() // 두 가구가 같은 주소를 넣었으면 한 번만 읽는다
      const links: ShopLink[] = []
      for (const r of (data ?? []) as { source: string; source_id: string }[]) {
        const url = shopUrl(r.source as ShopSource, r.source_id) // 저장된 url 대신 출처·id로 다시 만든다(DB check와 같은 규칙)
        if (!url || seen.has(`${r.source}|${r.source_id}`)) continue
        seen.add(`${r.source}|${r.source_id}`)
        links.push({ source: r.source as ShopSource, sourceId: r.source_id, url })
      }
      return links
    },
    shopTodayOk: async (source, sourceId) => {
      const { data, error } = await g().from('shop_checks').select('id').eq('source', source).eq('source_id', sourceId).eq('ok', true)
        .eq('checked_on', kstToday()).limit(1)
      if (error) throw error
      return (data ?? []).length > 0
    },
    saveShop: async (link, p, at) => {
      const { error } = await g().from('shop_checks').insert({
        source: link.source, source_id: link.sourceId, checked_at: at, ok: true,
        name: p.name.slice(0, 200), price: p.price, image_url: p.imageUrl, rating: p.rating, review_count: p.reviewCount,
        size: p.size?.slice(0, 40) ?? null, price_from: p.priceFrom,
        obs_low: p.observed?.low ?? null, obs_high: p.observed?.high ?? null, obs_avg: p.observed?.avg ?? null, changed_on: p.observed?.changedOn ?? null,
      })
      if (error) throw error
    },
    failShop: async (link, err, at) => {
      const { error } = await g().from('shop_checks').insert({ source: link.source, source_id: link.sourceId, checked_at: at, ok: false, error: err })
      if (error) console.error('shop_checks 기록 실패', error.message)
    },
  }).catch((e) => {
    console.error('product-check 실패', e instanceof Error ? e.message : String(e))
    return new Response(JSON.stringify({ status: 'error' }), { status: 500, headers: { 'content-type': 'application/json' } })
  })
  return withCors(res)
})
