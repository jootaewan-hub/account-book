import { useState } from 'react'
import { won } from '../lib/format'
import type { CompareResult, LineVerdict, PastLine } from '../lib/shopCompare'
import { formatUnitPrice } from '../lib/units'
import { PriceDelta } from './PriceDelta'

const md = (date: string) => `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일`
const SHOW = 5

/** '100ml당 299.5원' 또는 '5,990원'(개당) */
function priceText(price: number, base: string): string {
  return base === '1개' ? `${won(price)}원` : `${base}당 ${formatUnitPrice(price)}원`
}

/** 지난 줄의 날짜·가게·값. 이름이 다르면(같은 품목 등급) 그 상품명도 */
function refText(ref: PastLine, name: string, value: string | null): string {
  const same = ref.name.replace(/\s+/g, '') === name.replace(/\s+/g, '')
  return [`${md(ref.date)} ${ref.place}`, value, same ? null : ref.name].filter(Boolean).join(', ')
}

/**
 * 영수증 확인 화면의 "이번 장보기 살펴보기"(설계 2026-10-21 3-2): 지난 장보기 대비, 지난번보다 비싸진·싸진 것,
 * 최근에 또 산 것, 장보기 목록에 없던 것, 같은 것이 두 줄, 처음 사는 것. 판단은 하지 않고 우리 기록의 날짜·가게·값만 적는다.
 */
export function ShopCompareCard({ result, loading, error }: { result: CompareResult; loading: boolean; error: string | null }) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const more = (key: string) => setOpen((s) => new Set(s).add(key))
  const r = result
  const nothingPast = !loading && !error && r.prevTrip === null && r.pricier.length + r.cheaper.length + r.recent.length === 0 && r.first.length === r.count

  const list = (key: string, rows: LineVerdict[], render: (v: LineVerdict) => React.ReactNode) => {
    const shown = open.has(key) ? rows : rows.slice(0, SHOW)
    return (
      <>
        <ul className="cmp-list">{shown.map((v) => <li key={v.key} className="cmp-row">{render(v)}</li>)}</ul>
        {rows.length > shown.length && <button className="link-btn cmp-more" onClick={() => more(key)}>{rows.length - shown.length}개 더 보기</button>}
      </>
    )
  }
  const priceRow = (v: LineVerdict) => {
    const p = v.price!
    return (
      <>
        <span className="cmp-name">{v.name}</span>
        <span className="cmp-val num">{priceText(p.now, p.base)} <PriceDelta diff={p.diff} pct={p.pct} /></span>
        <span className="cmp-ref">{refText(p.ref, v.name, priceText(p.prev, p.base))}</span>
      </>
    )
  }

  return (
    <div className="card cmp-card">
      <h3 className="section-title">이번 장보기 살펴보기</h3>
      <p className="cmp-head num">
        {r.count}개, {won(r.total)}원.{' '}
        {r.prevTrip ? (
          <>지난 장보기({md(r.prevTrip.date)} {r.prevTrip.place}, {r.prevTrip.count}개 {won(r.prevTrip.total)}원)보다 <PriceDelta diff={r.total - r.prevTrip.total} pct={null} /></>
        ) : loading ? '지난 장보기 기록 읽는 중' : '지난 장보기 기록이 없어요.'}
      </p>
      {error && <p className="cmp-note">지난 기록을 불러오지 못했어요. 저장에는 영향이 없어요.</p>}
      {nothingPast && !r.listUsed && <p className="cmp-note">다음 장보기부터 지난번과 견줘 드려요.</p>}

      {/* 기록을 읽는 동안은 묶음을 내지 않는다(전부 '처음 사는 것'으로 보였다가 바뀌지 않게) */}
      {!loading && r.pricier.length > 0 && (
        <>
          <p className="cmp-sub">지난번보다 비싸진 것 <span className="muted num">{r.pricier.length}</span></p>
          {list('pricier', r.pricier, priceRow)}
        </>
      )}
      {!loading && r.cheaper.length > 0 && (
        <>
          <p className="cmp-sub">지난번보다 싸진 것 <span className="muted num">{r.cheaper.length}</span></p>
          {list('cheaper', r.cheaper, priceRow)}
        </>
      )}
      {!loading && r.recent.length > 0 && (
        <>
          <p className="cmp-sub">최근에 또 산 것 <span className="muted num">{r.recent.length}</span></p>
          {list('recent', r.recent, (v) => {
            const rc = v.recent!
            return (
              <>
                <span className="cmp-name">{v.name}</span>
                <span className="cmp-ref num">{rc.days === 0 ? '오늘' : `${rc.days}일 전`}({md(rc.ref.date)})에도 샀어요 — {[rc.ref.place, `${won(rc.ref.amount)}원`, rc.ref.name.replace(/\s+/g, '') === v.name.replace(/\s+/g, '') ? null : rc.ref.name].filter(Boolean).join(', ')}</span>
              </>
            )
          })}
        </>
      )}
      {!loading && r.offList.length > 0 && (
        <>
          <p className="cmp-sub">장보기 목록에 없던 것 <span className="muted num">{r.offList.length}</span></p>
          <p className="cmp-names">{r.offList.map((v) => v.name).join(', ')}</p>
        </>
      )}
      {!loading && r.duplicates.length > 0 && (
        <>
          <p className="cmp-sub">같은 것이 두 줄 <span className="muted num">{r.duplicates.length}</span></p>
          <p className="cmp-names">{r.duplicates.map((v) => v.name).join(', ')}</p>
        </>
      )}
      {!loading && r.first.length > 0 && !nothingPast && (
        <details className="table-view cmp-first">
          <summary>처음 사는 것 {r.first.length}</summary>
          <p className="cmp-names">{r.first.map((v) => v.name).join(', ')}</p>
        </details>
      )}
      <p className="tx-meta">최근 1년 가계부 기록과 견줬어요. 상품 이름이 비슷한 것끼리 맞춘 거라 다른 상품일 수 있어요.</p>
    </div>
  )
}
