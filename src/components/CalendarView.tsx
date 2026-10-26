import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { anniversariesInMonth, daysBetween, dLabel, repeatLabel, upcomingAnniversaries } from '../lib/anniversaries'
import { DOW, dayOf, formatDateLong, monthGrid, parseYM } from '../lib/dates'
import { compact, won } from '../lib/format'
import { HOLIDAYS } from '../lib/holidays'
import { dailyTotals, samePeriodDiff, sumType } from '../lib/ledger'
import type { Lookup } from '../lib/lookup'
import type { Anniversary, CalEvent, Transaction } from '../lib/types'
import { AnnivIcon, CalendarIcon, Plus } from './Icons'
import type { PlanTarget } from './PlanSheet'
import { Soft, useSlideIn } from './Motion'
import { TxRow } from './TxRow'

interface Props {
  ym: string
  today: string
  sel: string
  /** 그 달 내역. 고정지출 예정분(planned, D-030)도 들어 있다 */
  cur: Transaction[]
  prev: Transaction[]
  /** 달을 넘겨 새 달 내역을 아직 못 받았을 때: 0원·"기록 없음" 대신 불러오는 중으로 보인다 */
  loading?: boolean
  lookup: Lookup
  annivs: Anniversary[]
  events: CalEvent[]
  onSelect: (date: string) => void
  /** 일정·기념일 넣기·고치기 시트를 연다 */
  onPlan: (t: PlanTarget) => void
  /** 다른 달의 날짜로 옮겨 가서 고른다 (다가오는 기념일) */
  onJump: (date: string) => void
  /** 내역을 누를 때. 예정 내역이면 부르는 쪽이 고정 탭으로 보낸다 */
  onEdit: (t: Transaction) => void
}

