import { dayOf } from './dates'
import type { Transaction, TxType } from './types'

export function sumType(txs: Transaction[], type: TxType, uptoDay?: number): number {
  let s = 0
  for (const t of txs) {
    if (t.type !== type) continue
    if (uptoDay !== undefined && dayOf(t.occurred_on) > uptoDay) continue
    s += t.amount
  }
  return s
}

export function dailyTotals(txs: Transaction[]): Map<string, { expense: number; income: number }> {
  const map = new Map<string, { expense: number; income: number }>()
  for (const t of txs) {
    const cur = map.get(t.occurred_on) ?? { expense: 0, income: 0 }
    cur[t.type] += t.amount
    map.set(t.occurred_on, cur)
  }
  return map
}

/** 이번 달 1~day일과 지난달 같은 기간의 지출 차이 */
export function samePeriodDiff(cur: Transaction[], prev: Transaction[], day: number): number {
  return sumType(cur, 'expense', day) - sumType(prev, 'expense', day)
}
