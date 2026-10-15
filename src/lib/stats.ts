// 통계 화면 계산: 12개월 추이, 전월·전년 대비, 분류별·용도별 지출
import { addMonths } from './dates'
import type { Category, MonthTotal, Scope, Transaction } from './types'

export interface MonthPoint {
  ym: string
  expense: number
  income: number
}

/** ym을 끝으로 하는 n개월 (빈 달은 0) */
export function monthSeries(totals: MonthTotal[], ym: string, n = 12): MonthPoint[] {
  const map = new Map<string, MonthPoint>()
  for (let i = n - 1; i >= 0; i--) {
    const k = addMonths(ym, -i)
    map.set(k, { ym: k, expense: 0, income: 0 })
  }
  for (const t of totals) {
    const p = map.get(t.month.slice(0, 7))
    if (p) p[t.type] += t.total
  }
  return [...map.values()]
}

export function totalOf(totals: MonthTotal[], ym: string, type: 'expense' | 'income'): number {
  return totals.filter((t) => t.month.startsWith(ym) && t.type === type).reduce((s, t) => s + t.total, 0)
}

/** 증감률(%). 비교 대상이 0이면 null */
export function pctChange(cur: number, base: number): number | null {
  if (!base) return null
  return Math.round(((cur - base) / base) * 1000) / 10
}

export interface CategoryRow {
  id: string | null
  name: string
  amount: number
  prev: number
  share: number // 0~1
}

/** 분류별 지출, 큰 것부터. 분류 없는 지출은 '분류 없음' */
export function categoryBreakdown(cur: Transaction[], prev: Transaction[], categories: Category[]): CategoryRow[] {
  const names = new Map(categories.map((c) => [c.id, c.name]))
  const sum = (txs: Transaction[]) => {
    const m = new Map<string | null, number>()
    for (const t of txs) if (t.type === 'expense') m.set(t.category_id, (m.get(t.category_id) ?? 0) + t.amount)
    return m
  }
  const a = sum(cur)
  const b = sum(prev)
  const total = [...a.values()].reduce((s, v) => s + v, 0)
  return [...a.entries()]
    .map(([id, amount]) => ({
      id, name: (id && names.get(id)) || '분류 없음', amount, prev: b.get(id) ?? 0, share: total ? amount / total : 0,
    }))
    .sort((x, y) => y.amount - x.amount)
}

/** 누구를 위한 지출인가별 합계 */
export function scopeSplit(cur: Transaction[]): Record<Scope, number> {
  const out: Record<Scope, number> = { shared: 0, husband: 0, wife: 0 }
  for (const t of cur) if (t.type === 'expense') out[t.scope] += t.amount
  return out
}
