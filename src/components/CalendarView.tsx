import { useMemo } from 'react'
import { DOW, dayOf, formatDateLong, monthGrid, parseYM } from '../lib/dates'
import { compact, won } from '../lib/format'
import { HOLIDAYS } from '../lib/holidays'
import { dailyTotals, samePeriodDiff, sumType } from '../lib/ledger'
import type { Lookup } from '../lib/lookup'
import type { Transaction } from '../lib/types'
import { TxRow } from './TxRow'

interface Props {
  ym: string
  today: string
  sel: string
  cur: Transaction[]
  prev: Transaction[]
  lookup: Lookup
  onSelect: (date: string) => void
  onEdit: (t: Transaction) => void
}

export function CalendarView({ ym, today, sel, cur, prev, lookup, onSelect, onEdit }: Props) {
  const totals = useMemo(() => dailyTotals(cur), [cur])
  const inc = sumType(cur, 'income')
  const exp = sumType(cur, 'expense')
  const thisMonth = today.slice(0, 7)

  let compare: React.ReactNode = null
  if (ym === thisMonth) {
    const d = dayOf(today)
    const diff = samePeriodDiff(cur, prev, d)
    compare = <>지난달 같은 기간(1~{d}일)보다 지출이 <b className="num">{won(Math.abs(diff))}원 {diff >= 0 ? '많아요' : '적어요'}</b></>
  } else if (ym < thisMonth) {
    const diff = exp - sumType(prev, 'expense')
    compare = <>지난달보다 지출이 <b className="num">{won(Math.abs(diff))}원 {diff >= 0 ? '많았어요' : '적었어요'}</b></>
  }

  const { m } = parseYM(ym)
  const dayTx = cur.filter((t) => t.occurred_on === sel)
  const de = sumType(dayTx, 'expense')
  const di = sumType(dayTx, 'income')

  return (
    <section className="view">
      <div className="card">
        <div className="summary">
          <div><div className="k">수입</div><div className="v inc num">{won(inc)}</div></div>
          <div><div className="k">지출</div><div className="v exp num">{won(exp)}</div></div>
          <div><div className="k">남은 돈</div><div className="v num">{won(inc - exp)}</div></div>
        </div>
        {compare && <div className="compare">{compare}</div>}
      </div>

      <div className="card cal-card">
        <div className="cal">
          {DOW.map((d, i) => <div key={d} className={`dow${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}`}>{d}</div>)}
          {monthGrid(ym).map((date, i) => {
            if (!date) return <div key={`b${i}`} className="day blank" aria-hidden="true" />
            const dw = i % 7
            const t = totals.get(date)
            const hol = HOLIDAYS[date]
            const cls = ['day', dw === 0 && 'sun', dw === 6 && 'sat', hol && 'hol', date === today && 'today', date === sel && 'sel'].filter(Boolean).join(' ')
            const label = `${m}월 ${dayOf(date)}일${t?.expense ? ` 지출 ${won(t.expense)}원` : ''}${t?.income ? ` 수입 ${won(t.income)}원` : ''}`
            return (
              <button key={date} className={cls} aria-label={label} aria-pressed={date === sel} onClick={() => onSelect(date)}>
                <span className="n num">{dayOf(date)}</span>
                {hol && <span className="hname">{hol}</span>}
                {t?.income ? <span className="amt inc num">+{compact(t.income)}</span> : null}
                {t?.expense ? <span className="amt exp num">{compact(t.expense)}</span> : null}
              </button>
            )
          })}
        </div>
      </div>

      {sel.startsWith(ym) && (
        <div className="card">
          <div className="day-head">
            <h2>{formatDateLong(sel)}{HOLIDAYS[sel] ? ` · ${HOLIDAYS[sel]}` : ''}</h2>
            <div className="tot num">
              {de > 0 && <>지출 {won(de)}원</>}
              {de > 0 && di > 0 && <br />}
              {di > 0 && <>수입 {won(di)}원</>}
            </div>
          </div>
          <div className="tx-list">
            {dayTx.length
              ? dayTx.map((t) => <TxRow key={t.id} t={t} lookup={lookup} onClick={() => onEdit(t)} />)
              : <div className="empty">이 날 기록이 없어요. 오른쪽 아래 + 버튼으로 추가하세요.</div>}
          </div>
        </div>
      )}
    </section>
  )
}
