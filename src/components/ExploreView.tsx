// 알아보기 탭(D-035): 날씨·미세먼지와 다나와 가격 비교. 숫자는 서버 함수가 준 값만 쓰고 출처·기준 시각을 붙인다.
import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  dayName, DEFAULT_PLACE, degree, failText, fetchWeather, loadPlace, offerTotal, productPrices, round2, savePlace, searchPrices,
  sortOffers, variantText, whenText, won,
  type ExploreItem, type Place, type ProductPrices, type SearchResult, type WeatherResult,
} from '../lib/explore'
import { sb } from '../lib/supabase'
import { Sheet } from './Sheet'

// 같은 위치는 10분 동안 다시 받지 않는다(탭을 오가도 기상청을 다시 부르지 않게)
const WEATHER_TTL = 10 * 60_000
const weatherCache = new Map<string, { at: number; data: WeatherResult }>()
/** 시험이 장면마다 비운다 */
export const clearWeatherCache = () => weatherCache.clear()

// 다나와 이미지는 콘텐츠 보안 정책에 넣은 호스트만 보인다(lib/csp.ts)
const imageOf = (url: string | null) => (url && /^https:\/\/img\.danuri\.io\//.test(url) ? url : null)

// 에어코리아 등급(그대로 보인다) → 색 이름
const GRADE_CLASS: Record<string, string> = { 좋음: 'good', 보통: 'normal', 나쁨: 'bad', 매우나쁨: 'worst' }

export function ExploreView({ toast }: { toast: (msg: string) => void }) {
  return (
    <div className="view explore">
      <WeatherCard toast={toast} />
      <PriceCard />
    </div>
  )
}

function WeatherCard({ toast }: { toast: (msg: string) => void }) {
  const [place, setPlace] = useState<Place>(loadPlace)
  const [data, setData] = useState<WeatherResult | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [locating, setLocating] = useState(false)

  useEffect(() => {
    let alive = true
    const key = `${place.lat},${place.lng}`
    const hit = weatherCache.get(key)
    if (hit && Date.now() - hit.at < WEATHER_TTL) {
      setData(hit.data)
      setState('ready')
      return
    }
    setState('loading')
    fetchWeather(sb(), place)
      .then((d) => {
        weatherCache.set(key, { at: Date.now(), data: d })
        if (alive) { setData(d); setState('ready') }
      })
      .catch(() => { if (alive) setState('failed') })
    return () => { alive = false }
  }, [place])

  function pickHere() {
    if (!('geolocation' in navigator)) return toast('이 기기에서는 위치를 쓸 수 없어요')
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        const p: Place = { lat: round2(pos.coords.latitude), lng: round2(pos.coords.longitude), kind: 'here' }
        savePlace(p)
        setPlace(p)
      },
      () => {
        setLocating(false)
        toast('위치를 받지 못했어요. 기기 설정에서 위치 권한을 확인해 주세요')
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 10 * 60_000 },
    )
  }

  function pickDefault() {
    savePlace(DEFAULT_PLACE)
    setPlace(DEFAULT_PLACE)
  }

  const w = data?.weather
  const a = data?.air
  return (
    <section className="card explore-weather" aria-label="날씨와 미세먼지">
      <div className="explore-head">
        <h2 className="section-title">날씨</h2>
        <span className="explore-place">{place.kind === 'here' ? '현재 위치 근처' : '성남시청 근처'}</span>
        {place.kind === 'here'
          ? <button className="link-btn" onClick={pickDefault}>성남으로</button>
          : <button className="link-btn" onClick={pickHere} disabled={locating}>{locating ? '위치 찾는 중' : '현재 위치로'}</button>}
      </div>

      {state === 'loading' && <p className="lead">기상청 예보 받는 중</p>}
      {state === 'failed' && <p className="lead">날씨를 받지 못했어요. 잠시 뒤 탭을 다시 열어 주세요</p>}

      {state === 'ready' && w && (w.status === 'ok' ? (
        <>
          {w.now && (
            <div className="wx-now">
              <b className="wx-temp num">{degree(w.now.temp)}</b>
              <span className="wx-now-meta">
                <span>{w.now.precip === null ? '강수 확인 못 함' : w.now.precip === '없음' ? '비·눈 없음' : w.now.precip}</span>
                {w.now.rain1h !== null && w.now.rain1h > 0 && <span className="num">1시간 {w.now.rain1h}mm</span>}
                {w.now.humidity !== null && <span className="num">습도 {w.now.humidity}%</span>}
              </span>
            </div>
          )}
          <div className="wx-days">
            {w.days.map((d) => (
              <div key={d.date} className="wx-day">
                <div className="k">{dayName(d.date)}</div>
                <div className="v num">{degree(d.min)} / {degree(d.max)}</div>
                <div className="wx-day-meta">{d.sky ?? '하늘 확인 못 함'}{d.precip && d.precip !== '없음' ? `, ${d.precip}` : ''}</div>
                <div className="wx-day-meta num">강수확률 {d.rainChance === null ? '확인 못 함' : `${d.rainChance}%`}</div>
              </div>
            ))}
          </div>
          <p className="explore-src">
            {w.now ? `기상청 초단기실황 ${whenText(w.now.observedAt)} 관측 · ` : '지금 기온은 받지 못했어요 · '}
            기상청 단기예보 {whenText(w.issuedAt)} 발표
          </p>
        </>
      ) : <p className="lead">{failText('weather', w.status)}</p>)}

      {state === 'ready' && a && (
        <div className="air">
          <h3 className="explore-sub">미세먼지</h3>
          {a.status === 'ok' ? (
            <>
              <div className="wx-days">
                {([['미세먼지', a.pm10], ['초미세먼지', a.pm25]] as const).map(([label, v]) => (
                  <div key={label} className="wx-day">
                    <div className="k">{label}</div>
                    <div className="v num">{v.value === null ? '확인 못 함' : `${v.value}㎍/㎥`}</div>
                    <div className={`air-grade${v.grade ? ` g-${GRADE_CLASS[v.grade] ?? 'none'}` : ''}`}>{v.grade ?? '등급 없음'}</div>
                  </div>
                ))}
              </div>
              <p className="explore-src">
                에어코리아 {a.station.name} 측정소{a.station.distanceKm !== null ? `(약 ${a.station.distanceKm}km)` : ''}
                {a.measuredAt ? `, ${whenText(a.measuredAt)} 측정` : ''}
              </p>
            </>
          ) : <p className="lead">{failText('air', a.status)}</p>}
        </div>
      )}
    </section>
  )
}

