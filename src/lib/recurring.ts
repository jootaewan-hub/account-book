// 고정지출·구독·관리비 계산. DB의 generate_recurring과 같은 규칙(31일 → 그 달 마지막 날, 매년은 시작 달 기준)을 쓴다.
import { addMonths, daysInMonth, monthRange, ymd, parseYM } from './dates'
import type { MonthTotal, Recurring, RecurringKind, Transaction } from './types'

export const KIND_LABEL: Record<RecurringKind, string> = { fixed: '고정지출', subscription: '구독', utility: '관리비·공과금', installment: '할부' }

const monthIndex = (ym: string) => { const { y, m } = parseYM(ym); return y * 12 + m - 1 }

/** 그 달에 내야 하는 날(YYYY-MM-DD). 그 달이 대상이 아니면 null */
export function dueDate(r: Pick<Recurring, 'day_of_month' | 'every_months' | 'start_month' | 'end_month'>, ym: string): string | null {
  const start = r.start_month.slice(0, 7)
  if (ym < start) return null
  if (r.end_month && ym > r.end_month.slice(0, 7)) return null
  if ((monthIndex(ym) - monthIndex(start)) % r.every_months !== 0) return null
  const { y, m } = parseYM(ym)
  return ymd(y, m, Math.min(r.day_of_month, daysInMonth(ym)))
}

/** 오늘 이후 처음 내는 날 (최대 24개월 앞까지) */
export function nextDue(r: Recurring, today: string): string | null {
  for (let i = 0; i < 24; i++) {
    const d = dueDate(r, addMonths(today.slice(0, 7), i))
    if (d && d >= today) return d
  }
  return null
}

/** 한 달 기준 금액 (연간 구독은 12로 나눔) */
export function monthlyAmount(r: Recurring): number {
  return r.amount === null ? 0 : Math.round(r.amount / r.every_months)
}

/**
 * 금액을 매달 넣어야 하는 항목 중, 이번 달 날짜가 지났는데 아직 안 넣은 것.
 * 어느 달 분인지는 recurring_month가 기준이다 (DB의 유일 제약과 같아서, 내역 날짜를 고쳐도 달이 바뀌지 않는다). 없으면 날짜로 본다
 */
export function pendingInputs(list: Recurring[], txs: Transaction[], today: string): { r: Recurring; due: string }[] {
  const ym = today.slice(0, 7)
  const done = new Set(txs.filter((t) => t.recurring_id && (t.recurring_month ?? t.occurred_on).startsWith(ym)).map((t) => t.recurring_id))
  const out: { r: Recurring; due: string }[] = []
  for (const r of list) {
    if (!r.active || r.amount !== null || done.has(r.id)) continue
    const due = dueDate(r, ym)
    if (due && due <= today) out.push({ r, due })
  }
  return out
}

/** 달력에 보이는 고정지출 예정분. round는 할부의 [회차, 총 개월 수] */
export interface PlannedCharge { r: Recurring; date: string; amount: number; round: [number, number] | null }

/**
 * 그 달의 고정지출 예정분(D-030): 내는 날이 오늘보다 뒤라 아직 내역으로 들어가지 않은 것.
 * DB의 generate_recurring이 오늘까지 넣으므로 오늘 뒤만 보면 겹치지 않는다. 그래도 그 달 분을 미리 넣었으면 뺀다(pendingInputs와 같은 기준).
 * 금액을 매달 넣는 항목(관리비 등)은 숫자가 없으므로 넣지 않고, 수입도 넣지 않는다.
 */