export function CalendarView({ ym, today, sel, cur, prev, loading = false, lookup, annivs, events, onSelect, onPlan, onJump, onEdit }: Props) {
  // 고정지출 예정분(D-030)은 쓴 돈·남은 돈에 넣되(이미 정해진 지출), 칸에서는 점선 금액으로 따로 보인다
  const totals = useMemo(() => dailyTotals(cur.filter((t) => !t.planned)), [cur])
  const planned = useMemo(() => cur.filter((t) => t.planned), [cur])
  const planByDate = useMemo(() => dailyTotals(planned), [planned])
  const annivByDate = useMemo(() => anniversariesInMonth(annivs, ym), [annivs, ym])
  const evByDate = useMemo(() => {
    const m = new Map<string, CalEvent[]>()
    for (const e of events) m.set(e.date, [...(m.get(e.date) ?? []), e])
    return m
  }, [events])
  const inc = sumType(cur, 'income')
  const exp = sumType(cur, 'expense')
  const thisMonth = today.slice(0, 7)
  const gridRef = useSlideIn<HTMLDivElement>(ym)

  let compare: React.ReactNode = null
  // 지난달 지출 기록이 없으면 전액이 '더 썼어요'로 보이므로 비교하지 않는다
  const prevHasExpense = prev.some((t) => t.type === 'expense')
  if (loading) {
    compare = null
  } else if (!prevHasExpense) {
    if (exp > 0 && ym <= thisMonth) compare = <span className="muted">지난달 기록이 없어 비교하지 않아요</span>
  } else if (ym === thisMonth) {
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
  const dayEvents = evByDate.get(sel) ?? []
  // 이번 달을 볼 때만, 30일 안에 오는 기념일·일정 네 개까지 (가까운 순서)
  const soon = ym !== thisMonth ? [] : [
    ...upcomingAnniversaries(annivs, today).map((u) => ({ key: u.a.id, kind: u.a.kind as string, name: u.a.name, date: u.date, days: u.days })),
    ...events.filter((e) => e.date >= today).map((e) => ({ key: e.id, kind: 'event', name: e.title, date: e.date, days: daysBetween(today, e.date) })),
  ].filter((x) => x.days <= 30).sort((a, b) => a.days - b.days || a.name.localeCompare(b.name)).slice(0, 4)
  const de = sumType(dayTx.filter((t) => !t.planned), 'expense')
  const di = sumType(dayTx, 'income')
  const dp = sumType(dayTx.filter((t) => t.planned), 'expense')
  const monthPlan = sumType(planned, 'expense')
  const future = ym > thisMonth
  // 들어온 돈이 없는 달은 남은 돈 대신 쓴 돈을 크게 보여 준다. 앞 달은 고정지출 예정분이라 '나갈 돈'
  const hasIncome = inc > 0
  const left = inc - exp
  const ratio = hasIncome ? Math.min(1, exp / inc) : 0

  return (
    <section className="view cal-view">
      {/* 넓은 화면에서는 왼쪽 달력, 오른쪽 고른 날의 내역. 휴대폰에서는 이 묶음이 풀려 한 줄로 이어진다 */}
      <div className="cal-main">
        {/* aria-live를 두지 않는다: 달 표시(App)가 이미 읽히고, 배우자 내역이 들어올 때마다 전부 다시 읽히면 시끄럽다 */}
        <div className="hero">
          <p className="hero-label"><Soft value={hasIncome ? `${m}월에 ${future ? '남을' : '남은'} 돈` : `${m}월에 ${future ? '나갈' : '쓴'} 돈`} /></p>
          <p className={`hero-num num${hasIncome && left < 0 ? ' neg' : ''}`}>
            <Soft value={loading ? '…' : hasIncome ? `${left < 0 ? '-' : ''}${won(Math.abs(left))}` : won(exp)} /><small>원</small>
          </p>
          {hasIncome && (
            <div className="spend-bar" role="img" aria-label={`들어온 돈의 ${Math.round((exp / inc) * 100)}%를 썼어요`}>
              <i style={{ transform: `scaleX(${ratio})` }} />
            </div>
          )}
          <div className="hero-legend num">
            <span>{future ? '나갈 돈' : '쓴 돈'} <b><Soft value={won(exp)} /></b></span>
            <span className="in">들어온 돈 <b><Soft value={won(inc)} /></b></span>
          </div>
          {compare && <p className="compare">{compare}</p>}
          {monthPlan > 0 && (
            <p className="compare plan-sum">
              고정지출 예정 <b className="num">{won(monthPlan)}원</b><span className="num">, {planned.length}건</span> 포함
            </p>
          )}
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
              const ev = evByDate.get(date)
              const pl = planByDate.get(date)?.expense
              const cls = ['day', dw === 0 && 'sun', dw === 6 && 'sat', hol && 'hol', an && 'anniv', date === today && 'today', date === sel && 'sel'].filter(Boolean).join(' ')
              const label = `${m}월 ${dayOf(date)}일${hol ? ` ${hol}` : ''}${an ? ` ${an.map((a) => a.name).join(', ')}` : ''}${ev ? ` 일정 ${ev.map((e) => e.title).join(', ')}` : ''}${t?.expense ? ` 지출 ${won(t.expense)}원` : ''}${t?.income ? ` 수입 ${won(t.income)}원` : ''}${pl ? ` 고정지출 예정 ${won(pl)}원` : ''}`
              return (
                <button key={date} className={cls} aria-label={label} aria-pressed={date === sel} onClick={() => onSelect(date)}>
                  <span className="n num">{dayOf(date)}{an && <span className={`anniv-mark k-${an[0].kind}`}><AnnivIcon kind={an[0].kind} /></span>}{ev && <span className="ev-dot" />}</span>
                  {t?.income ? <span className="amt inc num">+{compact(t.income)}</span> : null}
                  {t?.expense ? <span className="amt exp num">{compact(t.expense)}</span> : null}
                  {pl ? <span className="amt plan num">{compact(pl)}</span> : null}
                </button>
              )
            })}
          </div>
        </div>

        {soon.length > 0 && (
          <SoonRow label="다가오는 기념일" items={soon.map((u) => (tab: number | undefined) => (
            <button key={u.key} className={`anniv-chip k-${u.kind}`} tabIndex={tab} onClick={() => onJump(u.date)}>
              {u.kind === 'event' ? <CalendarIcon /> : <AnnivIcon kind={u.kind as Anniversary['kind']} />}<span>{u.name}</span><b className="num">{dLabel(u.days)}</b>
            </button>
          ))} />
        )}
      </div>

      {sel.startsWith(ym) && (
        <div className="day-group">
          <div className="day-head">
            <h2>{formatDateLong(sel).replace(/^\d+월 /, '')}{HOLIDAYS[sel] ? <span className="tag" style={{ marginLeft: 8, verticalAlign: '2px' }}>{HOLIDAYS[sel]}</span> : null}</h2>
            <div className="tot num">
              {de > 0 && <>{won(de)}원 썼어요</>}
              {de > 0 && di > 0 && <br />}
              {di > 0 && <>{won(di)}원 들어왔어요</>}
              {(de > 0 || di > 0) && dp > 0 && <br />}
              {dp > 0 && <span className="plan">{won(dp)}원 나갈 예정</span>}
            </div>
          </div>
          {(dayAnniv.length > 0 || dayEvents.length > 0) && (
            <div className="anniv-list">
              {dayAnniv.map((a) => (
                <button key={a.id} className={`anniv-row k-${a.kind}`} onClick={() => onPlan({ kind: 'anniv', anniv: a })}>
                  <AnnivIcon kind={a.kind} /><b>{a.name}</b>
                  <span>{[a.category, a.repeat_unit === 'month' || a.repeat_every > 1 ? repeatLabel(a) : null, a.lunar ? `음력 ${a.month}월 ${a.day}일` : null].filter(Boolean).join(' · ')}</span>
                </button>
              ))}
              {dayEvents.map((e) => (
                <button key={e.id} className="anniv-row k-event" onClick={() => onPlan({ kind: 'event', event: e })}>
                  <CalendarIcon /><b>{e.title}</b><span className="num">{e.time ?? '하루 종일'}</span>
                </button>
              ))}
            </div>
          )}
          <button className="day-add" onClick={() => onPlan({ kind: 'new', date: sel })}><Plus />일정·기념일 넣기</button>
          <div className="tx-list">
            {dayTx.map((t) => <TxRow key={t.id} t={t} lookup={lookup} onClick={() => onEdit(t)} />)}
            {!dayTx.length && <div className="empty">{loading ? '불러오는 중…' : '이 날 기록이 없어요. 기록하기로 추가해 보세요.'}</div>}
          </div>
        </div>
      )}
    </section>
  )
}