type Search =
  | { state: 'idle' }
  | { state: 'searching'; query: string }
  | { state: 'busy' | 'failed'; query: string }
  | { state: 'done'; result: Extract<SearchResult, { items: ExploreItem[] }> }

function PriceCard() {
  const [text, setText] = useState('')
  const [search, setSearch] = useState<Search>({ state: 'idle' })
  const [open, setOpen] = useState<ExploreItem | null>(null)
  const seq = useRef(0)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const query = text.replace(/\s+/g, ' ').trim()
    if (query.length < 2 || search.state === 'searching') return
    const n = ++seq.current
    setSearch({ state: 'searching', query })
    try {
      const r = await searchPrices(sb(), query)
      if (n !== seq.current) return
      setSearch(r.status === 'busy' ? { state: 'busy', query } : { state: 'done', result: r })
    } catch {
      if (n === seq.current) setSearch({ state: 'failed', query })
    }
  }

  return (
    <section className="card explore-price" aria-label="가격 비교">
      <h2 className="section-title">가격 비교</h2>
      <form className="explore-search" onSubmit={submit}>
        <input className="input" aria-label="상품 이름" placeholder="예: 비비고 왕교자 1.05kg" maxLength={60}
          value={text} onChange={(e) => setText(e.target.value)} enterKeyHint="search" />
        <button className="primary" disabled={text.trim().length < 2 || search.state === 'searching'}>찾기</button>
      </form>

      {search.state === 'idle' && <p className="explore-src">다나와 검색 결과의 수량별 최저가를 보여 주고, 상품을 누르면 쇼핑몰별 가격을 보여 줘요.</p>}
      {search.state === 'searching' && <p className="lead">다나와 검색 중(다른 검색이 있으면 10초씩 기다려요)</p>}
      {search.state === 'busy' && <p className="lead">다나와 검색이 밀려 있어요. 잠시 뒤 다시 찾아 주세요</p>}
      {search.state === 'failed' && <p className="lead">다나와 검색 결과를 받지 못했어요</p>}
      {search.state === 'done' && (
        <>
          <p className="explore-src">다나와 검색 “{search.result.query}”, {whenText(search.result.foundAt)} 확인</p>
          {search.result.items.length === 0
            ? <p className="empty">찾은 상품이 없어요. 상품 이름을 바꿔 찾아 주세요</p>
            : (
              <div className="explore-list">
                {search.result.items.map((it) => <ResultRow key={it.pcode} item={it} onOpen={() => setOpen(it)} />)}
              </div>
            )}
        </>
      )}
      <OfferSheet item={open} onClose={() => setOpen(null)} />
    </section>
  )
}

