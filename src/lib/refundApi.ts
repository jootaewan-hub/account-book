import { REFUND_COLUMNS, type TransactionRefund, type TransactionRefundRow } from './refunds'
import { sb } from './supabase'

const table = () => sb().from('transaction_refunds')

export async function saveRefund(
  transaction: { id: string; household_id: string },
  refund: TransactionRefund,
  inserting: boolean,
): Promise<TransactionRefund> {
  const { id, ...fields } = refund
  if (inserting) {
    const { data, error } = await table().insert({
      id, transaction_id: transaction.id, household_id: transaction.household_id, ...fields,
    }).select(REFUND_COLUMNS).single<TransactionRefundRow>()
    if (!error) return { ...data, amount: Number(data.amount) }
    // 서버에 반영됐지만 응답을 받지 못한 경우에도 같은 ID를 다시 쓴다.
    if (error.code !== '23505') throw new Error(error.message)
  }
  const { data, error } = await table().update(fields).eq('transaction_id', transaction.id).eq('id', id)
    .select(REFUND_COLUMNS).single<TransactionRefundRow>()
  if (error) throw new Error(error.message)
  return { ...data, amount: Number(data.amount) }
}

export async function deleteRefund(transactionId: string, refundId: string): Promise<void> {
  const { error } = await table().delete().eq('transaction_id', transactionId).eq('id', refundId)
  if (error) throw new Error(error.message)
}