export function plannedInMonth(list: Recurring[], txs: Transaction[], ym: string, today: string): PlannedCharge[] {
  const done = new Set(txs.filter((t) => t.recurring_id && (t.recurring_month ?? t.occurred_on).startsWith(ym)).map((t) => t.recurring_id))
  const out: PlannedCharge[] = []
  for (const r of list) {
    if (!r.active || r.type !== 'expense' || r.amount === null || done.has(r.id)) continue
    const date = dueDate(r, ym)
    if (!date || date <= today) continue
    // DB가 넣는 메모 "할부 n/m회"와 같은 셈: 총 개월 수 - 마지막 달까지 남은 달 수
    const round: [number, number] | null = r.kind === 'installment' && r.installment_months && r.end_month
      ? [r.installment_months - (monthIndex(r.end_month.slice(0, 7)) - monthIndex(ym)), r.installment_months] : null
    out.push({ r, date, amount: r.amount, round })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount)
}

/**
 * 예정분을 내역 모양으로(D-030 보충): 고정지출은 이미 정해진 지출이라 달력·내역·통계 합계에 실제 내역과 같은 계산으로 넣는다.
 * DB에 없는 행이므로 id를 'plan:'으로 시작하고 planned를 붙여, 고치기·지우기·고르기에서 뺀다
 */
export function plannedTxs(list: Recurring[], txs: Transaction[], ym: string, today: string): Transaction[] {
  return plannedInMonth(list, txs, ym, today).map(({ r, date, amount, round }) => ({
    id: `plan:${r.id}:${ym}`, household_id: r.household_id, type: 'expense', occurred_on: date, amount, title: r.title, memo: null,
    category_id: r.category_id, payment_method_id: r.payment_method_id, scope: r.scope, source: 'recurring', created_by: '', created_at: '',
    recurring_id: r.id, recurring_month: `${ym}-01`, platform: null, planned: { kind: r.kind, round },
  }))
}

/** 통계 12개월 막대에 더할 달별 예정 합계: from~to 중 이번 달부터만(지난 달은 이미 내역이다) */
export function plannedTotals(list: Recurring[], txs: Transaction[], fromYm: string, toYm: string, today: string): MonthTotal[] {
  const out: MonthTotal[] = []
  for (let ym = fromYm > today.slice(0, 7) ? fromYm : today.slice(0, 7); ym <= toYm; ym = addMonths(ym, 1)) {
    const ps = plannedInMonth(list, txs, ym, today)
    if (ps.length) out.push({ month: `${ym}-01`, type: 'expense', total: ps.reduce((s, p) => s + p.amount, 0), n: ps.length })
  }
  return out
}

/**
 * 고정 탭에서 고른 달의 한 항목(D-030 보충). done: 그 달 분 내역이 있음(금액은 내역 값), planned: 내는 날이 오늘 뒤,
 * missing: 내는 날이 지났는데 내역이 없음, none: 그 달에 내지 않음(매년 다른 달, 시작 전·끝난 뒤, 꺼 둠).
 * 금액을 매달 넣는 항목은 지난번 금액을 estimate로 붙인다(합계에는 넣지 않고 따로 보인다)
 */
export type MonthState = 'done' | 'planned' | 'missing' | 'none'
export interface MonthItem { date: string | null; state: MonthState; amount: number | null; estimate: boolean }

export function monthItem(r: Recurring, txs: Transaction[], history: Transaction[], ym: string, today: string): MonthItem {
  const rec = txs.find((t) => !t.planned && t.recurring_id === r.id && (t.recurring_month ?? t.occurred_on).startsWith(ym))
  if (rec) return { date: rec.occurred_on, state: 'done', amount: rec.amount, estimate: false }
  const date = dueDate(r, ym)
  if (!date || !r.active) return { date: null, state: 'none', amount: r.amount, estimate: false }
  const state: MonthState = date > today ? 'planned' : 'missing'
  if (r.amount !== null) return { date, state, amount: r.amount, estimate: false }
  return { date, state, amount: pastAmounts(r, history)[0]?.amount ?? null, estimate: true }
}

/**
 * 고정 탭이 읽는 내역 기간: 지난 5개월(구독 찾기)부터 다음 달 말까지.
 * 관리비 고지서는 납부 마감일(오늘보다 뒤, 다음 달일 수도 있다)로 넣으므로 오늘까지만 읽으면 이번 달 분을 못 본다
 */
