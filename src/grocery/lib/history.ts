import { daysBetween } from '../../lib/anniversaries'
import { parsePackText, perUnit } from '../../lib/units'
import { shoppingNameKey } from './frequent'
import { parseItemLine } from './parse'
import type { HistoryPeriod, SeenRecord } from './seen'

export type HistoryRow = {
  record: SeenRecord
  volume: { quantity: number; unit: string } | null
  unitPrice: ReturnType<typeof perUnit>
}

export type HistoryProduct = {
  key: string
  name: string
  rows: HistoryRow[]
  amounts: { unit: string; quantity: number }[]
  purchaseRows: number
  purchaseDays: number
  unknownVolume: number
  unknownQuantity: number
}

/** 이름의 끝에 적힌 규격만 읽는다. 예를 들어 '100g당 3,000원'의 100g은 용량이 아니다. */
function volumeOf(record: SeenRecord, parsed: ReturnType<typeof parseItemLine>): HistoryRow['volume'] {
  if (!(record.quantity > 0) || !Number.isFinite(record.quantity)) return null
  const given = record.packSize && record.packUnit ? parsePackText(`${record.packSize}${record.packUnit}`) : null
  const named = parsed?.spec && !parsed.specIsDefault ? parsePackText(parsed.spec) : null
  const pack = given ?? named
  if (!pack) return null
  // 구조화된 용량은 1개 기준이다. 이름만 있는 '900ml ×2'는 기록 수량이 1일 때 한 묶음으로 계산한다.
  const count = !given && record.quantity === 1 ? parsed?.count ?? 1 : record.quantity
  return { quantity: pack.pack_size * count, unit: pack.pack_unit }
}

function priceOf(record: SeenRecord, volume: HistoryRow['volume']): HistoryRow['unitPrice'] {
  const printed = record.source === 'capture' && record.unitPrice && record.unitLabel
    ? parsePackText(record.unitLabel.replace(/\s*당$/, '')) : null
  if (printed && record.unitPrice) {
    return perUnit({ ...printed, amount: record.unitPrice, quantity: 1 })
  }
  return volume ? perUnit({ amount: record.amount, quantity: 1, pack_size: volume.quantity, pack_unit: volume.unit }) : null
}

export function summarizePurchaseHistory(records: SeenRecord[], { from, to }: HistoryPeriod) {
  const byName = new Map<string, { name: string; rows: HistoryRow[] }>()
  let firstPurchase: string | null = null
  for (const record of records) {
    if (record.date > to || (from && record.date < from) || !(record.amount > 0)) continue
    const parsed = parseItemLine(record.name.normalize('NFC'))
    if (!parsed) continue
    const key = shoppingNameKey(parsed.name)
    const group = byName.get(key) ?? { name: parsed.name, rows: [] }
    const volume = volumeOf(record, parsed)
    const unitPrice = priceOf(record, volume)
    group.rows.push({ record, volume, unitPrice })
    byName.set(key, group)
    if (record.source !== 'capture' && (!firstPurchase || record.date < firstPurchase)) firstPurchase = record.date
  }

  const days = firstPurchase ? daysBetween(firstPurchase, to) + 1 : 0
  const products: HistoryProduct[] = [...byName].map(([key, { name, rows }]) => {
    const amounts = new Map<string, number>()
    const dates = new Set<string>()
    let unknownVolume = 0
    let unknownQuantity = 0
    let purchaseRows = 0
    rows.sort((a, b) => b.record.date.localeCompare(a.record.date) || (b.record.recordedAt ?? '').localeCompare(a.record.recordedAt ?? ''))
    for (const { record, volume } of rows) {
      if (record.source === 'capture') continue
      purchaseRows++
      dates.add(record.date)
      if (!volume) {
        unknownVolume++
        if (Number.isFinite(record.quantity) && record.quantity > 0) unknownQuantity += record.quantity
        continue
      }
      amounts.set(volume.unit, (amounts.get(volume.unit) ?? 0) + volume.quantity)
    }
    return {
      key, name, rows, purchaseRows, purchaseDays: dates.size, unknownVolume, unknownQuantity,
      amounts: [...amounts].map(([unit, quantity]) => ({ unit, quantity })),
    }
  }).sort((a, b) => b.purchaseDays - a.purchaseDays || b.purchaseRows - a.purchaseRows || a.name.localeCompare(b.name, 'ko'))
  return { products, days, firstPurchase }
}

/** 실제 구매가와 가격 캡처를 섞지 않고 같은 상품의 같은 용량 단위만 비교한다. */
export function historyPriceGroups(rows: HistoryRow[]) {
  const series = new Map<string, { base: string; capture: boolean; points: { record: SeenRecord; price: number }[] }>()
  for (const { record, unitPrice } of rows) {
    if (!unitPrice) continue
    const capture = record.source === 'capture'
    const key = `${capture}:${unitPrice.base}`
    const group = series.get(key) ?? { base: unitPrice.base, capture, points: [] }
    group.points.push({ record, price: unitPrice.price })
    series.set(key, group)
  }
  return [...series.values()].sort((a, b) => Number(a.capture) - Number(b.capture)).map((group) => {
    const latest = group.points[0]
    const oldest = group.points[group.points.length - 1]
    const change = latest.record.date === oldest.record.date ? null : ((latest.price - oldest.price) / oldest.price) * 100
    return { ...group, latest, oldest, change }
  })
}
