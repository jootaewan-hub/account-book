import { useEffect, useMemo, useState } from 'react'
import { addDays } from '../../lib/events'
import { formatUnitPrice } from '../../lib/units'
import { historyPriceGroups, summarizePurchaseHistory, type HistoryProduct, type HistoryRow } from '../lib/history'
import { kstDay } from '../lib/products'
import { seenWhen, type PurchaseHistory } from '../lib/seen'
import type { ListStore } from '../lib/store'

const PERIODS = [['30', '30일'], ['90', '90일'], ['365', '1년'], ['all', '전체']] as const
const PAGE_SIZE = 12
const number = (value: number) => value.toLocaleString('ko-KR', { maximumFractionDigits: 3 })
const daily = (value: number) => value < 0.001 ? '0.001 미만' : number(value)
const dateLabel = (value: string) => value.replaceAll('-', '.')
const percent = (value: number) => value < 0.1 ? '0.1% 미만' : `${value.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}%`

export function PurchaseHistoryScreen({ store }: { store: ListStore }) {
  const [period, setPeriod] = useState('all')
  const [retry, setRetry] = useState(0)
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [result, setResult] = useState<{ key: string; value: PurchaseHistory | null } | null>(null)
  const to = kstDay(new Date().toISOString())
  const from = period === 'all' ? undefined : addDays(to, 1 - Number(period))
  const key = `${from ?? ''}:${to}:${retry}`

  useEffect(() => {
    let active = true
    store.purchaseHistory({ from, to }).then(
      (value) => { if (active) setResult({ key, value }) },
      () => { if (active) setResult({ key, value: null }) },
    )
    return () => { active = false }
  }, [store, from, to, key])

  const current = result?.key === key ? result : null
  const value = current?.value
  const stats = useMemo(() => value ? summarizePurchaseHistory(value.rows, { from, to }) : null, [value, from, to])
  const needle = search.normalize('NFC').replace(/\s/g, '').toLowerCase()
  const products = stats?.products.filter((p) => p.key.includes(needle)) ?? []

  return (
    <section className="purchase-history" aria-labelledby="purchase-history-title">
      <header className="purchase-history-head">
        <h2 id="purchase-history-title">구매 기록</h2>
        <p>영수증과 주문 캡처로 남긴 품목의 구매량과 가격을 봐요.</p>
      </header>
      <div className="purchase-history-controls">
        <div className="seg seg-4" role="group" aria-label="구매 기록 기간">
          {PERIODS.map(([id, label]) => <button key={id} type="button" aria-pressed={id === period} onClick={() => {
            setPeriod(id); setLimit(PAGE_SIZE); setOpen(null)
          }}>{label}</button>)}
        </div>
        <input type="search" className="add-text purchase-history-search" aria-label="구매 품목 찾기" placeholder="품목 찾기 (예: 우유, 계란)" value={search} onChange={(e) => {
          setSearch(e.target.value); setLimit(PAGE_SIZE); setOpen(null)
        }} />
      </div>
      {!current && <p className="purchase-history-note" role="status">구매 기록 불러오는 중</p>}
      {current && !value && <div className="purchase-history-note" role="alert">
        구매 기록을 불러오지 못했어요. <button type="button" className="btn-text" onClick={() => setRetry((n) => n + 1)}>다시 시도</button>
      </div>}
      {stats && <>
        <div className="purchase-history-basis">
          <h3>하루 평균 구매량</h3>
          {stats.firstPurchase && <p className="num">{dateLabel(stats.firstPurchase)} ~ {dateLabel(to)} ({number(stats.days)}일 기준)</p>}
          <p>기간 내 첫 구매 기록일부터 오늘까지의 구매량을 날짜 수로 나눠요. 내용량을 모르면 기록 수량만 써요. 실제로 먹은 양은 알 수 없어요.</p>
        </div>
        {value && !value.capturesAvailable && <p className="purchase-history-note" role="status">가격 캡처를 불러오지 못해 구매 기록만 보여요. <button type="button" className="btn-text" onClick={() => setRetry((n) => n + 1)}>다시 시도</button></p>}
        {products.length === 0 && <p className="purchase-history-note">{needle ? '이름이 맞는 품목이 없어요.' : '이 기간에 저장된 품목 기록이 없어요.'}</p>}
        {products.length > 0 && <ul className="purchase-history-list">
          {products.slice(0, limit).map((product) => (
            <li key={product.key} className="purchase-history-item">
              <button type="button" className="purchase-history-row" aria-expanded={open === product.key}
                onClick={() => setOpen((p) => p === product.key ? null : product.key)}>
                <span><strong>{product.name}</strong><small>{product.purchaseDays ? `${product.purchaseDays}일에 걸쳐 ${product.purchaseRows}건 구매` : '가격 캡처만 있음'}</small></span>
                <span className="purchase-history-rate num">
                  {product.amounts.map(({ unit, quantity }) => <span key={unit}>{daily(quantity / stats.days)}{unit}/일</span>)}
                  {product.amounts.length === 0 && (product.unknownQuantity > 0
                    ? <><span>{daily(product.unknownQuantity / stats.days)}개/일</span><small>기록 수량 (내용량 모름)</small></>
                    : '구매량 확인 못 함')}
                </span>
                <span aria-hidden="true">{open === product.key ? '−' : '+'}</span>
              </button>
              {open === product.key && <PurchaseDetail product={product} />}
            </li>
          ))}
        </ul>}
        {products.length > limit && <button type="button" className="btn-secondary" onClick={() => setLimit((n) => n + PAGE_SIZE)}>품목 더 보기 ({products.length - limit}개)</button>}
      </>}
    </section>
  )
}

