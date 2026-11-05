import { useMemo, useRef, useState, type ReactNode } from 'react'
import { anniversariesInMonth, dLabel, repeatLabel, upcomingAnniversaries } from '../lib/anniversaries'
import { DOW, dayOf, formatDateLong, monthGrid, monthRange, parseYM } from '../lib/dates'
import { byPriority, eventsByDate, fxClass, isRange, priorityWord, rangeLabel, rangePart, shortDate, upcomingEvents, whenLabel } from '../lib/events'
import { compact, won } from '../lib/format'
import { HOLIDAYS } from '../lib/holidays'
import { hasPlace, naverMapUrl, placeLabel } from '../lib/naverMap'
import { dailyTotals, samePeriodDiff, sumType } from '../lib/ledger'
import { lsGet, lsSet } from '../lib/localPrefs'
import type { Lookup } from '../lib/lookup'
import type { Anniversary, CalEvent, Scope, Transaction } from '../lib/types'
import { AnnivIcon } from './AnnivIcon'
import { CalendarIcon, CameraIcon, MapPinIcon, Plus } from './Icons'
import { EventMark, PriorityTag } from './EventPriority'
import { Bar, RowsWait, useAppear } from './Loading'
import type { PlanTarget } from './PlanSheet'
import { EventScopeTag, eventScopeLabel } from './EventScope'
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
  /** 캡처로 일정 넣기 시트를 연다(D-039) */
  onCapture?: () => void
  /** 고른 날에 이름만 적어 하루 종일 일정을 바로 넣는다(D-054). 넣었으면 true. 없으면 입력 칸을 보이지 않는다 */
  onQuickAdd?: (title: string) => Promise<boolean>
  /** 다른 달의 날짜로 옮겨 가서 고른다 (다가오는 기념일) */
  onJump: (date: string) => void
  /** 다가오는 기념일 아래 묶음(함께 기억할 것, D-038) */
  notes?: ReactNode
  /** 내역을 누를 때. 예정 내역이면 부르는 쪽이 고정 탭으로 보낸다 */
  onEdit: (t: Transaction) => void
}

/** 달력 칸 하나에 보일 기념일·일정 이름 수(넘치면 +N) */
const MAX_LABELS = 2