/** 검색 결과 한 줄: 오른쪽은 1개(없으면 가장 적은 수량) 최저가, 아래 줄은 그 단위 가격·판매처 수, 다른 수량, 평점 */
function ResultRow({ item, onOpen }: { item: ExploreItem; onOpen: () => void }) {
  const img = imageOf(item.imageUrl)
  const main = item.variants.find((v) => v.qty === 1) ?? [...item.variants].sort((a, b) => a.qty - b.qty)[0]
  const meta = [
    ...(main ? [] : ['가격 표시 없음']),
    ...(main?.unitPrice != null && main.unitLabel ? [`${main.unitLabel}당 ${won(main.unitPrice)}`] : []),
    ...(main?.mallCount != null ? [`판매처 ${main.mallCount}곳`] : []),
    ...item.variants.filter((v) => v !== main).map((v) => `${v.qty}개 ${won(v.price)}`),
    ...(item.rating !== null ? [`평점 ${item.rating}${item.reviewCount !== null ? `(${item.reviewCount.toLocaleString('ko-KR')})` : ''}`] : []),
  ]
  return (
    <button className={`tx${img ? ' has-lead' : ''}`} onClick={onOpen}>
      {img && <img className="tx-thumb" src={img} alt="" loading="lazy" />}
      <span>
        <span className="tx-title explore-name">{item.name}</span>
        <span className="tx-meta num">{meta.join(' · ')}</span>
      </span>
      <span className="tx-amt num">{main ? `${main.qty === 1 ? '' : `${main.qty}개 `}${won(main.price)}` : ''}</span>
    </button>
  )
}

function OfferSheet({ item, onClose }: { item: ExploreItem | null; onClose: () => void }) {
  const [data, setData] = useState<ProductPrices | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')

  useEffect(() => {
    if (!item) return
    let alive = true
    setData(null)
    setState('loading')
    productPrices(sb(), item.pcode)
      .then((d) => { if (alive) { setData(d); setState('ready') } })
      .catch(() => { if (alive) setState('failed') })
    return () => { alive = false }
  }, [item])

  const offers = data ? sortOffers(data.offers) : []
  return (
    <Sheet open={item !== null} title={item?.name ?? '상품 가격'} onClose={onClose}>
      {state === 'loading' && <p className="lead">다나와 상품 페이지 확인 중</p>}
      {state === 'failed' && <p className="lead">다나와 상품 페이지를 읽지 못했어요</p>}
      {state === 'ready' && data && (
        <div className="explore-offers">
          {data.product.rating !== null && (
            <p className="tx-meta num">평점 {data.product.rating}{data.product.reviewCount !== null ? ` · 후기 ${data.product.reviewCount.toLocaleString('ko-KR')}` : ''} (다나와)</p>
          )}
          <h3 className="explore-sub">쇼핑몰별 최저가{data.pageQty !== null && data.pageQty > 1 ? ` (${data.pageQty}개 묶음 기준)` : ''}</h3>
          {offers.length === 0
            ? <p className="empty">쇼핑몰별 가격을 읽지 못했어요</p>
            : (
              <table className="offer-table num">
                <thead><tr><th>판매처</th><th>상품가</th><th>배송비</th><th>합계</th></tr></thead>
                <tbody>
                  {offers.map((o, i) => {
                    const total = offerTotal(o)
                    return (
                      <tr key={`${o.seller}-${i}`}>
                        <td>{o.seller}</td>
                        <td>{won(o.price)}</td>
                        <td>{o.delivery === null ? '표시 없음' : o.delivery === 0 ? '무료' : won(o.delivery)}</td>
                        <td>{total === null ? '-' : won(total)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          {data.variants.length > 0 && (
            <>
              <h3 className="explore-sub">수량별 최저가</h3>
              <ul className="explore-variants">
                {data.variants.map((v) => <li key={v.qty} className="num">{variantText(v)}</li>)}
              </ul>
            </>
          )}
          <p className="explore-src">
            다나와 상품 페이지, {whenText(data.checkedAt)} 확인. 배송비 “표시 없음”은 무료가 아니라 페이지에 적혀 있지 않은 것이에요.
          </p>
          <a className="link-btn" href={`https://prod.danawa.com/info/?pcode=${encodeURIComponent(data.product.pcode)}`} target="_blank" rel="noopener noreferrer">다나와에서 보기</a>
        </div>
      )}
    </Sheet>
  )
}