/**
 * 다가오는 기념일 줄(D-033). 칩이 줄을 넘치면 마우스로 쓰는 화면(PC)에서는 옆으로 천천히 흘러 다 보이게 한다:
 * 같은 칩을 한 번 더 이어 붙여(읽기·탭 이동에서 뺀다) 끊김 없이 돌고, 마우스를 올리거나 포커스가 가면 멈춘다.
 * 움직임 줄이기를 켰으면 흐르지 않고 줄을 바꿔 다 보인다. 손가락으로 쓰는 화면은 지금처럼 밀어서 본다
 */
function SoonRow({ label, items }: { label: string; items: ((tab: number | undefined) => ReactNode)[] }) {
  const box = useRef<HTMLDivElement>(null)
  const set = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<{ kind: 'still' | 'flow' | 'wrap'; width: number }>({ kind: 'still', width: 0 })
  useEffect(() => {
    const el = box.current
    const one = set.current
    if (!el || !one || typeof ResizeObserver === 'undefined' || typeof window.matchMedia !== 'function') return
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)')
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)')
    const check = () => {
      // 칩 너비의 합(+ 간격 6px): 줄을 바꿔도 변하지 않는 원래 너비로 넘치는지 본다(scrollWidth는 줄을 바꾸면 줄어 오락가락한다)
      const chips = [...one.children]
      const width = chips.reduce((sum, c) => sum + c.getBoundingClientRect().width, 0) + 6 * Math.max(0, chips.length - 1)
      const over = width > el.clientWidth + 1
      setMode({ kind: !over || !fine.matches ? 'still' : calm.matches ? 'wrap' : 'flow', width })
    }
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    ro.observe(one)
    calm.addEventListener('change', check)
    return () => { ro.disconnect(); calm.removeEventListener('change', check) }
  }, [])
  // 1초에 40px쯤: 칩 네 개(500px 안팎)가 한 바퀴 도는 데 열몇 초
  const seconds = Math.max(8, Math.round((mode.width + 6) / 40))
  return (
    <div ref={box} className={`anniv-soon${mode.kind === 'still' ? '' : ` ${mode.kind}`}`} role="group" aria-label={label}>
      <div className="soon-track" style={mode.kind === 'flow' ? { animationDuration: `${seconds}s` } : undefined}>
        <div className="soon-set" ref={set}>{items.map((f) => f(undefined))}</div>
        {mode.kind === 'flow' && <div className="soon-set" aria-hidden="true" inert>{items.map((f) => f(-1))}</div>}
      </div>
    </div>
  )
}
