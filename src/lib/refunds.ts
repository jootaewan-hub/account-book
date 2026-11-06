export interface TransactionRefund {
  id: string
  amount: number
  requested_on: string
  refunded_on: string | null
}

export type TransactionRefundRow = Omit<TransactionRefund, 'amount'> & { amount: number | string }

export const REFUND_COLUMNS = 'id, amount, requested_on, refunded_on'

export function normalizeRefunds(rows: readonly TransactionRefundRow[] = []): TransactionRefund[] {
  return rows.map((row) => ({ ...row, amount: Number(row.amount) })).sort((a, b) =>
    a.requested_on.localeCompare(b.requested_on) || a.id.localeCompare(b.id))
}

export function confirmedRefundTotal(refunds: readonly TransactionRefund[] = []): number {
  return refunds.reduce((sum, refund) => sum + (refund.refunded_on ? refund.amount : 0), 0)
}

/** 완료된 환불은 원래 지출의 날짜와 분류에서 차감한다. */
export function netAmount(transaction: { type: 'income' | 'expense'; amount: number; refunds?: TransactionRefund[] }): number {
  return transaction.amount - (transaction.type === 'expense' ? confirmedRefundTotal(transaction.refunds) : 0)
}

/** CSV의 기존 열을 유지하면서 원래 결제와 환불 정보를 한 행에 내보낸다. */
export function exportRefundMemo(memo: string | null, amount: number, rows: TransactionRefundRow[] = []): string | null {
  if (rows.length === 0) return memo
  const refunds = normalizeRefunds(rows)
  return [
    memo,
    ...refunds.map((refund) => refund.refunded_on
      ? `환불 완료 ${refund.amount}원 (요청 ${refund.requested_on}, 완료 ${refund.refunded_on})`
      : `환불 대기 ${refund.amount}원 (요청 ${refund.requested_on})`),
    `순지출 ${amount - confirmedRefundTotal(refunds)}원`,
  ].filter(Boolean).join(' · ')
}
