import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useClosing, useFocusTrap, useScrollLock } from '../../lib/dialog'
import { checkedRange, koDay, koFullDay, SOURCE_NAME, SOURCES } from '../lib/alerts'
import { danawaProductUrl } from '../../../supabase/functions/_shared/danawa'
import { fitRule, isBulk } from '../../../supabase/functions/_shared/fit'
import { won } from '../lib/format'
import {
  checkedText,
  farmLine,
  isFresh,
  kstDay,
  priceRowText,
  ratingNote,
  safetySummary,
  searchLabel,
  SHORTCUTS,
  splitLines,
  type ItemDetailData,
  type PriceLine,
  type SafetyRecord,
} from '../lib/products'
import type { CandidateAlert, ListStore } from '../lib/store'
import type { Item } from '../lib/types'
import { change, changeText, dayText, gradeText, pickSeries, sameKey, seriesName, unitOf, whereOf, type MarketBoard, type MarketSeries, type SeriesKey } from '../lib/market'
import type { MarketStore } from '../lib/marketStore'
import MarketPanel from './MarketPanel'
import { ShopLinks, StorePrices } from './SourceBlocks'
import { GoodPickerSheet, IngredientsPickerSheet, NutritionPickerSheet, StorePickerSheet } from './StoreSheets'
import { INGREDIENT_NOTE, nutritionRows, nutritionSource, ORIGIN_LINE, type ItemIngredients, type ItemNutrition } from '../lib/foodInfo'
import { alternatives, betterText } from '../lib/alternatives'
import type { Candidate } from '../lib/products'
import type { ItemSources, ShopLink, ShopSource } from '../lib/sources'
import { OursBlock } from './OursBlock'
import type { OurPurchase } from '../lib/ours'
import type { Member } from '../lib/types'
import { READING_TEXT, sourceLabel, type CapturedQuoteInput, type PriceRead } from '../lib/photo'
import { PhotoPick, PriceReadForm } from './PhotoCapture'
import { matchMarket } from '../../../supabase/functions/_shared/market'

const CLOSE_MS = 250
type Tab = 'market' | 'price' | 'ingredients' | 'alternatives' | 'safety' | 'rating'
const TABS: { key: Tab; label: string }[] = [
  { key: 'price', label: '가격' },
  { key: 'ingredients', label: '성분' },
  { key: 'alternatives', label: '대안' },
  { key: 'safety', label: '안전' },
  { key: 'rating', label: '평가' },
]
// 신선 품목(정육·수산·채소·과일): 상품을 고르지 않고 시세로 본다(화면 설계 8-3, D-012)
const FRESH_TABS: { key: Tab; label: string }[] = [
  { key: 'market', label: '시세' },
  { key: 'price', label: '가격' },
  { key: 'ingredients', label: '성분' },
  { key: 'safety', label: '안전' },
]

type Props = {
  item: Item
  store: ListStore
  onChangeProduct: () => void
  onClose: () => void
  /** 농수산물 시세(D-012). board가 null이면 아직 불러오는 중, failed면 불러오지 못함 */
  market?: { store: MarketStore; board: MarketBoard | null; failed: boolean }
  /** 가구 구성원(우리가 산 값의 산 사람 표시, P2) */
  members?: readonly Member[]
}

