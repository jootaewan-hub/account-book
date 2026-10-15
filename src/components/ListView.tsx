import { useState } from 'react'
import { formatDateLong } from '../lib/dates'
import { won } from '../lib/format'
import { sumType } from '../lib/ledger'
import { txScopeKey, type Lookup } from '../lib/lookup'
import type { Transaction } from '../lib/types'
import { TxRow } from './TxRow'

export function ListView({ cur, lookup, onEdit }: { cur: Transaction[]; lookup: Lookup; onEdit: (t: Transaction) => void }) {
  const [filter, setFilter] = useState('all')
  const options = [['all', '전체'], ['shared', '공동'], ...lookup.members.map((m) => [m.user_id, m.display_name])]
  const list = cur.filter((t) => filter === 'all' || txScopeKey(t) === filter)
  const groups = new Map<string, Transaction[]>()
  for (const t of list) groups.set(t.occurred_on, [...(groups.get(t.occurred_on) ?? []), t])
  const dates = [...groups.keys()].sort().reverse()

  return (
    <section className="view">
      <div className="chips" role="group" aria-label="누구를 위한 내역인지로 거르기">
        {options.map(([k, label]) => (
          <button key={k} className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}</button>
        ))}
      </div>
      <div className="card">
        <div className="summary" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
          <div><div className="k">지출</div><div className="v exp num">{won(sumType(list, 'expense'))}</div></div>
          <div><div className="k">수입</div><div className="v inc num">{won(sumType(list, 'income'))}</div></div>
        </div>
      </div>
      {dates.length === 0 && <div className="card empty">이 달에는 해당하는 내역이 없어요.</div>}
      {dates.map((d) => {
        const arr = groups.get(d)!
        const e = sumType(arr, 'expense')
        return (
          <div key={d} className="card">
            <div className="day-head">
              <h2>{formatDateLong(d)}</h2>
              <div className="tot num">{e > 0 && `지출 ${won(e)}원`}</div>
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
