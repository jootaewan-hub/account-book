import { useEffect, useState } from 'react'
import { koDay } from '../lib/alerts'
import { won } from '../lib/format'
import {
  change,
  changeText,
  dayText,
  gradeText,
  keyOf,
  PERIOD_LABEL,
  rangeText,
  recordText,
  seriesName,
  siblings,
  unitOf,
  whereOf,
  type DatedPrice,
  type MarketSeries,
  type NearbyPrice,
  type TrendPoint,
} from '../lib/market'
import type { MarketStore } from '../lib/marketStore'
import MarketChart from './MarketChart'

type Props = {
  store: MarketStore
  series: MarketSeries[]
  /** 처음 보여 줄 시리즈 */
  initial: MarketSeries
  /** 그 시리즈를 지켜보는가(칩으로 품종을 바꾸면 바뀐 시리즈로 다시 묻는다) */
  isWatched: (s: MarketSeries) => boolean
  onWatch: (s: MarketSeries, on: boolean) => void
}

/** 시세 상세: 조사값, 같은 조사처의 비교 값, 45일 추이, 그날 주변 조사처 값. 숫자는 모두 조사값 그대로다(D-012). */
export default function MarketPanel({ store, series, initial, isWatched, onWatch }: Props) {
  const [s, setS] = useState(initial)
  const [trend, setTrend] = useState<TrendPoint[] | null>(null)
  const [nearby, setNearby] = useState<NearbyPrice[] | null>(null)
  const [failed, setFailed] = useState(false)
  const sibs = siblings(series, s)

  useEffect(() => {
    let live = true
    setTrend(null)
    setNearby(null)
    setFailed(false)
    Promise.all([store.trend(s), s.sgg === '1000' ? Promise.resolve([]) : store.nearby(s)]).then(
      ([t, n]) => {
        if (!live) return
        setTrend(t)
        setNearby(n)
      },
      () => live && setFailed(true),
    )
    return () => {
      live = false
    }
  }, [store, s])

  const watched = isWatched(s)
  const grade = gradeText(s)
  const where = whereOf(s)
  const range = rangeText(s)
  const rows: [string, DatedPrice | null][] = [
    ['이전 조사일', s.prev],
    [PERIOD_LABEL.w1, s.w1],
    [PERIOD_LABEL.m1, s.m1],
    [PERIOD_LABEL.y1, s.y1],
  ]

  return (
    <div className="market-panel">
      {sibs.length > 1 && (
        <div className="market-chips" role="group" aria-label="품종·등급">
          {sibs.map((x) => (
            <button key={keyOf(x)} type="button" className="market-chip" data-touch-extend aria-pressed={keyOf(x) === keyOf(s)} onClick={() => setS(x)}>
              {[seriesName(x), gradeText(x)].filter(Boolean).join(' ')}
            </button>
          ))}
        </div>
      )}

      <div className="market-now">
        <div>
          <p className="market-now-name">{seriesName(s)}{grade && <span className="market-grade"> {grade}</span>}</p>
          <p className="market-now-v num">
            {won(s.cur.price)} <span className="market-unit">/ {unitOf(s)}</span>
          </p>
          <p className="market-now-src">
            <span className="tag tag-oat">KAMIS 소매</span> {where}, <span className="nowrap">{koDay(s.cur.on)} 조사</span>
          </p>
          {range && <p className="market-range num">{range}</p>}
        </div>
        <button type="button" className="btn-secondary market-watch" aria-pressed={watched} onClick={() => onWatch(s, !watched)}>
          {watched ? '지켜보는 중' : '지켜보기'}
        </button>
      </div>

      <p className="detail-sub">{s.sgg === '1000' ? '전국 값의 이전 값' : `같은 조사처(${where})의 이전 값`}</p>
      <ul className="price-list">
        {rows.map(([label, p]) => {
          const c = change(s.cur, p)
          return (
            <li key={label} className="price-row">
              <div>
                <p className="price-where">{label}</p>
                <p className="price-src">{p ? `${dayText(p.on, s.cur.on)} 조사` : '그 무렵 조사값 없음'}</p>
              </div>
              <div className="market-cmp">
                <p className="price-v num">{p ? won(p.price) : '확인 못 함'}</p>
                {p && <p className={`market-change num is-${c?.dir ?? 'same'}`}>지금 {changeText(c)}</p>}
              </div>
            </li>
          )
        })}
      </ul>

      <p className="detail-sub">최근 45일</p>
      {failed && <p className="detail-none" role="status">추이를 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.</p>}
      {!failed && !trend && <p className="detail-none" role="status">시세 기록 불러오는 중</p>}
      {trend && <MarketChart points={trend} where={where} />}
      <p className="market-record">{recordText(s)}</p>

      {s.sgg !== '1000' && (
        <>
          <p className="detail-sub">{koDay(s.cur.on)} 서울·수원·성남 조사처</p>
          {nearby && nearby.length > 0 ? (
            <ul className="price-list">
              {nearby.map((n) => (
                <li key={n.mrkt} className={`price-row${n.mrkt === s.mrkt ? ' is-mine' : ''}`}>
                  <p className="price-where">{n.sggNm} {n.mrktNm}{n.mrkt === s.mrkt ? ' (위 값)' : ''}</p>
                  <p className="price-v num">{won(n.price)}</p>
                </li>
              ))}
            </ul>
          ) : (
            nearby && <p className="detail-none">그날 다른 조사처 값이 없어요.</p>
          )}
        </>
      )}
      <p className="alert-range">한국농수산식품유통공사 일별 소매가격(공공데이터포털)의 조사값이에요. 조사처 이름은 출처가 가린 그대로예요.</p>
    </div>
  )
}