export function historyRange(today: string): { from: string; to: string } {
  const ym = today.slice(0, 7)
  return { from: `${addMonths(ym, -5)}-01`, to: monthRange(addMonths(ym, 1)).end }
}

/** 같은 반복 항목의 지난 금액들 (최근 것부터) */
export function pastAmounts(r: Recurring, txs: Transaction[]): { date: string; amount: number }[] {
  return txs.filter((t) => t.recurring_id === r.id)
    .sort((a, b) => b.occurred_on.localeCompare(a.occurred_on))
    .map((t) => ({ date: t.occurred_on, amount: t.amount }))
}

const normTitle = (s: string) => s.replace(/\(주\)|㈜|주식회사|\s+/g, '').toLowerCase()

export interface SubscriptionCandidate {
  title: string
  amount: number
  day: number
  months: string[]
  category_id: string | null
  payment_method_id: string | null
}

/**
 * 구독처럼 보이는 지출: 같은 이름·같은 금액이 서로 다른 2개월 이상 나온 것.
 * 이미 반복 항목으로 등록됐거나 반복 항목에서 만들어진 내역은 뺀다.
 */
export function subscriptionCandidates(txs: Transaction[], list: Recurring[]): SubscriptionCandidate[] {
  const known = new Set(list.map((r) => normTitle(r.title)))
  const groups = new Map<string, Transaction[]>()
  for (const t of txs) {
    if (t.type !== 'expense' || t.recurring_id || !t.title.trim()) continue
    const key = `${normTitle(t.title)}|${t.amount}`
    if (known.has(normTitle(t.title))) continue
    groups.set(key, [...(groups.get(key) ?? []), t])
  }
  const out: SubscriptionCandidate[] = []
  for (const g of groups.values()) {
    const months = [...new Set(g.map((t) => t.occurred_on.slice(0, 7)))].sort()
    if (months.length < 2) continue
    const last = g[g.length - 1]
    out.push({
      title: last.title, amount: last.amount, day: Number(last.occurred_on.slice(8, 10)), months,
      category_id: last.category_id, payment_method_id: last.payment_method_id,
    })
  }
  return out.sort((a, b) => b.amount - a.amount)
}

/** 할부 총액을 개월 수로 나눈다. 나누어떨어지지 않는 원 단위 나머지는 첫 회차에 넣는다 */
export function installmentPlan(total: number, months: number): { first: number; rest: number } {
  const rest = Math.floor(total / months)
  return { first: total - rest * (months - 1), rest }
}

/** 시작 달(YYYY-MM)부터 term개월째 달(1일): 기간을 정한 항목의 end_month */
export function endMonthFor(startYm: string, term: number): string {
  return `${addMonths(startYm, term - 1)}-01`
}

/** 기간(개월 수). 끝나는 달이 없거나 매년 항목(기간을 쓰지 않는다)이면 null */
export function termOf(r: Pick<Recurring, 'start_month' | 'end_month' | 'every_months'>): number | null {
  if (!r.end_month || r.every_months !== 1) return null
  return monthIndex(r.end_month.slice(0, 7)) - monthIndex(r.start_month.slice(0, 7)) + 1
}

/** 끝나는 달이 있는 항목(할부, 기간을 정한 고정지출·구독)의 오늘 이후 남은 회차. 끝나는 달이 없으면 null */
export function termLeft(r: Pick<Recurring, 'day_of_month' | 'every_months' | 'start_month' | 'end_month'>, today: string): number | null {
  return r.end_month ? installmentsLeft(r, today) : null
}

/** 할부 항목에서 오늘 이후 남은 회차 수 */
export function installmentsLeft(r: Pick<Recurring, 'day_of_month' | 'every_months' | 'start_month' | 'end_month'>, today: string): number {
  if (!r.end_month) return 0
  let n = 0
  for (let ym = today.slice(0, 7); ym <= r.end_month.slice(0, 7); ym = addMonths(ym, 1)) {
    const d = dueDate(r, ym)
    if (d && d >= today) n++
  }
  return n
}
