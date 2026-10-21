import { useId, useMemo, useRef, useState } from 'react'
import { useClosing, useFocusTrap, useScrollLock } from '../../lib/dialog'
import type { Category as LedgerCategory, Scope } from '../../lib/types'
import { kstDay } from '../lib/products'
import { buildEntries, itemLabel, ledgerCategoryFor, type PurchaseEntry, type PurchaseInput } from '../lib/purchase'
import type { Item } from '../lib/types'

const CLOSE_MS = 250
// 사람 표시 색은 이 순서로만 이웃하게 놓는다(가계부 DESIGN.md: 공동 → 자녀 → 남편 → 아내)
const SCOPES: { value: Scope; label: string }[] = [
  { value: 'shared', label: '공동' }, { value: 'child', label: '자녀' }, { value: 'husband', label: '남편' }, { value: 'wife', label: '아내' },
]

type Props = {
  /** 산 것 중 아직 가계부에 넣지 않은 품목 */
  items: Item[]
  categories: LedgerCategory[]
  onSave: (entries: PurchaseEntry[]) => Promise<void>
  onClose: () => void
}

const digits = (s: string) => {
  const d = s.replace(/[^\d]/g, '').replace(/^0+/, '').slice(0, 10)
  return d ? Number(d) : null
}
const won = (n: number | null) => (n === null ? '' : n.toLocaleString('ko-KR'))

// 장보기에서 "가계부에 넣기"(D-011 길 ②). 영수증이 없는 장보기(현금·시장)를 가계부 내역으로 넣는다.
// 금액은 사람이 적은 값만 쓴다. 장보기에서 확인한 가격으로 미리 채우지 않는다.
export default function RecordSheet({ items, categories, onSave, onClose }: Props) {
  const today = kstDay(new Date().toISOString())
  const boughtToday = items.filter((i) => i.boughtAt && kstDay(i.boughtAt) === today)
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set((boughtToday.length ? boughtToday : items).map((i) => i.id)))
  const chosen = useMemo(() => items.filter((i) => picked.has(i.id)), [items, picked])
  const latest = chosen.map((i) => (i.boughtAt ? kstDay(i.boughtAt) : today)).sort().at(-1) ?? today
  const [date, setDate] = useState(latest)
  const [place, setPlace] = useState('')
  const [scope, setScope] = useState<Scope>('shared')
  const [mode, setMode] = useState<PurchaseInput['mode']>('total')
  const [total, setTotal] = useState<number | null>(null)
  const [amounts, setAmounts] = useState<Record<string, number | null>>({})
  const [categoryOf, setCategoryOf] = useState<Record<string, string | null>>(
    () => Object.fromEntries(items.map((i) => [i.id, ledgerCategoryFor(i, categories)])),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sheet = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const usable = categories.filter((c) => c.type === 'expense' && !c.archived)

  const sum = mode === 'total' ? total : chosen.reduce<number | null>((s, i) => (s === null || !amounts[i.id] ? null : s + (amounts[i.id] as number)), 0)

  // 처음 포커스는 시트 자체(아래 칸이 여러 개라 특정 칸을 고르지 않는다)
  const { closing, close } = useClosing(onClose, CLOSE_MS)
  useScrollLock(true)
  useFocusTrap(sheet, !closing, { onEscape: close })

  const togglePick = (id: string) =>
    setPicked((p) => {
      const next = new Set(p)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  async function save() {
    if (busy || closing) return
    const built = buildEntries(chosen, { date, place, scope, mode, amounts, total, categoryOf }, categories)
    if ('error' in built) {
      setError(built.error)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSave(built.entries)
    } catch {
      setError('가계부에 넣지 못했어요. 잠시 뒤 다시 해 주세요.')
      setBusy(false)
      return
    }
    close()
  }

  const saveLabel = busy
    ? '넣는 중'
    : <><span className="num">{chosen.length}</span>개{sum ? <> <span className="num">{won(sum)}</span>원</> : null} 가계부에 넣기</>

  return (
    <div className={`sheet-layer${closing ? ' is-closing' : ''}`}>
      <div className="sheet-backdrop" onClick={close} aria-hidden="true" />
      <div className="sheet" ref={sheet} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="sheet-head">
          <h2 id={titleId}>가계부에 넣기</h2>
          <button type="button" className="btn-text" onClick={close}>닫기</button>
        </div>
        <div className="sheet-body">
          <p className="record-lead">영수증이 있으면 가계부의 기록하기에서 사진으로 넣으면 품목과 금액이 함께 들어가요.</p>

          <h3 className="field-label">넣을 품목</h3>
          <ul className="record-items">
            {items.map((i) => (
              <li key={i.id} className="record-item">
                <label className="record-check">
                  <input type="checkbox" checked={picked.has(i.id)} onChange={() => togglePick(i.id)} />
                  <span className="record-name">{itemLabel(i)}{i.count > 1 && <span className="row-count num"> ×{i.count}</span>}</span>
                </label>
                {picked.has(i.id) && (
                  <div className="record-fields">
                    <select aria-label={`${i.name} 가계부 분류`} value={categoryOf[i.id] ?? ''}
                      onChange={(e) => setCategoryOf((c) => ({ ...c, [i.id]: e.target.value || null }))}>
                      <option value="">분류 없음</option>
                      {usable.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    {mode === 'each' && (
                      <input className="record-amount num" inputMode="numeric" aria-label={`${i.name} 금액(원)`} placeholder="금액"
                        value={won(amounts[i.id] ?? null)} onChange={(e) => setAmounts((a) => ({ ...a, [i.id]: digits(e.target.value) }))} />
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>

          <div className="seg record-mode" role="group" aria-label="금액 적는 방법">
            <button type="button" aria-pressed={mode === 'total'} onClick={() => setMode('total')}>낸 금액 하나로</button>
            <button type="button" aria-pressed={mode === 'each'} onClick={() => setMode('each')}>품목마다</button>
          </div>
          {mode === 'total' && (
            <label className="record-field">
              <span className="field-label">낸 금액(원)</span>
              <input className="record-input num" inputMode="numeric" placeholder="예: 23,400" value={won(total)}
                onChange={(e) => setTotal(digits(e.target.value))} />
            </label>
          )}

          <label className="record-field">
            <span className="field-label">산 날</span>
            <input className="record-input" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="record-field">
            <span className="field-label">어디서</span>
            <input className="record-input" list="platform-names" maxLength={30} autoComplete="off" placeholder="예: 동네 시장, 이마트, 쿠팡"
              value={place} onChange={(e) => setPlace(e.target.value)} />
          </label>
          <div className="record-field">
            <span className="field-label" id={`${titleId}-who`}>누구를 위한 지출</span>
            <div className="record-who" role="group" aria-labelledby={`${titleId}-who`}>
              {SCOPES.map((s) => (
                <button key={s.value} type="button" aria-pressed={scope === s.value} onClick={() => setScope(s.value)}>
                  <span className={`who-dot who-dot-${s.value}`} aria-hidden="true" />{s.label}
                </button>
              ))}
            </div>
          </div>
          {error && <p role="alert" className="form-error">{error}</p>}
        </div>
        <div className="sheet-foot">
          <button type="button" className="btn-primary btn-big" disabled={chosen.length === 0 || busy || closing} onClick={() => void save()}>
            {saveLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
