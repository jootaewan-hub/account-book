import { useCallback, useEffect, useState, type Ref } from 'react'
import { fetchRange, friendlyError } from '../lib/api'
import { monthRange } from '../lib/dates'
import { shortDate } from '../lib/events'
import { won } from '../lib/format'
import { sb } from '../lib/supabase'
import type { Transaction } from '../lib/types'

type LinkedTransaction = Pick<Transaction, 'id' | 'title' | 'occurred_on' | 'amount'>
type PaymentInput = { title: string; amount: string; due_on: string; transaction_id: string | null }
type Payment = { id: string; updated_at: string; title: string; amount: number; due_on: string | null; transaction_id: string | null; transaction: LinkedTransaction | null }

export function EventPayments({ householdId, eventId, eventDate, today, onOpenTransaction, sectionRef }: {
  householdId: string; eventId: string; eventDate: string; today: string; onOpenTransaction: (txId: string) => void
  sectionRef?: Ref<HTMLElement>
}) {
  const [rows, setRows] = useState<Payment[] | null>(null)
  const [draft, setDraft] = useState<{ row: Payment | null; input: PaymentInput } | null>(null)
  const [pick, setPick] = useState(false)
  const [month, setMonth] = useState(today.slice(0, 7))
  const [search, setSearch] = useState('')
  const [choices, setChoices] = useState<Transaction[] | null>(null)
  const [lookupError, setLookupError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const { data, error } = await sb().from('event_payments').select('id,updated_at,title,amount,due_on,transaction_id,transaction:transactions(id,title,occurred_on,amount)')
      .eq('event_id', eventId).eq('household_id', householdId).order('due_on').order('id')
    if (error) throw new Error(error.message)
    return (data ?? []) as unknown as Payment[]
  }, [eventId, householdId])

  useEffect(() => {
    let live = true
    load().then((rows) => { if (live) setRows(rows) }, (e) => { if (live) setError(friendlyError(e)) })
    return () => { live = false }
  }, [load])

  useEffect(() => {
    if (!pick || !month) return
    let live = true
    setChoices(null); setLookupError('')
    const { start, end } = monthRange(month)
    fetchRange(householdId, start, end).then(
      (rows) => { if (live) setChoices(rows.filter((row) => row.type === 'expense').reverse()) },
      (e) => { if (live) setLookupError(friendlyError(e)) },
    )
    return () => { live = false }
  }, [householdId, month, pick])

  function open(row: Payment | null) {
    setDraft({ row, input: { title: row?.title ?? '', amount: row ? String(row.amount) : '', due_on: row?.due_on ?? eventDate, transaction_id: row?.transaction_id ?? null } })
    setPick(false); setSearch(''); setConfirm(false); setError('')
  }

  function select(tx: Transaction) {
    setDraft((current) => current && ({ ...current, input: {
      ...current.input, transaction_id: tx.id, title: current.input.title.trim() || tx.title || '결제',
      amount: current.input.amount || String(tx.amount), due_on: current.input.due_on || tx.occurred_on,
    } }))
    setPick(false)
  }

  async function save(remove = false) {
    if (!draft || busy) return
    if (remove && !confirm) { setConfirm(true); return }
    const { row, input } = draft
    const amount = Number(input.amount)
    const fields = { title: input.title.trim(), amount, due_on: input.due_on || null, transaction_id: input.transaction_id }
    if (!remove && (!fields.title || !Number.isInteger(amount) || amount < 1 || amount > 9999999999 || (!input.due_on && !input.transaction_id))) return
    setBusy(true); setError('')
    try {
      const table = sb().from('event_payments')
      const request = row
        ? (remove ? table.delete() : table.update(fields)).eq('id', row.id).eq('updated_at', row.updated_at)
        : table.insert({ ...fields, event_id: eventId, household_id: householdId })
      const { data, error } = await request.select('id').maybeSingle()
      if (error || !data) throw new Error(error?.message ?? '다른 기기에서 먼저 바뀐 결제예요. 다시 열어 주세요.')
      setDraft(null); setPick(false)
      setRows(await load())
    } catch (e) { setError(friendlyError(e)) } finally { setBusy(false) }
  }

  const matching = choices?.filter((tx) => !rows?.some((row) => row.id !== draft?.row?.id && row.transaction_id === tx.id)
    && `${tx.title} ${tx.merchant ?? ''} ${tx.memo ?? ''} ${tx.amount}`.toLowerCase().includes(search.trim().toLowerCase()))

  return <section className="event-payments" aria-label="일정 결제" tabIndex={-1} ref={sectionRef}>
    <div className="household-tasks-head">
      <h3 className="section-title">일정 결제</h3>
      <button type="button" className="link-btn" onClick={() => open(null)} disabled={busy || !rows}>결제 추가</button>
    </div>
    {error && <p className="banner" role="alert">{error}</p>}
    {!rows && !error && <p className="plan-note" role="status">결제 불러오는 중</p>}
    {rows?.length === 0 && <p className="plan-note">예약금이나 잔금을 적고 결제 내역을 연결할 수 있어요.</p>}
    {Boolean(rows?.length) && <ul className="household-task-list">
      {rows?.map((row) => <li key={row.id}>
        <button type="button" className="household-task-row" disabled={busy} onClick={() => open(row)}>
          <strong>{row.title} <span className="num">{won(Number(row.transaction?.amount ?? row.amount))}원</span></strong>
          <span>{row.transaction ? `${shortDate(row.transaction.occurred_on)} 결제` : row.due_on ? `${shortDate(row.due_on)} 결제 예정${row.due_on < today ? ' · 기한 지남' : ''}` : '결제일 확인 필요'}</span>
        </button>
        {row.transaction_id && row.transaction && <button type="button" className="link-btn" onClick={() => onOpenTransaction(row.transaction_id!)}>내역 보기</button>}
      </li>)}
    </ul>}
    {draft && <form className="anniv-form event-payment-form" onSubmit={(e) => { e.preventDefault(); void save() }}>
      <label className="field">결제 이름<input className="input" maxLength={60} required placeholder="예: 숙소 잔금" value={draft.input.title}
        onChange={(e) => setDraft({ ...draft, input: { ...draft.input, title: e.target.value } })} /></label>
      <div className="row2">
        <label className="field">금액 (원)<input className="input" type="number" min={1} max={9999999999} required value={draft.input.amount}
          onChange={(e) => setDraft({ ...draft, input: { ...draft.input, amount: e.target.value } })} /></label>
        <label className="field">예정일<input className="input" type="date" required={!draft.input.transaction_id} value={draft.input.due_on}
          onChange={(e) => setDraft({ ...draft, input: { ...draft.input, due_on: e.target.value } })} /></label>
      </div>
      <div className="household-tasks-actions">
        <button type="button" className="ghost" aria-expanded={pick} onClick={() => setPick(!pick)}>{draft.input.transaction_id ? '연결 바꾸기' : '결제 내역 찾기'}</button>
        {draft.input.transaction_id && <button type="button" className="link-btn" onClick={() => setDraft({ ...draft, input: { ...draft.input, transaction_id: null } })}>연결 풀기</button>}
      </div>
      {pick && <div className="event-payment-picker">
        <label className="field">조회할 달<input className="input" type="month" value={month} onChange={(e) => { setMonth(e.target.value); setChoices(null) }} /></label>
        <input className="input" type="search" aria-label="결제 내역 검색" placeholder="이름이나 금액으로 찾기" value={search} onChange={(e) => setSearch(e.target.value)} />
        {lookupError && <p className="err" role="alert">{lookupError}</p>}
        {!choices && !lookupError && month && <p role="status" className="plan-note">내역 불러오는 중</p>}
        {matching?.length === 0 && <p className="plan-note">맞는 내역이 없어요.</p>}
        {matching?.map((tx) => <button key={tx.id} type="button" className="household-task-row" onClick={() => select(tx)}>
          <strong>{tx.title || '이름 없는 결제'}</strong><span>{shortDate(tx.occurred_on)} · {won(tx.amount)}원</span>
        </button>)}
      </div>}
      <div className="form-grid">
        <button type="button" className="ghost" disabled={busy} onClick={() => { setDraft(null); setPick(false); setError('') }}>닫기</button>
        <button className="primary" disabled={busy}>{draft.input.transaction_id ? '연결 저장' : '예정 결제 저장'}</button>
      </div>
      {draft.row && <button type="button" className="danger" disabled={busy} onClick={() => void save(true)}>{confirm ? '한 번 더 눌러 삭제' : '일정에서 결제 빼기'}</button>}
    </form>}
  </section>
}
