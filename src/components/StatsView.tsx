import { useEffect, useMemo, useState } from 'react'
import { fetchMonthlyTotals, fetchRange, fetchSettlement, friendlyError, markSettled, unmarkSettled } from '../lib/api'
import { addMonths, dayOf, monthRange, parseYM } from '../lib/dates'
import { won } from '../lib/format'
import { settle, sumType } from '../lib/ledger'
import { SCOPE_LABEL, SCOPES, type Lookup } from '../lib/lookup'
import { categoryBreakdown, monthSeries, pctChange, scopeSplit, type MonthPoint } from '../lib/stats'
import type { Category, Household, MonthTotal, SettlementRecord, Transaction } from '../lib/types'

interface Props {
  household: Household
  ym: string
  today: string
  cur: Transaction[]
  prev: Transaction[]
  lookup: Lookup
  categories: Category[]
  toast: (msg: string) => void
}

const man = (n: number) => (n >= 10_000 ? `${Math.round(n / 10_000).toLocaleString('ko-KR')}만` : won(n))

export function StatsView({ household, ym, today, cur, prev, lookup, categories, toast }: Props) {
  const [totals, setTotals] = useState<MonthTotal[] | null>(null)
  const [lastYear, setLastYear] = useState<Transaction[]>([])
  const [settled, setSettled] = useState<SettlementRecord | null | undefined>(undefined)
  const [sel, setSel] = useState(ym)
  const [err, setErr] = useState('')

  useEffect(() => { setSel(ym) }, [ym])
  useEffect(() => {
    let alive = true
    const ly = addMonths(ym, -12)
    Promise.all([
      fetchMonthlyTotals(household.id, `${addMonths(ym, -12)}-01`, monthRange(ym).end),
      fetchRange(household.id, monthRange(ly).start, monthRange(ly).end),
      fetchSettlement(household.id, `${ym}-01`),
    ]).then(([t, l, s]) => { if (alive) { setTotals(t); setLastYear(l); setSettled(s); setErr('') } })
      .catch((e) => { if (alive) setErr(friendlyError(e)) })
    return () => { alive = false }
  }, [household.id, ym, cur])

  const series = useMemo(() => (totals ? monthSeries(totals, ym) : []), [totals, ym])
  const cats = useMemo(() => categoryBreakdown(cur, prev, categories), [cur, prev, categories])
  const split = useMemo(() => scopeSplit(cur), [cur])
  const result = useMemo(() => settle(cur, lookup.methods, lookup.roleOf, household.share_ratio),
    [cur, lookup, household.share_ratio])

  const isCurrent = ym === today.slice(0, 7)
  const upto = isCurrent ? dayOf(today) : undefined
  const { m } = parseYM(ym)
  const rows = (['expense', 'income'] as const).map((type) => {
    const now = sumType(cur, type, upto)
    return { type, now, mom: now - sumType(prev, type, upto), momPct: pctChange(now, sumType(prev, type, upto)),
      yoy: now - sumType(lastYear, type, upto), yoyPct: pctChange(now, sumType(lastYear, type, upto)), hasLY: lastYear.length > 0 }
  })
  const selPoint = series.find((p) => p.ym === sel)
  const maxCat = cats[0]?.amount ?? 0

  return (
    <section className="view">
      {err && <p className="banner" role="alert">{err}</p>}

      <div className="card">
        <h3 className="section-title">{m}월 {isCurrent ? `(1~${upto}일, 비교도 같은 기간)` : ''}</h3>
        {rows.map((r) => (
          <div className="stat-row" key={r.type}>
            <span className="k">{r.type === 'expense' ? '지출' : '수입'}</span>
            <b className={`num ${r.type === 'expense' ? 'exp' : 'inc'}`}>{won(r.now)}</b>
            <span className="delta">전월 <Delta diff={r.mom} pct={r.momPct} /></span>
            <span className="delta">전년 {r.hasLY ? <Delta diff={r.yoy} pct={r.yoyPct} /> : <span className="muted">기록 없음</span>}</span>
          </div>
        ))}
      </div>

      <div className="card">
        <h3 className="section-title">최근 12개월</h3>
        <div className="legend">
          <span><i className="sw exp" />지출</span>
          <span><i className="sw inc" />수입</span>
        </div>
        {totals ? <MonthChart points={series} sel={sel} onSelect={setSel} /> : <p className="lead">불러오는 중…</p>}
        {selPoint && (
          <p className="readout num">
            {parseYM(selPoint.ym).y}년 {parseYM(selPoint.ym).m}월 · 지출 {won(selPoint.expense)} · 수입 {won(selPoint.income)} · 남은 돈 {won(selPoint.income - selPoint.expense)}
          </p>
        )}
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
        <h3 className="section-title">분류별 지출 · 지난달 대비</h3>
        {cats.length === 0 && <p className="empty">이번 달 지출이 없어요</p>}
        {cats.map((c) => (
          <div className="cat-row" key={c.id ?? 'none'}>
            <div className="cat-top">
              <span>{c.name} <span className="muted num">{Math.round(c.share * 100)}%</span></span>
              <b className="num">{won(c.amount)}</b>
            </div>
            <div className="cat-bar"><i style={{ width: `${maxCat ? (c.amount / maxCat) * 100 : 0}%` }} /></div>
            <span className="delta">{c.prev ? <Delta diff={c.amount - c.prev} pct={pctChange(c.amount, c.prev)} /> : <span className="muted">지난달 없음</span>}</span>
          </div>
        ))}
      </div>

      <div className="card">
        <h3 className="section-title">누구를 위한 지출</h3>
        <div className="summary">
          {SCOPES.map((s) => (
            <div key={s}><div className="k"><span className={`who ${lookup.colorOf(s)}`}>{SCOPE_LABEL[s]}</span></div><div className="v num">{won(split[s])}</div></div>
          ))}
        </div>
      </div>

      <div className="card">
        <h3 className="section-title">{m}월 정산 · 분담 비율 남편 {Math.round(household.share_ratio * 100)} : 아내 {Math.round((1 - household.share_ratio) * 100)}</h3>
        <div className="set-row"><span>공동 지출 중 남편 개인 돈으로 낸 것</span><span className="num">{won(result.paid.husband)}원</span></div>
        <div className="set-row"><span>공동 지출 중 아내 개인 돈으로 낸 것</span><span className="num">{won(result.paid.wife)}원</span></div>
        <p className="settle-result">
          {result.amount === 0 || !result.from || !result.to
            ? '주고받을 돈이 없어요'
            : <>{SCOPE_LABEL[result.from]} → {SCOPE_LABEL[result.to]} <b className="num">{won(result.amount)}원</b></>}
        </p>
        <p className="note">공동 통장·공동 카드로 낸 돈은 이미 함께 낸 것이라 빼고, 공동 지출을 개인 카드·현금으로 낸 것만 나눕니다. 분담 비율은 설정에서 바꿔요.</p>
        {settled === undefined ? null : settled ? (
          <div className="set-row">
            <span>정산 완료 · {new Date(settled.settled_at).toLocaleDateString('ko-KR')} · {won(settled.amount)}원</span>
            <button className="link-btn" onClick={async () => {
              try { await unmarkSettled(household.id, `${ym}-01`); setSettled(null); toast('정산 완료를 취소했어요') } catch (e) { toast(friendlyError(e)) }
            }}>취소</button>
          </div>
        ) : (
          <button className="ghost full-btn" onClick={async () => {
            try {
              await markSettled(household.id, { month: `${ym}-01`, from_role: result.from, to_role: result.to, amount: result.amount })
              setSettled(await fetchSettlement(household.id, `${ym}-01`)); toast('정산 완료로 표시했어요')
            } catch (e) { toast(friendlyError(e)) }
          }}>정산 완료로 표시</button>
        )}
      </div>
    </section>
  )
}

function Delta({ diff, pct }: { diff: number; pct: number | null }) {
  if (diff === 0) return <span className="muted">같아요</span>
  return (
    <span className="num">
      {diff > 0 ? '▲' : '▼'} {won(Math.abs(diff))}{pct !== null && ` (${diff > 0 ? '+' : ''}${pct}%)`}
    </span>
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
