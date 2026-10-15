import { useMemo } from 'react'
import { anniversariesInMonth, dLabel, upcomingAnniversaries } from '../lib/anniversaries'
import { DOW, dayOf, formatDateLong, monthGrid, parseYM } from '../lib/dates'
import { compact, won } from '../lib/format'
import { HOLIDAYS } from '../lib/holidays'
import { dailyTotals, samePeriodDiff, sumType } from '../lib/ledger'
import type { Lookup } from '../lib/lookup'
import type { Anniversary, Transaction } from '../lib/types'
import { AnnivIcon } from './Icons'
import { Soft, useSlideIn } from './Motion'
import { TxRow } from './TxRow'

interface Props {
  ym: string
  today: string
  sel: string
  cur: Transaction[]
  prev: Transaction[]
  lookup: Lookup
  annivs: Anniversary[]
  onSelect: (date: string) => void
  /** 다른 달의 날짜로 옮겨 가서 고른다 (다가오는 기념일) */
  onJump: (date: string) => void
  onEdit: (t: Transaction) => void
}

export function CalendarView({ ym, today, sel, cur, prev, lookup, annivs, onSelect, onJump, onEdit }: Props) {
  const totals = useMemo(() => dailyTotals(cur), [cur])
  const annivByDate = useMemo(() => anniversariesInMonth(annivs, ym), [annivs, ym])
  const inc = sumType(cur, 'income')
  const exp = sumType(cur, 'expense')
  const thisMonth = today.slice(0, 7)
  const gridRef = useSlideIn<HTMLDivElement>(ym)

  let compare: React.ReactNode = null
  if (ym === thisMonth) {
    const d = dayOf(today)
    const diff = samePeriodDiff(cur, prev, d)
    if (diff !== 0) compare = <>지난달 같은 기간(1~{d}일)보다 <b className="num">{won(Math.abs(diff))}원 {diff > 0 ? '더' : '덜'}</b> 썼어요</>
  } else if (ym < thisMonth) {
    const diff = exp - sumType(prev, 'expense')
    if (diff !== 0) compare = <>지난달보다 <b className="num">{won(Math.abs(diff))}원 {diff > 0 ? '더' : '덜'}</b> 썼어요</>
  }

  const { m } = parseYM(ym)
  const dayTx = cur.filter((t) => t.occurred_on === sel)
  const dayAnniv = annivByDate.get(sel) ?? []
  // 이번 달을 볼 때만, 30일 안에 오는 기념일 세 개까지
  const soon = ym === thisMonth ? upcomingAnniversaries(annivs, today).filter((u) => u.days <= 30).slice(0, 3) : []
  const de = sumType(dayTx, 'expense')
  const di = sumType(dayTx, 'income')
  // 들어온 돈이 없는 달은 남은 돈 대신 쓴 돈을 크게 보여 준다
  const hasIncome = inc > 0
  const left = inc - exp
  const ratio = hasIncome ? Math.min(1, exp / inc) : 0

  return (
    <section className="view">
      <div className="hero" aria-live="polite">
        <p className="hero-label"><Soft value={hasIncome ? `${m}월에 남은 돈` : `${m}월에 쓴 돈`} /></p>
        <p className={`hero-num num${hasIncome && left < 0 ? ' neg' : ''}`}>
          <Soft value={hasIncome ? `${left < 0 ? '-' : ''}${won(Math.abs(left))}` : won(exp)} /><small>원</small>
        </p>
        {hasIncome && (
          <div className="spend-bar" role="img" aria-label={`들어온 돈의 ${Math.round((exp / inc) * 100)}%를 썼어요`}>
            <i style={{ transform: `scaleX(${ratio})` }} />
          </div>
        )}
        <div className="hero-legend num">
          <span>쓴 돈 <b><Soft value={won(exp)} /></b></span>
          <span className="in">들어온 돈 <b><Soft value={won(inc)} /></b></span>
        </div>
        {compare && <p className="compare">{compare}</p>}
      </div>

      <div className="card cal-card">
        <div className="cal" ref={gridRef}>
          {DOW.map((d, i) => <div key={d} className={`dow${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}`}>{d}</div>)}
          {monthGrid(ym).map((date, i) => {
            if (!date) return <div key={`b${i}`} className="day blank" aria-hidden="true" />
            const dw = i % 7
            const t = totals.get(date)
            const hol = HOLIDAYS[date]
            const an = annivByDate.get(date)
            const cls = ['day', dw === 0 && 'sun', dw === 6 && 'sat', hol && 'hol', an && 'anniv', date === today && 'today', date === sel && 'sel'].filter(Boolean).join(' ')
            const label = `${m}월 ${dayOf(date)}일${hol ? ` ${hol}` : ''}${an ? ` ${an.map((a) => a.name).join(', ')}` : ''}${t?.expense ? ` 지출 ${won(t.expense)}원` : ''}${t?.income ? ` 수입 ${won(t.income)}원` : ''}`
            return (
              <button key={date} className={cls} aria-label={label} aria-pressed={date === sel} onClick={() => onSelect(date)}>
                <span className="n num">{dayOf(date)}{an && <span className={`anniv-mark k-${an[0].kind}`}><AnnivIcon kind={an[0].kind} /></span>}</span>
                {t?.income ? <span className="amt inc num">+{compact(t.income)}</span> : null}
                {t?.expense ? <span className="amt exp num">{compact(t.expense)}</span> : null}
              </button>
            )
          })}
        </div>
      </div>

      {soon.length > 0 && (
        <div className="anniv-soon" role="group" aria-label="다가오는 기념일">
          {soon.map((u) => (
            <button key={u.a.id} className={`anniv-chip k-${u.a.kind}`} onClick={() => onJump(u.date)}>
              <AnnivIcon kind={u.a.kind} /><span>{u.a.name}</span><b className="num">{dLabel(u.days)}</b>
            </button>
          ))}
        </div>
      )}

      {sel.startsWith(ym) && (
        <div className="day-group">
          <div className="day-head">
            <h2>{formatDateLong(sel).replace(/^\d+월 /, '')}{HOLIDAYS[sel] ? <span className="tag" style={{ marginLeft: 8, verticalAlign: '2px' }}>{HOLIDAYS[sel]}</span> : null}</h2>
            <div className="tot num">
              {de > 0 && <>{won(de)}원 썼어요</>}
              {de > 0 && di > 0 && <br />}
              {di > 0 && <>{won(di)}원 들어왔어요</>}
            </div>
          </div>
          {dayAnniv.length > 0 && (
            <div className="anniv-list">
              {dayAnniv.map((a) => (
                <div key={a.id} className={`anniv-row k-${a.kind}`}>
                  <AnnivIcon kind={a.kind} /><b>{a.name}</b>{a.lunar && <span>음력 {a.month}월 {a.day}일</span>}
                </div>
              ))}
            </div>
          )}
          <div className="tx-list">
            {dayTx.length
              ? dayTx.map((t) => <TxRow key={t.id} t={t} lookup={lookup} onClick={() => onEdit(t)} />)
              : <div className="empty">이 날 기록이 없어요. 오른쪽 아래 기록하기로 추가해 보세요.</div>}
          </div>
        </div>
      )}
    </section>
  )
}
