import { useEffect, useMemo, useState } from 'react'
import { fetchFuelFills, friendlyError } from '../lib/api'
import { addMonths } from '../lib/dates'
import { won } from '../lib/format'
import { fillLine, fuelDelta, fuelInterval, fuelKind, fuelMonth, fuelTrend, litersText } from '../lib/fuel'
import type { FuelFill } from '../lib/types'
import { Bar, Waiting } from './Loading'
import { PriceDelta } from './PriceDelta'

const md = (date: string) => `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일`

/** 통계 탭의 주유 묶음: 최근 주유의 리터당 가격과 지난번 대비, 리터당 가격 추이(최근 12번), 이번 달·지난달, 평균 간격, 최근 주유 목록 */
export function FuelCard({ householdId, version, ym, onAdd }: {
  householdId: string
  /** 사진 입력을 저장하거나 내역을 다시 읽을 때마다 오른다 (내역 실시간 이벤트가 주유 기록 저장보다 먼저 와도 다시 읽게) */
  version: number
  ym: string
  onAdd: () => void
}) {
  const [fills, setFills] = useState<FuelFill[] | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    fetchFuelFills(householdId).then((f) => { if (alive) { setFills(f); setErr('') } })
      .catch((e) => { if (alive) setErr(friendlyError(e)) })
    return () => { alive = false }
    // eslint-disable-next-line react/exhaustive-effect-dependencies -- version은 다시 읽는 신호
  }, [householdId, version])

  const delta = useMemo(() => (fills ? fuelDelta(fills) : null), [fills])
  const trend = useMemo(() => (fills ? fuelTrend(fills) : []), [fills])
  const cur = useMemo(() => (fills ? fuelMonth(fills, ym) : null), [fills, ym])
  const prev = useMemo(() => (fills ? fuelMonth(fills, addMonths(ym, -1)) : null), [fills, ym])
  const interval = useMemo(() => (fills ? fuelInterval(fills) : null), [fills])
  const recent = useMemo(() => (fills ? fuelTrend(fills, 8).reverse() : []), [fills])

  return (
    <div className="card fuel-card">
      <h2 className="section-title">주유</h2>
      {err && <p className="err">{err}</p>}
      {fills === null && !err && (
        <Waiting label="주유 기록 불러오는 중">
          <p className="fuel-big"><Bar w={4} /></p>
          <p className="wait-line"><Bar w="58%" /></p>
          <Bar w="100%" h={120} />
        </Waiting>
      )}
      {fills && fills.length === 0 && (
        <p className="empty">주유소 영수증을 찍어 넣으면 리터당 가격 변동과 주유량을 모아 보여 드려요.</p>
      )}
      {delta && (
        <>
          <p className="fuel-big num">{won(delta.latest.price_per_liter)}<small>원/L</small></p>
          <p className="tx-meta">
            {md(delta.latest.occurred_on)}, {delta.latest.title || '주유소 이름 모름'}{delta.latest.fuel_type ? `, ${delta.latest.fuel_type}` : ''}
          </p>
          <p className="fuel-line">
            {delta.prev && delta.diff !== null ? (
              <>
                <span>지난 주유보다 </span>
                <PriceDelta diff={delta.diff} pct={delta.pct} />
                <span className="muted num"> ({md(delta.prev.occurred_on)} {won(delta.prev.price_per_liter)}원/L)</span>
              </>
            ) : (
              <span className="muted">같은 유종의 지난 주유 기록이 없어요</span>
            )}
          </p>
          <p className="fuel-line num">이번 주유 {litersText(delta.latest.liters)}, {won(delta.latest.amount)}원</p>
          {trend.length >= 2 && <FuelChart points={trend} />}
          {cur && prev && (
            <div className="fuel-months">
              <p><span className="k">이번 달</span>{cur.count ? <span className="num">{cur.count}번, {litersText(cur.liters)}, {won(cur.amount)}원</span> : <span className="muted">아직 없음</span>}</p>
              <p><span className="k">지난달</span>{prev.count ? <span className="num">{prev.count}번, {litersText(prev.liters)}, {won(prev.amount)}원</span> : <span className="muted">기록 없음</span>}</p>
            </div>
          )}
          {interval !== null && <p className="tx-meta">최근 {Math.min(6, fills!.length)}번은 평균 {interval}일마다 주유했어요.</p>}
          <details className="table-view fuel-recent">
            <summary>최근 주유 {recent.length}번</summary>
            <ul className="fuel-list">{recent.map((f) => <li key={f.id} className="num">{fillLine(f)}</li>)}</ul>
          </details>
        </>
      )}
      <button className="ghost full-btn" onClick={onAdd}>주유 영수증 넣기</button>
    </div>
  )
}


