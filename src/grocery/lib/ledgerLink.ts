// 가계부 스마트 입력(영수증·쇼핑 주문)에서 장보기 품목을 연결할 때 가계부 쪽이 쓰는 장보기 읽기·쓰기(D-011 길 ①).
import { sb } from '../../lib/supabase'

export type ReceiptGroceryItem = { id: string; name: string; spec: string | null; boughtAt: string | null; linked: boolean }

const RECENT_MS = 7 * 24 * 3600_000

/**
 * 영수증과 맞춰 볼 장보기 품목: 안 산 것과 최근 7일 안에 산 것.
 * linked: 이미 가계부에 넣은 품목(같은 장보기를 두 번 넣지 않게 흐리게 보여 준다).
 */
export async function loadReceiptGroceryItems(householdId: string, nowMs = Date.now()): Promise<ReceiptGroceryItem[]> {
  const { data, error } = await sb().schema('grocery').from('items')
    .select('id, name, spec, bought_at, transaction_id')
    .eq('household_id', householdId)
  if (error) throw error
  const rows = (data ?? []) as { id: string; name: string; spec: string | null; bought_at: string | null; transaction_id: string | null }[]
  return rows
    .filter((r) => !r.bought_at || nowMs - Date.parse(r.bought_at) <= RECENT_MS)
    .map((r) => ({ id: r.id, name: r.name, spec: r.spec, boughtAt: r.bought_at, linked: r.transaction_id !== null }))
}

/** 장보기 품목들을 가계부 내역 하나에 연결한다(grocery.link_purchase). 연결한 수를 돌려준다 */
export async function linkGroceryItems(txId: string, links: { item_id: string; paid: number | null }[]): Promise<number> {
  const { data, error } = await sb().schema('grocery').rpc('link_purchase', { p_tx: txId, p_links: links })
  if (error) throw error
  return Number(data ?? 0)
}
