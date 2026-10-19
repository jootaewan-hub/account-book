import type { SupabaseClient } from '@supabase/supabase-js'
import { groupAlerts, SOURCES, type AlertsResult, type ItemAlertRow } from './alerts'
import type { Category } from './categories'
import type { Candidate, ItemDetailData, ItemPrice, ItemSearch, PriceLine, SafetyRecord, SearchResult } from './products'
import { kstDay } from './products'
import { SEONGNAM_AREAS } from '../../../supabase/functions/_shared/tprice'
import type { ItemSources, ShopPrice, StoreGood, StoreOption, StorePrice } from './sources'
import type { OurPurchase } from './ours'
import { invokePhoto } from './photo'
import type { ListStore , BarcodeRecord } from './store'
import type { Membership } from './membership'
import type { Item } from './types'

type Row = {
  id: string
  household_id: string
  name: string
  spec: string | null
  count: number
  category: string
  product_key: string | null
  product_id?: string | null
  product_qty?: number | null
  added_by: string | null
  added_at: string
  bought_by: string | null
  bought_at: string | null
  paid: number | null
  transaction_id?: string | null
}

export function rowToItem(r: Row): Item {
  return {
    id: r.id,
    householdId: r.household_id,
    name: r.name,
    spec: r.spec,
    count: r.count,
    category: r.category as Category,
    productKey: r.product_id ?? null,
    productQty: r.product_qty ?? null,
    addedBy: r.added_by,
    addedAt: r.added_at,
    boughtBy: r.bought_by,
    boughtAt: r.bought_at,
    paid: r.paid == null ? null : Number(r.paid), // bigint는 문자열로 올 수 있다
    transactionId: r.transaction_id ?? null,
  }
}

