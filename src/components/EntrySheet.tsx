import { useEffect, useMemo, useState } from 'react'
import { friendlyError } from '../lib/api'
import { won } from '../lib/format'
import { SCOPE_LABEL, SCOPES, type Lookup } from '../lib/lookup'
import { normalizePlatform } from '../lib/platform'
import type { Category, Scope, Transaction, TxInput, TxType } from '../lib/types'
import { CameraIcon } from './Icons'
import { ItemList } from './ItemList'
import { PlatformInput } from './PlatformInput'
import { Sheet } from './Sheet'

interface Props {
  open: boolean
  editing: Transaction | null
  defaultDate: string
  lookup: Lookup
  categories: Category[]
  usage: Map<string, number>
  onSave: (input: TxInput, id?: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onClose: () => void
  /** 문자 붙여넣기·사진·쇼핑 캡처 입력으로 전환 */
  onSmart?: (mode: 'text' | 'photo' | 'shop' | 'bill') => void
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', '⌫']

export function lsGet(k: string): string | null {
  try { return localStorage.getItem(k) } catch { return null }
}
export function lsSet(k: string, v: string) {
  try { localStorage.setItem(k, v) } catch { /* 저장 공간을 못 쓰면 기본값만 사용 */ }
}

export function isScope(v: string | null): v is Scope {
  return v === 'shared' || v === 'husband' || v === 'wife' || v === 'child'
}

export function defaultScope(lookup: Lookup): Scope {
  const last = lsGet(`ab:lastScope:${lookup.me}`)
  return isScope(last) ? last : 'shared'
}

export function EntrySheet({ open, editing, defaultDate, lookup, categories, usage, onSave, onDelete, onClose, onSmart }: Props) {
  const [type, setType] = useState<TxType>('expense')
  const [amount, setAmount] = useState('')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [scope, setScope] = useState<Scope>('shared')
  const [date, setDate] = useState(defaultDate)
  const [title, setTitle] = useState('')
  const [platform, setPlatform] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!open) return
    setErr(''); setBusy(false); setConfirmDelete(false)
    if (editing) {
      setType(editing.type)
      setAmount(String(editing.amount))
      setCategoryId(editing.category_id)
      setScope(editing.scope)
      setDate(editing.occurred_on)
      setTitle(editing.title)
      setPlatform(editing.platform ?? '')
      return
    }
    setType('expense')
    setAmount('')
    setCategoryId(null)
    setScope(defaultScope(lookup))
    setDate(defaultDate)
    setTitle('')
    setPlatform('')
    // 시트가 열릴 때만 초기화한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing])

  const cats = useMemo(() => {
    return categories
      .filter((c) => c.type === type)
      .slice()
      .sort((a, b) => (usage.get(b.id) ?? 0) - (usage.get(a.id) ?? 0) || a.sort - b.sort)
  }, [categories, type, usage])

  const n = parseInt(amount || '0', 10)

  function switchType(t: TxType) {
    setType(t)
    setCategoryId(null)
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
      type, occurred_on: date, amount: n, title: title.trim(),
      category_id: categoryId, payment_method_id: editing?.payment_method_id ?? null, scope,
      platform: normalizePlatform(platform),
    }
    try {
      await onSave(input, editing?.id)
      if (!editing) lsSet(`ab:lastScope:${lookup.me}`, scope)
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
    <Sheet open={open} title={editing ? '내역 수정' : '기록하기'} onClose={onClose}>
      {!editing && onSmart && (
        <>
          <div className="quick">
            <div className="quick-top">
              <span className="quick-ico" aria-hidden="true"><CameraIcon /></span>
              <span><b>사진으로 기록하기</b><span>영수증, 쇼핑 캡처를 20장까지 한 번에</span></span>
            </div>
            <div className="smart-row">
              <button className="smart-btn" onClick={() => onSmart('photo')}>영수증</button>
              <button className="smart-btn" onClick={() => onSmart('shop')}>쇼핑 캡처</button>
            </div>
          </div>
          <div className="smart-row sub">
            <button className="smart-btn" onClick={() => onSmart('text')}>문자 붙여넣기</button>
            <button className="smart-btn" onClick={() => onSmart('bill')}>관리비 고지서</button>
          </div>
        </>
      )}
      <div className="manual-head">
        <h3>{editing ? '금액' : '직접 입력'}</h3>
        <div className="seg" role="group" aria-label="구분">
          <button aria-pressed={type === 'expense'} onClick={() => switchType('expense')}>지출</button>
          <button aria-pressed={type === 'income'} onClick={() => switchType('income')}>수입</button>
        </div>
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
        <span className="lbl">{type === 'income' ? '누구의 수입인가요' : '누구를 위한 지출인가요'}</span>
        <div className="seg" role="group">
          {SCOPES.map((s) => (
            <button key={s} aria-pressed={scope === s} onClick={() => setScope(s)}>{SCOPE_LABEL[s]}</button>
          ))}
        </div>
      </div>
      <div className="field">
        <label htmlFor="entry-date">날짜</label>
        <input id="entry-date" type="date" className="input date-input" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="entry-title">내용</label>
        <input id="entry-title" className="input" value={title} maxLength={60} placeholder="예: 동네 마트, 물티슈 100매" onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="entry-platform">플랫폼</label>
        <PlatformInput id="entry-platform" value={platform} onChange={setPlatform} />
      </div>
      {editing?.items && editing.items.length > 0 && (
        <div className="field">
          <span className="lbl">품목 {editing.items.length}개</span>
          <ItemList items={editing.items} />
        </div>
      )}
      <p className="err" role="alert">{err}</p>
      <button className="primary" onClick={save} disabled={busy}>{busy ? '저장 중…' : n ? `${won(n)}원 저장하기` : '저장하기'}</button>
      {editing && (
        <button className="danger" onClick={remove} disabled={busy}>{confirmDelete ? '한 번 더 누르면 지워요' : '삭제하기'}</button>
      )}
    </Sheet>
  )
}
