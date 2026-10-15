// 관리비 고지서 비교: 이번 달을 전월·전년 같은 달과 견준다.
// 저장된 지난 고지서가 있으면 그 값을, 없으면 이번 고지서에 적혀 있던 전월·전년 값을 쓴다.
import { addMonths } from './dates'
import { pctChange } from './stats'
import type { BillCharge, BillUsage, Recurring, UtilityBill } from './types'

export type Source = 'saved' | 'printed'

export interface CompareRow {
  name: string
  unit: string | null
  cur: number
  prev: number | null
  prevFrom: Source | null
  prevPct: number | null
  lastYear: number | null
  lastYearFrom: Source | null
  lastYearPct: number | null
}

export interface BillComparison {
  month: string // YYYY-MM
  total: CompareRow
  usages: CompareRow[]
  charges: CompareRow[]
}

const key = (name: string) => name.replace(/\s+/g, '').toLowerCase()

function row(
  name: string, unit: string | null, cur: number,
  saved: [number | null | undefined, number | null | undefined], printed: [number | null, number | null],
): CompareRow {
  const pick = (s: number | null | undefined, p: number | null): [number | null, Source | null] =>
    s !== null && s !== undefined ? [s, 'saved'] : p !== null ? [p, 'printed'] : [null, null]
  const [prev, prevFrom] = pick(saved[0], printed[0])
  const [lastYear, lastYearFrom] = pick(saved[1], printed[1])
  return {
    name, unit, cur, prev, prevFrom, prevPct: prev === null ? null : pctChange(cur, prev),
    lastYear, lastYearFrom, lastYearPct: lastYear === null ? null : pctChange(cur, lastYear),
  }
}

type Lines = Pick<UtilityBill, 'bill_month' | 'total' | 'charges' | 'usages'>

/** bill을 history(다른 달 고지서들)의 전월·전년 같은 달과 비교한다 */
export function compareBill(bill: Lines, history: Lines[]): BillComparison {
  const ym = bill.bill_month.slice(0, 7)
  const find = (m: string) => history.find((b) => b.bill_month.startsWith(m))
  const p = find(addMonths(ym, -1))
  const y = find(addMonths(ym, -12))
  const usageOf = (b: Lines | undefined, u: BillUsage) => b?.usages.find((x) => key(x.name) === key(u.name))?.amount
  const chargeOf = (b: Lines | undefined, c: BillCharge) => b?.charges.find((x) => key(x.name) === key(c.name))?.amount
  return {
    month: ym,
    total: row('관리비 합계', '원', bill.total, [p?.total, y?.total], [null, null]),
    usages: bill.usages.map((u) => row(u.name, u.unit, u.amount, [usageOf(p, u), usageOf(y, u)], [u.prev_month, u.last_year])),
    charges: bill.charges
      .map((c) => row(c.name, '원', c.amount, [chargeOf(p, c), chargeOf(y, c)], [c.prev_month, c.last_year]))
      .sort((a, b) => b.cur - a.cur),
  }
}

/** 최근 n개월 관리비 합계 (없는 달은 null) */
export function billTrend(bills: Lines[], ym: string, n = 12): { ym: string; total: number | null }[] {
  return Array.from({ length: n }, (_, i) => {
    const m = addMonths(ym, i - n + 1)
    return { ym: m, total: bills.find((b) => b.bill_month.startsWith(m))?.total ?? null }
  })
}

/** 관리비 지출을 연결할 반복 항목: 금액을 매달 넣는 관리비·공과금 중 '관리비'가 들어간 것, 없으면 하나뿐인 것 */
export function billRecurring(list: Recurring[]): Recurring | null {
  const variable = list.filter((r) => r.active && r.kind === 'utility' && r.amount === null && r.type === 'expense')
  return variable.find((r) => r.title.includes('관리비')) ?? (variable.length === 1 ? variable[0] : null)
}

/** 사용량 숫자: 정수면 쉼표, 소수면 셋째 자리까지 */
export function formatUsage(v: number): string {
  return Number.isInteger(v) ? v.toLocaleString('ko-KR') : v.toLocaleString('ko-KR', { maximumFractionDigits: 3 })
}
