import type { Item } from './types'
import type { PurchaseEntry } from './purchase'
import type { ParsedItem } from './parse'
import { EMPTY_ALERTS, type AlertsResult, type FoodAlert, type FoodSource } from './alerts'
import {
  kstDay,
  splitLines,
  type Candidate,
  type ItemDetailData,
  type ItemExtras,
  type ItemPrice,
  type ItemSearch,
  type PriceLine,
  type SearchResult,
} from './products'
import type { ItemSources, ShopLink, ShopPrice, ShopSource, StoreGood, StoreOption, StorePrice } from './sources'
import type { OurPurchase } from './ours'
import type { CapturedQuoteInput, ListItem, PhotoImage, PhotoJob, PhotoResult, PriceRead, ProductRead } from './photo'
import type { C002Row, ItemNutrition, NutritionRow, ProductInfoView } from './foodInfo'
import { productQuery } from '../../../supabase/functions/grocery-photo/photo'

export interface ListStore {
  list(): Promise<Item[]>
  /** 만든 품목을 돌려준다(담은 뒤 후보 찾기를 바로 시작하려고) */
  add(items: ParsedItem[]): Promise<Item[]>
  setBought(id: string, bought: boolean): Promise<void>
  remove(id: string): Promise<void>
  subscribe(onChange: () => void): () => void
  /** 내 가구 품목과 비슷한 식약처 기록과 확인 시각 */
  alerts(): Promise<AlertsResult>
  /** 품목별 후보 찾기 상태, 오늘 최저가, 고른 상품명 */
  extras(): Promise<ItemExtras>
  candidates(itemId: string): Promise<Candidate[]>
  /** 품목 후보(다나와 상품)마다 이름이 겹치는 식약처 기록(D-016). 상품 id → 기록 */
  candidateAlerts(itemId: string): Promise<ReadonlyMap<string, CandidateAlert[]>>
  /** 다나와에서 후보를 찾는다(product-search). 결과 종류를 돌려주고, 실패는 던진다 */
  findCandidates(itemId: string, query?: string): Promise<SearchResult>
  choose(itemId: string, productId: string, qty: number): Promise<void>
  /** 고른 상품의 다나와 가격을 확인한다(product-check). 같은 날은 서버가 캐시를 쓴다 */
  checkPrice(itemId: string): Promise<void>
  detail(itemId: string): Promise<ItemDetailData>
  /** 산 품목을 가계부 내역으로 넣고 연결한다(grocery.record_purchase, D-011). 만든 내역 id를 돌려준다 */
  recordPurchase(entries: PurchaseEntry[]): Promise<string[]>
  /** 품목 상세: 고른 상품에 넣은 몰 주소의 값(grocery.shop_prices)과 참가격 연결·매장 가격(item_store_link·item_store_prices). P3 */
  sources(itemId: string): Promise<ItemSources>
  /** 고른 상품에 몰 주소를 넣는다(출처마다 하나, 같은 출처는 바꿈). 상품을 안 고른 품목이면 no_product */
  addShopLink(itemId: string, link: ShopLink): Promise<void>
  removeShopLink(itemId: string, source: ShopSource): Promise<void>
  /** 참가격 조사 상품 전부(약 600개) */
  storeGoods(): Promise<StoreGood[]>
  /** 품목(이름·규격)에 참가격 상품을 고른다. null이면 푼다 */
  chooseStoreGood(itemId: string, goodId: string | null): Promise<void>
  /** 성남 참가격 판매점과 가구가 고른 매장 */
  storeOptions(): Promise<{ stores: StoreOption[]; chosen: string[] }>
  setStores(entpIds: string[]): Promise<void>
  /** 우리가 산 값(P2): 연결된 내역·"맞아요"·이름이 비슷한 가계부 기록(grocery.our_purchases) */
  ourPurchases(itemId: string): Promise<OurPurchase[]>
  /** 비슷한 기록이 같은 상품인지 적는다(grocery.decide_purchase) */
  decidePurchase(itemId: string, transactionItemId: string, same: boolean): Promise<void>
  /** 사진·캡처 읽기(grocery-photo, P4). 실패는 던진다. 읽은 값은 화면에서 확인·고친 뒤에만 쓴다 */
  readPhoto(job: PhotoJob, image: PhotoImage): Promise<PhotoResult>
  /** 캡처에서 확인한 가격을 넣는다(captured_quotes). 상품을 안 고른 품목이면 no_product */
  addCapturedQuote(itemId: string, q: CapturedQuoteInput): Promise<void>
  /** 바코드가 같은 식약처 기록(P6, 화면 설계 8-2 "기록 있음")과 서비스별 확인 시각 */
  barcodeAlerts(code: string): Promise<{ records: BarcodeRecord[]; syncedAt: AlertsResult['syncedAt'] }>
  /** 성분(P7): 고른 상품에 붙인 식약처 품목(원재료·영양성분). 없으면 null */
  productInfo(itemId: string): Promise<ProductInfoView | null>
  /** 식약처 품목 후보 찾기(food-info search) */
  searchFoodInfo(itemId: string): Promise<{ term: string | null; candidates: C002Row[] }>
  /** 사람이 고른 품목을 저장(food-info choose) */
  chooseFoodInfo(itemId: string, reportNo: string): Promise<void>
  /** 영양성분(P9, D-018): 품목 이름·규격에 기억한 식품영양성분DB 식품. 없으면 null */
  itemNutrition(itemId: string): Promise<ItemNutrition | null>
  /** 식품영양성분DB를 이름으로 찾는다(food-info nutrition_search). query가 없으면 품목 이름 */
  searchNutrition(itemId: string, query?: string): Promise<{ term: string | null; candidates: NutritionRow[] }>
  /** 사람이 고른 식품을 저장(food-info nutrition_choose). query는 그 후보를 찾은 검색어 */
  chooseNutrition(itemId: string, query: string, foodCd: string): Promise<void>
  /** 성분 탭을 열 때 품목 이름으로 가장 잘 맞는 식품을 자동으로 맞춰 저장(food-info nutrition_auto). 없으면 null */
  autoNutrition(itemId: string): Promise<ItemNutrition | null>
}