// 품목 상세: 요약 네 칸과 가격·안전·평가 탭. 숫자마다 출처와 확인 시각을 붙인다(화면 설계 4·5절).
export default function ItemDetail({ item, store, onChangeProduct, onClose, market, members = [] }: Props) {
  const fresh = isFresh(item.category) && Boolean(market)
  const [tab, setTab] = useState<Tab>(fresh ? 'market' : 'price')
  const matched = fresh ? matchMarket(item.name, item.spec) : null
  const series = market?.board ? pickSeries(market.board.series, matched) : null
  const [watches, setWatches] = useState<SeriesKey[]>([])
  useEffect(() => {
    if (!fresh || !market) return
    market.store.watches().then(setWatches, () => {})
  }, [fresh, market])
  const toggleWatch = (s: MarketSeries, on: boolean) => {
    const before = watches
    setWatches(on ? [...before, { item: s.item, vrty: s.vrty, grd: s.grd }] : before.filter((w) => !sameKey(w, s)))
    market?.store.setWatch(s, on).catch(() => setWatches(before))
  }
  const [data, setData] = useState<ItemDetailData | null>(null)
  const [failed, setFailed] = useState(false)
  const [checking, setChecking] = useState(false)
  // P3: 넣은 주소의 값·참가격 매장 가격, 고르기 시트
  const [sources, setSources] = useState<ItemSources | null>(null)
  const [ours, setOurs] = useState<OurPurchase[] | null>(null)
  const [srcFailed, setSrcFailed] = useState(false)
  const [srcBusy, setSrcBusy] = useState(false)
  // 겹쳐 연 고르기 시트. 닫히면 연 버튼으로 포커스가 돌아오는 것은 시트 공통 규칙(lib/dialog.ts)이 한다
  const [picker, setPicker] = useState<'good' | 'stores' | 'food' | 'nutrition' | null>(null)
  const openPicker = (p: 'good' | 'stores' | 'food' | 'nutrition') => setPicker(p)
  const closePicker = () => setPicker(null)
  // P7·D-020: 식약처 품목제조보고 원재료(품목 이름·규격에 기억), 대안 계산용 후보
  const [ing, setIng] = useState<ItemIngredients | null | 'loading' | 'failed'>('loading')
  // P9: 품목 이름·규격에 기억한 식품영양성분DB 식품(신선 품목도)
  const [nut, setNut] = useState<ItemNutrition | null | 'loading' | 'failed'>('loading')
  const [cands, setCands] = useState<Candidate[] | null | 'loading'>('loading')
  const [candAlerts, setCandAlerts] = useState<ReadonlyMap<string, CandidateAlert[]>>(new Map())
  // 캡처로 가격 넣기(P4): 읽는 중 → 읽은 값(고친 뒤 저장)
  const [capture, setCapture] = useState<'idle' | 'reading' | (PriceRead & { qty: number })>('idle')
  const [captureMsg, setCaptureMsg] = useState<string | null>(null)
  const sheet = useRef<HTMLDivElement>(null)
  const closeBtn = useRef<HTMLButtonElement>(null)
  const asked = useRef(false)
  const titleId = useId()
  // 닫기 움직임·Esc·Tab 순환·스크롤 잠금. 위에 고르기 시트가 열리면 그 시트가 키를 받고 이 시트는 쉰다
  const { closing, close } = useClosing(onClose, CLOSE_MS)
  useScrollLock(true)
  useFocusTrap(sheet, !closing, { onEscape: close, initialFocus: closeBtn })

  const load = useCallback(() => {
    setFailed(false)
    return store.detail(item.id).then(
      (d) => {
        setData(d)
        return d
      },
      (e: unknown) => {
        console.error('품목 상세 불러오기 실패', e)
        setFailed(true)
        return null
      },
    )
  }, [store, item.id])

  const loadSources = useCallback(() => {
    setSrcFailed(false)
    return Promise.all([
      store.sources(item.id).then(setSources, () => setSrcFailed(true)),
      store.ourPurchases(item.id).then(setOurs, () => setOurs([])),
    ]).then(() => {})
  }, [store, item.id])
  useEffect(() => {
    void loadSources()
  }, [loadSources])
  // 몰 주소 자동 찾기(D-024): 고른 상품을 아직 찾은 적 없으면 한 번 찾고(상품을 고를 때 목록에서도 부른다),
  // 찾는 중이면 4초마다 다시 읽는다(2분까지). 찾기는 서버가 상품마다 한 번만 한다
  const [finding, setFinding] = useState(false)
  const findAsked = useRef(false)
  const polls = useRef(0)
  const hasProduct = Boolean(data?.product)
  const findStatus = sources ? (sources.find?.status ?? 'none') : null
  useEffect(() => {
    if (!hasProduct || findStatus !== 'none' || findAsked.current) return
    findAsked.current = true
    setFinding(true)
    store.findShops(item.id).catch(() => {}).then(loadSources).finally(() => setFinding(false))
  }, [hasProduct, findStatus, store, item.id, loadSources])
  useEffect(() => {
    if (findStatus !== 'searching' || finding || polls.current >= 30) return
    const t = window.setTimeout(() => {
      polls.current++
      void loadSources()
    }, 4000)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react/exhaustive-effect-dependencies -- sources가 새로 읽힐 때마다 다음 4초를 잰다
  }, [findStatus, finding, sources, loadSources])
  const loadIng = useCallback(() => store.itemIngredients(item.id).then(setIng, () => setIng('failed')), [store, item.id])
  const loadNut = useCallback(() => store.itemNutrition(item.id).then(setNut, () => setNut('failed')), [store, item.id])
  // 성분 탭을 열었는데 기억한 식품이 없으면 버튼 없이 이름으로 자동 맞춘다(사용자 2026-10-20). 한 번만 시도한다
  const autoTried = useRef(false)
  useEffect(() => {
    if (tab !== 'ingredients' || nut !== null || autoTried.current) return
    autoTried.current = true
    setNut('loading')
    store.autoNutrition(item.id).then(setNut, () => setNut(null))
  }, [tab, nut, store, item.id])
  // 원재료도 성분 탭을 열면 고른 상품명으로 자동으로 맞춘다(D-020). 상품이 없는 품목은 이름만으로 맞추지 않고 사람이 고른다. 한 번만 시도한다
  const ingTried = useRef(false)
  useEffect(() => {
    if (tab !== 'ingredients' || ing !== null || ingTried.current || !data?.product) return
    ingTried.current = true
    setIng('loading')
    store.autoIngredients(item.id).then(setIng, () => setIng(null))
  }, [tab, ing, data, store, item.id])
  useEffect(() => {
    void loadIng()
    void loadNut()
    store.candidates(item.id).then(setCands, () => setCands(null))
    store.candidateAlerts(item.id).then(setCandAlerts, () => setCandAlerts(new Map()))
  }, [loadIng, loadNut, store, item.id])
  const withBusy = (p: Promise<unknown>) => {
    setSrcBusy(true)
    return p.finally(() => setSrcBusy(false))
  }
  const addLink = (link: ShopLink) =>
    withBusy(
      store.addShopLink(item.id, link).then(() => {
        // 넣은 주소는 바로 한 번 읽는다(서버가 출처마다 하루 한 번만 받는다)
        setChecking(true)
        return store.checkPrice(item.id).catch(() => {}).then(() => Promise.all([load(), loadSources()])).finally(() => setChecking(false))
      }),
    ).then(() => {})
  const removeLink = (source: ShopSource) => withBusy(store.removeShopLink(item.id, source).then(loadSources)).then(() => {})
  const unlinkGood = () => withBusy(store.chooseStoreGood(item.id, null).then(loadSources)).then(() => {})
  const readCapture = (img: { media_type: 'image/jpeg'; data: string; width: number; height: number }) => {
    setCapture('reading')
    setCaptureMsg(null)
    store.readPhoto('price', { media_type: img.media_type, data: img.data, width: img.width, height: img.height }).then(
      (r) => setCapture(r.job === 'price' ? r.price : 'idle'),
      (e: unknown) => {
        setCapture('idle')
        setCaptureMsg(e instanceof Error && e.message ? e.message : '캡처를 읽지 못했어요. 값을 직접 적어 주세요.')
      },
    )
  }
  const saveCapture = (q: CapturedQuoteInput) =>
    withBusy(store.addCapturedQuote(item.id, q).then(() => load())).then(() => setCapture('idle'))
  const decide = (r: OurPurchase, same: boolean) =>
    r.transactionItemId ? withBusy(store.decidePurchase(item.id, r.transactionItemId, same).then(loadSources)).then(() => {}) : Promise.resolve()

  // 열 때: 고른 상품이 있고 오늘 성공한 확인이 없으면 그때 확인한다(화면 설계 8-1)
  useEffect(() => {
    void load().then((d) => {
      const today = kstDay(new Date().toISOString())
      const fresh = d?.check?.ok && kstDay(d.check.checkedAt) === today
      if (!d?.product || fresh || asked.current) return
      asked.current = true
      setChecking(true)
      store.checkPrice(item.id).then(
        () => load().finally(() => setChecking(false)),
        () => load().finally(() => setChecking(false)),
      )
    })
  }, [load, store, item.id])

  const today = kstDay(new Date().toISOString())
  const qty = item.productQty ?? 1
  const split = splitLines(data?.lines ?? [], qty, today)
  const query = data?.product?.name ?? [item.name, item.spec].filter(Boolean).join(' ')
  const lastFailed = data?.check && !data.check.ok ? data.check : null
  // 실패 문구 뒤의 시각은 다나와 줄 기준(캡처 줄이 앞에 있을 수 있다, 리뷰 ④)
  const lastDanawa = data?.lines.find((l) => l.source === 'danawa') ?? null
  // 대안도 2~3인 가구에 맞는 크기만 견준다(D-015). 고른 상품은 큰 용량이어도 남긴다. 식약처 기록이 겹치는 후보는 표시를 붙여 뒤로(D-016)
  const chosenId = data?.product?.id
  const rule = fitRule(item.name, item.spec, item.count)
  const alts = chosenId && Array.isArray(cands)
    ? alternatives(cands.filter((c) => c.productId === chosenId || !isBulk(c, rule)), chosenId, qty, candAlerts)
    : []

  return (
    <div className={`sheet-layer${closing ? ' is-closing' : ''}`}>
      <div className="sheet-backdrop" onClick={close} aria-hidden="true" />
      <div className="sheet detail" ref={sheet} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="sheet-head">
          <h2 id={titleId}>{item.name}{item.spec ? ` ${item.spec}` : ''}</h2>
          <button type="button" className="btn-text" ref={closeBtn} onClick={close}>닫기</button>
        </div>
        <div className="sheet-body">
          {failed && <p className="cand-state" role="status">품목 정보를 불러오지 못했어요. 잠시 뒤 다시 해 주세요.</p>}
          {!data && !failed && <p className="cand-state" role="status">품목 정보 불러오는 중</p>}
          {data && (
            <>
              <div className="detail-head">
                {data.product?.imageUrl && <img className="cand-img" src={data.product.imageUrl} alt="" />}
                <div className="cand-title">
                  <p className="cand-name">
                    {data.product
                      ? `${data.product.name} (${qty}개)`
                      : fresh
                        ? series ? `시세: ${seriesName(series)}${gradeText(series) ? ` ${gradeText(series)}` : ''}` : '농수산물 시세'
                        : searchLabel(null, isFresh(item.category))}
                  </p>
                  <p className="cand-rating">{item.category}</p>
                </div>
                {(data.product || !isFresh(item.category)) && (
                  <button type="button" className="btn-secondary detail-change" onClick={onChangeProduct}>
                    {data.product ? '상품 바꾸기' : '상품 고르기'}
                  </button>
                )}
              </div>

              {fresh ? (
                <FreshSummary series={series} state={market?.failed ? 'failed' : market?.board ? 'ready' : 'loading'} safety={safetySummary(data.safety, data.syncedAt)} />
              ) : (
              <section className="summary detail-summary" aria-label="요약">
                <div className="summary-cell">
                  <p className="summary-k">가장 싼 값</p>
                  <p className="summary-v num">{split.best ? won(split.best.price) : '확인 못 함'}</p>
                  {split.best && <p className="summary-note">{split.best.seller ?? '다나와 최저가'}, {checkedText(split.best.checkedAt)}</p>}
                </div>
                <div className="summary-cell">
                  <p className="summary-k">식약처 기록</p>
                  <p className="summary-v detail-small">{safetySummary(data.safety, data.syncedAt)}</p>
                </div>
                <div className="summary-cell">
                  <p className="summary-k">평점</p>
                  <p className="summary-v num">{data.product?.rating != null ? data.product.rating.toFixed(1) : '확인 못 함'}</p>
                  {data.product?.rating != null && <p className="summary-note">{ratingNote(data.product.ratedAt)}</p>}
                </div>
                <div className="summary-cell">
                  <p className="summary-k">더 나은 상품</p>
                  <p className="summary-v num">{data.product ? betterText(cands === 'loading' ? null : cands === null ? null : alts.length) : '상품 고르기 전'}</p>
                  {data.product && alts.length > 0 && <p className="summary-note">대안 탭에서 보기</p>}
                </div>
              </section>
              )}

              <div className={`seg detail-tabs${fresh ? ' seg-4' : ' seg-5'}`} role="tablist" aria-label="품목 상세">
                {(fresh ? FRESH_TABS : TABS).map((t) => (
                  <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}>
                    {t.label}
                  </button>
                ))}
              </div>

              {tab === 'market' && market && (
                <div role="tabpanel">
                  {market.failed && <p className="cand-state" role="status">시세를 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.</p>}
                  {!market.failed && !market.board && <p className="cand-state" role="status">시세 확인 중</p>}
                  {market.board && !series && (
                    <p className="cand-state">
                      {matched
                        ? `KAMIS ${matched.label}의 최근 60일 조사값이 없어 시세 확인 못 함.`
                        : '이 품목에 맞는 KAMIS 조사 품목을 찾지 못해 시세 확인 못 함.'}
                    </p>
                  )}
                  {market.board && series && (
                    <MarketPanel
                      store={market.store}
                      series={market.board.series}
                      initial={series}
                      isWatched={(x) => watches.some((w) => sameKey(w, x))}
                      onWatch={toggleWatch}
                    />
                  )}
                </div>
              )}

              {tab === 'price' && (
                <div role="tabpanel">
                  {checking && <p className="cand-state" role="status">다나와 가격 확인 중</p>}
                  {!checking && lastFailed && (
                    <p className="cand-state" role="status">
                      다나와 가격을 지금 불러오지 못했어요.
                      {lastDanawa ? ` ${checkedText(lastDanawa.checkedAt)}에 확인한 값을 보여 드려요.` : split.same.length + split.other.length > 0 ? ' 캡처로 넣은 값만 있어요.' : ''}
                    </p>
                  )}
                  {!data.product && (
                    <p className="cand-state">{isFresh(item.category) ? '신선 품목은 시세 탭에 공공 조사값을 보여 드려요. 쇼핑몰 가격은 아래에서 직접 보세요.' : '상품을 고르면 가격을 확인해요.'}</p>
                  )}
                  {data.product && !checking && split.same.length === 0 && split.other.length === 0 && !lastFailed && (
                    <p className="cand-state">가격 확인 못 함</p>
                  )}
                  {split.same.length > 0 && <PriceList title={`${qty}개`} lines={split.same} members={members} />}
                  {split.other.length > 0 && <PriceList title="다른 용량" lines={split.other} members={members} showUnit />}
                  {data.product && (
                    <div className="detail-block capture-block">
                      <div className="photo-row">
                        <PhotoPick label="화면 캡처로 가격 넣기" inputLabel="가격 캡처 사진" disabled={capture === 'reading' || srcBusy} onImage={readCapture} />
                        <span className="src-line">쇼핑몰 화면이나 가격표를 찍으면 값을 읽어 와요. 확인한 값만 저장돼요.</span>
                      </div>
                      {capture === 'reading' && <p className="cand-state" role="status">{READING_TEXT}</p>}
                      {captureMsg && <p className="cand-state" role="alert">{captureMsg}</p>}
                      {typeof capture === 'object' && <PriceReadForm read={capture} busy={srcBusy} onSave={saveCapture} onCancel={() => setCapture('idle')} />}
                    </div>
                  )}
                  {ours && <OursBlock rows={ours} members={members} busy={srcBusy} onDecide={decide} />}
                  {srcFailed && <p className="cand-state" role="status">넣은 주소의 값과 매장 가격을 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.</p>}
                  {!srcFailed && !sources && <p className="cand-state" role="status">넣은 주소·매장 가격 불러오는 중</p>}
                  {sources && data.product && (
                    <ShopLinks
                      shops={sources.shops}
                      find={finding ? { status: 'searching', searchedAt: new Date().toISOString(), error: null, candidates: [] } : sources.find}
                      busy={srcBusy || checking}
                      onAdd={addLink}
                      onRemove={removeLink}
                    />
                  )}
                  {sources && (
                    <StorePrices store={sources.store} busy={srcBusy} onPickGood={() => openPicker('good')} onUnlink={unlinkGood} onPickStores={() => openPicker('stores')} />
                  )}
                  <p className="detail-sub">다른 곳에서 보기</p>
                  <div className="detail-links">
                    {SHORTCUTS.map((s) => (
                      <a key={s.name} className="btn-secondary detail-link" href={s.url(query)} target="_blank" rel="noopener noreferrer">
                        {s.name}
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {tab === 'ingredients' && (
                <div role="tabpanel">
                  <div className="detail-block">
                    <p className="detail-sub">열량·영양성분</p>
                    {nut === 'loading' && <p className="cand-state" role="status">식품영양성분DB에서 이름으로 맞추는 중</p>}
                    {nut === 'failed' && <p className="cand-state" role="status">영양성분을 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.</p>}
                    {nut === null && (
                      <>
                        <p className="detail-none">식품영양성분DB에서 이름으로 맞는 식품을 찾지 못했어요. 다른 이름으로 찾아 고르면 같은 이름·규격으로 담을 때 다시 쓰여요.</p>
                        <button type="button" className="btn-secondary detail-link" onClick={() => openPicker('nutrition')}>영양성분 찾기</button>
                      </>
                    )}
                    {typeof nut === 'object' && nut !== null && (
                      <>
                        <p className="store-good">
                          <span>{nut.foodName}</span>
                          <button type="button" className="btn-text" onClick={() => openPicker('nutrition')}>다른 식품으로 바꾸기</button>
                        </p>
                        <dl className="nutri-table">
                          {nutritionRows(nut.nutrition).map((r) => (
                            <div key={r.label} className="nutri-row"><dt>{r.label}</dt><dd className="num">{r.value}</dd></div>
                          ))}
                        </dl>
                        <p className="src-line">
                          {[nut.maker, nutritionSource(nut.nutrition), nut.auto ? `${checkedText(nut.updatedAt)} ${nut.matchedBy === 'product' ? '상품명으로' : '이름으로'} 자동 맞춤` : `${checkedText(nut.updatedAt)} 고름`].filter(Boolean).join(', ')}
                        </p>
                        {nut.auto && (
                          <p className="read-note">
                            {nut.matchedBy === 'product' ? '고른 상품의 이름으로' : '품목 이름으로'} 자동으로 맞춘 식품이에요. 다른 식품이면 "다른 식품으로 바꾸기"로 고쳐 주세요.
                          </p>
                        )}
                      </>
                    )}
                  </div>
                  {!fresh && (
                    <div className="detail-block">
                      <p className="detail-sub">원재료</p>
                      {ing === 'loading' && <p className="cand-state" role="status">{data.product ? '식약처 품목제조보고에서 상품명으로 맞추는 중' : '원재료 불러오는 중'}</p>}
                      {ing === 'failed' && <p className="cand-state" role="status">원재료를 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.</p>}
                      {ing === null && (
                        <>
                          <p className="detail-none">
                            {data.product
                              ? '식약처 품목제조보고에서 상품명으로 맞는 품목을 찾지 못했어요. 직접 찾아 고르면 같은 이름·규격으로 담을 때 다시 쓰여요.'
                              : '식약처 품목제조보고(식품·축산물·건강기능식품)에서 같은 품목을 고르면 원재료를 보여 드려요. 상품을 고르면 상품명으로 자동으로 맞춰요.'}
                          </p>
                          <button type="button" className="btn-secondary detail-link" onClick={() => openPicker('food')}>식약처 품목 찾기</button>
                        </>
                      )}
                      {typeof ing === 'object' && ing !== null && (
                        <>
                          <p className="store-good">
                            <span>{ing.name}</span>
                            <button type="button" className="btn-text" onClick={() => openPicker('food')}>다른 품목으로 바꾸기</button>
                          </p>
                          <p className="src-line">
                            {[ing.maker, ing.kind, ing.shelfLife ? `소비기한 ${ing.shelfLife}` : null, ing.changedOn ? `${koFullDay(ing.changedOn)} 변경` : null, `보고번호 ${ing.reportNo}`].filter(Boolean).join(', ')}
                          </p>
                          <p className="ingredients-text">{ing.rawMaterials ?? '확인 못 함'}</p>
                          {ing.health &&
                            ([['기능성', ing.health.function], ['섭취 방법', ing.health.intake], ['주의사항', ing.health.caution]] as const)
                              .filter(([, v]) => v)
                              .map(([k, v]) => (
                                <p key={k} className="ingredients-text"><b>{k}</b> {v}</p>
                              ))}
                          <p className="src-line">{ORIGIN_LINE[ing.origin]}, {ing.auto ? `${checkedText(ing.updatedAt)} 상품명으로 자동 맞춤` : `${checkedText(ing.updatedAt)} 고름`}</p>
                          <p className="read-note">
                            {ing.auto ? '고른 상품의 이름으로 자동으로 맞춘 품목이에요. 다른 품목이면 "다른 품목으로 바꾸기"로 고쳐 주세요. ' : ''}
                            {INGREDIENT_NOTE}
                          </p>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              {tab === 'alternatives' && (
                <div role="tabpanel">
                  {!data.product && <p className="cand-state">상품을 고르면 같은 품목의 다른 후보와 견줘요.</p>}
                  {data.product && cands === 'loading' && <p className="cand-state" role="status">후보 불러오는 중</p>}
                  {data.product && cands === null && <p className="cand-state" role="status">후보를 불러오지 못했어요.</p>}
                  {data.product && Array.isArray(cands) && alts.length === 0 && <p className="detail-none">후보 중에 고른 상품보다 싸거나 평가가 더 좋은 것은 없어요.</p>}
                  {alts.length > 0 && (
                    <ul className="price-list">
                      {alts.map((a) => (
                        <li key={a.productId} className="price-row ours-row">
                          <div>
                            <p className="price-where"><span>{a.name}</span></p>
                            <p className="alt-reasons">
                              {a.reasons.map((r) => <span key={r.kind} className="tag">{r.kind === 'cheaper' ? '더 쌈' : '평가가 좋음'}</span>)}
                              {a.alert && <span className="alert-badge alert-similar">비슷한 제품 기록</span>}
                            </p>
                            {a.reasons.map((r) => <p key={r.kind} className="src-line">{r.text}</p>)}
                            {a.alert && <p className="src-line">식약처 {a.alert}. 같은 제품인지 확인해 보세요.</p>}
                            <p className="src-line">다나와, {checkedText(a.foundAt)} 확인</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                  {data.product && Array.isArray(cands) && (
                    <p className="shop-note">숫자는 다나와 후보 값({qty}개 가격·평점·후기 수) 그대로예요. 후보도 식약처 기록과 이름으로 대조해 겹치면 표시를 붙여요. 바꾸려면 "상품 바꾸기"를 눌러요.</p>
                  )}
                </div>
              )}

              {tab === 'safety' && (
                <div role="tabpanel">
                  {SOURCES.map((src) => {
                    const recs = data.safety.filter((r) => r.source === src && !r.farm)
                    return (
                      <div key={src} className="detail-block">
                        <p className="detail-sub">{SOURCE_NAME[src]}</p>
                        {!data.syncedAt[src] ? (
                          <p className="detail-none">확인 못 함(아직 목록을 받지 못했어요)</p>
                        ) : recs.length === 0 ? (
                          <p className="detail-none">확인한 범위에서 찾은 기록 없음</p>
                        ) : (
                          <ul className="alert-list">{recs.map((r) => <SafetyCard key={r.sourceId} r={r} />)}</ul>
                        )}
                      </div>
                    )
                  })}
                  <FarmRecords records={data.safety} />
                  <p className="alert-range">{checkedRange(data.syncedAt)}</p>
                </div>
              )}

              {tab === 'rating' && (
                <div role="tabpanel">
                  {data.product?.rating != null ? (
                    <p className="detail-rating">
                      <span className="num">평점 {data.product.rating.toFixed(1)}</span>
                      {data.product.reviewCount != null && <span className="num">, 후기 {data.product.reviewCount.toLocaleString('ko-KR')}개</span>}
                      <span className="detail-none"> ({ratingNote(data.product.ratedAt)})</span>
                    </p>
                  ) : (
                    <p className="detail-none">평점 확인 못 함</p>
                  )}
                  {data.product && (
                    <a className="btn-secondary detail-link" href={danawaProductUrl(data.product.pcode)} target="_blank" rel="noopener noreferrer">
                      원래 페이지에서 후기 보기
                    </a>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {picker === 'good' && (
        <GoodPickerSheet
          store={store}
          itemName={item.name}
          current={sources?.store.good?.goodId ?? null}
          onPick={(goodId) => store.chooseStoreGood(item.id, goodId).then(loadSources)}
          onClose={closePicker}
        />
      )}
      {picker === 'stores' && <StorePickerSheet store={store} onSaved={loadSources} onClose={closePicker} />}
      {picker === 'nutrition' && (
        <NutritionPickerSheet
          store={store}
          itemId={item.id}
          itemName={item.name}
          current={typeof nut === 'object' && nut !== null ? nut.foodCd : null}
          onDone={() => loadNut().then(() => {})}
          onClose={closePicker}
        />
      )}
      {picker === 'food' && data && (
        <IngredientsPickerSheet
          store={store}
          itemId={item.id}
          itemName={item.name}
          productName={data.product?.name ?? null}
          current={typeof ing === 'object' && ing !== null ? ing.reportNo : null}
          onDone={() => loadIng().then(() => {})}
          onClose={closePicker}
        />
      )}
    </div>
  )
}

function PriceList({ title, lines, members, showUnit = false }: { title: string; lines: PriceLine[]; members: readonly Member[]; showUnit?: boolean }) {
  return (
    <div className="detail-block">
      <p className="detail-sub">{title}</p>
      <ul className="price-list">
        {lines.map((l, i) => (
          <li key={`${l.seller}-${l.qty}-${i}`} className="price-row">
            <div>
              <p className="price-where">{l.seller ?? `다나와 최저가(${l.qty}개)`}</p>
              <p className="price-src">
                {sourceLabel(l.source, l.capturedBy, members)}, {checkedText(l.checkedAt)}
                {showUnit && l.seller !== null ? `, ${l.qty}개` : ''}
                {showUnit && l.unitPrice !== null && l.unitLabel ? `, ${l.unitLabel}당 ${won(l.unitPrice)}` : ''}
              </p>
            </div>
            <p className="price-v num">{priceRowText(l)}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}

function SafetyCard({ r }: { r: SafetyRecord }) {
  return (
    <li className="alert-card">
      <p className="alert-product">{r.productName}</p>
      <dl className="alert-facts">
        {r.maker && <><dt>업체</dt><dd>{r.maker}</dd></>}
        {r.reason && <><dt>사유</dt><dd>{r.reason}</dd></>}
        {r.grade && <><dt>등급</dt><dd>{r.grade}</dd></>}
        {r.registeredOn && <><dt>등록일</dt><dd className="num">{koFullDay(r.registeredOn)}</dd></>}
        <dt>찾은 방법</dt><dd>{r.via === 'product_name' ? '상품명으로 찾음' : '품목 이름으로 찾음'}</dd>
      </dl>
    </li>
  )
}

function FarmRecords({ records }: { records: SafetyRecord[] }) {
  const [open, setOpen] = useState(false)
  const line = farmLine(records)
  if (!line) return null
  return (
    <div className="detail-block">
      <button type="button" className="btn-text detail-farm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {line}
      </button>
      {open && <ul className="alert-list">{records.filter((r) => r.farm).map((r) => <SafetyCard key={r.sourceId} r={r} />)}</ul>}
    </div>
  )
}

/** 신선 품목 요약 네 칸: 오늘 시세, 1주 전 대비, 1년 전 대비, 식약처 기록(화면 설계 8-3, 평년은 D-012로 1년 전) */
function FreshSummary({ series, state, safety }: { series: MarketSeries | null; state: 'loading' | 'ready' | 'failed'; safety: string }) {
  const none = state === 'loading' ? '확인 중' : '확인 못 함'
  const cmp = (label: string, p: MarketSeries['w1']) => {
    const c = series ? change(series.cur, p) : null
    return (
      <div className="summary-cell">
        <p className="summary-k">{label} 대비</p>
        <p className={`summary-v num${c ? ` market-change is-${c.dir}` : ''}`}>{series ? changeText(c) : none}</p>
        {series && p && <p className="summary-note">{dayText(p.on, series.cur.on)} {won(p.price)}</p>}
      </div>
    )
  }
  return (
    <section className="summary detail-summary" aria-label="요약">
      <div className="summary-cell">
        <p className="summary-k">오늘 시세</p>
        <p className="summary-v num">{series ? won(series.cur.price) : none}</p>
        {series && <p className="summary-note">{unitOf(series)}, {whereOf(series)} {koDay(series.cur.on)}</p>}
      </div>
      {cmp('1주 전', series?.w1 ?? null)}
      {cmp('1년 전', series?.y1 ?? null)}
      <div className="summary-cell">
        <p className="summary-k">식약처 기록</p>
        <p className="summary-v detail-small">{safety}</p>
      </div>
    </section>
  )
}
