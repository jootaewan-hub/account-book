import { useEffect, useState } from 'react'
import { deleteRecurring, friendlyError, insertRecurring, updateRecurring } from '../lib/api'
import { formatDateLong } from '../lib/dates'
import { won } from '../lib/format'
import { SCOPE_LABEL, SCOPES, type Lookup } from '../lib/lookup'
import { dueDate, KIND_LABEL } from '../lib/recurring'
import { POPULAR } from '../lib/services'
import type { Category, Recurring, RecurringInput, RecurringKind, Scope, TxType } from '../lib/types'
import { defaultScope } from './EntrySheet'
import { ServiceLogo } from './ServiceLogo'
import { Sheet } from './Sheet'

export type RecurringDraft = Partial<RecurringInput> & { id?: string }

interface Props {
  open: boolean
  draft: RecurringDraft | null
  householdId: string
  today: string
  lookup: Lookup
  categories: Category[]
  onSaved: (msg: string) => Promise<void>
  onClose: () => void
}

const KINDS: RecurringKind[] = ['fixed', 'subscription', 'utility']
const DEFAULT_CATEGORY: Record<RecurringKind, string> = { fixed: '기타', subscription: '구독', utility: '관리비' }

export function RecurringSheet({ open, draft, householdId, today, lookup, categories, onSaved, onClose }: Props) {
  const [kind, setKind] = useState<RecurringKind>('fixed')
  const [type, setType] = useState<TxType>('expense')
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [variable, setVariable] = useState(false)
  const [day, setDay] = useState(25)
  const [every, setEvery] = useState<1 | 12>(1)
  const [startMonth, setStartMonth] = useState(today.slice(0, 7))
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [scope, setScope] = useState<Scope>('shared')
  const [active, setActive] = useState(true)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const catFor = (k: RecurringKind, t: TxType) =>
    t === 'expense' ? categories.find((c) => c.type === 'expense' && c.name === DEFAULT_CATEGORY[k])?.id ?? null : null

  useEffect(() => {
    if (!open || !draft) return
    const k = draft.kind ?? 'fixed'
    setKind(k)
    setType(draft.type ?? 'expense')
    setTitle(draft.title ?? '')
    setAmount(draft.amount ? String(draft.amount) : '')
    setVariable(draft.id ? draft.amount === null : k === 'utility')
    setDay(draft.day_of_month ?? Number(today.slice(8, 10)))
    setEvery(draft.every_months ?? 1)
    setStartMonth((draft.start_month ?? today).slice(0, 7))
    setCategoryId(draft.category_id !== undefined ? draft.category_id : catFor(k, draft.type ?? 'expense'))
    setScope(draft.scope ?? defaultScope(lookup))
    setActive(draft.active ?? true)
    setErr(''); setBusy(false); setConfirmDelete(false)
    // 시트가 열릴 때만 초기화한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draft])

  function switchKind(k: RecurringKind) {
    setKind(k)
    if (!draft?.id) {
      setVariable(k === 'utility')
      if (k !== 'fixed') setType('expense')
      setCategoryId(catFor(k, k === 'fixed' ? type : 'expense'))
    }
  }

  const n = parseInt(amount || '0', 10)
  const input: RecurringInput = {
    kind, type, title: title.trim(), amount: variable ? null : n, day_of_month: day, every_months: every,
    category_id: categoryId, payment_method_id: draft?.payment_method_id ?? null, scope, start_month: `${startMonth}-01`, end_month: null,
    active, memo: null,
  }
  const firstDue = dueDate(input, today.slice(0, 7)) ?? dueDate(input, startMonth)
  const willAddNow = !draft?.id && !variable && n > 0 && firstDue !== null && firstDue <= today && startMonth <= today.slice(0, 7)

  async function save() {
    if (!input.title) return setErr('이름을 입력하세요.')
    if (!variable && !n) return setErr('금액을 입력하세요. 매달 다르면 "매달 금액이 달라요"를 고르세요.')
    if (!/^\d{4}-\d{2}$/.test(startMonth)) return setErr('시작 달을 고르세요.')
    setBusy(true); setErr('')
    try {
      if (draft?.id) await updateRecurring(draft.id, input)
      else await insertRecurring(householdId, input)
      await onSaved(draft?.id ? '고쳤어요' : '등록했어요')
    } catch (e) {
      setErr(friendlyError(e)); setBusy(false)
    }
  }

  async function remove() {
    if (!draft?.id) return
    if (!confirmDelete) return setConfirmDelete(true)
    setBusy(true)
    try { await deleteRecurring(draft.id); await onSaved('삭제했어요. 이미 들어간 내역은 그대로 남아요.') } catch (e) { setErr(friendlyError(e)); setBusy(false) }
  }

  const cats = categories.filter((c) => c.type === type)

  return (
    <Sheet open={open} title={draft?.id ? '반복 항목 고치기' : '반복 항목 추가'} onClose={onClose}>
      <div className="seg" role="group" aria-label="종류">
        {KINDS.map((k) => <button key={k} aria-pressed={kind === k} onClick={() => switchKind(k)}>{KIND_LABEL[k]}</button>)}
      </div>
      {kind === 'fixed' && (
        <div className="seg" role="group" aria-label="구분">
          <button aria-pressed={type === 'expense'} onClick={() => { setType('expense'); setCategoryId(catFor(kind, 'expense')) }}>지출</button>
          <button aria-pressed={type === 'income'} onClick={() => { setType('income'); setCategoryId(null) }}>수입 (월급 등)</button>
        </div>
      )}
      {kind === 'subscription' && !draft?.id && (
        <div className="field">
          <span className="lbl">자주 쓰는 구독 (누르면 이름이 들어가요)</span>
          <div className="svc-picks">
            {POPULAR.map((s) => (
              <button key={s.name} className="svc-pick" onClick={() => setTitle(s.name)} aria-pressed={title === s.name}>
                <ServiceLogo name={s.name} size={44} /><span>{s.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="field">
        <label htmlFor="rc-title">이름</label>
        <div className="svc-name-row">
          {kind === 'subscription' && <ServiceLogo name={title || '?'} size={40} />}
          <input id="rc-title" className="input" value={title} maxLength={60}
            placeholder={kind === 'subscription' ? '예: 넷플릭스' : kind === 'utility' ? '예: 아파트 관리비' : '예: 월세, 보험료'}
            onChange={(e) => setTitle(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="rc-amount">금액</label>
        <input id="rc-amount" className="input num" inputMode="numeric" disabled={variable} value={variable ? '' : amount}
          placeholder={variable ? '매달 직접 입력' : '0'} onChange={(e) => setAmount(e.target.value.replace(/\D/g, '').slice(0, 10))} />
        <label className="check">
          <input type="checkbox" checked={variable} onChange={(e) => setVariable(e.target.checked)} />
          매달 금액이 달라요 (날짜가 되면 입력하라고 알려 줘요)
        </label>
      </div>
      <div className="row2">
        <div className="field">
          <label htmlFor="rc-day">날짜</label>
          <select id="rc-day" className="input" value={day} onChange={(e) => setDay(Number(e.target.value))}>
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d === 31 ? '말일' : `${d}일`}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="rc-every">주기</label>
          <select id="rc-every" className="input" value={every} onChange={(e) => setEvery(Number(e.target.value) as 1 | 12)}>
            <option value={1}>매달</option>
            <option value={12}>매년 (시작 달에)</option>
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor="rc-start">시작 달</label>
        <input id="rc-start" type="month" className="input date-input" value={startMonth} onChange={(e) => setStartMonth(e.target.value)} />
        {willAddNow && firstDue && (
          <span className="hint">저장하면 {formatDateLong(firstDue)} 분 {won(n)}원이 바로 내역에 들어가요. 이미 직접 적었다면 시작 달을 다음 달로 바꾸세요.</span>
        )}
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
        <span className="lbl">{type === 'income' ? '누구의 수입인가요' : '누구를 위한 지출인가요'}</span>
        <div className="seg" role="group">
          {SCOPES.map((s) => <button key={s} aria-pressed={scope === s} onClick={() => setScope(s)}>{SCOPE_LABEL[s]}</button>)}
        </div>
      </div>
      {draft?.id && (
        <label className="check">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          사용 중 (끄면 더 이상 자동으로 넣지 않아요)
        </label>
      )}
      <p className="err" role="alert">{err}</p>
      <button className="primary" disabled={busy} onClick={save}>{busy ? '저장 중…' : '저장'}</button>
      {draft?.id && (
        <button className="danger" disabled={busy} onClick={remove}>{confirmDelete ? '한 번 더 누르면 삭제됩니다' : '삭제'}</button>
      )}
    </Sheet>
  )
}

export function draftFrom(r: Recurring): RecurringDraft {
  const { household_id: _h, ...rest } = r
  void _h
  return rest
}
