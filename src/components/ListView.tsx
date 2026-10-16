import { useState } from 'react'
import { formatDateLong } from '../lib/dates'
import { won } from '../lib/format'
import { sumType } from '../lib/ledger'
import { SCOPE_LABEL, SCOPES, type Lookup } from '../lib/lookup'
import { normMerchant } from '../lib/categorize'
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
  cur: Transaction[]
  lookup: Lookup
  focus: ListFocus | null
  onClearFocus: () => void
  onEdit: (t: Transaction) => void
}

export function ListView({ cur, lookup, focus, onClearFocus, onEdit }: Props) {
  const [filter, setFilter] = useState<'all' | Scope>('all')
  const [q, setQ] = useState('')
  const needle = q.trim().toLowerCase()
  const matches = (t: Transaction) =>
    [t.title, t.memo, t.platform, lookup.categoryName(t.category_id), ...(t.items ?? []).map((i) => i.name)]
      .some((s) => (s ?? '').toLowerCase().includes(needle))
  const inFocus = (t: Transaction) => {
    if (!focus) return true
    if (focus.kind === 'category') return t.category_id === focus.id
    const p = platformOfTx(t)
    if (focus.kind === 'merchant') return !p && normMerchant(t.title) === focus.name
    return focus.name === OTHER_PLATFORM ? !p : p === focus.name
  }
  const list = cur.filter((t) => (filter === 'all' || t.scope === filter) && inFocus(t) && (!needle || matches(t)))
  const groups = new Map<string, Transaction[]>()
  for (const t of list) groups.set(t.occurred_on, [...(groups.get(t.occurred_on) ?? []), t])
  const dates = [...groups.keys()].sort().reverse()
  const narrowed = Boolean(needle) || focus !== null

  return (
    <section className="view">
      <div className="month-sum num">
        <span>쓴 돈 <b>{won(sumType(list, 'expense'))}원</b></span>
        <span className="in">들어온 돈 <b>{won(sumType(list, 'income'))}원</b></span>
        {narrowed && <span>{list.length}건</span>}
      </div>
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
      {dates.length === 0 && <div className="empty">{narrowed ? '조건에 맞는 내역이 없어요.' : '이 달에는 해당하는 내역이 없어요.'}</div>}
      {dates.map((d) => {
        const arr = groups.get(d)!
        const e = sumType(arr, 'expense')
        const i = sumType(arr, 'income')
        return (
          <div key={d} className="day-group">
            <div className="day-head">
              <h2>{formatDateLong(d).replace(/^\d+월 /, '')}</h2>
              <div className="tot num">{e > 0 && `${won(e)}원`}{e > 0 && i > 0 && <br />}{i > 0 && `+${won(i)}원`}</div>
            </div>
            <div className="tx-list">
              {arr.map((t) => <TxRow key={t.id} t={t} lookup={lookup} onClick={() => onEdit(t)} />)}
            </div>
          </div>
        )
      })}
    </section>
  )
}
