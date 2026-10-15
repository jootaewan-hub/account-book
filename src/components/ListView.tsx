import { useState } from 'react'
import { formatDateLong } from '../lib/dates'
import { won } from '../lib/format'
import { sumType } from '../lib/ledger'
import { SCOPE_LABEL, SCOPES, type Lookup } from '../lib/lookup'
import type { Scope, Transaction } from '../lib/types'
import { TxRow } from './TxRow'

const DOT: Record<Scope, string> = { shared: 'var(--who-shared)', husband: 'var(--who-husband)', wife: 'var(--who-wife)', child: 'var(--who-child)' }

export function ListView({ cur, lookup, onEdit }: { cur: Transaction[]; lookup: Lookup; onEdit: (t: Transaction) => void }) {
  const [filter, setFilter] = useState<'all' | Scope>('all')
  const list = cur.filter((t) => filter === 'all' || t.scope === filter)
  const groups = new Map<string, Transaction[]>()
  for (const t of list) groups.set(t.occurred_on, [...(groups.get(t.occurred_on) ?? []), t])
  const dates = [...groups.keys()].sort().reverse()

  return (
    <section className="view">
      <div className="month-sum num">
        <span>쓴 돈 <b>{won(sumType(list, 'expense'))}원</b></span>
        <span className="in">들어온 돈 <b>{won(sumType(list, 'income'))}원</b></span>
      </div>
      <div className="chips" role="group" aria-label="누구를 위한 내역인지로 거르기">
        <button className="chip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>전체</button>
        {SCOPES.map((s) => (
          <button key={s} className="chip" aria-pressed={filter === s} onClick={() => setFilter(s)}>
            <span className="dot" style={{ background: DOT[s] }} aria-hidden="true" />{SCOPE_LABEL[s]}
          </button>
        ))}
      </div>
      {dates.length === 0 && <div className="empty">이 달에는 해당하는 내역이 없어요.</div>}
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
