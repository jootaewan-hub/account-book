// 통계 화면 계산: 12개월 추이, 전월·전년 대비, 분류별·용도별 지출
import { NON_PURCHASE_CATEGORIES, normMerchant } from './categorize'
import { addMonths } from './dates'
import { OTHER_PLATFORM, platformOfTx } from './platform'
import type { Category, MonthTotal, Scope, Transaction } from './types'

export { OTHER_PLATFORM, platformOf } from './platform'

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
  const out: Record<Scope, number> = { shared: 0, husband: 0, wife: 0, child: 0 }
  for (const t of cur) if (t.type === 'expense') out[t.scope] += t.amount
  return out
}

export interface PlatformRow {
  name: string
  /** platform: 쿠팡 같은 온라인 플랫폼, merchant: 플랫폼이 없는 매장 결제의 가게 이름, other: 이름이 없는 결제 */
  kind: 'platform' | 'merchant' | 'other'
  amount: number
  count: number
  prev: number
}

/**
 * 어디서 샀나: 플랫폼별, 플랫폼이 없는 매장 결제는 가게 이름별. 한 번만 간 가게도 묶지 않고 따로 둔다(사용자 2026-10-26:
 * 묶으면 정확히 볼 수 없다). 이름이 없는 결제만 마지막에 한 줄로. 반복 항목으로 들어온 것과 대출이자·관리비·보험·통신·주거·세금처럼
 * '산 것'이 아닌 분류는 뺀다
 */
export function platformBreakdown(cur: Transaction[], prev: Transaction[], categories: Category[] = []): PlatformRow[] {
  const skip = new Set(categories.filter((c) => NON_PURCHASE_CATEGORIES.has(c.name)).map((c) => c.id))
  const keyOf = (t: Transaction): Pick<PlatformRow, 'name' | 'kind'> | null => {
    if (t.type !== 'expense' || t.recurring_id || (t.category_id && skip.has(t.category_id))) return null
    const p = platformOfTx(t)
    if (p) return { name: p, kind: 'platform' }
    const m = normMerchant(t.title)
    return m ? { name: m, kind: 'merchant' } : { name: OTHER_PLATFORM, kind: 'other' }
  }
  const sum = (txs: Transaction[]) => {
    const m = new Map<string, Pick<PlatformRow, 'name' | 'kind' | 'amount' | 'count'>>()
    for (const t of txs) {
      const k = keyOf(t)
      if (!k) continue
      const v = m.get(`${k.kind}\n${k.name}`) ?? { ...k, amount: 0, count: 0 }
      v.amount += t.amount; v.count++
      m.set(`${k.kind}\n${k.name}`, v)
    }
    return m
  }
  const a = sum(cur)
  const b = sum(prev)
  const rows = [...a].map(([k, v]): PlatformRow => ({ ...v, prev: b.get(k)?.amount ?? 0 }))
  // 금액 큰 순서, 같으면 많이 간 순서. 이름 없는 결제는 맨 뒤
  return rows.sort((x, y) => Number(x.kind === 'other') - Number(y.kind === 'other') || y.amount - x.amount || y.count - x.count)
}
