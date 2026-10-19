// 농수산물 시세 읽기·지켜보기 저장소(D-012). 조사값은 market-sync가 쌓고, 화면은 읽기만 한다(지켜보기만 쓴다).
import type { SupabaseClient } from '@supabase/supabase-js'
import type { FoodAlert } from './alerts'
import { keyOf, sameKey, type MarketBoard, type MarketSeries, type NearbyPrice, type SeriesKey, type TrendPoint } from './market'

export type Recalls = { records: FoodAlert[]; syncedAt: string | null }

export interface MarketStore {
  board(): Promise<MarketBoard>
  /** 그 시리즈 조사처의 최근 45일과 날마다 주변 범위 */
  trend(s: MarketSeries): Promise<TrendPoint[]>
  /** 그 시리즈의 마지막 조사일에 성남·수원·서울 조사처마다의 값(싼 순) */
  nearby(s: MarketSeries): Promise<NearbyPrice[]>
  watches(): Promise<SeriesKey[]>
  setWatch(k: SeriesKey, on: boolean): Promise<void>
  /** 식약처 회수·판매중지 최근 등록분 */
  recalls(limit?: number): Promise<Recalls>
}

type BoardRow = {
  item_cd: string; vrty_cd: string; grd_cd: string; ctgry_cd: string
  item_nm: string; vrty_nm: string; grd_nm: string; unit: string; unit_sz: string
  sgg_cd: string; sgg_nm: string; mrkt_cd: string; mrkt_nm: string
  cur_on: string; cur_price: number
  prev_on: string | null; prev_price: number | null
  w1_on: string | null; w1_price: number | null
  m1_on: string | null; m1_price: number | null
  y1_on: string | null; y1_price: number | null
  low: number | null; high: number | null; markets: number | null
  first_on: string; days: number | null; fetched_at: string
}

const dated = (on: string | null, price: number | null) => (on && price != null ? { on, price: Number(price) } : null)

export function rowToSeries(r: BoardRow): MarketSeries {
  return {
    item: r.item_cd, vrty: r.vrty_cd, grd: r.grd_cd, ctgry: r.ctgry_cd,
    itemNm: r.item_nm, vrtyNm: r.vrty_nm, grdNm: r.grd_nm, unit: r.unit, unitSz: r.unit_sz,
    sgg: r.sgg_cd, sggNm: r.sgg_nm, mrkt: r.mrkt_cd, mrktNm: r.mrkt_nm,
    cur: { on: r.cur_on, price: Number(r.cur_price) },
    prev: dated(r.prev_on, r.prev_price), w1: dated(r.w1_on, r.w1_price), m1: dated(r.m1_on, r.m1_price), y1: dated(r.y1_on, r.y1_price),
    low: r.low == null ? null : Number(r.low), high: r.high == null ? null : Number(r.high), markets: Number(r.markets ?? 0),
    firstOn: r.first_on, days: Number(r.days ?? 0), fetchedAt: r.fetched_at,
  }
}