export function CalendarView({ ym, today, sel, cur, prev, loading = false, lookup, annivs, events, onSelect, onPlan, onCapture, onQuickAdd, onJump, onEdit, notes }: Props) {
  // 고정지출 예정분(D-030)은 쓴 돈·남은 돈에 넣되(이미 정해진 지출), 칸에서는 점선 금액으로 따로 보인다
  const totals = useMemo(() => dailyTotals(cur.filter((t) => !t.planned)), [cur])
  const planned = useMemo(() => cur.filter((t) => t.planned), [cur])
  const planByDate = useMemo(() => dailyTotals(planned), [planned])
  const annivByDate = useMemo(() => anniversariesInMonth(annivs, ym), [annivs, ym])
  // 기간 일정(D-054)은 기간 안의 날마다 들어간다(앞 달에 시작한 것도 이 달 날짜에)
  const evByDate = useMemo(() => { const r = monthRange(ym); return eventsByDate(events, r.start, r.end) }, [events, ym])
  const inc = sumType(cur, 'income')
  const exp = sumType(cur, 'expense')
  const thisMonth = today.slice(0, 7)
  const gridRef = useSlideIn<HTMLDivElement>(ym)
  const appear = useAppear(loading)

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
    ...upcomingAnniversaries(annivs, today).map((u) => ({ key: u.a.id, kind: u.a.kind as string, name: u.a.name, category: u.a.category, date: u.date, days: u.days, scope: 'shared' as const })),
    ...upcomingEvents(events, today).map((u) => ({ key: u.e.id, kind: 'event', name: u.e.title, category: null, date: u.date, days: u.days, scope: u.e.scope ?? 'shared', event: u.e, ongoing: u.ongoing })),
  ].map((x) => ({ event: undefined as CalEvent | undefined, ongoing: false, ...x })).filter((x) => x.days <= 30).sort((a, b) => a.days - b.days || a.name.localeCompare(b.name))
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
      {/* 차례(D-055): 남은 돈·달력 → 고른 날(일정·넣기·내역) → 다가오는 일정·기억할 것. 넓은 화면은 왼쪽에 달력 쪽 둘, 오른쪽에 고른 날.
          휴대폰에서는 이 묶음들이 풀려 한 줄로 이어진다 */}
      <div className="cal-top">
        {/* aria-live를 두지 않는다: 달 표시(App)가 이미 읽히고, 배우자 내역이 들어올 때마다 전부 다시 읽히면 시끄럽다 */}
        <div className="hero">
          {loading ? (
            // 이 달 내역이 오기 전에는 0원 대신 숫자 자리만 보인다
            <div className="hero-wait">
              <p className="wait-sr" role="status">{m}월 내역 불러오는 중</p>
              <p className="hero-label"><Bar w={7} /></p>
              <p className="hero-num"><Bar w={5.4} /></p>
              <div className="spend-bar" />
              <div className="hero-legend"><Bar w={8} /><Bar w={8} /></div>
            </div>
          ) : (
            <div className={appear || undefined}>
              <p className="hero-label"><Soft value={hasIncome ? `${m}월에 ${future ? '남을' : '남은'} 돈` : `${m}월에 ${future ? '나갈' : '쓴'} 돈`} /></p>
              <p className={`hero-num num${hasIncome && left < 0 ? ' neg' : ''}`}>
                <Soft value={hasIncome ? `${left < 0 ? '-' : ''}${won(Math.abs(left))}` : won(exp)} /><small>원</small>
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
              // 일정은 꼭 → 중요 → 보통 순서(두 개까지만 보여서). 중요·꼭은 효과 클래스, 기간 일정은 이웃 날과 이어지게 모서리를 편다(D-054)
              const labels: { key: string; name: string; cls: string; event?: CalEvent }[] = [
                ...(an ?? []).map((a) => ({ key: `a-${a.id}`, name: a.name, cls: `an k-${a.kind}` })),
                ...byPriority(ev ?? []).map((e) => ({ key: `e-${e.id}`, name: e.title, event: e,
                  cls: ['ev', `s-${e.scope ?? 'shared'}`, fxClass(e), isRange(e) && `r-${rangePart(e, date)}`,
                    // 이어지는 날 가운데 그 줄의 첫 칸(일요일·1일): 누구 띠를 여기에만 다시 보인다
                    isRange(e) && date !== e.date && (dw === 0 || dayOf(date) === 1) && 'r-head'].filter(Boolean).join(' ') })),
              ]
              const cls = ['day', dw === 0 && 'sun', dw === 6 && 'sat', hol && 'hol', an && 'anniv', date === today && 'today', date === sel && 'sel'].filter(Boolean).join(' ')
              const label = `${m}월 ${dayOf(date)}일${hol ? ` ${hol}` : ''}${an ? ` ${an.map((a) => a.name).join(', ')}` : ''}${ev ? ` 일정 ${ev.map(eventReadName).join(', ')}` : ''}${t?.expense ? ` 지출 ${won(t.expense)}원` : ''}${t?.income ? ` 수입 ${won(t.income)}원` : ''}${pl ? ` 고정지출 예정 ${won(pl)}원` : ''}`
              return (
                <button key={date} className={cls} aria-label={label} aria-pressed={date === sel} onClick={() => onSelect(date)}>
                  <span className="n num">{dayOf(date)}{an && <span className={`anniv-mark k-${an[0].kind}`}><AnnivIcon a={an[0]} /></span>}</span>
                  {/* 기념일·일정 이름(달력에서 바로 보이게). 두 개까지, 넘치면 +N. 읽기는 칸의 aria-label이 맡는다 */}
                  {labels.slice(0, MAX_LABELS).map((l) => <span key={l.key} className={`cal-lbl ${l.cls}`} aria-hidden="true">{l.event && <EventMark e={l.event} />}{l.name}</span>)}
                  {labels.length > MAX_LABELS && <span className="cal-lbl more num" aria-hidden="true">+{labels.length - MAX_LABELS}</span>}
                  {t?.income ? <span className="amt inc num">+{compact(t.income)}</span> : null}
                  {t?.expense ? <span className="amt exp num">{compact(t.expense)}</span> : null}
                  {pl ? <span className="amt plan num">{compact(pl)}</span> : null}
                </button>
              )
            })}
          </div>
        </div>

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
          {/* 그날의 기념일·일정 줄과 넣기 칸을 한 면에(D-055). 줄마다 색 면을 두지 않고 줄 맞춘 목록으로 */}
          <div className="card day-plan">
            {(dayAnniv.length > 0 || dayEvents.length > 0) && (
              <ul className="ag-list" aria-label="이 날의 일정·기념일">
                {dayAnniv.map((a) => (
                  <AgendaRow key={a.id} icon={<AnnivIcon a={a} />} name={a.name} onClick={() => onPlan({ kind: 'anniv', anniv: a })}
                    meta={[a.category, a.repeat_unit === 'month' || a.repeat_every > 1 ? repeatLabel(a) : null, a.lunar ? `음력 ${a.month}월 ${a.day}일` : null].filter(Boolean).join(', ')} />
                ))}
                {dayEvents.map((e) => {
                  // 장소를 누르면 네이버 지도(좌표가 있으면 대중교통 길찾기, 없으면 검색)를 연다(D-041). 일정 줄 버튼 안에 넣지 않고 그 아래 줄로 둔다
                  const routed = e.lat !== null && e.lng !== null
                  return (
                    <AgendaRow key={e.id} icon={<CalendarIcon />} name={e.title} event={e} scope={e.scope ?? 'shared'} meta={whenLabel(e)}
                      onClick={() => onPlan({ kind: 'event', event: e })}>
                      {hasPlace(e) && (
                        <a className="ag-place" href={naverMapUrl(e, 'transit') ?? undefined} target="_blank" rel="noopener noreferrer"
                          aria-label={`${placeLabel(e)} ${routed ? '길찾기' : '지도 검색'}, 네이버 지도`}>
                          <MapPinIcon /><span>{placeLabel(e)}</span><em>{routed ? '길찾기' : '지도'}</em>
                        </a>
                      )}
                    </AgendaRow>
                  )
                })}
              </ul>
            )}
            <DayNew key={sel} label={`${m}월 ${dayOf(sel)}일에 일정 넣기`} onQuickAdd={onQuickAdd} onCapture={onCapture}
              onDetail={(title) => onPlan({ kind: 'new', date: sel, title })} />
          </div>
          <div className="tx-list">
            {dayTx.map((t) => <TxRow key={t.id} t={t} lookup={lookup} onClick={() => onEdit(t)} />)}
            {!dayTx.length && (loading ? <RowsWait rows={2} /> : <div className="empty">이 날 기록이 없어요. 기록하기로 추가해 보세요.</div>)}
          </div>
        </div>
      )}

      <div className="cal-more">
        {soon.length > 0 && (
          <SoonList label="다가오는 일정·기념일" items={soon.map((u) => (
            <AgendaRow key={u.key} name={u.name} event={u.event} scope={u.scope} onClick={() => onJump(u.date)}
              icon={u.event ? <CalendarIcon /> : <AnnivIcon a={{ name: u.name, category: u.category, kind: u.kind as Anniversary['kind'] }} />}
              meta={u.event && isRange(u.event) ? rangeLabel(u.event) : shortDate(u.date)} trail={u.ongoing ? '하는 중' : dLabel(u.days)} />
          ))} />
        )}
        {notes}
      </div>
    </section>
  )
}

