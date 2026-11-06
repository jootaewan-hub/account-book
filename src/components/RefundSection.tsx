import { useState, type FormEvent } from 'react'
import { friendlyError } from '../lib/api'
import { won } from '../lib/format'
import { deleteRefund, saveRefund } from '../lib/refundApi'
import { confirmedRefundTotal, normalizeRefunds, type TransactionRefund } from '../lib/refunds'
import type { Transaction } from '../lib/types'
import './RefundSection.css'

interface Props {
  transaction: Transaction
  today: string
  onChanged: () => void
}

export function RefundSection({ transaction, today, onChanged }: Props) {
  const [refunds, setRefunds] = useState(() => normalizeRefunds(transaction.refunds))
  const [draft, setDraft] = useState<TransactionRefund | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const confirmed = confirmedRefundTotal(refunds)
  const available = transaction.amount - refunds.reduce((sum, refund) => sum + refund.amount, 0)
  const existing = refunds.find((refund) => refund.id === draft?.id)
  const max = available + (existing?.amount ?? 0)

  function open(refund: TransactionRefund | null) {
    setError('')
    setConfirmDelete(false)
    setDraft(refund)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !draft) return
    if (!Number.isSafeInteger(draft.amount) || draft.amount <= 0 || draft.amount > max) {
      setError(`1원부터 ${won(max)}원까지 입력해 주세요.`)
      return
    }
    setBusy(true)
    setError('')
    try {
      const saved = await saveRefund(transaction, draft, !existing)
      setRefunds((rows) => normalizeRefunds([...rows.filter((r) => r.id !== saved.id), saved]))
      open(null)
      onChanged()
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!existing || busy) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setBusy(true)
    setError('')
    try {
      await deleteRefund(transaction.id, existing.id)
      setRefunds((rows) => rows.filter((r) => r.id !== existing.id))
      open(null)
      onChanged()
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  if (!refunds.length && transaction.occurred_on > today) return null

  return (
    <section className="field refund-section" aria-label="환불 기록">
      <div className="refund-heading">
        <h3 className="lbl">환불 기록</h3>
        {refunds.length > 0 && <span className="num" role="status">순지출 {won(transaction.amount - confirmed)}원</span>}
      </div>
      {refunds.length > 0 && (
        <ul className="refund-list">
          {refunds.map((refund) => (
            <li key={refund.id}>
              <span>
                <b>{refund.refunded_on ? '환불 완료' : '환불 대기'}</b> <span className="num">{won(refund.amount)}원</span>
                <span className="tx-meta">요청 {refund.requested_on}{refund.refunded_on && ` · 완료 ${refund.refunded_on}`}</span>
              </span>
              <button type="button" className="ghost" aria-label={`${refund.requested_on} 요청, ${won(refund.amount)}원 환불 수정`}
                onClick={() => open(refund)} disabled={busy}>수정</button>
            </li>
          ))}
        </ul>
      )}
      {draft ? (
        <form className="field refund-form" onSubmit={submit}>
          <label className="field">상태
            <select className="input" value={draft.refunded_on !== null ? 'refunded' : 'waiting'} disabled={busy}
              onChange={(event) => setDraft({ ...draft, refunded_on: event.target.value === 'refunded' ? today : null })}>
              <option value="waiting">환불 대기</option>
              <option value="refunded">환불 완료</option>
            </select>
          </label>
          <label className="field">환불 금액
            <input className="input num" type="text" inputMode="numeric" pattern="[0-9]+" placeholder={`최대 ${won(max)}원`} required disabled={busy}
              value={draft.amount || ''} onChange={(event) => setDraft({ ...draft, amount: Number(event.target.value.replace(/[^0-9]/g, '')) })} />
          </label>
          <label className="field">요청일
            <input className="input" type="date" required min={transaction.occurred_on} max={draft.refunded_on || today} value={draft.requested_on}
              disabled={busy} onChange={(event) => setDraft({ ...draft, requested_on: event.target.value })} />
          </label>
          {draft.refunded_on !== null && (
            <label className="field">완료일
              <input className="input" type="date" required min={draft.requested_on} max={today} value={draft.refunded_on}
                disabled={busy} onChange={(event) => setDraft({ ...draft, refunded_on: event.target.value })} />
            </label>
          )}
          {error && <p className="err" role="alert">{error}</p>}
          <div className="form-grid">
            <button type="button" className="ghost" onClick={() => open(null)} disabled={busy}>취소</button>
            <button type="submit" className="primary" disabled={busy}>{busy ? '처리 중…' : '환불 저장'}</button>
          </div>
          {existing && <button type="button" className="danger" onClick={remove} disabled={busy}>
            {confirmDelete ? '한 번 더 누르면 환불 기록을 지워요' : '환불 기록 삭제'}
          </button>}
        </form>
      ) : available > 0 && (
        <button type="button" className="ghost" onClick={() => open({
          id: crypto.randomUUID(), amount: 0, requested_on: today, refunded_on: null,
        })}>환불 기록 추가</button>
      )}
    </section>
  )
}
