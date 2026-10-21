import { useEffect, useMemo, useState } from 'react'
import { fetchMonthlyTotals, fetchRange, friendlyError } from '../lib/api'
import { addMonths, dayOf, monthRange, parseYM } from '../lib/dates'
import { won } from '../lib/format'
import { categoryTrend, monthFacts, monthTips, weeklySpend } from '../lib/insights'
import { sumType } from '../lib/ledger'
import { SCOPE_LABEL, SCOPES, type Lookup } from '../lib/lookup'
import { categoryBreakdown, monthSeries, OTHER_PLATFORM, pctChange, platformBreakdown, scopeSplit, type MonthPoint } from '../lib/stats'
import type { Category, Household, MonthTotal, Transaction } from '../lib/types'
import { BillCard } from './BillCard'
import { FuelCard } from './FuelCard'

interface Props {
  household: Household
  ym: string
  today: string
  cur: Transaction[]
  prev: Transaction[]
  lookup: Lookup
  categories: Category[]
  /** 관리비 고지서를 새로 저장하면 바뀐다 */
  billsVersion: number
  /** 관리비 고지서 넣기 */
  onBill: () => void
  /** 주유 영수증 넣기 (영수증 사진 입력) */
  onFuel: () => void
  /** 분류·플랫폼의 내역을 내역 탭에서 보기 */
  onCategory: (id: string | null, name: string) => void
  onPlatform: (name: string, kind: 'platform' | 'merchant' | 'other') => void
}

const man = (n: number) => (n >= 10_000 ? `${Math.round(n / 10_000).toLocaleString('ko-KR')}만` : won(n))

