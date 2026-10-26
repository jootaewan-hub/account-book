import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchSaveBatch, friendlyError, type BatchMate } from '../lib/api'
import { suggestCategory } from '../lib/categorize'
import { won } from '../lib/format'
import { fuelText } from '../lib/fuel'
import { isSaveShortcut, isTextField, keypadKey, pressKey, saveKeyLabel } from '../lib/keypad'
import { SCOPE_LABEL, SCOPES, type Lookup } from '../lib/lookup'
import { normalizePlatform } from '../lib/platform'
import type { Category, Scope, Transaction, TxInput, TxType } from '../lib/types'
import { CameraIcon } from './Icons'
import { InstallmentPicker } from './InstallmentPicker'
import { ItemList } from './ItemList'
import { PlatformInput } from './PlatformInput'
import { Sheet } from './Sheet'
import { defaultScope, lsSet } from '../lib/localPrefs'

interface Props {
  open: boolean
  editing: Transaction | null
  defaultDate: string
  lookup: Lookup
  categories: Category[]
  usage: Map<string, number>
  /** installment: 새 지출을 할부로 넣을 때 개월 수와 달마다 나눠 넣을지 */
  onSave: (input: TxInput, id?: string, installment?: { months: number; split: boolean } | null) => Promise<void>
  onDelete: (id: string) => Promise<void>
  /** 같은 영수증에서 나눠 저장한 내역을 한꺼번에 지운다(D-027) */
  onDeleteMany?: (ids: string[]) => Promise<void>
  onClose: () => void
  /** 문자 붙여넣기·사진·쇼핑 캡처 입력으로 전환 */
  onSmart?: (mode: 'text' | 'photo' | 'shop' | 'bill') => void
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', '⌫']

export function EntrySheet({ open, editing, defaultDate, lookup, categories, usage, onSave, onDelete, onDeleteMany, onClose, onSmart }: Props) {
  const [type, setType] = useState<TxType>('expense')
  const [amount, setAmount] = useState('')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [scope, setScope] = useState<Scope>('shared')
  const [date, setDate] = useState(defaultDate)
  const [title, setTitle] = useState('')
  const [platform, setPlatform] = useState('')
  const [memo, setMemo] = useState('')
  // 분류를 이름으로 골라 준 상태 (사용자가 직접 고르면 끝)
  const [catAuto, setCatAuto] = useState(false)
  const [months, setMonths] = useState<number | null>(null)
  const [split, setSplit] = useState(true)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  // 같은 영수증에서 나눠 저장한 내역(이 내역 포함). 사진으로 넣은 내역만 찾고, 못 찾으면 칸을 숨긴다
  const [batch, setBatch] = useState<BatchMate[]>([])
  const [confirmBatch, setConfirmBatch] = useState(false)
  const canBatch = Boolean(onDeleteMany)
  // 앱이 다시 그려질 때(실시간 갱신 등) 다시 읽지 않게 내역 id로만 다시 읽는다. 다시 읽으면 두 번 누르기 확인이 풀린다
  // eslint-disable-next-line react/exhaustive-effect-dependencies -- editing은 id·source·household_id만 쓴다
  useEffect(() => {
    setBatch([]); setConfirmBatch(false)
    if (!open || !editing || editing.source !== 'photo' || !canBatch) return
    let alive = true
    fetchSaveBatch(editing).then((b) => { if (alive) setBatch(b.length >= 2 ? b : []) })
    return () => { alive = false }
  }, [open, editing?.id, editing?.source, canBatch])

  useEffect(() => {
    if (!open) return
    setErr(''); setBusy(false); setConfirmDelete(false); setCatAuto(false)
    setMonths(null); setSplit(true)
    if (editing) {
      setType(editing.type)
      setAmount(String(editing.amount))
      setCategoryId(editing.category_id)
      setScope(editing.scope)
      setDate(editing.occurred_on)
      setTitle(editing.title)
      setPlatform(editing.platform ?? '')
      setMemo(editing.memo ?? '')
      return
    }
    setType('expense')
    setAmount('')
    setCategoryId(null)
    setScope(defaultScope(lookup))
    setDate(defaultDate)
    setTitle('')
    setPlatform('')
    setMemo('')
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
    setCatAuto(false)
  }

  // 새 내역의 이름을 적으면 분류를 제안한다. 사용자가 분류를 직접 고른 뒤에는 바꾸지 않는다
  function changeTitle(v: string) {
    setTitle(v)
    if (editing || type !== 'expense' || (categoryId !== null && !catAuto)) return
    const s = suggestCategory(v, categories)
    if (s) { setCategoryId(s.id); setCatAuto(true) }
    else if (catAuto) { setCategoryId(null); setCatAuto(false) }
  }

  function press(k: string) {
    setAmount((a) => pressKey(a, k))
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
      memo: memo.trim() || null,
    }
    try {
      const installment = !editing && type === 'expense' && months ? { months, split } : null
      await onSave(input, editing?.id, installment)
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

  async function removeBatch() {
    if (!onDeleteMany || !batch.length) return
    if (!confirmBatch) return setConfirmBatch(true)
    setBusy(true)
    try { await onDeleteMany(batch.map((b) => b.id)) } catch (e) { setErr(friendlyError(e)); setBusy(false); setConfirmBatch(false) }
  }

  // 키보드: 글자 칸 밖에서 숫자·Backspace는 금액으로, ⌘/Ctrl+Enter는 어디서든 저장
  const onKeyRef = useRef<(e: KeyboardEvent) => void>(() => {})
  onKeyRef.current = (e) => {
    if (busy) return
    if (isSaveShortcut(e)) { e.preventDefault(); void save(); return }
    if (isTextField(e.target as HTMLElement | null)) return
    const k = keypadKey(e)
    if (k) { e.preventDefault(); press(k) }
  }
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => onKeyRef.current(e)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <Sheet open={open} title={editing ? '내역 수정' : '기록하기'} onClose={onClose} wide>
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
      {/* 휴대폰에서는 두 묶음이 풀려 한 줄로 이어지고, 넓은 화면에서는 왼쪽 금액·오른쪽 나머지 두 단이 된다 */}
      <div className="entry-grid">
        <div className="entry-col">
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
          <p className="kbd-hint">키보드 숫자로도 금액을 넣을 수 있어요. {saveKeyLabel()}로 저장해요.</p>
        </div>
        <div className="entry-col">
          <div className="field">
            <span className="lbl">분류</span>
            <div className="chips">
              {cats.map((c) => (
                <button key={c.id} className="chip" aria-pressed={categoryId === c.id} onClick={() => { setCategoryId(c.id); setCatAuto(false) }}>{c.name}</button>
              ))}
            </div>
            {catAuto && <span className="tx-meta">이름을 보고 골랐어요. 다르면 바꿔 주세요.</span>}
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
          {!editing && type === 'expense' && (
            <InstallmentPicker id="entry-installment" amount={n} months={months} split={split}
              onChange={(p) => { if (p.months !== undefined) setMonths(p.months); if (p.split !== undefined) setSplit(p.split) }} />
          )}
          <div className="field">
            <label htmlFor="entry-title">내용</label>
            <input id="entry-title" className="input" value={title} maxLength={60} placeholder="예: 동네 마트, 물티슈 100매" onChange={(e) => changeTitle(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="entry-platform">플랫폼</label>
            <PlatformInput id="entry-platform" value={platform} onChange={setPlatform} />
          </div>
          <div className="field">
            <label htmlFor="entry-memo">메모</label>
            <input id="entry-memo" className="input" value={memo} maxLength={200} placeholder="예: 쿠폰 2,000원 적용, 회사 회식"
              onChange={(e) => setMemo(e.target.value)} />
          </div>
          {editing?.items && editing.items.length > 0 && (
            <div className="field">
              <span className="lbl">품목 {editing.items.length}개</span>
              <ItemList items={editing.items} />
            </div>
          )}
          {editing?.fuel && (
            <div className="field">
              <span className="lbl">주유</span>
              <p className="tx-meta fuel-readonly num">{fuelText(editing.fuel)}. 리터·단가를 고치려면 이 내역을 지우고 영수증을 다시 찍어요.</p>
            </div>
          )}
          <p className="err" role="alert">{err}</p>
          <button className="primary" onClick={save} disabled={busy}>{busy ? '저장 중…' : n ? `${won(n)}원 저장하기` : '저장하기'}</button>
          {editing && (
            <button className="danger" onClick={remove} disabled={busy}>{confirmDelete ? '한 번 더 누르면 지워요' : '삭제하기'}</button>
          )}
          {editing && batch.length > 0 && (
            <div className="field batch-del">
              <span className="lbl">함께 나눠 저장한 내역 {batch.length}건</span>
              <ul className="batch-list">
                {batch.map((b) => (
                  <li key={b.id} className={b.id === editing.id ? 'cur' : undefined}>
                    <span className="batch-name">{b.title || '이름 없음'}{b.id === editing.id && <span className="tag batch-cur">지금 보는 내역</span>}</span>
                    <span className="num">{won(b.amount)}원</span>
                  </li>
                ))}
                <li className="batch-sum"><span>합계</span><span className="num">{won(batch.reduce((s, b) => s + b.amount, 0))}원</span></li>
              </ul>
              <button className="danger" onClick={removeBatch} disabled={busy}>
                {confirmBatch ? `한 번 더 누르면 ${batch.length}건 지워요` : `${batch.length}건 모두 삭제`}
              </button>
            </div>
          )}
        </div>
      </div>
    </Sheet>
  )
}