/** 달력 칸 읽기 이름: "양인환대(남편)", "가족 여행(꼭, 11월 7일 ~ 9일)" */
function eventReadName(e: CalEvent): string {
  const more = [e.scope && e.scope !== 'shared' ? eventScopeLabel(e.scope) : null, priorityWord(e), isRange(e) ? rangeLabel(e) : null].filter(Boolean)
  return more.length ? `${e.title}(${more.join(', ')})` : e.title
}

/**
 * 일정·기념일 한 줄(D-055). 고른 날 묶음과 다가오는 목록이 같은 모양을 쓴다: 그림 칸 · 이름 · 태그 · 오른쪽 글(시간·기간·날짜) · D-day.
 * 중요·꼭 일정(D-054)은 줄 전체를 칠하지 않고 이름만 달력 칸 이름 모양(고른 효과)으로 보이고 "중요"·"꼭" 글자 태그를 붙인다
 */
function AgendaRow({ icon, name, event, scope, meta, trail, onClick, children }: {
  icon: ReactNode
  name: string
  /** 일정이면 넘긴다(중요도 효과·태그) */
  event?: CalEvent
  scope?: Scope
  meta?: string
  /** 오른쪽 끝 굵은 글(D-day) */
  trail?: string
  onClick: () => void
  /** 줄 아래에 붙는 것(장소 줄) */
  children?: ReactNode
}) {
  return (
    <li className="ag-row">
      <button className="ag-main" onClick={onClick}>
        <span className="ag-ico" aria-hidden="true">{icon}</span>
        <span className={['ag-name', event && fxClass(event)].filter(Boolean).join(' ')}>{event && <EventMark e={event} />}{name}</span>
        {event && <PriorityTag e={event} />}
        {scope && <EventScopeTag scope={scope} />}
        <span className="ag-meta num">{meta}</span>
        {trail && <b className="ag-d num">{trail}</b>}
      </button>
      {children}
    </li>
  )
}

