// 품목 상세 가격 탭의 두 묶음(P3, D-013): "주소를 넣은 곳"(컬리·홈플러스·쿠팡→로우차트 페이지 값)과 "매장 가격(참가격)".
// 숫자마다 출처와 확인 시각·조사일을 붙인다. 넣은 주소의 값은 가장 싼 값에 넣지 않는다(D-013 ⑤).
import { useState, type FormEvent } from 'react'
import { parseShopUrl, SHOP_LABEL } from '../../../supabase/functions/_shared/shops'
import { won } from '../lib/format'
import {
  candidateSourceText,
  findStateText,
  NOTE_NOT_BEST,
  observedText,
  shopPriceText,
  shopSourceText,
  shopStateText,
  storeRowText,
  storeSourceText,
  storeTypeName,
  urlRejectText,
  type ShopFind,
  type ShopLink,
  type ShopPrice,
  type ShopSource,
  type StoreSection,
} from '../lib/sources'

type ShopProps = {
  shops: ShopPrice[]
  /** 몰 주소 자동 찾기 결과(D-024). 찾은 적 없으면 null */
  find: ShopFind | null
  busy: boolean
  onAdd: (link: ShopLink) => Promise<void>
  onRemove: (source: ShopSource) => Promise<void>
}

export function ShopLinks({ shops, find, busy, onAdd, onRemove }: ShopProps) {
  // 자동으로 넣은 주소(줄에 "자동으로 찾음" 표시)와, 아직 넣지 않은 출처의 후보(사람이 고른다)
  const auto = new Set((find?.candidates ?? []).filter((c) => c.saved).map((c) => `${c.source}|${c.sourceId}`))
  const linked = new Set(shops.map((s) => s.source))
  const picks = (find?.status === 'done' ? find.candidates : []).filter((c) => !c.saved && !linked.has(c.source))
  const state = findStateText(find, shops.length)
  const [pickMsg, setPickMsg] = useState<string | null>(null)
  const pick = async (link: ShopLink) => {
    setPickMsg(null)
    try {
      await onAdd(link)
    } catch {
      setPickMsg('주소를 저장하지 못했어요. 잠시 뒤 다시 해 주세요.')
    }
  }
  const [text, setText] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const r = parseShopUrl(text)
    if (!r.ok) {
      setMsg(urlRejectText(r.reason))
      return
    }
    setMsg(null)
    try {
      await onAdd(r.link)
      setText('')
    } catch {
      setMsg('주소를 저장하지 못했어요. 잠시 뒤 다시 해 주세요.')
    }
  }
  return (
    <div className="detail-block">
      <p className="detail-sub">주소를 넣은 곳</p>
      {shops.length === 0 && !find && <p className="detail-none">컬리·홈플러스·쿠팡 상품 페이지 주소를 넣으면 그 페이지의 가격을 하루 한 번 읽어 와요.</p>}
      {state && <p className="cand-state" role="status">{state}</p>}
      {shops.length > 0 && (
        <ul className="price-list">
          {shops.map((s) => {
            const state = shopStateText(s)
            const obs = observedText(s)
            return (
              <li key={s.source} className="price-row shop-row">
                <div>
                  <p className="price-where">
                    <span className="tag">{SHOP_LABEL[s.source]}</span>
                    <span>{s.name ?? '상품 이름 확인 못 함'}</span>
                    {auto.has(`${s.source}|${s.sourceId}`) && <span className="tag tag-auto">자동으로 찾음</span>}
                  </p>
                  {state && <p className="src-line shop-state">{state}</p>}
                  <p className="src-line">{shopSourceText(s)}{s.size ? `, ${s.size}` : ''}</p>
                  {obs && <p className="src-line">{obs}</p>}
                  <p className="shop-actions">
                    <a className="btn-text" href={s.url} target="_blank" rel="noopener noreferrer">페이지 열기</a>
                    <button type="button" className="btn-text" disabled={busy} onClick={() => void onRemove(s.source)}>빼기</button>
                  </p>
                </div>
                <p className="price-v num">{shopPriceText(s)}</p>
              </li>
            )
          })}
        </ul>
      )}
      {picks.length > 0 && (
        <>
          <p className="detail-sub find-sub">같은 상품인지 확인해 주세요</p>
          <ul className="price-list">
            {picks.map((c) => (
              <li key={`${c.source}|${c.sourceId}`} className="price-row shop-row find-row">
                <div>
                  <p className="price-where">
                    <span className="tag">{SHOP_LABEL[c.source]}</span>
                    <span>{c.name}</span>
                  </p>
                  <p className="src-line">{candidateSourceText(c)}{c.size ? `, ${c.size}` : ''}</p>
                  <p className="shop-actions">
                    <button type="button" className="btn-secondary" disabled={busy} onClick={() => void pick({ source: c.source, sourceId: c.sourceId, url: c.url })}>이 상품이에요</button>
                    <a className="btn-text" href={c.url} target="_blank" rel="noopener noreferrer">페이지 열기</a>
                  </p>
                </div>
                <p className="price-v num">{won(c.price)}</p>
              </li>
            ))}
          </ul>
          {pickMsg && <p className="cand-state" role="alert">{pickMsg}</p>}
        </>
      )}
      <form className="cand-search" onSubmit={submit}>
        <input
          className="cand-input"
          aria-label="상품 페이지 주소"
          placeholder="https://www.kurly.com/goods/…"
          inputMode="url"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="btn-secondary" disabled={busy || !text.trim()}>주소 넣기</button>
      </form>
      {msg && <p className="cand-state" role="alert">{msg}</p>}
      <p className="shop-note">{NOTE_NOT_BEST}</p>
    </div>
  )
}

type StoreProps = {
  store: StoreSection
  busy: boolean
  onPickGood: () => void
  onUnlink: () => Promise<void>
  onPickStores: () => void
}

export function StorePrices({ store, busy, onPickGood, onUnlink, onPickStores }: StoreProps) {
  return (
    <div className="detail-block">
      <p className="detail-sub">매장 가격(참가격)</p>
      {!store.good ? (
        <>
          <p className="detail-none">한국소비자원 참가격의 조사 상품을 고르면 성남 판매점의 격주 조사 가격을 보여 드려요.</p>
          <button type="button" className="btn-secondary detail-link" disabled={busy} onClick={onPickGood}>참가격 상품 고르기</button>
        </>
      ) : (
        <>
          <p className="store-good">
            <span>{store.good.name}</span>
            <button type="button" className="btn-text" disabled={busy} onClick={onPickGood}>바꾸기</button>
            <button type="button" className="btn-text" disabled={busy} onClick={() => void onUnlink()}>연결 풀기</button>
          </p>
          {store.prices.length === 0 && <p className="detail-none">아직 받은 참가격 조사값이 없어요(매일 07:20에 받아요).</p>}
          {store.prices.length > 0 && (
            <ul className="price-list">
              {store.prices.map((p) => (
                <li key={p.entpId} className="price-row">
                  <div>
                    <p className="price-where">
                      <span>{p.entpName}</span>
                      <span className="tag">{storeTypeName(p.typeCode)}</span>
                    </p>
                    <p className="src-line">{storeSourceText(p)}</p>
                  </div>
                  <p className="price-v num">{storeRowText(p)}</p>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="btn-text" disabled={busy} onClick={onPickStores}>매장 고르기</button>
        </>
      )}
    </div>
  )
}
