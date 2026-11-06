import { parseItemLine, SPEC_MAX, type ParsedItem } from './parse'
import { parsePack } from './purchase'
import { nameScore, type SeenRecord } from './seen'

export const shoppingNameKey = (name: string) => name.normalize('NFC').replace(/\s+/g, '').toLowerCase()

function specKey(spec: string | null): string {
  const pack = parsePack(spec)
  return pack ? `${pack.pack_size}${pack.pack_unit}` : shoppingNameKey(spec ?? '')
}

export const shoppingItemKey = (item: Pick<ParsedItem, 'name' | 'spec'>) => `${shoppingNameKey(item.name)}|${specKey(item.spec)}`

export function alreadyShopping(queued: Pick<ParsedItem, 'name' | 'spec'>, candidate: ParsedItem): boolean {
  const nameMatches = shoppingNameKey(queued.name) === shoppingNameKey(candidate.name)
    || nameScore(queued.name, candidate.name) === 2
  return nameMatches && (!queued.spec || !candidate.spec || specKey(queued.spec) === specKey(candidate.spec))
}

/** 여러 날 산 품목만 추천한다. 캡처 가격과 같은 날의 여러 줄은 구매 횟수를 늘리지 않는다. */
export function frequentPurchases(records: SeenRecord[]): ParsedItem[] {
  const groups = new Map<string, { item: ParsedItem; days: Set<string>; latest: string }>()
  for (const r of records) {
    if (r.source === 'capture' || r.amount <= 0) continue
    const parsed = parseItemLine(r.name.normalize('NFC'))
    if (!parsed) continue
    const pack = r.packSize && r.packUnit ? `${r.packSize}${r.packUnit}` : ''
    const spec = (!parsed.specIsDefault && parsed.spec) || (pack && pack.length <= SPEC_MAX ? pack : null)
    const count = Number.isInteger(r.quantity) && r.quantity >= 1 && r.quantity <= 99 ? r.quantity : 1
    const key = shoppingItemKey({ name: parsed.name, spec })
    const group = groups.get(key) ?? { item: { ...parsed, spec, count, specIsDefault: false }, days: new Set<string>(), latest: r.date }
    group.days.add(r.date)
    if (r.date > group.latest) {
      group.latest = r.date
      group.item.count = count
    }
    groups.set(key, group)
  }
  return [...groups.values()].filter((g) => g.days.size >= 2)
    .sort((a, b) => b.days.size - a.days.size || b.latest.localeCompare(a.latest))
    .map((g) => g.item)
}
