// 품목 줄 고치기(D-052): 영수증 확인 화면과 저장된 내역의 수정 시트가 함께 쓰는 순수 함수.
// 이름·수량·금액만 직접 고치고, 개당 가격은 수량·금액에서 다시 센다(서버가 할인을 접을 때와 같은 규칙, D-051).
import type { TxItem } from './types'

export interface EditableItem {
  name: string
  quantity: number
  unit_price: number | null
  amount: number
  pack_size: number | null
  pack_unit: string | null
}

/** 저장할 품목 줄 한 개(새 줄은 id 없음). sort는 화면 순서 */
export type ItemPatch = EditableItem & { sort: number }

/** 수정 시트가 저장할 때 넘기는 품목 전·후(후의 id 없는 줄은 새 줄) */
export type ItemsChange = { before: TxItem[]; after: (EditableItem & { id?: string })[] }

/** 수량·금액이 둘 다 양수면 개당 가격 = 금액 ÷ 수량(반올림), 아니면 모른다(null) */
export function withUnitPrice<T extends EditableItem>(it: T): T {
  const unit_price = it.quantity > 0 && it.amount > 0 ? Math.round(it.amount / it.quantity) : null
  return { ...it, unit_price }
}

/** 새 줄: 이름 비움, 1개, 0원, 용량 없음 */
export function blankItem(): EditableItem {
  return { name: '', quantity: 1, unit_price: null, amount: 0, pack_size: null, pack_unit: null }
}

/** 수량 칸 글자 → 수. 0보다 크고 소수 셋째 자리까지(DB numeric(10,3)). 못 읽으면 null */
export function parseQuantity(text: string): number | null {
  const t = text.trim()
  if (!/^\d{1,6}(\.\d{1,3})?$/.test(t)) return null
  const n = Number(t)
  return n > 0 ? n : null
}

/** 금액 칸 글자 → 정수. 쉼표는 무시하고, 할인·반품 줄을 위해 음수도 받는다. 못 읽으면 null */
export function parseAmount(text: string): number | null {
  const t = text.trim().replace(/,/g, '')
  if (!/^-?\d{1,10}$/.test(t)) return null
  return Number(t)
}

/**
 * 저장 전 정리: 이름 앞뒤 공백을 지우고 60자로 자른다. 이름도 금액도 없는 줄(더하기만 누르고 둔 줄)은 뺀다.
 * 이름 없이 금액만 있는 줄이 남으면 몇 번째 줄인지 돌려 준다(저장을 막고 알린다)
 */
export function cleanItems<T extends EditableItem>(items: T[]): { items: T[]; missingName: number | null } {
  const kept = items
    .map((it) => ({ ...it, name: it.name.trim().slice(0, 60) }))
    .filter((it) => it.name !== '' || it.amount !== 0)
  const idx = kept.findIndex((it) => it.name === '')
  return { items: kept, missingName: idx >= 0 ? idx + 1 : null }
}

const FIELDS: (keyof EditableItem)[] = ['name', 'quantity', 'unit_price', 'amount', 'pack_size', 'pack_unit']

const nameKey = (s: string) => s.replace(/\s+/g, '').toLowerCase()

type RereadItem = EditableItem & { id?: string; image_path?: string | null }

/** 이름이 같은 줄의 id·사진을 유지한다. 다시 읽은 목록에 없는 줄도 사용자가 직접 검토할 수 있게 남긴다. */
export function mergeReread(before: RereadItem[], fresh: EditableItem[]): { items: RereadItem[]; retained: number } {
  const pool = new Map<string, RereadItem[]>()
  for (const item of before) {
    const key = nameKey(item.name)
    const group = pool.get(key)
    if (group) group.push(item)
    else pool.set(key, [item])
  }
  const matched = new Set<RereadItem>()
  const items = fresh.map((item) => {
    const old = pool.get(nameKey(item.name))?.shift()
    if (!old) return item
    matched.add(old)
    return { ...old, ...item }
  })
  const retained = before.filter((item) => !matched.has(item))
  return { items: [...items, ...retained], retained: retained.length }
}

/** 금액이 같은 후보가 하나일 때만 적용할 수 있다. */
export function pickRereadEntry<E extends { amount: number; items: unknown[] }>(entries: E[], amount: number): E | null {
  const matches = entries.filter((entry) => entry.items.length > 0 && entry.amount === amount)
  return matches.length === 1 ? matches[0] : null
}

/**
 * 저장된 품목(전)과 고친 품목(후)의 차이. 후의 순서가 sort가 된다.
 * - insert: id가 없는 줄(새로 더한 줄)
 * - update: id가 있는 줄 가운데 바뀐 칸만
 * - remove: 전에는 있었는데 후에 없는 줄(사진 지우기에 쓰도록 줄 전체)
 */
export function diffItems(
  before: TxItem[], after: ItemsChange['after'],
): { insert: ItemPatch[]; update: { id: string; patch: Partial<ItemPatch> }[]; remove: TxItem[] } {
  const prev = new Map(before.map((b) => [b.id, b]))
  const insert: ItemPatch[] = []
  const update: { id: string; patch: Partial<ItemPatch> }[] = []
  const seen = new Set<string>()
  after.forEach((it, sort) => {
    const row: ItemPatch = {
      name: it.name, quantity: it.quantity, unit_price: it.unit_price, amount: it.amount,
      pack_size: it.pack_size, pack_unit: it.pack_unit, sort,
    }
    const old = it.id ? prev.get(it.id) : undefined
    if (!old || !it.id) { insert.push(row); return }
    seen.add(it.id)
    const patch: Partial<ItemPatch> = {}
    for (const k of FIELDS) if (old[k] !== row[k]) (patch as Record<string, unknown>)[k] = row[k]
    if (old.sort !== sort) patch.sort = sort
    if (Object.keys(patch).length) update.push({ id: it.id, patch })
  })
  const remove = before.filter((b) => !seen.has(b.id))
  return { insert, update, remove }
}