// grocery.items 저장소. 서버 오류는 던진다(호출하는 쪽이 오류 상태를 보여 준다).
export function createSupabaseStore(client: SupabaseClient, me: Membership): ListStore {
  const g = () => client.schema('grocery')
  const table = () => g().from('items')
  let goodsCache: StoreGood[] | null = null // 참가격 상품 목록(약 600개)은 한 번만 읽는다

  return {
    async list() {
      const { data, error } = await table()
        .select('*')
        .eq('household_id', me.householdId)
        .order('added_at', { ascending: true })
      if (error) throw error
      return ((data ?? []) as Row[]).map(rowToItem)
    },
    async add(items) {
      if (items.length === 0) return []
      // added_by는 보내지 않는다: DB 기본값(auth.uid())이 채우고 RLS가 확인한다.
      const rows = items.map((p) => ({
        household_id: me.householdId,
        name: p.name,
        spec: p.spec,
        count: p.count,
        category: p.category,
      }))
      const { data, error } = await table().insert(rows).select('*')
      if (error) throw error
      return ((data ?? []) as Row[]).map(rowToItem)
    },
    async setBought(id, bought) {
      const patch = bought
        ? { bought_by: me.userId, bought_at: new Date().toISOString() }
        : { bought_by: null, bought_at: null, paid: null }
      const { error } = await table().update(patch).eq('id', id).eq('household_id', me.householdId)
      if (error) throw error
    },
    async remove(id) {
      const { error } = await table().delete().eq('id', id).eq('household_id', me.householdId)
      if (error) throw error
    },
    async recordPurchase(entries) {
      const { data, error } = await g().rpc('record_purchase', { p_household_id: me.householdId, p_entries: entries })
      if (error) throw error
      return (data ?? []) as string[]
    },
    subscribe(onChange) {
      // 구독마다 고유한 이름: StrictMode의 재마운트에서 아직 지워지지 않은 채널과 겹치지 않게 한다.
      const channel = client
        .channel(`grocery-items-${me.householdId}-${crypto.randomUUID()}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'grocery', table: 'items', filter: `household_id=eq.${me.householdId}` },
          () => onChange(),
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'grocery', table: 'items', filter: `household_id=eq.${me.householdId}` },
          () => onChange(),
        )
        // DELETE는 열 값으로 거를 수 없어 필터가 없다. 알림만 받고 list()가 가구로 좁혀 다시 읽는다.
        .on('postgres_changes', { event: 'DELETE', schema: 'grocery', table: 'items' }, () => onChange())
        .subscribe()
      return () => {
        void client.removeChannel(channel)
      }
    },
    async alerts(): Promise<AlertsResult> {
      const [matches, syncedAt] = await Promise.all([g().rpc('item_alerts'), lastSynced()])
      if (matches.error) throw matches.error
      return { ...groupAlerts((matches.data ?? []) as ItemAlertRow[]), syncedAt }
    },
    async extras() {
      const [searches, prices, chosen] = await Promise.all([
        g().from('item_searches').select('item_id, status, candidate_count, updated_at'),
        g().rpc('item_prices'),
        // items → products 관계는 product_id FK와 item_candidates(연결 표) 두 갈래라 FK 이름을 지정한다
        g().from('items').select('id, products!items_product_id_fkey(name)').eq('household_id', me.householdId).not('product_id', 'is', null),
      ])
      if (searches.error) throw searches.error
      if (prices.error) throw prices.error
      if (chosen.error) throw chosen.error
      const s = new Map<string, ItemSearch>()
      for (const r of (searches.data ?? []) as SearchRow[]) {
        s.set(r.item_id, { status: r.status, candidateCount: r.candidate_count ?? 0, updatedAt: r.updated_at })
      }
      const p = new Map<string, ItemPrice>()
      for (const r of (prices.data ?? []) as PriceRow[]) {
        p.set(r.item_id, { price: r.price, seller: r.seller, source: r.source === 'capture' ? 'capture' : 'danawa', qty: r.qty, delivery: r.delivery, checkedAt: r.checked_at })
      }
      const names = new Map<string, string>()
      for (const r of (chosen.data ?? []) as unknown as { id: string; products: { name: string } | null }[]) {
        if (r.products?.name) names.set(r.id, r.products.name)
      }
      return { searches: s, prices: p, productNames: names }
    },
    async candidates(itemId) {
      const { data, error } = await g()
        .from('item_candidates')
        .select('qty, price, unit_price, unit_label, mall_count, rank, found_at, products(id, name, image_url, rating)')
        .eq('item_id', itemId)
        .order('rank', { ascending: true })
        .order('qty', { ascending: true })
      if (error) throw error
      const byProduct = new Map<string, Candidate>()
      for (const r of (data ?? []) as unknown as CandidateRow[]) {
        if (!r.products) continue
        const c = byProduct.get(r.products.id) ?? {
          productId: r.products.id,
          name: r.products.name,
          imageUrl: r.products.image_url,
          rating: r.products.rating == null ? null : Number(r.products.rating),
          variants: [],
          foundAt: r.found_at,
        }
        c.variants.push({ qty: r.qty, price: r.price, unitPrice: r.unit_price, unitLabel: r.unit_label, mallCount: r.mall_count })
        byProduct.set(r.products.id, c)
      }
      return [...byProduct.values()]
    },
    async findCandidates(itemId, query) {
      const { data, error } = await client.functions.invoke('product-search', { body: query ? { itemId, query } : { itemId } })
      if (error) throw error
      return ((data as { status?: SearchResult } | null)?.status ?? 'done') as SearchResult
    },
    async choose(itemId, productId, qty) {
      const { error } = await g().rpc('choose_product', { p_item: itemId, p_product: productId, p_qty: qty })
      if (error) throw error
    },
    async checkPrice(itemId) {
      const { data, error } = await table().select('product_id').eq('id', itemId).maybeSingle()
      if (error) throw error
      if (!data?.product_id) return
      const res = await client.functions.invoke('product-check', { body: { productId: data.product_id } })
      if (res.error) throw res.error
    },
    async sources(itemId): Promise<ItemSources> {
      const it = await table().select('product_id').eq('id', itemId).maybeSingle()
      if (it.error) throw it.error
      const productId = (it.data?.product_id ?? null) as string | null
      const [shops, link, prices] = await Promise.all([
        productId ? g().rpc('shop_prices', { p_product: productId }) : Promise.resolve({ data: [], error: null }),
        g().rpc('item_store_link', { p_item: itemId }),
        g().rpc('item_store_prices', { p_item: itemId }),
      ])
      if (shops.error) throw shops.error
      if (link.error) throw link.error
      if (prices.error) throw prices.error
      const good = ((link.data ?? []) as { good_id: string; good_name: string }[])[0]
      return {
        shops: ((shops.data ?? []) as ShopRow[]).map(
          (r): ShopPrice => ({
            source: r.source as ShopPrice['source'], sourceId: r.source_id, url: r.url, addedAt: r.added_at,
            checkedAt: r.checked_at, ok: r.ok, error: r.error, pricedAt: r.priced_at, name: r.name, price: r.price, imageUrl: r.image_url,
            rating: r.rating == null ? null : Number(r.rating), reviewCount: r.review_count, size: r.size, priceFrom: r.price_from,
            obsLow: r.obs_low, obsHigh: r.obs_high, obsAvg: r.obs_avg, changedOn: r.changed_on,
          }),
        ),
        store: {
          good: good ? { goodId: good.good_id, name: good.good_name } : null,
          prices: ((prices.data ?? []) as StoreRow[]).map(
            (r): StorePrice => ({
              goodId: r.good_id, goodName: r.good_name, entpId: r.entp_id, entpName: r.entp_name, typeCode: r.type_code,
              inspectedOn: r.inspected_on, price: r.price, dc: r.dc ?? false, plusOne: r.plus_one ?? false,
            }),
          ),
        },
      }
    },
    async addShopLink(itemId, link) {
      const it = await table().select('product_id').eq('id', itemId).maybeSingle()
      if (it.error) throw it.error
      if (!it.data?.product_id) throw new Error('no_product')
      const { error } = await g().from('shop_links').upsert(
        { household_id: me.householdId, product_id: it.data.product_id, source: link.source, source_id: link.sourceId, url: link.url, added_by: me.userId, added_at: new Date().toISOString() },
        { onConflict: 'household_id,product_id,source' },
      )
      if (error) throw error
    },
    async removeShopLink(itemId, source) {
      const it = await table().select('product_id').eq('id', itemId).maybeSingle()
      if (it.error) throw it.error
      if (!it.data?.product_id) return
      const { error } = await g().from('shop_links').delete().eq('household_id', me.householdId).eq('product_id', it.data.product_id).eq('source', source)
      if (error) throw error
    },
    async storeGoods() {
      if (!goodsCache) {
        const { data, error } = await g().from('tprice_goods').select('good_id, name, detail').order('name').limit(2000)
        if (error) throw error
        goodsCache = ((data ?? []) as { good_id: string; name: string; detail: string | null }[]).map((r): StoreGood => ({ goodId: r.good_id, name: r.name, detail: r.detail }))
      }
      return goodsCache
    },
    async chooseStoreGood(itemId, goodId) {
      const { error } = await g().rpc('choose_store_good', { p_item: itemId, p_good: goodId })
      if (error) throw error
    },
    async storeOptions() {
      const [stores, prefs] = await Promise.all([
        g().from('tprice_stores').select('entp_id, name, type_code').in('area_detail_code', [...SEONGNAM_AREAS]).order('name'),
        g().from('household_prefs').select('store_ids').eq('household_id', me.householdId).maybeSingle(),
      ])
      if (stores.error) throw stores.error
      if (prefs.error) throw prefs.error
      return {
        stores: ((stores.data ?? []) as { entp_id: string; name: string; type_code: string }[]).map((r): StoreOption => ({ entpId: r.entp_id, name: r.name, typeCode: r.type_code })),
        chosen: ((prefs.data?.store_ids ?? []) as string[]),
      }
    },
    async setStores(entpIds) {
      const { error } = await g().from('household_prefs').upsert(
        { household_id: me.householdId, store_ids: entpIds, updated_by: me.userId, updated_at: new Date().toISOString() },
        { onConflict: 'household_id' },
      )
      if (error) throw error
    },
    async ourPurchases(itemId) {
      const { data, error } = await g().rpc('our_purchases', { p_item: itemId })
      if (error) throw error
      const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))
      return ((data ?? []) as OurRow[]).map(
        (r): OurPurchase => ({
          kind: r.kind, transactionId: r.transaction_id, transactionItemId: r.transaction_item_id, occurredOn: r.occurred_on,
          platform: r.platform, place: r.place ?? '', createdBy: r.created_by, name: r.name, quantity: num(r.quantity), unitPrice: num(r.unit_price),
          amount: Number(r.amount), packSize: num(r.pack_size), packUnit: r.pack_unit,
        }),
      )
    },
    async decidePurchase(itemId, transactionItemId, same) {
      const { error } = await g().rpc('decide_purchase', { p_item: itemId, p_tx_item: transactionItemId, p_same: same })
      if (error) throw error
    },
    readPhoto(job, image) {
      return invokePhoto(client, { job, image })
    },
    async barcodeAlerts(code) {
      const [rows, syncedAt] = await Promise.all([
        g().from('food_alerts').select('source, source_id, product_name, maker, reason, grade, pack_unit, barcode, registered_on').eq('barcode', code).limit(20),
        lastSynced(),
      ])
      if (rows.error) throw rows.error
      return {
        records: ((rows.data ?? []) as BarcodeRow[]).map((r) => ({
          source: r.source as BarcodeRecord['source'], sourceId: r.source_id, productName: r.product_name, maker: r.maker, reason: r.reason,
          grade: r.grade, packUnit: r.pack_unit, registeredOn: r.registered_on, barcode: r.barcode,
        })),
        syncedAt,
      }
    },
    async addCapturedQuote(itemId, q) {
      const it = await table().select('product_id').eq('id', itemId).maybeSingle()
      if (it.error) throw it.error
      if (!it.data?.product_id) throw new Error('no_product')
      const { error } = await g().from('captured_quotes').insert({
        household_id: me.householdId, product_id: it.data.product_id, seller: q.seller, price: q.price, qty: q.qty, delivery: q.delivery, captured_by: me.userId,
      })
      if (error) throw error
    },
    async detail(itemId): Promise<ItemDetailData> {
      const [it, safety, syncedAt] = await Promise.all([
        table().select('product_id').eq('id', itemId).maybeSingle(),
        g().rpc('item_safety', { p_item: itemId }),
        lastSynced(),
      ])
      if (it.error) throw it.error
      if (safety.error) throw safety.error
      const records = ((safety.data ?? []) as SafetyRow[]).map(
        (r): SafetyRecord => ({
          source: r.source as SafetyRecord['source'],
          sourceId: r.source_id,
          productName: r.product_name,
          maker: r.maker,
          reason: r.reason,
          grade: r.grade,
          packUnit: r.pack_unit,
          registeredOn: r.registered_on,
          via: r.via,
          farm: r.farm,
        }),
      )
      const productId = (it.data?.product_id ?? null) as string | null
      if (!productId) return { product: null, check: null, lines: [], safety: records, syncedAt }
      const [prod, checks, caps] = await Promise.all([
        g().from('products').select('id, source_id, name, image_url, rating, review_count, rated_at').eq('id', productId).maybeSingle(),
        g().from('price_checks').select('id, checked_at, ok, error').eq('product_id', productId).order('checked_at', { ascending: false }).limit(10),
        // 오늘(한국 시간) 우리 가구가 캡처한 값(P4)
        g().from('captured_quotes').select('seller, price, qty, delivery, captured_at, captured_by').eq('product_id', productId).eq('household_id', me.householdId)
          .eq('captured_on', kstDay(new Date().toISOString())).order('captured_at', { ascending: false }),
      ])
      if (prod.error) throw prod.error
      if (checks.error) throw checks.error
      if (caps.error) throw caps.error
      const list = (checks.data ?? []) as { id: string; checked_at: string; ok: boolean; error: string | null }[]
      const lastOk = list.find((c) => c.ok)
      let lines: PriceLine[] = []
      if (lastOk) {
        const q = await g().from('price_quotes').select('qty, seller, price, delivery, unit_price, unit_label, mall_count').eq('check_id', lastOk.id)
        if (q.error) throw q.error
        lines = ((q.data ?? []) as QuoteRow[]).map((r) => ({
          price: r.price,
          seller: r.seller,
          source: 'danawa' as const,
          qty: r.qty,
          delivery: r.delivery,
          checkedAt: lastOk.checked_at,
          unitPrice: r.unit_price,
          unitLabel: r.unit_label,
          mallCount: r.mall_count,
        }))
      }
      for (const c of (caps.data ?? []) as { seller: string; price: number; qty: number; delivery: number | null; captured_at: string; captured_by: string | null }[]) {
        lines.push({ price: c.price, seller: c.seller, source: 'capture', qty: c.qty, delivery: c.delivery, checkedAt: c.captured_at, capturedBy: c.captured_by, unitPrice: null, unitLabel: null, mallCount: null })
      }
      const p = prod.data as ProductRow | null
      return {
        product: p
          ? { id: p.id, name: p.name, imageUrl: p.image_url, rating: p.rating == null ? null : Number(p.rating), reviewCount: p.review_count, ratedAt: p.rated_at, pcode: p.source_id }
          : null,
        check: list[0] ? { checkedAt: list[0].checked_at, ok: list[0].ok, error: list[0].error } : null,
        lines,
        safety: records,
        syncedAt,
      }
    },
  }

  // 서비스별 마지막 성공 실행 시각(최신순이라 처음 본 값이 마지막 성공)
  async function lastSynced(): Promise<AlertsResult['syncedAt']> {
    const runs = await g().from('sync_runs').select('source, ran_at').eq('ok', true).in('source', [...SOURCES]).order('ran_at', { ascending: false }).limit(30)
    if (runs.error) throw runs.error
    const syncedAt: AlertsResult['syncedAt'] = {}
    for (const r of (runs.data ?? []) as { source: string; ran_at: string }[]) {
      const s = SOURCES.find((x) => x === r.source)
      if (s && !syncedAt[s]) syncedAt[s] = r.ran_at
    }
    return syncedAt
  }
}

type SearchRow = { item_id: string; status: ItemSearch['status']; candidate_count: number | null; updated_at: string }
type BarcodeRow = { source: string; source_id: string; product_name: string; maker: string | null; reason: string | null; grade: string | null; pack_unit: string | null; barcode: string; registered_on: string | null }
type OurRow = {
  kind: OurPurchase['kind']; transaction_id: string; transaction_item_id: string | null; occurred_on: string; platform: string | null; place: string | null
  created_by: string; name: string; quantity: number | string | null; unit_price: number | string | null; amount: number | string; pack_size: number | string | null; pack_unit: string | null
}
type ShopRow = {
  source: string; source_id: string; url: string; added_at: string; checked_at: string | null; ok: boolean | null; error: string | null
  priced_at: string | null; name: string | null; price: number | null; image_url: string | null; rating: number | string | null; review_count: number | null
  size: string | null; price_from: string | null; obs_low: number | null; obs_high: number | null; obs_avg: number | null; changed_on: string | null
}
type StoreRow = {
  good_id: string; good_name: string; entp_id: string; entp_name: string; type_code: string
  inspected_on: string | null; price: number | null; dc: boolean | null; plus_one: boolean | null
}
type PriceRow = { item_id: string; price: number; seller: string | null; source: string; qty: number; delivery: number | null; checked_at: string }
type CandidateRow = {
  qty: number
  price: number
  unit_price: number | null
  unit_label: string | null
  mall_count: number | null
  found_at: string
  products: { id: string; name: string; image_url: string | null; rating: number | string | null } | null
}
type QuoteRow = { qty: number; seller: string | null; price: number; delivery: number | null; unit_price: number | null; unit_label: string | null; mall_count: number | null }
type ProductRow = { id: string; source_id: string; name: string; image_url: string | null; rating: number | string | null; review_count: number | null; rated_at: string | null }
type SafetyRow = {
  source: string
  source_id: string
  product_name: string
  maker: string | null
  reason: string | null
  grade: string | null
  pack_unit: string | null
  registered_on: string | null
  via: 'item_name' | 'product_name'
  farm: boolean
}