export function StatsView({ household, ym, today, cur, prev, lookup, categories, billsVersion, onBill, onFuel, onCategory, onPlatform }: Props) {
  const [totals, setTotals] = useState<MonthTotal[] | null>(null)
  const [lastYear, setLastYear] = useState<Transaction[]>([])
  // 분류 추이용 지난 넉 달 (지난달·이번 달은 이미 받은 것을 쓴다)
  const [older, setOlder] = useState<Transaction[]>([])
  const [sel, setSel] = useState(ym)
  // 펼친 분류 (undefined: 없음, null: '분류 없음')
  const [openCat, setOpenCat] = useState<string | null | undefined>(undefined)
  const [err, setErr] = useState('')

  useEffect(() => { setSel(ym); setOpenCat(undefined) }, [ym])

  // 달이 바뀔 때만: 작년 같은 달과 지난 넉 달
  useEffect(() => {
    let alive = true
    const ly = addMonths(ym, -12)
    Promise.all([
      fetchRange(household.id, monthRange(ly).start, monthRange(ly).end),
      fetchRange(household.id, monthRange(addMonths(ym, -5)).start, monthRange(addMonths(ym, -2)).end),
    ]).then(([l, o]) => { if (alive) { setLastYear(l); setOlder(o); setErr('') } })
      .catch((e) => { if (alive) setErr(friendlyError(e)) })
    return () => { alive = false }
  }, [household.id, ym])

  // 내역이 바뀔 때마다: 12개월 합계 (서버에서 더하는 가벼운 호출)
  useEffect(() => {
    let alive = true
    fetchMonthlyTotals(household.id, `${addMonths(ym, -12)}-01`, monthRange(ym).end)
      .then((t) => { if (alive) setTotals(t) })
      .catch((e) => { if (alive) setErr(friendlyError(e)) })
    return () => { alive = false }
  }, [household.id, ym, cur])

  const series = useMemo(() => (totals ? monthSeries(totals, ym) : []), [totals, ym])
  const cats = useMemo(() => categoryBreakdown(cur, prev, categories), [cur, prev, categories])
  const split = useMemo(() => scopeSplit(cur), [cur])
  const prevSplit = useMemo(() => scopeSplit(prev), [prev])
  const platforms = useMemo(() => platformBreakdown(cur, prev, categories), [cur, prev, categories])
  const insight = useMemo(() => ({ cur, prev, ym, today, categories }), [cur, prev, ym, today, categories])
  const facts = useMemo(() => monthFacts(insight), [insight])
  const tips = useMemo(() => monthTips(insight), [insight])
  const weeks = useMemo(() => weeklySpend(cur, ym, today), [cur, ym, today])
  const trendTxs = useMemo(() => [...older, ...prev, ...cur], [older, prev, cur])

  const isCurrent = ym === today.slice(0, 7)
  const upto = isCurrent ? dayOf(today) : undefined
  const { m } = parseYM(ym)
  // 지난달 기록이 아예 없으면 전액이 '늘었다'로 보이므로 비교하지 않는다
  const prevHas = (type: 'expense' | 'income') => prev.some((t) => t.type === type)
  const rows = (['expense', 'income'] as const).map((type) => {
    const now = sumType(cur, type, upto)
    return { type, now, hasPrev: prevHas(type), mom: now - sumType(prev, type, upto), momPct: pctChange(now, sumType(prev, type, upto)),
      yoy: now - sumType(lastYear, type, upto), yoyPct: pctChange(now, sumType(lastYear, type, upto)), hasLY: lastYear.some((t) => t.type === type) }
  })
  const noPrev = !prevHas('expense')
  const selPoint = series.find((p) => p.ym === sel)
  const maxCat = cats[0]?.amount ?? 0
  const maxPlat = Math.max(0, ...platforms.map((p) => p.amount))
  const maxWeek = Math.max(0, ...weeks.map((w) => w.amount))

  return (
    <section className="view">
      {err && <p className="banner" role="alert">{err}</p>}

      <div className="card">
        <h2 className="section-title">{m}월 {isCurrent ? `(1~${upto}일, 비교도 같은 기간)` : ''}</h2>
        {rows.map((r) => (
          <div className="stat-row" key={r.type}>
            <span className="k">{r.type === 'expense' ? '지출' : '수입'}</span>
            <b className={`num ${r.type === 'expense' ? 'exp' : 'inc'}`}>{won(r.now)}</b>
            <span className="delta">전월 {r.hasPrev ? <Delta diff={r.mom} pct={r.momPct} /> : <span className="muted">기록 없음</span>}</span>
            <span className="delta">전년 {r.hasLY ? <Delta diff={r.yoy} pct={r.yoyPct} /> : <span className="muted">기록 없음</span>}</span>
          </div>
        ))}
      </div>

      {facts.length > 0 && (
        <div className="card">
          <h2 className="section-title">{m}월 살펴보기</h2>
          <ul className="facts">{facts.map((f) => <li key={f.key}>{f.text}</li>)}</ul>
        </div>
      )}

      {tips.length > 0 && (
        <div className="card">
          <h2 className="section-title">이렇게 해 보면</h2>
          <ul className="tips">
            {tips.map((t) => (
              <li key={t.key} className="tip">
                <span>{t.text}</span>
                {t.saving !== null && t.saving > 0 && <span className="save num">한 달 약 {won(t.saving)}원</span>}
              </li>
            ))}
          </ul>
          <p className="tx-meta" style={{ marginTop: 10 }}>이번 달과 지난달 내역만 보고 찾은 제안이에요. 사정에 맞지 않으면 흘려 보내세요.</p>
        </div>
      )}

      {sumType(cur, 'expense') > 0 && (
        <div className="card">
          <h2 className="section-title">주별로 보면</h2>
          {weeks.map((w) => (
            <div key={w.label} className={`week-row${w.future ? ' future' : ''}`}>
              <span className="k num">{w.label}</span>
              <div className="cat-bar"><i style={{ width: `${maxWeek ? (w.amount / maxWeek) * 100 : 0}%` }} /></div>
              <b className="num">{w.future && w.amount === 0 ? '아직' : won(w.amount)}</b>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h2 className="section-title">최근 12개월</h2>
        <div className="legend">
          <span><i className="sw exp" />지출</span>
          <span><i className="sw inc" />수입</span>
        </div>
        {totals ? <MonthChart points={series} sel={sel} onSelect={setSel} /> : <p className="lead">불러오는 중…</p>}
        {selPoint && <p className="readout num">{readout(selPoint)}</p>}
        <details className="table-view">
          <summary>표로 보기</summary>
          <table>
            <thead><tr><th>월</th><th>지출</th><th>수입</th></tr></thead>
            <tbody>
              {series.slice().reverse().map((p) => (
                <tr key={p.ym}><td>{p.ym}</td><td className="num">{won(p.expense)}</td><td className="num">{won(p.income)}</td></tr>
              ))}
            </tbody>
          </table>
        </details>
      </div>

      <div className="card">
        <h2 className="section-title">어디에 썼나</h2>
        {cats.length === 0 && <p className="empty">이번 달 지출이 없어요</p>}
        {cats.length > 0 && <p className="tx-meta" style={{ marginTop: -6, marginBottom: 6 }}>{noPrev ? '지난달 기록이 없어 비교하지 않아요. ' : ''}눌러서 여섯 달 추이와 내역을 봐요.</p>}
        {cats.map((c) => {
          const open = openCat === c.id
          return (
            <div className="cat-row" key={c.id ?? 'none'}>
              <button className="cat-btn" aria-expanded={open} onClick={() => setOpenCat(open ? undefined : c.id)}>
                <div className="cat-top">
                  <span>{c.name} <span className="muted num">{Math.round(c.share * 100)}%</span></span>
                  <b className="num">{won(c.amount)}</b>
                </div>
                <div className="cat-bar"><i style={{ width: `${maxCat ? (c.amount / maxCat) * 100 : 0}%` }} /></div>
                {!noPrev && <span className="delta">{c.prev ? <Delta diff={c.amount - c.prev} pct={pctChange(c.amount, c.prev)} /> : <span className="muted">지난달 없음</span>}</span>}
              </button>
              {open && (
                <div className="cat-detail">
                  <Trend points={categoryTrend(trendTxs, c.id, ym)} />
                  <button className="ghost" onClick={() => onCategory(c.id, c.name)}>{c.name} 내역 보기</button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="card">
        <h2 className="section-title">누구를 위한 지출</h2>
        <div className="summary four">
          {SCOPES.map((s) => (
            <div key={s}>
              <div className="k"><span className={`who ${lookup.colorOf(s)}`}>{SCOPE_LABEL[s]}</span></div>
              <div className="v num">{won(split[s])}</div>
              {!noPrev && <span className="delta">{prevSplit[s] || split[s] ? <Delta diff={split[s] - prevSplit[s]} pct={pctChange(split[s], prevSplit[s])} /> : null}</span>}
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2 className="section-title">어디서 샀나</h2>
        {platforms.length === 0 && <p className="empty">이번 달 지출이 없어요</p>}
        {platforms.map((p) => (
          <button className="cat-row cat-btn" key={`${p.kind}:${p.name}`} onClick={() => onPlatform(p.name, p.kind)}>
            <div className="cat-top">
              <span>{p.name} {p.kind === 'merchant' && <span className="tag">매장</span>} <span className="muted num">{p.kind === 'other' ? `한 번씩 간 곳 ${p.count}건` : `${p.count}건`}</span></span>
              <b className="num">{won(p.amount)}</b>
            </div>
            <div className="cat-bar"><i className={p.name === OTHER_PLATFORM ? 'other' : ''} style={{ width: `${maxPlat ? (p.amount / maxPlat) * 100 : 0}%` }} /></div>
            {!noPrev && <span className="delta">{p.prev ? <Delta diff={p.amount - p.prev} pct={pctChange(p.amount, p.prev)} /> : <span className="muted">지난달 없음</span>}</span>}
          </button>
        ))}
        <p className="note">온라인은 플랫폼 칸으로, 매장 결제는 가게 이름으로 묶어요. 두 번 넘게 갔거나 큰 가게만 따로 보이고 나머지는 '그 밖'이에요. 대출이자·관리비·보험처럼 산 게 아닌 돈과 자동으로 들어온 고정지출은 빼요. 눌러서 그 내역을 봐요.</p>
      </div>

      <BillCard householdId={household.id} reloadKey={billsVersion} onAdd={onBill} />
      <FuelCard householdId={household.id} version={billsVersion} txs={cur} ym={ym} onAdd={onFuel} />
    </section>
  )
}

/** 12개월 그래프 아래 문장. 수입이 없으면 쓴 돈만, 수입보다 많이 썼으면 '더 썼어요' */
function readout(p: MonthPoint): string {
  const { y, m } = parseYM(p.ym)
  const when = `${y}년 ${m}월에`
  if (p.income === 0) return `${when} ${won(p.expense)}원 썼어요`
  const left = p.income - p.expense
  if (left < 0) return `${when} ${won(p.expense)}원 쓰고 ${won(p.income)}원 들어와 ${won(-left)}원 더 썼어요`
  return `${when} ${won(p.expense)}원 쓰고 ${won(p.income)}원 들어와 ${won(left)}원 남았어요`
}

function Delta({ diff, pct }: { diff: number; pct: number | null }) {
  if (diff === 0) return <span className="muted">같아요</span>
  return (
    <span className="num">
      {diff > 0 ? '▲' : '▼'} {won(Math.abs(diff))}{pct !== null && ` (${diff > 0 ? '+' : ''}${pct}%)`}
    </span>
  )
}

/** 한 분류의 여섯 달 막대. 마지막(보고 있는 달)만 진하게 */
function Trend({ points }: { points: { ym: string; amount: number }[] }) {
  const max = Math.max(1, ...points.map((p) => p.amount))
  return (
    <div className="trend" role="img" aria-label={`여섯 달 추이: ${points.map((p) => `${parseYM(p.ym).m}월 ${won(p.amount)}원`).join(', ')}`}>
      {points.map((p, i) => (
        <div key={p.ym} className={`trend-bar${i === points.length - 1 ? ' on' : ''}`}>
          <span className="num">{p.amount ? man(p.amount) : ''}</span>
          <i style={{ height: `${(p.amount / max) * 100}%` }} />
          <span>{parseYM(p.ym).m}월</span>
        </div>
      ))}
    </div>
  )
}

/** 12개월 지출·수입 막대. 같은 단위(원)라 축은 하나. 달을 누르면 아래에 값이 나온다 */
function MonthChart({ points, sel, onSelect }: { points: MonthPoint[]; sel: string; onSelect: (ym: string) => void }) {
  const W = 360, H = 180, L = 40, R = 6, T = 8, B = 22
  const pw = W - L - R, ph = H - T - B
  const raw = Math.max(1, ...points.flatMap((p) => [p.expense, p.income]))
  const mag = 10 ** Math.floor(Math.log10(raw))
  const max = ([1, 2, 2.5, 5, 10].map((k) => k * mag).find((v) => v >= raw)) ?? raw
  const gw = pw / points.length
  const bw = Math.max(3, Math.min(10, (gw - 8) / 2))
  const y = (v: number) => T + ph - (v / max) * ph
  const bar = (x: number, v: number) => {
    const h = (v / max) * ph
    if (h <= 0) return ''
    const r = Math.min(4, bw / 2, h)
    const top = T + ph - h
    return `M${x},${T + ph}V${top + r}Q${x},${top} ${x + r},${top}H${x + bw - r}Q${x + bw},${top} ${x + bw},${top + r}V${T + ph}Z`
  }
  return (
    <svg className="month-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="최근 12개월 지출과 수입 막대그래프">
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={L} x2={W - R} y1={y(max * f)} y2={y(max * f)} className="grid" />
          <text x={L - 6} y={y(max * f) + 4} className="axis" textAnchor="end">{man(max * f)}</text>
        </g>
      ))}
      {points.map((p, i) => {
        const x0 = L + i * gw + (gw - (bw * 2 + 2)) / 2
        const { y: yy, m } = parseYM(p.ym)
        const on = p.ym === sel
        return (
          <g key={p.ym} className={on ? 'on' : 'off'} onClick={() => onSelect(p.ym)}>
            <rect x={L + i * gw} y={T} width={gw} height={ph + B} className="hit" />
            <path d={bar(x0, p.expense)} className="b exp" />
            <path d={bar(x0 + bw + 2, p.income)} className="b inc" />
            <text x={L + i * gw + gw / 2} y={H - 6} className={`axis${on ? ' strong' : ''}`} textAnchor="middle">
              {m === 1 || i === 0 ? `${String(yy).slice(2)}.${m}` : m}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
