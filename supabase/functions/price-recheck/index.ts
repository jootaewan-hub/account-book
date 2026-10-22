// Edge Function 진입점(서비스 롤). 호출 비밀번호는 없다: handle()이 20시간에 한 번만 실제로 받고, grocery.sync_lock(id 4)을 얻지 못하면 429.
// 저장 코드는 product-check와 같은 표(price_checks·price_quotes·shop_checks)에 쓴다.
import { createClient } from 'npm:@supabase/supabase-js@2.117.3'
import { fetchHtml } from '../_shared/edge.ts'
import { shopUrl, type ShopLink, type ShopSource } from '../_shared/shops.ts'
import { handle } from './handle.ts'

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const g = () => admin.schema('grocery')
const kstToday = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)

Deno.serve((req) =>
  handle(req, {
    now: () => new Date(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    recentOk: async (since) => {
      const { data, error } = await g().from('sync_runs').select('id').eq('source', 'recheck').eq('ok', true).gte('ran_at', since).limit(1)
      if (error) throw new Error(`sync_runs 읽기 실패: ${error.message}`)
      return (data ?? []).length > 0
    },
    acquire: async (cutoff, at) => {
      const { data, error } = await g().from('sync_lock').update({ locked_at: at }).eq('id', 4).lt('locked_at', cutoff).select('id')
      if (error) throw new Error(`sync_lock 실패: ${error.message}`)
      return (data ?? []).length === 1
    },
    products: async () => {
      // 안 산 품목이 고른 상품(가구 상관없이). 같은 상품은 하나.
      const { data, error } = await g().from('items').select('products!items_product_id_fkey(id, source_id)').is('bought_at', null).not('product_id', 'is', null)
      if (error) throw new Error(`items 읽기 실패: ${error.message}`)
      const seen = new Map<string, { id: string; sourceId: string }>()
      for (const r of (data ?? []) as unknown as { products: { id: string; source_id: string } | null }[]) {
        if (r.products && !seen.has(r.products.id)) seen.set(r.products.id, { id: r.products.id, sourceId: r.products.source_id })
      }
      // 최근 30일의 마지막 성공 확인 시각(handle이 오래된 순으로 본다). 30일 넘게 못 본 상품은 null로 맨 앞
      const ids = [...seen.keys()]
      const lastOk = new Map<string, string>()
      if (ids.length > 0) {
        const since = new Date(Date.now() - 30 * 86400_000).toISOString()
        const { data: checks, error: e2 } = await g().from('price_checks').select('product_id, checked_at')
          .eq('source', 'danawa').eq('ok', true).in('product_id', ids).gte('checked_at', since).order('checked_at', { ascending: false })
        if (e2) throw new Error(`price_checks 읽기 실패: ${e2.message}`)
        for (const c of (checks ?? []) as { product_id: string; checked_at: string }[]) if (!lastOk.has(c.product_id)) lastOk.set(c.product_id, c.checked_at)
      }
      return [...seen.values()].map((p) => ({ ...p, lastOk: lastOk.get(p.id) ?? null }))
    },
    todayOk: async (id) => {
      const { data, error } = await g().from('price_checks').select('id').eq('product_id', id).eq('ok', true).eq('checked_on', kstToday()).limit(1)
      if (error) throw error
      return (data ?? []).length > 0
    },
    fetchHtml,
    save: async (id, p, at) => {
      const patch = p.rating === null ? { updated_at: at } : { rating: p.rating, review_count: p.reviewCount, rated_at: at, updated_at: at }
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
        await g().from('price_checks').delete().eq('id', check.id)
        throw ins.error
      }
    },
    fail: async (id, err, at) => {
      const { error } = await g().from('price_checks').insert({ product_id: id, source: 'danawa', checked_at: at, ok: false, error: err })
      if (error) console.error('price_checks 기록 실패', error.message)
    },
    shopLinks: async (id) => {
      const { data, error } = await g().from('shop_links').select('source, source_id').eq('product_id', id).order('source')
      if (error) throw error
      const seen = new Set<string>()
      const links: ShopLink[] = []
      for (const r of (data ?? []) as { source: string; source_id: string }[]) {
        const url = shopUrl(r.source as ShopSource, r.source_id)
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
    log: (e) => console.log('price-recheck', JSON.stringify(e)),
    recordRun: async (run) => {
      const { error } = await g().from('sync_runs').insert(run)
      if (error) console.error('sync_runs 기록 실패', error.message)
    },
  }),
)