/**
 * 고른 날의 일정 넣기 칸(D-054, D-055에 일정 줄과 같은 면 안으로): 흰 입력칸 + 먹색 "넣기", 그 아래 흰 보조 버튼 둘.
 * 이름만 적어 넣으면 하루 종일 일정으로 바로 들어가고, 시간·기간·중요도·기념일은 "자세히 넣기" 시트에서 정한다(적던 이름은 가져간다)
 */
function DayNew({ label, onQuickAdd, onDetail, onCapture }: {
  /** 입력칸의 읽기 이름("11월 5일에 일정 넣기") */
  label: string
  onQuickAdd?: (title: string) => Promise<boolean>
  onDetail: (title?: string) => void
  onCapture?: () => void
}) {
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [miss, setMiss] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  async function add() {
    const name = title.trim()
    if (!name) { setMiss(true); input.current?.focus(); return }
    if (!onQuickAdd || busy) return
    setBusy(true)
    try { if (await onQuickAdd(name)) setTitle('') } finally { setBusy(false) }
  }

  return (
    <div className="day-new">
      {onQuickAdd && (
        <form className="day-new-form" onSubmit={(e) => { e.preventDefault(); void add() }}>
          <div className="day-new-row">
            <input ref={input} className={`input${miss ? ' bad' : ''}`} placeholder="새 일정 (예: 치과 예약)" maxLength={40} autoComplete="off" enterKeyHint="done"
              aria-label={label} aria-invalid={miss || undefined} aria-describedby={miss ? 'day-new-note' : undefined}
              value={title} onChange={(e) => { setTitle(e.target.value); setMiss(false) }} />
            <button className="primary" disabled={busy}>넣기</button>
          </div>
          {miss && <p id="day-new-note" className="err" role="alert">일정 이름을 적어 주세요.</p>}
        </form>
      )}
      <div className="day-adds" role="group" aria-label={onQuickAdd ? undefined : label}>
        <button type="button" className="ghost" onClick={() => onDetail(title.trim() || undefined)}><Plus />자세히 넣기</button>
        {onCapture && <button type="button" className="ghost" onClick={onCapture}><CameraIcon />캡처·문자로 넣기</button>}
      </div>
    </div>
  )
}

/** 다가오는 목록에서 접힌 채 보이는 줄 수 */
const SOON_MAX = 5
const SOON_OPEN = 'ab:soonOpen'

/**
 * 다가오는 일정·기념일 목록(D-055): 30일 안의 것을 가까운 순서로 줄 맞춰 보인다. 다섯 줄까지 보이고 "N개 더 보기"로 펼친다(펼친 상태는 기기에 기억).
 * 색색 칩이 여러 줄로 감기던 것(D-044)과 넓은 화면에서 옆으로 흐르던 것(D-033)을 이 목록 하나로 바꿨다: 잘리는 것 없이 다 볼 수 있고 움직이지 않는다
 */
function SoonList({ label, items }: { label: string; items: ReactNode[] }) {
  const [open, setOpen] = useState(() => lsGet(SOON_OPEN) === '1')
  const more = items.length - SOON_MAX
  return (
    <section className="card soon-card" role="group" aria-label={label}>
      <div className="soon-head">
        <h2 className="section-title">{label}</h2>
        <span className="soon-count num">{items.length}개</span>
      </div>
      <ul className="ag-list">{open ? items : items.slice(0, SOON_MAX)}</ul>
      {more > 0 && (
        <button className="link-btn soon-more" aria-expanded={open} onClick={() => { lsSet(SOON_OPEN, open ? '0' : '1'); setOpen(!open) }}>
          {open ? '접기' : `${more}개 더 보기`}
        </button>
      )}
    </section>
  )
}
