import { useEffect, useState } from 'react'
import { deleteRecurring, friendlyError, insertRecurring, updateRecurring } from '../lib/api'
import { addMonths, formatDateLong } from '../lib/dates'
import { won } from '../lib/format'
import { SCOPE_LABEL, SCOPES, type Lookup } from '../lib/lookup'
import { dueDate, endMonthFor, KIND_LABEL, termOf } from '../lib/recurring'
import { POPULAR } from '../lib/services'
import type { Category, Recurring, RecurringInput, RecurringKind, Scope, TxType } from '../lib/types'
import { defaultScope } from '../lib/localPrefs'
import { RecurringIcon } from './RecurringIcon'
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
const DEFAULT_CATEGORY: Record<RecurringKind, string> = { fixed: '기타', subscription: '구독', utility: '관리비', installment: '기타' }
// 기간(개월 수) 선택지. 할부(installment_months)와 같은 2~60개월. 매년 항목에는 기간을 두지 않는다
const TERMS = Array.from({ length: 59 }, (_, i) => i + 2)
const ymLabel = (month: string) => `${month.slice(0, 4)}년 ${Number(month.slice(5, 7))}월`

export function RecurringSheet({ open, draft, householdId, today, lookup, categories, onSaved, onClose }: Props) {
  const [kind, setKind] = useState<RecurringKind>('fixed')
  const [type, setType] = useState<TxType>('expense')
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [variable, setVariable] = useState(false)
  const [day, setDay] = useState(25)
  const [every, setEvery] = useState<1 | 12>(1)
  const [startMonth, setStartMonth] = useState(today.slice(0, 7))
  const [term, setTerm] = useState<number | null>(null)
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
    setTerm(k === 'installment' ? null : termOf({ start_month: draft.start_month ?? today, end_month: draft.end_month ?? null, every_months: draft.every_months ?? 1 }))
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
  const isInstallment = kind === 'installment'
  const input: RecurringInput = {
    kind, type, title: title.trim(), amount: variable ? null : n, day_of_month: day, every_months: every,
    category_id: categoryId, payment_method_id: draft?.payment_method_id ?? null, scope, start_month: `${startMonth}-01`,
    // 할부의 마지막 달·개월 수와 메모는 화면에서 고치지 않는다. 매달 항목은 기간(개월 수)으로 마지막 달을 정한다(없으면 계속)
    end_month: isInstallment || every === 12 ? draft?.end_month ?? null : term ? endMonthFor(startMonth, term) : null,
    active, memo: draft?.memo ?? null,
    installment_months: isInstallment ? draft?.installment_months ?? null : null,
  }
  const termChoices = term && !TERMS.includes(term) ? [...TERMS, term].sort((a, b) => a - b) : TERMS
  const firstDue = dueDate(input, today.slice(0, 7)) ?? dueDate(input, startMonth)
  const willAddNow = !draft?.id && !variable && n > 0 && firstDue !== null && firstDue <= today && startMonth <= today.slice(0, 7)
  // 금액을 매달 넣던 항목에 금액을 정하면, 아직 넣지 않은 지난 달(최대 12개월) 분이 한꺼번에 들어간다 (DB generate_recurring)
  let backfill = 0
  if (draft?.id && draft.amount === null && !variable && n > 0) {
    for (let i = 12; i >= 0; i--) {
      const ym = addMonths(today.slice(0, 7), -i)
      const d = ym >= startMonth ? dueDate(input, ym) : null
      if (d && d <= today) backfill++
    }
  }

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
      {isInstallment ? (
        <p className="note">
          {draft?.installment_months}개월 할부예요. {draft?.end_month ? `${draft.end_month.slice(0, 4)}년 ${Number(draft.end_month.slice(5, 7))}월까지 ` : ''}
          날짜가 되면 자동으로 들어가요. 이름, 금액, 날짜, 분류는 고칠 수 있어요.
        </p>
      ) : (
        <div className="seg" role="group" aria-label="종류">
          {KINDS.map((k) => <button key={k} aria-pressed={kind === k} onClick={() => switchKind(k)}>{KIND_LABEL[k]}</button>)}
        </div>
      )}
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
          {kind === 'subscription' ? <ServiceLogo name={title || '?'} size={40} /> : <RecurringIcon kind={kind} title={title} type={type} size={40} />}
          <input id="rc-title" className="input" value={title} maxLength={60}
            placeholder={kind === 'subscription' ? '예: 넷플릭스' : kind === 'utility' ? '예: 아파트 관리비' : '예: 월세, 보험료'}
            onChange={(e) => setTitle(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="rc-amount">금액</label>
        <input id="rc-amount" className="input num" inputMode="numeric" disabled={variable} value={variable ? '' : amount}
          placeholder={variable ? '매달 직접 입력' : '0'} onChange={(e) => setAmount(e.target.value.replace(/\D/g, '').slice(0, 10))} />
        {!isInstallment && (
          <label className="check">
            <input type="checkbox" checked={variable} onChange={(e) => setVariable(e.target.checked)} />
            매달 금액이 달라요 (날짜가 되면 입력하라고 알려 줘요)
          </label>
        )}
      </div>
      <div className="row2">
        <div className="field">
          <label htmlFor="rc-day">날짜</label>
          <select id="rc-day" className="input" value={day} onChange={(e) => setDay(Number(e.target.value))}>
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d === 31 ? '말일' : `${d}일`}</option>)}
          </select>
        </div>
        {!isInstallment && <div className="field">
          <label htmlFor="rc-every">주기</label>
          <select id="rc-every" className="input" value={every} onChange={(e) => setEvery(Number(e.target.value) as 1 | 12)}>
            <option value={1}>매달</option>
            <option value={12}>매년 (시작 달에)</option>
          </select>
        </div>}
      </div>
      {!isInstallment && <div className="field">
        <label htmlFor="rc-start">시작 달</label>
        <input id="rc-start" type="month" className="input date-input" value={startMonth} onChange={(e) => setStartMonth(e.target.value)} />
        {willAddNow && firstDue && (
          <span className="hint">저장하면 {formatDateLong(firstDue)} 분 {won(n)}원이 바로 내역에 들어가요. 이미 직접 적었다면 시작 달을 다음 달로 바꾸세요.</span>
        )}
        {backfill > 0 && (
          <span className="hint">
            저장하면 아직 넣지 않은 {backfill}개월 분이 {won(n)}원씩 한꺼번에 내역에 들어가요. 지난 달 분을 이미 직접 적었다면 시작 달을 이번 달로 바꾸세요.
          </span>
        )}
      </div>}
      {!isInstallment && every === 1 && <div className="field">
        <label htmlFor="rc-term">기간</label>
        <select id="rc-term" className="input" value={term ?? 0} onChange={(e) => setTerm(Number(e.target.value) || null)}>
          <option value={0}>계속 (끝나는 달 없음)</option>
          {termChoices.map((m) => <option key={m} value={m}>{m}개월</option>)}
        </select>
        <span className="tx-meta">
          {term
            ? `${ymLabel(startMonth)}부터 ${ymLabel(endMonthFor(startMonth, term))}까지 ${term}회 넣고 끝나요.`
            : '취득세·가전 할부처럼 정해진 기간만 내는 것은 개월 수를 고르세요. 마지막 달이 지나면 더 넣지 않아요.'}
        </span>
      </div>}
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
