import { useEffect, useMemo, useState } from 'react'
import { fetchBills, friendlyError } from '../lib/api'
import { billTrend, compareBill } from '../lib/bills'
import { won } from '../lib/format'
import type { UtilityBill } from '../lib/types'
import { BillTable } from './BillTable'
import { ChevronLeft, ChevronRight } from './Icons'

/** 통계 탭의 관리비 분석: 고른 달 고지서를 전월·전년 같은 달과 비교하고, 최근 12개월 관리비 추이를 보여 준다 */
export function BillCard({ householdId, reloadKey, onAdd }: { householdId: string; reloadKey: unknown; onAdd: () => void }) {
  const [bills, setBills] = useState<UtilityBill[] | null>(null)
  const [idx, setIdx] = useState(0)
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    fetchBills(householdId).then((b) => { if (alive) { setBills(b); setIdx(0); setErr('') } })
      .catch((e) => { if (alive) setErr(friendlyError(e)) })
    return () => { alive = false }
    // eslint-disable-next-line react/exhaustive-effect-dependencies -- reloadKey는 고지서를 저장했을 때 다시 읽는 신호
  }, [householdId, reloadKey])

  const bill = bills?.[idx]
  const cmp = useMemo(() => (bill && bills ? compareBill(bill, bills.filter((b) => b.id !== bill.id)) : null), [bill, bills])
  const trend = useMemo(() => (bill && bills ? billTrend(bills, bill.bill_month.slice(0, 7)) : []), [bill, bills])
  const max = Math.max(1, ...trend.map((t) => t.total ?? 0))

  return (
    <div className="card">
      <div className="bill-head">
        <h2 className="section-title">{bill ? `${bill.bill_month.slice(0, 4)}년 ${Number(bill.bill_month.slice(5, 7))}월분 관리비` : '관리비'}</h2>
        {bills && bills.length > 1 && (
          <span className="bill-nav">
            <button className="icon-btn" aria-label="이전 고지서" disabled={idx >= bills.length - 1} onClick={() => setIdx(idx + 1)}><ChevronLeft /></button>
            <button className="icon-btn" aria-label="다음 고지서" disabled={idx === 0} onClick={() => setIdx(idx - 1)}><ChevronRight /></button>
          </span>
        )}
      </div>
      {err && <p className="err">{err}</p>}
      {bills && bills.length === 0 && (
        <p className="empty">관리비 고지서를 찍어 넣으면 전기·수도·난방 사용량과 항목별 금액을 전월·전년 같은 달과 비교해 드려요.</p>
      )}
      {cmp && <BillTable cmp={cmp} />}
      {bill && trend.some((t) => t.total !== null) && (
        <div className="bill-trend" role="img" aria-label="최근 12개월 관리비">
          {trend.map((t) => (
            <div key={t.ym} className={`bt-bar${t.ym === bill.bill_month.slice(0, 7) ? ' on' : ''}`} title={t.total === null ? `${t.ym} 없음` : `${t.ym} ${won(t.total)}원`}>
              <i style={{ height: `${t.total === null ? 0 : Math.max(4, (t.total / max) * 100)}%` }} />
              <span>{Number(t.ym.slice(5))}</span>
            </div>
          ))}
        </div>
      )}
      <button className="ghost full-btn" onClick={onAdd}>관리비 고지서 넣기</button>
    </div>
  )
}