export type BarcodeRecord = FoodAlert & { barcode: string }
/** 후보 상품과 이름이 겹치는 식약처 기록(grocery.candidate_alerts) */
export type CandidateAlert = { source: FoodSource; productName: string; registeredOn: string | null }

/** 개발용 데모 화면에서 쓰는 가격 확인 자료(실제 가격 아님) */
export type DemoPrices = {
  searches: Record<string, ItemSearch>
  candidates: Record<string, Candidate[]>
  /** 품목 id → 상품 id → 식약처 기록(D-016) */
  candidateAlerts?: Record<string, Record<string, CandidateAlert[]>>
  products: Record<string, NonNullable<ItemDetailData['product']>>
  /** 상품 id → 가격 줄 */
  lines: Record<string, PriceLine[]>
  /** 상품 id → 넣은 몰 주소의 값(P3) */
  shops?: Record<string, ShopPrice[]>
  storeGoods?: StoreGood[]
  /** 품목 id → 참가격 상품 id */
  storeLinks?: Record<string, string>
  /** 참가격 상품 id → 매장 줄 */
  storePrices?: Record<string, StorePrice[]>
  stores?: StoreOption[]
  /** 품목 id → 우리가 산 값·비슷한 기록(P2) */
  ours?: Record<string, OurPurchase[]>
  /** 사진·캡처 읽기의 가짜 결과(P4·P6) */
  photo?: { product: ProductRead; price: PriceRead & { qty: number }; list?: ListItem[] }
  /** 바코드 → 식약처 기록(P6) */
  barcodes?: Record<string, BarcodeRecord[]>
  /** 성분(P7): 상품 id → 식약처 품목, 후보 목록 */
  foodInfo?: { info: Record<string, ProductInfoView>; candidates: C002Row[] }
  /** 품목 id → 기억한 식품, 이름 검색 후보(P9) */
  nutrition?: { items: Record<string, ItemNutrition>; candidates: NutritionRow[]; candidatesOther?: NutritionRow[] }
}

const NO_PRICES: DemoPrices = { searches: {}, candidates: {}, products: {}, lines: {} }

