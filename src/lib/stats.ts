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
  const out: Record<Scope, number> = { shared: 0, husband: 0, wife: 0, child: 0 }
  for (const t of cur) if (t.type === 'expense') out[t.scope] += t.amount
  return out
}

// 온라인 쇼핑·배달 플랫폼. 내역 이름(가맹점)으로 알아본다. 긴 표기를 먼저 맞춘다(예: 쿠팡이츠 ≠ 쿠팡)
const PLATFORMS: [string, string[]][] = [
  ['쿠팡이츠', ['쿠팡이츠', 'coupangeats']],
  ['쿠팡', ['쿠팡', 'coupang']],
  ['오늘의집', ['오늘의집', 'ohou', '버킷플레이스']],
  ['컬리', ['마켓컬리', '컬리', 'kurly']],
  ['네이버', ['네이버페이', '네이버쇼핑', '스마트스토어', '네이버', 'naverpay', 'naver', 'npay']],
  ['11번가', ['11번가', '십일번가', '11st']],
  ['G마켓', ['g마켓', '지마켓', 'gmarket']],
  ['옥션', ['옥션', 'auction']],
  ['SSG닷컴', ['ssg닷컴', 'ssg.com', '쓱닷컴']],
  ['무신사', ['무신사', 'musinsa']],
  ['29CM', ['29cm']],
  ['에이블리', ['에이블리', 'ably']],
  ['지그재그', ['지그재그', 'zigzag']],
  ['알리익스프레스', ['알리익스프레스', 'aliexpress', '알리']],
  ['테무', ['테무', 'temu']],
  ['배달의민족', ['배달의민족', '배민', '우아한형제들']],
  ['요기요', ['요기요', 'yogiyo']],
  ['카카오 선물하기', ['카카오선물하기', '카카오톡선물하기', '선물하기']],
  ['당근', ['당근마켓', '당근페이', '당근']],
]
const PLATFORM_ALIASES = PLATFORMS.flatMap(([name, aliases]) => aliases.map((a) => [a, name] as const))
  .sort((a, b) => b[0].length - a[0].length)

export const OTHER_PLATFORM = '그 외 (매장 등)'

/** 내역 이름으로 플랫폼을 알아본다. 모르면 null */
export function platformOf(title: string): string | null {
  const t = title.replace(/\s+/g, '').toLowerCase()
  return PLATFORM_ALIASES.find(([alias]) => t.includes(alias))?.[1] ?? null
}

export interface PlatformRow {
  name: string
  amount: number
  count: number
  prev: number
}

/** 플랫폼별 지출, 큰 것부터. 알아보지 못한 지출은 마지막에 '그 외'로 묶는다 */
export function platformBreakdown(cur: Transaction[], prev: Transaction[]): PlatformRow[] {
  const sum = (txs: Transaction[]) => {
    const m = new Map<string, { amount: number; count: number }>()
    for (const t of txs) {
      if (t.type !== 'expense') continue
      const k = platformOf(t.title) ?? OTHER_PLATFORM
      const v = m.get(k) ?? { amount: 0, count: 0 }
      v.amount += t.amount; v.count++
      m.set(k, v)
    }
    return m
  }
  const a = sum(cur)
  const b = sum(prev)
  const rows = [...a.entries()].map(([name, v]) => ({ name, ...v, prev: b.get(name)?.amount ?? 0 }))
  return [
    ...rows.filter((r) => r.name !== OTHER_PLATFORM).sort((x, y) => y.amount - x.amount),
    ...rows.filter((r) => r.name === OTHER_PLATFORM),
  ]
}