function PurchaseDetail({ product }: { product: HistoryProduct }) {
  const groups = historyPriceGroups(product.rows)
  const unpriced = product.rows.filter((row) => !row.unitPrice)
  return (
    <div className="purchase-history-detail">
      {product.amounts.length > 0 && <p className="purchase-history-note">확인한 총 구매량 <b className="num">{product.amounts.map(({ quantity, unit }) => `${number(quantity)}${unit}`).join(', ')}</b></p>}
      {product.unknownVolume > 0 && <p className="purchase-history-note">
        구매 {product.unknownVolume}건은 내용량을 몰라 g·ml 등으로 환산할 수 없어요.
        {product.unknownQuantity > 0 && ` 기록 수량은 총 ${number(product.unknownQuantity)}개예요.`}
      </p>}
      <h3>가격 변화</h3>
      {groups.length === 0 && <p className="purchase-history-note">같은 단위로 비교할 수 있는 가격이 없어요.</p>}
      {groups.map((group) => (
        <section className="purchase-price-group" key={`${group.capture}:${group.base}`}>
          <div className="purchase-price-head">
            <h4>{group.capture ? '가격 캡처' : '실제 구매가'} <span>{group.base}당</span></h4>
            <span className="num">{group.change === null ? '비교할 날짜 부족' : group.change === 0 ? '첫 기록과 같음' : `첫 기록 대비 ${group.change > 0 ? '+' : '−'}${percent(Math.abs(group.change))}`}</span>
          </div>
          {group.change !== null && <p className="purchase-history-note num">
            {group.oldest.record.date.slice(0, 4)}년 {seenWhen(group.oldest.record)} {formatUnitPrice(group.oldest.price)}원
            {' → '}{group.latest.record.date.slice(0, 4)}년 {seenWhen(group.latest.record)} {formatUnitPrice(group.latest.price)}원
          </p>}
          {group.capture && <p className="purchase-history-note">캡처에 표시된 상품가 (배송비 제외)</p>}
          <PriceRows rows={group.points} />
        </section>
      ))}
      {unpriced.length > 0 && <details className="purchase-price-units">
        <summary>단위가 확인되지 않은 원본 기록 {unpriced.length}건</summary>
        <PriceRows rows={unpriced.map((row: HistoryRow) => ({ record: row.record }))} />
      </details>}
    </div>
  )
}

function PriceRows({ rows }: { rows: { record: HistoryRow['record']; price?: number }[] }) {
  const [all, setAll] = useState(false)
  const max = rows.reduce((largest, row) => Math.max(largest, row.price ?? 0), 0)
  return <>
    <ol className="purchase-price-rows">
      {(all ? rows : rows.slice(0, 6)).map(({ record, price }, i) => <li key={i}>
        <div className="purchase-price-row">
          <span>{record.date.slice(0, 4)}년 {seenWhen(record)}</span>
          <strong className="num">{price === undefined ? number(record.amount) : formatUnitPrice(price)}원</strong>
        </div>
        {price !== undefined && max > 0 && <span className="purchase-price-bar" aria-hidden="true"><i style={{ width: `${(price / max) * 100}%` }} /></span>}
      </li>)}
    </ol>
    {rows.length > 6 && <button type="button" className="btn-text" onClick={() => setAll(!all)}>{all ? '최근 기록만 보기' : `이전 기록 ${rows.length - 6}건 더 보기`}</button>}
  </>
}
