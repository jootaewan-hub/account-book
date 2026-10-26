import { useEffect, useRef, useState } from 'react'
import { friendlyError } from '../lib/api'
import { formatDateLong } from '../lib/dates'
import { won } from '../lib/format'
import { sumType } from '../lib/ledger'
import { SCOPE_LABEL, SCOPES, type Lookup } from '../lib/lookup'
import { storeOfTx } from '../lib/categorize'
import { OTHER_PLATFORM, platformOfTx } from '../lib/platform'
import type { Scope, Transaction } from '../lib/types'
import { TxRow } from './TxRow'

const DOT: Record<Scope, string> = { shared: 'var(--who-shared)', husband: 'var(--who-husband)', wife: 'var(--who-wife)', child: 'var(--who-child)' }

/** 통계에서 넘어온 조건: 한 분류, 한 플랫폼, 또는 한 가게(플랫폼 없는 매장 결제)의 내역만 */
export type ListFocus =
  | { kind: 'category'; id: string | null; name: string }
  | { kind: 'platform'; name: string }
  | { kind: 'merchant'; name: string }
const FOCUS_LABEL: Record<ListFocus['kind'], string> = { category: '분류', platform: '플랫폼', merchant: '가게' }

interface Props {
  /** 그 달 내역. 고정지출 예정분(planned, D-030)도 들어 있다 */
  cur: Transaction[]
  /** 앞 달(오늘 뒤의 달)이면 '쓴 돈' 대신 '나갈 돈' */
  future?: boolean
  /** 달을 넘겨 새 달 내역을 아직 못 받았을 때 */
  loading?: boolean
  lookup: Lookup
  focus: ListFocus | null
  onClearFocus: () => void
  onEdit: (t: Transaction) => void
  /** 고른 내역을 한꺼번에 지운다(D-027). 실패하면 던진다 */
  onDeleteMany: (ids: string[]) => Promise<void>
  /** 고르기를 켜고 끌 때 (켜져 있는 동안 기록하기 둥근 버튼을 숨긴다). 바뀌지 않는 함수를 넘긴다 */
  onPickingChange?: (on: boolean) => void
}

