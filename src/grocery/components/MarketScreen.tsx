import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { koDay, koFullDay, SOURCE_NAME } from '../lib/alerts'
import { won } from '../lib/format'
import {
  boardSource,
  change,
  changeText,
  dayText,
  gradeText,
  keyOf,
  latestOn,
  movers,
  PERIOD_LABEL,
  sameKey,
  seriesName,
  unitOf,
  whereOf,
  type MarketBoard,
  type MarketSeries,
  type Period,
  type SeriesKey,
  type TrendPoint,
} from '../lib/market'
import type { MarketStore, Recalls } from '../lib/marketStore'
import { Sparkline } from './MarketChart'
import MarketPanel from './MarketPanel'
import MarketSheet from './MarketSheet'

const PERIODS: Period[] = ['w1', 'm1', 'y1']
const GROUPS: { title: string; ctgry: string[] }[] = [
  { title: '채소·감자류', ctgry: ['100', '200'] },
  { title: '버섯', ctgry: ['300'] },
  { title: '과일', ctgry: ['400'] },
  { title: '고기·계란(전국)', ctgry: ['500'] },
  { title: '수산물', ctgry: ['600'] },
]

/** 시세 화면(화면 설계 8절, D-012): 지켜보는 품목, 이번 주 움직임, 모든 품목, 식약처 최근 회수·판매중지 */
export default function MarketScreen({ store }: { store: MarketStore }) {
  const [board, setBoard] = useState<MarketBoard | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [watches, setWatches] = useState<SeriesKey[]>([])
  const [recalls, setRecalls] = useState<Recalls | null>(null)
  const [recallsFailed, setRecallsFailed] = useState(false)
  const [period, setPeriod] = useState<Period>('w1')
  const [open, setOpen] = useState<MarketSeries | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(() => {
    setState((s) => (s === 'ready' ? s : 'loading'))
    Promise.all([store.board(), store.watches()]).then(
      ([b, w]) => {
        setBoard(b)
        setWatches(w)
        setState('ready')
      },
      () => setState((s) => (s === 'ready' ? s : 'error')),
    )
    store.recalls().then(
      (r) => {
        setRecalls(r)
        setRecallsFailed(false)
      },
      () => setRecallsFailed(true),
    )
  }, [store])

  useEffect(() => {
    load()
    const onVisible = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [load])

  const series = useMemo(() => board?.series ?? [], [board])
  const watched = (k: SeriesKey) => watches.some((w) => sameKey(w, k))
  const toggleWatch = (s: SeriesKey, on: boolean) => {
    const before = watches
    setWatches(on ? [...before.filter((w) => !sameKey(w, s)), { item: s.item, vrty: s.vrty, grd: s.grd }] : before.filter((w) => !sameKey(w, s)))
    store.setWatch(s, on).catch(() => {
      setWatches(before)
      setNotice('지켜보기를 저장하지 못했어요. 잠시 뒤 다시 해 주세요.')
      window.setTimeout(() => setNotice(null), 5000)
    })
  }
  const watchedSeries = watches.map((w) => series.find((s) => sameKey(s, w))).filter((s): s is MarketSeries => Boolean(s))
  const missingWatches = watches.length - watchedSeries.length
  const moves = useMemo(() => movers(series, period), [series, period])
  const last = latestOn(series)

  return (
    <div className="list-page market-page">
      {state === 'loading' && (
        <div className="skeleton" aria-hidden="true">
          <div className="sk sk-seg" />
          <div className="sk sk-group" />
        </div>
      )}
      {state === 'loading' && <p className="sr-only" role="status">시세 불러오는 중</p>}
      {state === 'error' && (
        <div className="state">
          <p>시세를 불러오지 못했어요.</p>
          <button type="button" className="btn-secondary" onClick={load}>다시 시도</button>
        </div>
      )}

      {state === 'ready' && board && (
        <div className="fade-in">
          <p className="market-source">
            {boardSource(board.syncedAt)}
            {last && <>, 조사일 {koDay(last)}까지</>}
          </p>

          {series.length === 0 ? (
            <p className="state empty">아직 받은 시세가 없어요. 매일 아침 한국농수산식품유통공사 조사값을 받아 와요.</p>
          ) : (
            <>
              <section className="group" aria-labelledby="mk-watch">
                <h2 className="group-title" id="mk-watch">
                  지켜보는 품목 <span className="group-count num">{watchedSeries.length}개</span>
                </h2>
                {watchedSeries.length === 0 ? (
                  <p className="market-empty">지켜보는 품목이 없어요. 아래 품목을 눌러 지켜보기를 켜 보세요.</p>
                ) : (
                  <ul className="group-rows">
                    {watchedSeries.map((s) => <WatchRow key={keyOf(s)} s={s} store={store} onOpen={() => setOpen(s)} />)}
                  </ul>
                )}
                {missingWatches > 0 && <p className="market-empty">지켜보는 품목 {missingWatches}개는 최근 60일 조사값이 없어요.</p>}
              </section>

              <section className="group" aria-labelledby="mk-moves">
                <h2 className="group-title" id="mk-moves">이번 주 움직임</h2>
                <div className="seg seg-3" role="group" aria-label="비교 기간">
                  {PERIODS.map((p) => (
                    <button key={p} type="button" aria-pressed={period === p} onClick={() => setPeriod(p)}>{PERIOD_LABEL[p]}</button>
                  ))}
                </div>
                <MoveList title="내린 것" list={moves.down} period={period} onOpen={setOpen} />
                <MoveList title="오른 것" list={moves.up} period={period} onOpen={setOpen} />
              </section>

              <section className="group" aria-labelledby="mk-all">
                <div className="group-head">
                  <h2 className="group-title" id="mk-all">
                    모든 품목 <span className="group-count num">{series.length}개</span>
                  </h2>
                  <button type="button" className="btn-text" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}>
                    {showAll ? '접기' : '펼치기'}
                  </button>
                </div>
                {showAll && GROUPS.map((g) => {
                  const list = series.filter((s) => g.ctgry.includes(s.ctgry))
                  if (list.length === 0) return null
                  return (
                    <div key={g.title} className="market-all">
                      <p className="detail-sub">{g.title}</p>
                      <ul className="group-rows">
                        {list.map((s) => <SeriesRow key={keyOf(s)} s={s} onOpen={() => setOpen(s)} />)}
                      </ul>
                    </div>
                  )
                })}
              </section>
            </>
          )}

          <section className="group" aria-labelledby="mk-recall">
            <h2 className="group-title" id="mk-recall">
              {SOURCE_NAME.I0490}
              {recalls?.syncedAt && <span className="group-count num">{koDay(recalls.syncedAt)} 확인</span>}
            </h2>
            {recallsFailed && <p className="market-empty" role="status">식약처 목록을 불러오지 못했어요.</p>}
            {recalls && !recalls.syncedAt && <p className="market-empty">식약처 목록을 아직 받지 못했어요.</p>}
            {recalls && recalls.syncedAt && recalls.records.length === 0 && (
              <p className="market-empty">확인한 범위에서 찾은 기록 없음</p>
            )}
            {recalls && recalls.records.length > 0 && (
              <ul className="alert-list">
                {recalls.records.map((r) => (
                  <li key={r.sourceId} className="alert-card">
                    {r.grade && <span className="alert-badge alert-record market-badge">{r.grade}</span>}
                    <p className="alert-product">{r.productName}</p>
                    <dl className="alert-facts">
                      {r.maker && <><dt>업체</dt><dd>{r.maker}</dd></>}
                      {r.reason && <><dt>사유</dt><dd>{r.reason}</dd></>}
                      {r.registeredOn && <><dt>등록일</dt><dd className="num">{koFullDay(r.registeredOn)}</dd></>}
                    </dl>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      <div className="notice-slot" aria-live="polite">
        {notice && <div className="notice"><p>{notice}</p></div>}
      </div>

      {open && (
        <MarketSheet title={seriesName(open)} onClose={() => setOpen(null)}>
          <MarketPanel store={store} series={series} initial={open} isWatched={watched} onWatch={toggleWatch} />
        </MarketSheet>
      )}
    </div>
  )
}

function SeriesRow({ s, onOpen, extra }: { s: MarketSeries; onOpen: () => void; extra?: ReactNode }) {
  const c = change(s.cur, s.w1)
  const grade = gradeText(s)
  return (
    <li className="row">
      <button type="button" className="row-body market-row" onClick={onOpen}>
        <span className="row-main">
          <span className="row-name">{seriesName(s)}{grade && <span className="row-spec"> {grade}</span>}</span>
          <span className="row-meta">{unitOf(s)}, {whereOf(s)} <span className="nowrap">{koDay(s.cur.on)}</span></span>
        </span>
        {extra}
        <span className="row-price">
          <span className="row-price-v num">{won(s.cur.price)}</span>
          <span className={`market-change num is-${c?.dir ?? 'same'}`}>{c ? `1주 전보다 ${changeText(c)}` : '1주 전 확인 못 함'}</span>
        </span>
      </button>
    </li>
  )
}

function WatchRow({ s, store, onOpen }: { s: MarketSeries; store: MarketStore; onOpen: () => void }) {
  const [trend, setTrend] = useState<TrendPoint[]>([])
  useEffect(() => {
    let live = true
    store.trend(s).then((t) => live && setTrend(t), () => {})
    return () => {
      live = false
    }
  }, [store, s])
  return <SeriesRow s={s} onOpen={onOpen} extra={<Sparkline points={trend} />} />
}

function MoveList({ title, list, period, onOpen }: { title: string; list: ReturnType<typeof movers>['down']; period: Period; onOpen: (s: MarketSeries) => void }) {
  return (
    <div className="market-moves">
      <p className="detail-sub">{title}</p>
      {list.length === 0 ? (
        <p className="market-empty">{PERIOD_LABEL[period]} 값과 비교할 수 있는 품목이 없어요.</p>
      ) : (
        <ul className="group-rows">
          {list.map(({ s, past, c }) => (
            <li key={keyOf(s)} className="row">
              <button type="button" className="row-body market-row" onClick={() => onOpen(s)}>
                <span className="row-main">
                  <span className="row-name">{seriesName(s)}{gradeText(s) && <span className="row-spec"> {gradeText(s)}</span>}</span>
                  <span className="row-meta">{unitOf(s)}, {whereOf(s)} <span className="nowrap">{koDay(s.cur.on)}</span></span>
                  <span className="row-meta">{PERIOD_LABEL[period]}(<span className="nowrap">{dayText(past.on, s.cur.on)}</span>) <span className="num">{won(past.price)}</span></span>
                </span>
                <span className="row-price">
                  <span className="row-price-v num">{won(s.cur.price)}</span>
                  <span className={`market-change num is-${c.dir}`}>{changeText(c)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