// 메모리 구현: 테스트와 개발용 데모 화면에서 쓴다(저장되지 않음).
export function createMemoryStore(
  seed: Item[],
  me: { userId: string; householdId: string },
  now: () => string = () => new Date().toISOString(),
  demoAlerts: AlertsResult = EMPTY_ALERTS,
  demoPrices: DemoPrices = NO_PRICES,
): ListStore {
  let items: Item[] = seed.map((i) => ({ ...i }))
  const listeners = new Set<() => void>()
  const notify = () => listeners.forEach((fn) => fn())
  // P3: 넣은 주소(상품 id마다), 참가격 연결(품목 이름·규격 열쇠마다, DB의 name_key처럼), 고른 매장
  const shops = new Map<string, ShopPrice[]>(Object.entries(demoPrices.shops ?? {}).map(([k, v]) => [k, v.map((x) => ({ ...x }))]))
  const nameKey = (i: Item) => `${i.name}|${i.spec ?? ''}`
  const storeLinks = new Map<string, string>()
  for (const [itemId, goodId] of Object.entries(demoPrices.storeLinks ?? {})) {
    const it = items.find((i) => i.id === itemId)
    if (it) storeLinks.set(nameKey(it), goodId)
  }
  let chosenStores: string[] = []
  const captured = new Map<string, PriceLine[]>() // 상품 id → 캡처한 가격 줄(P4)
  const foodInfo = new Map<string, ProductInfoView>(Object.entries(demoPrices.foodInfo?.info ?? {}))
  const nutrition = new Map<string, ItemNutrition>(Object.entries(demoPrices.nutrition?.items ?? {}))
  // 데모 후보: 검색어에 '파'가 들면 파 식품, 아니면 만두 식품(가짜 값)
  const demoCandidates = (term: string) => (term.includes('파') ? demoPrices.nutrition?.candidates : demoPrices.nutrition?.candidatesOther) ?? demoPrices.nutrition?.candidates ?? []
  const ours = new Map<string, OurPurchase[]>(Object.entries(demoPrices.ours ?? {}).map(([k, v]) => [k, v.map((x) => ({ ...x }))]))

  return {
    async list() {
      return items.map((i) => ({ ...i }))
    },
    async add(parsed) {
      const at = now()
      const added = parsed.map(
        (p): Item => ({
          id: crypto.randomUUID(),
          householdId: me.householdId,
          name: p.name,
          spec: p.spec,
          count: p.count,
          category: p.category,
          productKey: null,
          productQty: null,
          addedBy: me.userId,
          addedAt: at,
          boughtBy: null,
          boughtAt: null,
          paid: null,
          transactionId: null,
        }),
      )
      items = [...items, ...added]
      notify()
      return added.map((i) => ({ ...i }))
    },
    async setBought(id, bought) {
      items = items.map((i) =>
        i.id !== id
          ? i
          : bought
            ? { ...i, boughtBy: me.userId, boughtAt: now() }
            : { ...i, boughtBy: null, boughtAt: null, paid: null },
      )
      notify()
    },
    async remove(id) {
      items = items.filter((i) => i.id !== id)
      notify()
    },
    async recordPurchase(entries) {
      // 메모리 구현: 서버 함수처럼 이미 넣은 품목은 거절하고, 안 산 품목은 산 것으로 바꿔 연결한다
      const ids = entries.map(() => crypto.randomUUID())
      const links = entries.flatMap((e, k) => e.links.map((l) => ({ ...l, tx: ids[k], date: e.tx.occurred_on })))
      if (links.some((l) => items.find((i) => i.id === l.item_id)?.transactionId)) throw new Error('already_linked')
      items = items.map((i) => {
        const l = links.find((x) => x.item_id === i.id)
        if (!l) return i
        return { ...i, transactionId: l.tx, paid: l.paid, boughtBy: i.boughtBy ?? me.userId, boughtAt: i.boughtAt ?? `${l.date}T03:00:00.000Z` }
      })
      notify()
      return ids
    },
    subscribe(onChange) {
      listeners.add(onChange)
      return () => {
        listeners.delete(onChange)
      }
    },
    async alerts() {
      return demoAlerts
    },
    async extras() {
      const today = kstDay(new Date().toISOString())
      const prices = new Map<string, ItemPrice>()
      const productNames = new Map<string, string>()
      for (const i of items) {
        if (!i.productKey || i.productQty === null) continue
        const name = demoPrices.products[i.productKey]?.name
        if (name) productNames.set(i.id, name)
        if (i.boughtAt) continue
        const best = splitLines([...(demoPrices.lines[i.productKey] ?? []), ...(captured.get(i.productKey) ?? [])], i.productQty, today).best
        if (best) prices.set(i.id, best)
      }
      return { searches: new Map(Object.entries(demoPrices.searches)), prices, productNames, nutrition: new Map(nutrition) }
    },
    async candidates(itemId) {
      return demoPrices.candidates[itemId] ?? []
    },
    async candidateAlerts(itemId) {
      return new Map(Object.entries(demoPrices.candidateAlerts?.[itemId] ?? {}).map(([k, v]) => [k, v.map((a) => ({ ...a }))]))
    },
    async findCandidates() {
      return 'done' as const
    },
    async choose(itemId, productId, qty) {
      items = items.map((i) => (i.id === itemId ? { ...i, productKey: productId, productQty: qty } : i))
      notify()
    },
    async checkPrice() {},
    async sources(itemId) {
      const it = items.find((i) => i.id === itemId)
      const goodId = it ? storeLinks.get(nameKey(it)) : undefined
      const good = goodId ? (demoPrices.storeGoods ?? []).find((g) => g.goodId === goodId) : undefined
      const prices = good ? (demoPrices.storePrices?.[good.goodId] ?? []) : []
      return {
        // DB의 shop_prices()처럼 출처 이름순
        shops: it?.productKey ? (shops.get(it.productKey) ?? []).map((x) => ({ ...x })).sort((a, b) => a.source.localeCompare(b.source)) : [],
        store: {
          good: good ? { goodId: good.goodId, name: good.name } : null,
          prices: (chosenStores.length ? prices.filter((p) => chosenStores.includes(p.entpId)) : prices).map((p) => ({ ...p })),
        },
      }
    },
    async addShopLink(itemId, link) {
      const it = items.find((i) => i.id === itemId)
      if (!it?.productKey) throw new Error('no_product')
      const row: ShopPrice = {
        ...link, addedAt: now(), checkedAt: null, ok: null, error: null, pricedAt: null, name: null, price: null, imageUrl: null,
        rating: null, reviewCount: null, size: null, priceFrom: null, obsLow: null, obsHigh: null, obsAvg: null, changedOn: null,
      }
      shops.set(it.productKey, [...(shops.get(it.productKey) ?? []).filter((x) => x.source !== link.source), row])
    },
    async removeShopLink(itemId, source) {
      const it = items.find((i) => i.id === itemId)
      if (it?.productKey) shops.set(it.productKey, (shops.get(it.productKey) ?? []).filter((x) => x.source !== source))
    },
    async storeGoods() {
      return (demoPrices.storeGoods ?? []).map((g) => ({ ...g }))
    },
    async chooseStoreGood(itemId, goodId) {
      const it = items.find((i) => i.id === itemId)
      if (!it) throw new Error('item_not_found')
      if (goodId === null) storeLinks.delete(nameKey(it))
      else storeLinks.set(nameKey(it), goodId)
    },
    async storeOptions() {
      return { stores: (demoPrices.stores ?? []).map((o) => ({ ...o })), chosen: [...chosenStores] }
    },
    async setStores(entpIds) {
      chosenStores = [...entpIds]
    },
    async ourPurchases(itemId) {
      return (ours.get(itemId) ?? []).map((r) => ({ ...r }))
    },
    async readPhoto(job) {
      if (!demoPrices.photo) throw new Error('no_demo')
      if (job === 'product') return { job: 'product', product: demoPrices.photo.product, query: productQuery(demoPrices.photo.product) }
      if (job === 'list') return { job: 'list', items: (demoPrices.photo.list ?? []).map((x) => ({ ...x })), note: null }
      return { job: 'price', price: demoPrices.photo.price }
    },
    async productInfo(itemId) {
      const it = items.find((i) => i.id === itemId)
      return it?.productKey ? (foodInfo.get(it.productKey) ?? null) : null
    },
    async searchFoodInfo() {
      return { term: '왕교자', candidates: (demoPrices.foodInfo?.candidates ?? []).map((c) => ({ ...c })) }
    },
    async chooseFoodInfo(itemId, reportNo) {
      const it = items.find((i) => i.id === itemId)
      if (!it?.productKey) throw new Error('no_product')
      const c = (demoPrices.foodInfo?.candidates ?? []).find((x) => x.reportNo === reportNo)
      if (!c) throw new Error('not_found')
      const prev = foodInfo.get(it.productKey)
      foodInfo.set(it.productKey, {
        reportNo: c.reportNo, name: c.name, maker: c.maker, kind: c.kind, rawMaterials: c.rawMaterials, changedOn: c.changedOn,
        nutrition: prev?.reportNo === c.reportNo ? prev.nutrition : null, nutritionError: prev?.reportNo === c.reportNo ? prev.nutritionError : 'not_found', updatedAt: now(),
      })
    },
    async itemNutrition(itemId) {
      const n = nutrition.get(itemId)
      return n ? { ...n, nutrition: { ...n.nutrition } } : null
    },
    async searchNutrition(itemId, query) {
      const it = items.find((i) => i.id === itemId)
      const term = query?.trim() || it?.name || ''
      return { term: term || null, candidates: demoCandidates(term).map((c) => ({ ...c })) }
    },
    async chooseNutrition(itemId, query, foodCd) {
      const c = demoCandidates(query).find((x) => x.foodCd === foodCd)
      if (!c) throw new Error('not_found')
      const { foodCd: cd, reportNo: _r, ...n } = c
      void _r
      nutrition.set(itemId, { foodCd: cd, foodName: c.foodName ?? '이름 없음', maker: c.maker, nutrition: n, updatedAt: now(), auto: false, matchedBy: null })
    },
    async autoNutrition(itemId) {
      const it = items.find((i) => i.id === itemId)
      const c = demoCandidates(it?.name ?? '')[0]
      if (!it || !c?.foodCd) return null
      const { foodCd: cd, reportNo: _r, ...n } = c
      void _r
      const row: ItemNutrition = { foodCd: cd, foodName: c.foodName ?? '이름 없음', maker: c.maker, nutrition: n, updatedAt: now(), auto: true, matchedBy: 'name' }
      nutrition.set(itemId, row)
      return { ...row, nutrition: { ...row.nutrition } }
    },
    async barcodeAlerts(code) {
      return { records: (demoPrices.barcodes?.[code] ?? []).map((r) => ({ ...r })), syncedAt: demoAlerts.syncedAt }
    },
    async addCapturedQuote(itemId, q) {
      const it = items.find((i) => i.id === itemId)
      if (!it?.productKey) throw new Error('no_product')
      captured.set(it.productKey, [
        ...(captured.get(it.productKey) ?? []),
        { price: q.price, seller: q.seller, source: 'capture', qty: q.qty, delivery: q.delivery, checkedAt: now(), capturedBy: me.userId, unitPrice: null, unitLabel: null, mallCount: null },
      ])
    },
    async decidePurchase(itemId, transactionItemId, same) {
      // 메모리 구현: "맞아요"는 confirmed로, "아니에요"는 뺀다(실제는 name_key로 같은 이름의 품목이 함께 본다)
      const rows = ours.get(itemId) ?? []
      ours.set(itemId, same
        ? rows.map((r) => (r.transactionItemId === transactionItemId ? { ...r, kind: 'confirmed' as const } : r))
        : rows.filter((r) => r.transactionItemId !== transactionItemId))
    },
    async detail(itemId) {
      const it = items.find((i) => i.id === itemId)
      const product = it?.productKey ? (demoPrices.products[it.productKey] ?? null) : null
      const lines = it?.productKey ? [...(demoPrices.lines[it.productKey] ?? []), ...(captured.get(it.productKey) ?? [])] : []
      const last = lines.map((l) => l.checkedAt).sort().at(-1)
      return {
        product,
        check: last ? { checkedAt: last, ok: true, error: null } : null,
        lines,
        safety: (demoAlerts.byItem.get(itemId) ?? []).map((a) => ({ ...a, via: 'item_name' as const, farm: false })),
        syncedAt: demoAlerts.syncedAt,
      }
    },
  }
}