/** 리터당 가격 선 그래프. 가장 최근 유종만 선으로 잇고 다른 유종은 점만. 첫 값·마지막 값·최저·최고를 글자로 직접 쓴다 */
function FuelChart({ points }: { points: FuelFill[] }) {
  const W = 360, H = 150, L = 12, R = 12, T = 18, B = 26
  const pw = W - L - R, ph = H - T - B
  const prices = points.map((p) => p.price_per_liter)
  const lo = Math.min(...prices), hi = Math.max(...prices)
  const pad = hi === lo ? 10 : (hi - lo) * 0.25
  const min = lo - pad, max = hi + pad
  const x = (i: number) => (points.length === 1 ? L + pw / 2 : L + (i / (points.length - 1)) * pw)
  const y = (v: number) => T + ph - ((v - min) / (max - min)) * ph
  const kind = fuelKind(points[points.length - 1].fuel_type)
  const line = points.map((p, i) => (fuelKind(p.fuel_type) === kind ? `${x(i).toFixed(1)},${y(p.price_per_liter).toFixed(1)}` : null)).filter(Boolean).join(' ')
  // 값 글자: 첫·마지막, 그리고 그와 다른 최저·최고
  const first = prices[0], last = prices[prices.length - 1]
  const labelIdx = new Set<number>([0, points.length - 1])
  if (lo !== first && lo !== last) labelIdx.add(prices.indexOf(lo))
  if (hi !== first && hi !== last) labelIdx.add(prices.lastIndexOf(hi))
  // 날짜 글자는 6개까지 고르게(첫·마지막 포함)
  const step = Math.max(1, Math.ceil((points.length - 1) / 5))
  const dateIdx = new Set<number>([points.length - 1])
  for (let i = 0; i < points.length - 1; i += step) dateIdx.add(i)
  const mmdd = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`
  const label = points.map((p) => `${md(p.occurred_on)} ${won(p.price_per_liter)}원`).join(', ')
  return (
    <svg className="fuel-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`최근 ${points.length}번 주유의 리터당 가격: ${label}`}>
      <line x1={L} x2={W - R} y1={y(hi)} y2={y(hi)} className="grid" />
      <line x1={L} x2={W - R} y1={y(lo)} y2={y(lo)} className="grid" />
      {line && <polyline points={line} className="line" />}
      {points.map((p, i) => (
        <g key={p.id}>
          <circle cx={x(i)} cy={y(p.price_per_liter)} r={fuelKind(p.fuel_type) === kind ? 3.5 : 3} className={fuelKind(p.fuel_type) === kind ? 'dot' : 'dot other'} />
          {labelIdx.has(i) && (
            <text x={x(i)} y={y(p.price_per_liter) - 8} className={`val${i === points.length - 1 ? ' strong' : ''}`}
              textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}>{won(p.price_per_liter)}</text>
          )}
          {dateIdx.has(i) && (
            <text x={x(i)} y={H - 8} className="axis" textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}>{mmdd(p.occurred_on)}</text>
          )}
        </g>
      ))}
    </svg>
  )
}