export function createSupabaseMarketStore(client: SupabaseClient, householdId: string): MarketStore {
  const g = () => client.schema('grocery')
  return {
    async board() {
      const [rows, runs] = await Promise.all([
        g().rpc('market_board'),
        g().from('sync_runs').select('ran_at').eq('source', 'kamis').eq('ok', true).order('ran_at', { ascending: false }).limit(1),
      ])
      if (rows.error) throw rows.error
      if (runs.error) throw runs.error
      return {
        series: ((rows.data ?? []) as BoardRow[]).map(rowToSeries),
        syncedAt: ((runs.data ?? []) as { ran_at: string }[])[0]?.ran_at ?? null,
      }
    },
    async trend(s) {
      const { data, error } = await g().rpc('market_trend', { p_item: s.item, p_vrty: s.vrty, p_grd: s.grd, p_sgg: s.sgg, p_mrkt: s.mrkt })
      if (error) throw error
      return ((data ?? []) as { exmn_ymd: string; price: number | null; low: number | null; high: number | null; markets: number }[]).map((r) => ({
        on: r.exmn_ymd, price: r.price == null ? null : Number(r.price), low: r.low == null ? null : Number(r.low),
        high: r.high == null ? null : Number(r.high), markets: Number(r.markets ?? 0),
      }))
    },
    async nearby(s) {
      const { data, error } = await g().from('price_points')
        .select('sgg_nm, mrkt_nm, mrkt_cd, price')
        .eq('item_cd', s.item).eq('vrty_cd', s.vrty).eq('grd_cd', s.grd)
        .eq('exmn_ymd', s.cur.on).eq('unit', s.unit).eq('unit_sz', s.unitSz)
        .neq('sgg_cd', '1000')
        .order('price', { ascending: true })
      if (error) throw error
      return ((data ?? []) as { sgg_nm: string; mrkt_nm: string; mrkt_cd: string; price: number }[]).map((r) => ({
        sggNm: r.sgg_nm, mrktNm: r.mrkt_nm, mrkt: r.mrkt_cd, price: Number(r.price),
      }))
    },
    async watches() {
      const { data, error } = await g().from('watch').select('item_cd, vrty_cd, grd_cd').eq('household_id', householdId).order('created_at')
      if (error) throw error
      return ((data ?? []) as { item_cd: string; vrty_cd: string; grd_cd: string }[]).map((r) => ({ item: r.item_cd, vrty: r.vrty_cd, grd: r.grd_cd }))
    },
    async setWatch(k, on) {
      const q = on
        ? g().from('watch').upsert({ household_id: householdId, item_cd: k.item, vrty_cd: k.vrty, grd_cd: k.grd }, { onConflict: 'household_id,item_cd,vrty_cd,grd_cd', ignoreDuplicates: true })
        : g().from('watch').delete().eq('household_id', householdId).eq('item_cd', k.item).eq('vrty_cd', k.vrty).eq('grd_cd', k.grd)
      const { error } = await q
      if (error) throw error
    },
    async recalls(limit = 5) {
      const [rows, runs] = await Promise.all([
        g().from('food_alerts')
          .select('source, source_id, product_name, maker, reason, grade, pack_unit, registered_on')
          .eq('source', 'I0490')
          .order('registered_on', { ascending: false, nullsFirst: false })
          .limit(limit),
        g().from('sync_runs').select('ran_at').eq('source', 'I0490').eq('ok', true).order('ran_at', { ascending: false }).limit(1),
      ])
      if (rows.error) throw rows.error
      if (runs.error) throw runs.error
      type R = { source: 'I0490'; source_id: string; product_name: string; maker: string | null; reason: string | null; grade: string | null; pack_unit: string | null; registered_on: string | null }
      return {
        records: ((rows.data ?? []) as R[]).map((r) => ({
          source: r.source, sourceId: r.source_id, productName: r.product_name, maker: r.maker, reason: r.reason,
          grade: r.grade, packUnit: r.pack_unit, registeredOn: r.registered_on,
        })),
        syncedAt: ((runs.data ?? []) as { ran_at: string }[])[0]?.ran_at ?? null,
      }
    },
  }
}

/** 메모리 구현: 테스트와 개발용 데모 화면(실제 시세 아님) */
export function createMemoryMarketStore(seed: {
  board: MarketBoard
  trends?: Record<string, TrendPoint[]>
  nearby?: Record<string, NearbyPrice[]>
  watches?: SeriesKey[]
  recalls?: Recalls
}): MarketStore {
  let watches = [...(seed.watches ?? [])]
  return {
    async board() {
      return seed.board
    },
    async trend(s) {
      return seed.trends?.[keyOf(s)] ?? []
    },
    async nearby(s) {
      return seed.nearby?.[keyOf(s)] ?? []
    },
    async watches() {
      return [...watches]
    },
    async setWatch(k, on) {
      watches = watches.filter((w) => !sameKey(w, k))
      if (on) watches.push({ item: k.item, vrty: k.vrty, grd: k.grd })
    },
    async recalls() {
      return seed.recalls ?? { records: [], syncedAt: null }
    },
  }
}
