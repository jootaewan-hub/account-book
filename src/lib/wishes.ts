import type { SupabaseClient } from '@supabase/supabase-js'
import type { ExploreItem, ShopItem } from './explore'
import { readAllPages } from '../../supabase/functions/_shared/pagination'

export type WishInput = { title: string; url: string | null; target_price: number | null; memo: string | null }
export type WishQuote = { price: number; source: string; checkedAt: string; note: string }
export type WishSeed = WishInput & { quote: WishQuote | null }
export type Wish = WishSeed & { id: string; created_by: string; created_at: string; bought_at: string | null }
export type WishTarget = { wish: Wish } | { seed: WishSeed }
export interface WishStore {
  list(): Promise<Wish[]>
  byUrl(url: string): Promise<Wish | null>
  save(input: WishSeed, id?: string): Promise<void>
  setBought(id: string, bought: boolean): Promise<void>
  remove(id: string): Promise<void>
  subscribe(changed: () => void): () => void
}

/** 보관함 링크는 일반 웹 주소만 허용한다. DB에서 읽은 주소도 화면에 넣기 전에 검사한다. */
export function wishUrl(text: string | null): string | null {
  if (!text?.trim()) return null
  try {
    const url = new URL(text.trim())
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && url.href.length <= 2000 ? url.href : null
  } catch { return null }
}

export function normalizeWish(input: WishInput): WishInput {
  const title = input.title.trim()
  if (!title || title.length > 200) throw new Error('물건 이름을 200자 안에서 적어 주세요.')
  const url = wishUrl(input.url)
  if (input.url?.trim() && !url) throw new Error('상품 링크는 http 또는 https 주소로 적어 주세요.')
  const target = input.target_price
  if (target !== null && (!Number.isSafeInteger(target) || target <= 0 || target >= 10_000_000_000)) throw new Error('목표 가격을 1원 이상, 100억 원 미만의 정수로 적어 주세요.')
  const memo = input.memo?.trim() || null
  if (memo && memo.length > 500) throw new Error('메모는 500자 안에서 적어 주세요.')
  return { title, url, target_price: target, memo }
}

/** 검색 줄에 표시한 값과 같은 수량을 보관한다. 목표 가격과 보관 당시 가격은 분리한다. */
export function seedFromSearch(item: ExploreItem | ShopItem, source: string, checkedAt: string): WishSeed {
  const variant = 'pcode' in item
    ? item.variants.find((v) => v.qty === 1) ?? [...item.variants].sort((a, b) => a.qty - b.qty)[0]
    : null
  const price = 'pcode' in item ? variant?.price : item.price
  const note = 'pcode' in item ? `${variant?.qty ?? 1}개 기준 · 검색 표시 가격 · 배송비 확인 필요` : '상품·매물 표시 가격 · 배송비 확인 필요'
  return {
    title: item.name.slice(0, 200),
    url: 'pcode' in item ? `https://prod.danawa.com/info/?pcode=${encodeURIComponent(item.pcode)}` : wishUrl(item.url),
    target_price: null, memo: null,
    quote: price != null && Number.isSafeInteger(price) && price > 0 && price < 10_000_000_000 && Number.isFinite(Date.parse(checkedAt))
      ? { price, source, checkedAt, note } : null,
  }
}

type WishRow = WishInput & {
  id: string; created_by: string; created_at: string; bought_at: string | null
  saved_price: number | string | null; price_source: string | null; price_checked_at: string | null; price_note: string | null
}
const COLUMNS = 'id,title,url,target_price,memo,saved_price,price_source,price_checked_at,price_note,bought_at,created_by,created_at'
function fromRow(row: WishRow): Wish {
  return {
    id: row.id, title: row.title, url: wishUrl(row.url), target_price: row.target_price == null ? null : Number(row.target_price), memo: row.memo,
    created_by: row.created_by, created_at: row.created_at, bought_at: row.bought_at,
    quote: row.saved_price != null && row.price_source && row.price_checked_at
      ? { price: Number(row.saved_price), source: row.price_source, checkedAt: row.price_checked_at, note: row.price_note ?? '' } : null,
  }
}
function checked<T>({ data, error }: { data: T; error: { code?: string; message: string } | null }): T {
  if (error) {
    if (error.code === '23505') throw new Error('이미 보관한 링크예요. 보관함에서 그 물건을 열어 주세요.')
    if (error.code === 'PGRST116') throw new Error('다른 기기에서 이 물건을 지웠어요. 목록을 다시 확인해 주세요.')
    if (error.code === '42P01' || error.code === 'PGRST205') throw new Error('보관함 설정이 아직 적용되지 않았어요.')
    throw new Error(error.message)
  }
  return data
}

export function createWishStore(client: SupabaseClient, householdId: string): WishStore {
  const table = () => client.schema('grocery').from('purchase_wishes')
  return {
    async list() {
      const rows = await readAllPages<WishRow>((from, to) => table().select(COLUMNS, { count: from === 0 ? 'exact' : undefined })
        .eq('household_id', householdId).order('created_at', { ascending: false }).order('id', { ascending: false }).range(from, to))
      return rows.map(fromRow)
    },
    async byUrl(url) {
      const row = checked(await table().select(COLUMNS).eq('household_id', householdId).eq('url', wishUrl(url)).maybeSingle()) as WishRow | null
      return row ? fromRow(row) : null
    },
    async save(input, id) {
      const fields = normalizeWish(input)
      if (id) {
        checked(await table().update(fields).eq('household_id', householdId).eq('id', id).select('id').single())
      } else {
        const q = input.quote
        checked(await table().insert({ ...fields, household_id: householdId,
          saved_price: q?.price ?? null, price_source: q?.source ?? null, price_checked_at: q?.checkedAt ?? null, price_note: q?.note ?? null,
        }).select('id').single())
      }
    },
    async setBought(id, bought) {
      checked(await table().update({ bought_at: bought ? new Date().toISOString() : null }).eq('household_id', householdId).eq('id', id).select('id').single())
    },
    async remove(id) {
      checked(await table().delete().eq('household_id', householdId).eq('id', id).select('id').single())
    },
    subscribe(changed) {
      let timer: ReturnType<typeof setTimeout> | undefined
      const update = () => { clearTimeout(timer); timer = setTimeout(changed, 250) }
      const filter = `household_id=eq.${householdId}`
      const channel = client.channel(`wishes-${householdId}-${crypto.randomUUID()}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'grocery', table: 'purchase_wishes', filter }, update)
        .on('postgres_changes', { event: 'UPDATE', schema: 'grocery', table: 'purchase_wishes', filter }, update)
        .on('postgres_changes', { event: 'DELETE', schema: 'grocery', table: 'purchase_wishes' }, update).subscribe()
      return () => { clearTimeout(timer); void client.removeChannel(channel) }
    },
  }
}
