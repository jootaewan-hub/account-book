import { dayOf } from './dates'
import type { Member, PaymentMethod, Transaction, TxType } from './types'

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

/** 누가 낸 돈인가: 'shared'(공동 계좌·카드) 또는 사용자 id. 결제수단이 없으면 입력한 사람. */
export function payerOf(t: Transaction, methods: Map<string, PaymentMethod>): string {
  const m = t.payment_method_id ? methods.get(t.payment_method_id) : undefined
  if (!m || m.owner_type === 'entered_by') return t.created_by
  if (m.owner_type === 'shared') return 'shared'
  return m.owner_user_id ?? t.created_by
}

/** 누구를 위한 지출(수입)인가: 'shared' 또는 사용자 id */
export function scopeKey(t: Transaction): string {
  return t.scope === 'shared' ? 'shared' : (t.scope_user_id as string)
}

export interface Settlement {
  paid: Record<string, number> // 공동 지출 중 각자 개인 수단으로 낸 금액
  /** 보낼 사람 → 받을 사람, 금액. 0이면 정산할 것 없음 */
  from: string | null
  to: string | null
  amount: number
}

/**
 * 공동 지출 중 개인 결제수단으로 낸 돈만 모아 분담 비율대로 나눈다.
 * 공동 계좌·카드로 낸 돈은 이미 함께 낸 것이므로 제외한다.
 * ratio는 owner가 부담할 몫(0~1).
 */
export function settle(
  txs: Transaction[],
  methods: Map<string, PaymentMethod>,
  members: Member[],
  ratio: number,
): Settlement {
  const owner = members.find((m) => m.role === 'owner')
  const partner = members.find((m) => m.role === 'partner')
  const paid: Record<string, number> = {}
  for (const m of members) paid[m.user_id] = 0
  if (!owner || !partner) return { paid, from: null, to: null, amount: 0 }
  for (const t of txs) {
    if (t.type !== 'expense' || t.scope !== 'shared') continue
    const payer = payerOf(t, methods)
    if (payer === 'shared' || !(payer in paid)) continue
    paid[payer] += t.amount
  }
  const total = paid[owner.user_id] + paid[partner.user_id]
  const diff = Math.round(paid[owner.user_id] - total * ratio) // +면 owner가 더 냄
  if (diff === 0) return { paid, from: null, to: null, amount: 0 }
  return diff > 0
    ? { paid, from: partner.user_id, to: owner.user_id, amount: diff }
    : { paid, from: owner.user_id, to: partner.user_id, amount: -diff }
}

/** 이번 달 1~day일과 지난달 같은 기간의 지출 차이 */
export function samePeriodDiff(cur: Transaction[], prev: Transaction[], day: number): number {
  return sumType(cur, 'expense', day) - sumType(prev, 'expense', day)
}