export function ListView({ cur, future = false, loading = false, lookup, focus, onClearFocus, onEdit, onDeleteMany, onPickingChange }: Props) {
  const [filter, setFilter] = useState<'all' | Scope>('all')
  const [q, setQ] = useState('')
  const needle = q.trim().toLowerCase()
  // 고르기(D-027): 지울 내역을 행·날짜 단위로 고른다. 찾기·거르기를 바꾸면 고른 것을 비워 안 보이는 내역이 지워지지 않게 한다
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const focusKey = focus ? `${focus.kind}:${focus.name}` : ''
  // eslint-disable-next-line react/exhaustive-effect-dependencies -- 거르는 조건이 바뀌었다는 신호
  useEffect(() => { setPicked(new Set()); setConfirm(false) }, [filter, needle, focusKey])
  useEffect(() => { onPickingChange?.(picking) }, [picking, onPickingChange])
  // 다른 탭으로 가며 사라질 때 둥근 버튼을 되돌린다
  useEffect(() => () => onPickingChange?.(false), [onPickingChange])
  const matches = (t: Transaction) =>
    [t.title, t.memo, t.platform, lookup.categoryName(t.category_id), ...(t.items ?? []).map((i) => i.name)]
      .some((s) => (s ?? '').toLowerCase().includes(needle))
  const inFocus = (t: Transaction) => {
    if (!focus) return true
    if (focus.kind === 'category') return t.category_id === focus.id
    const p = platformOfTx(t)
    if (focus.kind === 'merchant') return !p && storeOfTx(t) === focus.name
    // 가게 이름 없는 결제 줄: 플랫폼도 가게 이름도 모르는 내역만(통계 어디서 샀나와 같은 storeOfTx)
    return focus.name === OTHER_PLATFORM ? !p && !storeOfTx(t) : p === focus.name
  }
  const list = cur.filter((t) => (filter === 'all' || t.scope === filter) && inFocus(t) && (!needle || matches(t)))
  // 고정지출 예정분(D-030)은 DB에 없는 행이라 고를 수도 지울 수도 없다. 고르는 동안에는 목록에서 뺀다
  const real = list.filter((t) => !t.planned)
  const planSum = sumType(list.filter((t) => t.planned), 'expense')
  const groups = new Map<string, Transaction[]>()
  for (const t of picking ? real : list) {
    const arr = groups.get(t.occurred_on)
    if (arr) arr.push(t)
    else groups.set(t.occurred_on, [t])
  }
  const dates = [...groups.keys()].sort().reverse()
  const narrowed = Boolean(needle) || focus !== null
  // 지우는 것은 지금 화면에 보이는 것 중 고른 것만 (달을 넘기면 지난달에 고른 것은 빠진다)
  const chosen = real.filter((t) => picked.has(t.id))
  const chosenSum = chosen.reduce((s, t) => s + (t.type === 'expense' ? t.amount : 0), 0)

  function togglePicking() {
    setPicking((p) => !p)
    setPicked(new Set()); setConfirm(false); setErr('')
  }
  function toggle(ids: string[], on: boolean) {
    setPicked((prev) => {
      const next = new Set(prev)
      for (const id of ids) { if (on) next.add(id); else next.delete(id) }
      return next
    })
    setConfirm(false); setErr('')
  }
  async function removeChosen() {
    if (!chosen.length || busy) return
    if (!confirm) return setConfirm(true)
    setBusy(true); setErr('')
    try {
      await onDeleteMany(chosen.map((t) => t.id))
      setPicking(false); setPicked(new Set())
    } catch (e) {
      setErr(friendlyError(e))
    }
    setBusy(false); setConfirm(false)
  }

  return (
    <section className="view">
      <div className="month-sum num">
        <span>{future ? '나갈 돈' : '쓴 돈'} <b>{won(sumType(list, 'expense'))}원</b></span>
        <span className="in">들어온 돈 <b>{won(sumType(list, 'income'))}원</b></span>
        {narrowed && <span>{list.length}건</span>}
        {(real.length > 0 || picking) && (
          <button className="link-btn pick-toggle" aria-pressed={picking} onClick={togglePicking}>{picking ? '고르기 취소' : '고르기'}</button>
        )}
      </div>
      {planSum > 0 && <p className="plan-note">고정지출 예정 <b className="num">{won(planSum)}원</b>이 들어 있어요</p>}
      <input type="search" className="input" aria-label="내역 찾기" placeholder="이름·품목·메모로 찾기" value={q}
        autoComplete="off" onChange={(e) => setQ(e.target.value)} />
      {focus && (
        <div className="focus-row">
          <span className="chip" aria-pressed="true">{FOCUS_LABEL[focus.kind]}: {focus.name}</span>
          <button className="link-btn" onClick={onClearFocus}>전체 보기</button>
        </div>
      )}
      <div className="chips" role="group" aria-label="누구를 위한 내역인지로 거르기">
        <button className="chip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>전체</button>
        {SCOPES.map((s) => (
          <button key={s} className="chip" aria-pressed={filter === s} onClick={() => setFilter(s)}>
            <span className="dot" style={{ background: DOT[s] }} aria-hidden="true" />{SCOPE_LABEL[s]}
          </button>
        ))}
      </div>
      {dates.length === 0 && <div className="empty">{loading ? '불러오는 중…' : narrowed ? '조건에 맞는 내역이 없어요.' : '이 달에는 해당하는 내역이 없어요.'}</div>}
      {dates.map((d) => {
        const arr = groups.get(d)!
        const e = sumType(arr, 'expense')
        const i = sumType(arr, 'income')
        const day = formatDateLong(d).replace(/^\d+월 /, '')
        const ids = arr.map((t) => t.id)
        const n = ids.filter((id) => picked.has(id)).length
        return (
          <div key={d} className="day-group">
            <div className="day-head">
              <h2>
                {picking ? (
                  <label className="check day-pick">
                    <DayCheck all={n === ids.length} some={n > 0} onChange={(on) => toggle(ids, on)} />{day}
                  </label>
                ) : day}
              </h2>
              <div className="tot num">{e > 0 && `${won(e)}원`}{e > 0 && i > 0 && <br />}{i > 0 && `+${won(i)}원`}</div>
            </div>
            <div className="tx-list">
              {arr.map((t) => picking
                ? <TxRow key={t.id} t={t} lookup={lookup} picked={picked.has(t.id)} onClick={() => toggle([t.id], !picked.has(t.id))} />
                : <TxRow key={t.id} t={t} lookup={lookup} onClick={() => onEdit(t)} />)}
            </div>
          </div>
        )
      })}
      {picking && (
        <div className="pick-bar" role="region" aria-label="고른 내역">
          <div className="pick-sum" aria-live="polite">
            <span>
              {chosen.length ? <><b className="num">{chosen.length}건</b> 골랐어요{chosenSum > 0 && <span className="num">, 지출 {won(chosenSum)}원</span>}</>
                : '지울 내역이나 날짜를 눌러 고르세요'}
            </span>
            {err && <span className="err" role="alert">{err}</span>}
          </div>
          <button className="danger" onClick={removeChosen} disabled={!chosen.length || busy}>
            {busy ? '지우는 중…' : confirm ? `한 번 더 누르면 ${chosen.length}건 지워요` : chosen.length ? `${chosen.length}건 삭제` : '삭제'}
          </button>
        </div>
      )}
    </section>
  )
}

/** 그날 내역 전부 고르기. 일부만 골랐으면 반쯤 찬 표시 */
function DayCheck({ all, some, onChange }: { all: boolean; some: boolean; onChange: (on: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (ref.current) ref.current.indeterminate = some && !all }, [all, some])
  return <input ref={ref} type="checkbox" checked={all} onChange={() => onChange(!all)} />
}
