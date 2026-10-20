import { useEffect, useMemo, useState } from 'react'
import { billRecurring, compareBill } from '../lib/bills'
import { fetchBills, fetchRecurring, friendlyError, saveUtilityBill } from '../lib/api'
import { won } from '../lib/format'
import type { CheckedBill } from '../lib/smart'
import type { Category, Recurring, UtilityBill } from '../lib/types'
import { BillTable } from './BillTable'

interface Props {
  bill: CheckedBill
  householdId: string
  today: string
  categories: Category[]
  onSaved: (count: number, date: string, msg: string) => Promise<void>
  onRetry: () => void
}

/** 읽은 관리비 고지서 확인: 몇 월분·금액을 고치고, 전월·전년과 비교해 보고, 가계부 지출로도 넣는다 */
export function BillReview({ bill, householdId, today, categories, onSaved, onRetry }: Props) {
  const [month, setMonth] = useState(bill.bill_month ?? today.slice(0, 7))
  const [total, setTotal] = useState(bill.total ? String(bill.total) : '')
  const [addExpense, setAddExpense] = useState(true)
  const [date, setDate] = useState(bill.due_date && bill.due_date <= addDays(today, 31) ? bill.due_date : today)
  const [history, setHistory] = useState<UtilityBill[]>([])
  const [recurring, setRecurring] = useState<Recurring[] | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    Promise.all([fetchBills(householdId), fetchRecurring(householdId)])
      .then(([b, r]) => { setHistory(b); setRecurring(r) })
      .catch((e) => setErr(friendlyError(e)))
  }, [householdId])

  const n = parseInt(total || '0', 10)
  const billMonth = `${month}-01`
  const cmp = useMemo(() => compareBill(
    { bill_month: billMonth, total: n, charges: bill.charges, usages: bill.usages },
    history.filter((h) => h.bill_month !== billMonth),
  ), [bill, billMonth, n, history])
  const rec = billRecurring(recurring ?? [])
  const category = rec?.category_id ?? categories.find((c) => c.type === 'expense' && c.name === '관리비')?.id ?? null
  const already = history.find((h) => h.bill_month === billMonth)
  const m = Number(month.slice(5, 7))
  const sum = bill.charges.reduce((s, c) => s + c.amount, 0)

  async function save() {
    if (!/^\d{4}-\d{2}$/.test(month)) return setErr('몇 월분인지 골라 주세요.')
    if (!n) return setErr('부과 금액을 입력해 주세요.')
    if (addExpense && !date) return setErr('지출 날짜를 골라 주세요.')
    setBusy(true); setErr('')
    try {
      await saveUtilityBill(householdId, {
        bill_month: billMonth, total: n, due_date: bill.due_date, charges: bill.charges, usages: bill.usages,
      }, addExpense ? { occurred_on: date, title: `관리비 (${m}월분)`, category_id: category, scope: 'shared', recurring: rec } : null)
      await onSaved(addExpense ? 1 : 0, addExpense ? date : today, `${m}월분 관리비를 저장했어요`)
    } catch (e) {
      setErr(friendlyError(e)); setBusy(false)
    }
  }

  return (
    <>
      {!bill.is_bill && <p className="banner">관리비 고지서가 아닌 것 같아요.{bill.note ? ` ${bill.note}` : ''} 다른 사진으로 해 보세요.</p>}
      {bill.is_bill && bill.note && <p className="note">{bill.note}</p>}
      <div className="card draft">
        <div className="row2">
          <div className="field">
            <label htmlFor="bill-month">몇 월분</label>
            <input id="bill-month" type="month" className="input date-input" value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="bill-total">부과 금액</label>
            <input id="bill-total" className="input num" inputMode="numeric" value={total}
              onChange={(e) => setTotal(e.target.value.replace(/\D/g, '').slice(0, 9))} />
          </div>
        </div>
        {bill.charges.length > 0 && sum !== n && (
          <p className="banner">항목 합계 {won(sum)}원이 부과 금액 {won(n)}원과 달라요. 고지서를 확인해 주세요.</p>
        )}
        {already && <p className="note">{m}월분 고지서가 이미 있어요. 저장하면 지금 읽은 값으로 바꾸고, 연결된 지출도 고쳐요.</p>}
        <BillTable cmp={cmp} />
      </div>

      <div className="card">
        <label className="check">
          <input type="checkbox" checked={addExpense} onChange={(e) => setAddExpense(e.target.checked)} />
          가계부에 {won(n)}원 지출로도 넣기 (분류: 관리비, 공동)
        </label>
        {addExpense && (
          <div className="field" style={{ marginTop: 10 }}>
            <label htmlFor="bill-date">지출 날짜{bill.due_date ? ` (납부 마감 ${bill.due_date})` : ''}</label>
            <input id="bill-date" type="date" className="input date-input" value={date} onChange={(e) => setDate(e.target.value)} />
            {date && recurring && (
              <span className="tx-meta">
                {rec
                  ? `고정 탭의 '${rec.title}' ${Number(date.slice(5, 7))}월 분으로 넣어요. 입력할 차례 알림이 꺼져요.`
                  : `고정 탭의 관리비·공과금에 '관리비' 항목을 만들어 ${Number(date.slice(5, 7))}월 분으로 넣어요. 다음 달부터 입력할 차례를 알려 드려요.`}
              </span>
            )}
          </div>
        )}
      </div>
      <p className="err" role="alert">{err}</p>
      <button className="primary" disabled={busy || !bill.is_bill} onClick={save}>{busy ? '저장 중…' : '저장'}</button>
      <button className="ghost" disabled={busy} onClick={onRetry}>다시 하기</button>
    </>
  )
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
