import { useEffect, useMemo, useState } from 'react'
import { friendlyError } from '../lib/api'
import { won } from '../lib/format'
import { txScopeKey, type Lookup } from '../lib/lookup'
import type { Category, PaymentMethod, Transaction, TxInput, TxType } from '../lib/types'
import { Sheet } from './Sheet'

interface Props {
  open: boolean
  editing: Transaction | null
  defaultDate: string
  lookup: Lookup
  methods: PaymentMethod[]
  categories: Category[]
  usage: Map<string, number>
  onSave: (input: TxInput, id?: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onClose: () => void
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', '⌫']

function lsGet(k: string): string | null {
  try { return localStorage.getItem(k) } catch { return null }
}
export function lsSet(k: string, v: string) {
  try { localStorage.setItem(k, v) } catch { /* 저장 공간을 못 쓰면 기본값만 사용 */ }
}

export function EntrySheet({ open, editing, defaultDate, lookup, methods, categories, usage, onSave, onDelete, onClose }: Props) {
  const me = lookup.me
  const [type, setType] = useState<TxType>('expense')
  const [amount, setAmount] = useState('')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [methodId, setMethodId] = useState<string | null>(null)
  const [scopeKey, setScopeKey] = useState('shared')
  const [date, setDate] = useState(defaultDate)
  const [title, setTitle] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const methodsFor = (t: TxType) => methods.filter((m) => (t === 'income' ? m.kind !== 'card' : true))

  useEffect(() => {
    if (!open) return
    setErr(''); setBusy(false); setConfirmDelete(false)
    if (editing) {
      setType(editing.type)
      setAmount(String(editing.amount))
      setCategoryId(editing.category_id)
      setMethodId(editing.payment_method_id)
      setScopeKey(txScopeKey(editing))
      setDate(editing.occurred_on)
      setTitle(editing.title)
      return
    }
    const lastMethod = lsGet(`ab:lastMethod:${me}`)
    const lastScope = lsGet(`ab:lastScope:${me}`)
    const active = methodsFor('expense')
    const myCard = active.find((m) => m.owner_type === 'member' && m.owner_user_id === me)
    setType('expense')
    setAmount('')
    setCategoryId(null)
    setMethodId(active.some((m) => m.id === lastMethod) ? lastMethod : (myCard ?? active[0])?.id ?? null)
    setScopeKey(lastScope && (lastScope === 'shared' || lookup.members.some((m) => m.user_id === lastScope)) ? lastScope : 'shared')
    setDate(defaultDate)
    setTitle('')
    // 시트가 열릴 때만 초기화한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing])

  const cats = useMemo(() => {
    return categories
      .filter((c) => c.type === type)
      .slice()
      .sort((a, b) => (usage.get(b.id) ?? 0) - (usage.get(a.id) ?? 0) || a.sort - b.sort)
  }, [categories, type, usage])

  const visibleMethods = methodsFor(type)
  const scopes = ['shared', ...lookup.members.map((m) => m.user_id)]
  const n = parseInt(amount || '0', 10)

  function switchType(t: TxType) {
    setType(t)
    setCategoryId(null)
    if (t === 'income' && !methodsFor('income').some((m) => m.id === methodId)) {
      setMethodId(methodsFor('income')[0]?.id ?? null)
    }
  }

  function press(k: string) {
    if (k === '⌫') setAmount((a) => a.slice(0, -1))
    else setAmount((a) => ((a + k).length <= 10 ? (a + k).replace(/^0+/, '') : a))
  }

  async function save() {
    if (!n) return setErr('금액을 입력하세요.')
    if (!categoryId) return setErr('분류를 고르세요.')
    if (!date) return setErr('날짜를 고르세요.')
    setBusy(true); setErr('')
    const input: TxInput = {
      type,
      occurred_on: date,
      amount: n,
      title: title.trim(),
      category_id: categoryId,
      payment_method_id: methodId,
      scope: scopeKey === 'shared' ? 'shared' : 'member',
      scope_user_id: scopeKey === 'shared' ? null : scopeKey,
    }
    try {
      await onSave(input, editing?.id)
      if (!editing) {
        if (methodId) lsSet(`ab:lastMethod:${me}`, methodId)
        lsSet(`ab:lastScope:${me}`, scopeKey)
      }
    } catch (e) {
      setErr(friendlyError(e)); setBusy(false)
    }
  }

  async function remove() {
    if (!editing) return
    if (!confirmDelete) return setConfirmDelete(true)
    setBusy(true)
    try { await onDelete(editing.id) } catch (e) { setErr(friendlyError(e)); setBusy(false) }
  }

  return (
    <Sheet open={open} title={editing ? '내역 수정' : '내역 추가'} onClose={onClose}>
      <div className="seg" role="group" aria-label="구분">
        <button aria-pressed={type === 'expense'} onClick={() => switchType('expense')}>지출</button>
        <button aria-pressed={type === 'income'} onClick={() => switchType('income')}>수입</button>
      </div>
      <div className={`amount num${n ? '' : ' empty-amt'}`} aria-live="polite">{won(n)}<small>원</small></div>
      <div className="keypad">
        {KEYS.map((k) => (
          <button key={k} onClick={() => press(k)} aria-label={k === '⌫' ? '지우기' : k}>{k}</button>
        ))}
      </div>
      <div className="field">
        <span className="lbl">분류</span>
        <div className="chips">
          {cats.map((c) => (
            <button key={c.id} className="chip" aria-pressed={categoryId === c.id} onClick={() => setCategoryId(c.id)}>{c.name}</button>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="lbl">결제수단 · 누가 냈는지</span>
        <div className="chips">
          {visibleMethods.map((m) => (
            <button key={m.id} className="chip" aria-pressed={methodId === m.id} onClick={() => setMethodId(m.id)}>
              {m.name}{m.last4 && <span className="sub num">··{m.last4}</span>}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="lbl">{type === 'income' ? '누구의 수입인가요' : '누구를 위한 지출인가요'}</span>
        <div className="seg" role="group">
          {scopes.map((s) => (
            <button key={s} aria-pressed={scopeKey === s} onClick={() => setScopeKey(s)}>{lookup.whoLabel(s)}</button>
          ))}
        </div>
      </div>
      <div className="row2">
        <div className="field">
          <label htmlFor="entry-date">날짜</label>
          <input id="entry-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="entry-title">내용</label>
          <input id="entry-title" className="input" value={title} maxLength={60} placeholder="예: 동네 마트" onChange={(e) => setTitle(e.target.value)} />
        </div>
      </div>
      <p className="err" role="alert">{err}</p>
      <button className="primary" onClick={save} disabled={busy}>{busy ? '저장 중…' : '저장'}</button>
      {editing && (
        <button className="danger" onClick={remove} disabled={busy}>{confirmDelete ? '한 번 더 누르면 삭제됩니다' : '삭제'}</button>
      )}
    </Sheet>
  )
}
