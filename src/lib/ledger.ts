import { dayOf } from './dates'
import type { PaymentMethod, Spouse, Transaction, TxType } from './types'

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

/**
 * 누가 낸 돈인가: 결제수단 주인으로 정한다.
 * 공동 계좌·카드는 'shared', 현금처럼 '입력한 사람'이거나 결제수단이 없으면 입력한 사람의 역할.
 * 역할을 알 수 없으면 null.
 */
export function payerOf(
  t: Transaction,
  methods: Map<string, PaymentMethod>,
  roleOf: (userId: string) => Spouse | null,
): Spouse | 'shared' | null {
  const m = t.payment_method_id ? methods.get(t.payment_method_id) : undefined
  if (!m || m.owner === 'entered_by') return roleOf(t.created_by)
  return m.owner
}

export interface Settlement {
  paid: Record<Spouse, number> // 공동 지출 중 각자 개인 수단으로 낸 금액
  from: Spouse | null // 보낼 사람
  to: Spouse | null // 받을 사람
  amount: number
}

/**
 * 공동 지출 중 개인 결제수단으로 낸 돈만 모아 분담 비율대로 나눈다.
 * 공동 계좌·카드로 낸 돈은 이미 함께 낸 것이므로 제외한다.
 * husbandShare: 남편이 부담할 몫(0~1).
 */
export function settle(
  txs: Transaction[],
  methods: Map<string, PaymentMethod>,
  roleOf: (userId: string) => Spouse | null,
  husbandShare: number,
): Settlement {
  const paid: Record<Spouse, number> = { husband: 0, wife: 0 }
  for (const t of txs) {
    if (t.type !== 'expense' || t.scope !== 'shared') continue
    const payer = payerOf(t, methods, roleOf)
    if (payer === 'husband' || payer === 'wife') paid[payer] += t.amount
  }
  const total = paid.husband + paid.wife
  const diff = Math.round(paid.husband - total * husbandShare) // +면 남편이 더 냄
  if (diff === 0) return { paid, from: null, to: null, amount: 0 }
  return diff > 0
    ? { paid, from: 'wife', to: 'husband', amount: diff }
    : { paid, from: 'husband', to: 'wife', amount: -diff }
}

/** 이번 달 1~day일과 지난달 같은 기간의 지출 차이 */
export function samePeriodDiff(cur: Transaction[], prev: Transaction[], day: number): number {
  return sumType(cur, 'expense', day) - sumType(prev, 'expense', day)
}
