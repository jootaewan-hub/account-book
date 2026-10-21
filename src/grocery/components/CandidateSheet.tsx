import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useClosing, useFocusTrap, useScrollLock } from '../../lib/dialog'
import { won } from '../lib/format'
import { checkedText, type Candidate } from '../lib/products'
import type { ListStore } from '../lib/store'
import type { Item } from '../lib/types'
import { READING_TEXT, type ProductRead } from '../lib/photo'
import { PhotoPick, ProductReadForm } from './PhotoCapture'
import { fitRule, splitCandidates } from '../../../supabase/functions/_shared/fit'

const CLOSE_MS = 250
// 묶음 구성(+, 세트, 구성, ×N)은 단품 아래에 둔다
const BUNDLE = /\+|세트|구성|\d\s*종/

type Props = {
  item: Item
  store: ListStore
  /** 상품을 고른 뒤(가격 확인은 부른 쪽이 이어서 한다) */
  onPicked: (productId: string, qty: number) => void
  onClose: () => void
}

// 처음 한 번 상품을 직접 고르는 시트. 후보는 다나와 검색 결과 그대로이고, 같은 상품도 수량마다 따로 고른다.
export default function CandidateSheet({ item, store, onPicked, onClose }: Props) {
  const [list, setList] = useState<Candidate[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState(item.spec ? `${item.name} ${item.spec}` : item.name)
  // 사진으로 찾기(P4): 읽는 중 → 읽은 값(고친 뒤 검색)
  const [photo, setPhoto] = useState<'idle' | 'reading' | ProductRead>('idle')
  const [photoMsg, setPhotoMsg] = useState<string | null>(null)
  // 큰 용량·묶음(D-014)은 기본으로 숨기고 버튼으로 본다
  const [showBulk, setShowBulk] = useState(false)
  const sheet = useRef<HTMLDivElement>(null)
  const closeBtn = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const { closing, close } = useClosing(onClose, CLOSE_MS)
  useScrollLock(true)
  useFocusTrap(sheet, !closing, { onEscape: close, initialFocus: closeBtn })

  const load = useCallback(() => {
    setFailed(false)
    setShowBulk(false)
    store.candidates(item.id).then(setList, () => setFailed(true))
  }, [store, item.id])

  useEffect(load, [load])

  const runSearch = (q: string) => {
    if (!q || searching) return
    setSearching(true)
    store.findCandidates(item.id, q).then(
      () => {
        setSearching(false)
        load()
      },
      () => {
        setSearching(false)
        setFailed(true)
      },
    )
  }
  const research = (e: FormEvent) => {
    e.preventDefault()
    runSearch(query.replace(/\s+/g, ' ').trim())
  }
  const readPhoto = (img: { media_type: 'image/jpeg'; data: string; width: number; height: number }) => {
    setPhoto('reading')
    setPhotoMsg(null)
    store.readPhoto('product', { media_type: img.media_type, data: img.data, width: img.width, height: img.height }).then(
      (r) => setPhoto(r.job === 'product' ? r.product : 'idle'),
      (e: unknown) => {
        setPhoto('idle')
        setPhotoMsg(e instanceof Error && e.message ? e.message : '사진을 읽지 못했어요. 이름을 직접 적어 주세요.')
      },
    )
  }

  // 2~3인 가구 기준(D-015): 품목의 완전 대용량 선을 넘는 한 봉지는 따로 두고, 맞는 후보는 수량 줄도 담은 양의 2배까지만
  const rule = fitRule(item.name, item.spec, item.count)
  const { fit, bulk } = splitCandidates(list ?? [], rule)
  const sorted = fit.slice().sort((a, b) => Number(BUNDLE.test(a.name)) - Number(BUNDLE.test(b.name)))
  const foundAt = (list ?? [])[0]?.foundAt

  const card = (c: Candidate) => (
    <li key={c.productId} className="cand-card">
      <div className="cand-head">
        {c.imageUrl ? <img className="cand-img" src={c.imageUrl} alt="" loading="lazy" /> : <div className="cand-img" aria-hidden="true" />}
        <div className="cand-title">
          <p className="cand-name">{c.name}</p>
          {c.rating !== null && <p className="cand-rating num">평점 {c.rating.toFixed(1)}(다나와)</p>}
        </div>
      </div>
      <div className="cand-variants">
        {c.variants.map((v) => (
          <button
            key={v.qty}
            type="button"
            className="cand-variant"
            aria-label={`${c.name} ${v.qty}개 ${won(v.price)} 고르기`}
            onClick={() => onPicked(c.productId, v.qty)}
          >
            <span className="cand-qty num">{v.qty}개</span>
            <span className="cand-price num">{won(v.price)}</span>
            <span className="cand-unit num">
              {v.unitPrice !== null && v.unitLabel ? `${v.unitLabel}당 ${won(v.unitPrice)}` : '단위가격 확인 못 함'}
              {v.mallCount !== null ? `, 판매처 ${v.mallCount}곳` : ''}
            </span>
          </button>
        ))}
      </div>
    </li>
  )

  return (
    <div className={`sheet-layer${closing ? ' is-closing' : ''}`}>
      <div className="sheet-backdrop" onClick={close} aria-hidden="true" />
      <div className="sheet" ref={sheet} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="sheet-head">
          <h2 id={titleId}>{item.name} — 어떤 상품인가요?</h2>
          <button type="button" className="btn-text" ref={closeBtn} onClick={close}>닫기</button>
        </div>
        <div className="sheet-body">
          <form className="cand-search" onSubmit={research}>
            <input
              className="cand-input"
              aria-label="다시 검색할 상품 이름"
              value={query}
              maxLength={60}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button type="submit" className="btn-secondary" disabled={searching}>다시 검색</button>
          </form>
          <div className="photo-row">
            <PhotoPick label="사진으로 찾기" inputLabel="포장 사진" disabled={photo === 'reading' || searching} onImage={readPhoto} className="btn-secondary detail-link" />
            <span className="src-line">포장 앞면을 찍으면 이름을 읽어 검색어로 써요.</span>
          </div>
          {photo === 'reading' && <p className="cand-state" role="status">{READING_TEXT}</p>}
          {photoMsg && <p className="cand-state" role="alert">{photoMsg}</p>}
          {typeof photo === 'object' && (
            <ProductReadForm
              read={photo}
              onSearch={(q) => {
                setQuery(q)
                setPhoto('idle')
                runSearch(q)
              }}
              onCancel={() => setPhoto('idle')}
            />
          )}
          {foundAt && !searching && <p className="cand-source">다나와, {checkedText(foundAt)} 확인</p>}
          {searching && <p className="cand-state" role="status">후보 찾는 중</p>}
          {!searching && list === null && !failed && <p className="cand-state" role="status">후보 불러오는 중</p>}
          {!searching && failed && <p className="cand-state" role="status">후보를 불러오지 못했어요. 잠시 뒤 다시 해 주세요.</p>}
          {!searching && list !== null && list.length === 0 && !failed && <p className="cand-state">후보를 찾지 못했어요. 이름을 바꿔 다시 검색해 보세요.</p>}
          {!searching && list !== null && list.length > 0 && fit.length === 0 && (
            <p className="cand-state">2~3인 가구에 맞는 크기의 후보가 없어요. 큰 용량·묶음을 보거나 이름을 바꿔 다시 검색해 보세요.</p>
          )}
          {!searching && sorted.length > 0 && <ul className="cand-list">{sorted.map(card)}</ul>}
          {!searching && bulk.length > 0 && (
            <p className="cand-state cand-bulk">
              {fit.length > 0 && <span>2~3인 가구에 맞는 크기만 보여요.</span>}
              <button type="button" className="btn-text" onClick={() => setShowBulk((v) => !v)}>
                {showBulk ? '큰 용량·묶음 숨기기' : `큰 용량·묶음 ${bulk.length}개 보기`}
              </button>
            </p>
          )}
          {!searching && showBulk && bulk.length > 0 && <ul className="cand-list">{bulk.map(card)}</ul>}
        </div>
      </div>
    </div>
  )
}
