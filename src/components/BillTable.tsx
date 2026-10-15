import { formatUsage, type BillComparison, type CompareRow } from '../lib/bills'
import { won } from '../lib/format'

/** 이번 달 · 전월 · 전년 같은 달 비교표 (사용량과 항목별 금액) */
export function BillTable({ cmp, chargeLimit = 8 }: { cmp: BillComparison; chargeLimit?: number }) {
  const printed = [cmp.total, ...cmp.usages, ...cmp.charges].some((r) => r.prevFrom === 'printed' || r.lastYearFrom === 'printed')
  const extra = cmp.charges.slice(chargeLimit)
  return (
    <div className="bill-table">
      <Head first="전체" />
      <Row r={cmp.total} money />
      {cmp.usages.length > 0 && <><Head first="사용량" /> {cmp.usages.map((r) => <Row key={r.name} r={r} />)}</>}
      {cmp.charges.length > 0 && (
        <>
          <Head first="항목별 금액" />
          {cmp.charges.slice(0, chargeLimit).map((r) => <Row key={r.name} r={r} money />)}
          {extra.length > 0 && (
            <details>
              <summary>나머지 {extra.length}개 항목</summary>
              {extra.map((r) => <Row key={r.name} r={r} money />)}
            </details>
          )}
        </>
      )}
      {printed && <p className="tx-meta">* 지난 고지서가 없어 이번 고지서에 적힌 값을 썼어요.</p>}
    </div>
  )
}

function Head({ first }: { first: string }) {
  return (
    <div className="bt-row bt-head">
      <span>{first}</span><span>이번 달</span><span>전월</span><span>전년 같은 달</span>
    </div>
  )
}

function Row({ r, money = false }: { r: CompareRow; money?: boolean }) {
  const fmt = (v: number) => (money ? won(v) : formatUsage(v))
  const unit = !money && r.unit ? <span className="muted"> {r.unit}</span> : null
  return (
    <div className="bt-row">
      <span className="bt-name">{r.name}{unit}</span>
      <span className="num"><b>{fmt(r.cur)}</b></span>
      <Cell v={r.prev} pct={r.prevPct} printed={r.prevFrom === 'printed'} fmt={fmt} />
      <Cell v={r.lastYear} pct={r.lastYearPct} printed={r.lastYearFrom === 'printed'} fmt={fmt} />
    </div>
  )
}

function Cell({ v, pct, printed, fmt }: { v: number | null; pct: number | null; printed: boolean; fmt: (v: number) => string }) {
  if (v === null) return <span className="muted">-</span>
  return (
    <span className="num">
      {fmt(v)}{printed && '*'}
      {pct !== null && pct !== 0 && <span className="bt-pct">{pct > 0 ? '▲' : '▼'}{Math.abs(pct)}%</span>}
    </span>
  )
}
