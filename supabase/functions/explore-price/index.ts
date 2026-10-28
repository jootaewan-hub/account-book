// Edge Function 진입점: 알아보기 탭 가격 비교(D-035). 로그인한 사용자만 부른다(verify_jwt, config.toml).
// 검색 캐시·상품·가격 확인은 서비스 롤로 grocery 스키마에 쓴다(가구 데이터는 읽거나 쓰지 않는다).
import { admin, cors, fetchHtml, isSignedIn, withCors } from '../_shared/edge.ts'
import { danawaStore } from '../_shared/priceStore.ts'
import { handle, itemsWithPcode, type ExploreItem, type Quote, type ShopItem, type ShopSource } from './handle.ts'

const g = () => admin.schema('grocery')
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'
const BOT_UA = 'account-book-explore/1.0 (+https://github.com/jootaewan-hub/account-book)'
const OLD_SHOPS = new Set<ShopSource>(['kurly', 'daiso'])
const GAP_MS: Record<ShopSource, number> = { kurly: 1_000, daiso: 2_000, ohou: 2_000, bunjang: 1_000, daangn: 2_000 }
const COLS = 'id, source_id, name, rating, review_count, rated_at'
type Row = { id: string; source_id: string; name: string; rating: number | string | null; review_count: number | null; rated_at: string | null }
const productRow = (r: Row) => ({ id: r.id, sourceId: r.source_id, name: r.name, rating: r.rating === null ? null : Number(r.rating), reviewCount: r.review_count, ratedAt: r.rated_at })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  try {
    const res = await handle(req, {
      signedIn: () => isSignedIn(req),
      ...danawaStore(admin),
      fetchHtml,
      cached: async (key, day) => {
        const { data, error } = await g().from('explore_searches').select('items, found_at').eq('query_key', key).eq('searched_on', day).maybeSingle()
        if (error) throw error
        return data ? { items: data.items as ExploreItem[], foundAt: data.found_at } : null
      },
      reserve: async (maxWaitMs) => {
        const { data, error } = await g().rpc('reserve_fetch', { p_key: 'danawa-search', p_gap_ms: 10_000, p_max_wait_ms: maxWaitMs })
        if (error) throw error
        return Number(data)
      },
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      saveSearch: async (key, day, query, items, foundAt) => {
        const { error } = await g().from('explore_searches')
          .upsert({ query_key: key, searched_on: day, query, items, found_at: foundAt }, { onConflict: 'query_key,searched_on' })
        if (error) throw error
        const old = new Date(Date.parse(`${day}T00:00:00+09:00`) - 30 * 86_400_000).toISOString().slice(0, 10)
        await g().from('explore_searches').delete().lt('searched_on', old)
      },
      product: async (pcode) => {
        const { data, error } = await g().from('products').select(COLS).eq('source', 'danawa').eq('source_id', pcode).maybeSingle()
        if (error) throw error
        return data ? productRow(data) : null
      },
      searchedName: async (pcode) => {
        const { data, error } = await g().from('explore_searches').select('items').filter('items', 'cs', itemsWithPcode(pcode))
          .order('found_at', { ascending: false }).limit(1).maybeSingle()
        if (error) throw error
        const hit = ((data?.items ?? []) as ExploreItem[]).find((i) => i.pcode === pcode)
        return hit?.name ?? null
      },
      insertProduct: async (pcode, name) => {
        const ins = await g().from('products').upsert({ source: 'danawa', source_id: pcode, name }, { onConflict: 'source,source_id', ignoreDuplicates: true })
        if (ins.error) throw ins.error
        const { data, error } = await g().from('products').select(COLS).eq('source', 'danawa').eq('source_id', pcode).single()
        if (error) throw error
        return productRow(data)
      },
      todayOk: async (id, day) => {
        const { data, error } = await g().from('price_checks').select('id').eq('product_id', id).eq('ok', true).eq('checked_on', day).limit(1)
        if (error) throw error
        return (data ?? []).length > 0
      },
      latest: async (id) => {
        const { data: check, error } = await g().from('price_checks').select('id, checked_at, page_qty').eq('product_id', id).eq('ok', true)
          .order('checked_at', { ascending: false }).limit(1).maybeSingle()
        if (error) throw error
        if (!check) return null
        const q = await g().from('price_quotes').select('qty, seller, price, delivery, unit_price, unit_label, mall_count').eq('check_id', check.id)
        if (q.error) throw q.error
        const quotes: Quote[] = (q.data ?? []).map((r) => ({
          qty: r.qty, seller: r.seller, price: r.price, delivery: r.delivery, unitPrice: r.unit_price, unitLabel: r.unit_label, mallCount: r.mall_count,
        }))
        return { checkedAt: check.checked_at, pageQty: check.page_qty, quotes }
      },
      // 컬리·다이소는 explore_shop_searches(D-036 첫판), 오늘의집·번개장터·당근은 explore_finds(범위 = 당근 동네)
      cachedShop: async (source, scope, key, day) => {
        const q = OLD_SHOPS.has(source)
          ? g().from('explore_shop_searches').select('items, found_at').eq('source', source)
          : g().from('explore_finds').select('items, found_at, region').eq('source', source).eq('scope', scope)
        const { data, error } = await q.eq('query_key', key).eq('searched_on', day).maybeSingle()
        if (error) throw error
        if (!data) return null
        const row = data as { items: ShopItem[]; found_at: string; region?: string | null }
        return { items: row.items, foundAt: row.found_at, ...(row.region ? { region: row.region } : {}) }
      },
      // 출처마다 전역 간격(D-036). 자리 줄은 마이그레이션이 넣었다(없으면 -1 = 바쁨)
      reserveShop: async (source, maxWaitMs) => {
        const { data, error } = await g().rpc('reserve_fetch', { p_key: `${source}-search`, p_gap_ms: GAP_MS[source], p_max_wait_ms: maxWaitMs })
        if (error) throw error
        return Number(data)
      },
      fetchText: async (url) => {
        // 오늘의집(Akamai)은 이름 없는 브라우저 흉내를 403으로 막고, 자기를 밝힌 봇 이름은 받는다(k-skill ohou-today-deal 원본 설명)
        const ohou = new URL(url).hostname === 'ohou.se'
        const r = await fetch(url, {
          headers: { 'user-agent': ohou ? BOT_UA : UA, accept: ohou ? 'text/html' : 'application/json, text/html;q=0.9, */*;q=0.8', 'accept-language': 'ko-KR,ko;q=0.9' },
          redirect: 'follow',
          signal: AbortSignal.timeout(20_000),
        })
        return { status: r.status, text: await r.text() }
      },
      saveShop: async (source, scope, key, day, query, items, foundAt, region) => {
        const old = new Date(Date.parse(`${day}T00:00:00+09:00`) - 30 * 86_400_000).toISOString().slice(0, 10)
        if (OLD_SHOPS.has(source)) {
          const { error } = await g().from('explore_shop_searches')
            .upsert({ source, query_key: key, searched_on: day, query, items, found_at: foundAt }, { onConflict: 'source,query_key,searched_on' })
          if (error) throw error
          await g().from('explore_shop_searches').delete().lt('searched_on', old)
          return
        }
        const { error } = await g().from('explore_finds')
          .upsert({ source, scope, query_key: key, searched_on: day, query, items, found_at: foundAt, region: region ?? null }, { onConflict: 'source,scope,query_key,searched_on' })
        if (error) throw error
        await g().from('explore_finds').delete().lt('searched_on', old)
      },
      now: () => new Date(),
    })
    return withCors(res)
  } catch (e) {
    console.error('explore-price 실패', e instanceof Error ? e.message : 'unknown')
    return withCors(new Response(JSON.stringify({ status: 'error' }), { status: 500, headers: { 'content-type': 'application/json; charset=utf-8' } }))
  }
})
