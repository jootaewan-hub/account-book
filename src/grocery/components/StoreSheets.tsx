// 참가격 상품 고르기·자주 가는 매장 고르기 시트(P3). 품목 상세 위에 겹쳐 열린다(Escape·Tab은 이 시트가 처리하고 상세는 쉰다).
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { filterGoods, storeTypeName, type StoreGood, type StoreOption } from '../lib/sources'
import { koFullDay } from '../lib/alerts'
import type { C002Row } from '../lib/foodInfo'
import type { ListStore } from '../lib/store'

const CLOSE_MS = 250

function Frame({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const [closing, setClosing] = useState(false)
  const sheet = useRef<HTMLDivElement>(null)
  const closeBtn = useRef<HTMLButtonElement>(null)
  const closeTimer = useRef<number | undefined>(undefined)
  const titleId = useId()
  const close = () => {
    if (closing) return
    setClosing(true)
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    closeTimer.current = window.setTimeout(onClose, reduce ? 0 : CLOSE_MS)
  }
  useEffect(() => {
    closeBtn.current?.focus({ preventScroll: true })
    return () => window.clearTimeout(closeTimer.current)
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.isComposing) close()
      if (e.key === 'Tab' && sheet.current) {
        const f = [...sheet.current.querySelectorAll<HTMLElement>('button:not([disabled]), input')]
        if (f.length === 0) return
        const i = f.indexOf(document.activeElement as HTMLElement)
        const next = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : i === f.length - 1 ? 0 : i + 1
        e.preventDefault()
        f[next].focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  return (
    <div className={`sheet-layer sheet-nested${closing ? ' is-closing' : ''}`}>
      <div className="sheet-backdrop" onClick={close} aria-hidden="true" />
      <div className="sheet" ref={sheet} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="sheet-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="btn-text" ref={closeBtn} onClick={close}>닫기</button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  )
}

type GoodProps = {
  store: ListStore
  itemName: string
  current: string | null
  onPick: (goodId: string) => Promise<void>
  onClose: () => void
}

/** 참가격 조사 상품(약 600개) 중에서 이 품목에 맞는 것을 고른다. 이름으로 거른다. */
export function GoodPickerSheet({ store, itemName, current, onPick, onClose }: GoodProps) {
  const [goods, setGoods] = useState<StoreGood[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState(itemName)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    store.storeGoods().then(setGoods, () => setFailed(true))
  }, [store])
  const list = goods ? filterGoods(goods, query) : []
  const pick = (id: string) => {
    if (busy) return
    setBusy(true)
    onPick(id).then(onClose, () => {
      setBusy(false)
      setFailed(true)
    })
  }
  return (
    <Frame title={`${itemName} — 참가격 조사 상품`} onClose={onClose}>
      <div className="cand-search">
        <input className="cand-input" aria-label="참가격 상품 이름으로 찾기" value={query} maxLength={60} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {failed && <p className="cand-state" role="status">참가격 상품을 불러오지 못했어요. 잠시 뒤 다시 해 주세요.</p>}
      {!failed && goods === null && <p className="cand-state" role="status">참가격 상품 불러오는 중</p>}
      {goods !== null && goods.length === 0 && <p className="cand-state">아직 받은 참가격 상품 목록이 없어요(매일 07:20에 받아요).</p>}
      {goods !== null && goods.length > 0 && list.length === 0 && <p className="cand-state">맞는 상품이 없어요. 다른 말로 찾아보세요.</p>}
      {list.length > 0 && (
        <ul className="pick-list">
          {list.map((g) => (
            <li key={g.goodId}>
              <button type="button" className="pick-row" aria-pressed={g.goodId === current} disabled={busy} onClick={() => pick(g.goodId)}>
                <span className="pick-name">{g.name}</span>
                {g.detail && <span className="pick-meta">{g.detail}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="shop-note">한국소비자원 참가격(공공데이터포털)의 조사 상품 목록이에요. 용량·구성이 다르면 가격도 달라요.</p>
    </Frame>
  )
}

type StoresProps = { store: ListStore; onSaved: () => Promise<void>; onClose: () => void }

/** 자주 가는 매장(성남 참가격 조사 판매점 중 10곳까지). 고르지 않으면 성남 판매점 전부를 본다. */
export function StorePickerSheet({ store, onSaved, onClose }: StoresProps) {
  const [options, setOptions] = useState<StoreOption[] | null>(null)
  const [chosen, setChosen] = useState<string[]>([])
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    store.storeOptions().then(
      (o) => {
        setOptions(o.stores)
        setChosen(o.chosen)
      },
      () => setFailed(true),
    )
  }, [store])
  const toggle = (id: string, on: boolean) => setChosen((c) => (on ? [...c.filter((x) => x !== id), id] : c.filter((x) => x !== id)))
  const save = () => {
    if (busy) return
    setBusy(true)
    store.setStores(chosen).then(
      () => onSaved().then(onClose, onClose),
      () => {
        setBusy(false)
        setFailed(true)
      },
    )
  }
  const full = chosen.length >= 10
  return (
    <Frame title="자주 가는 매장" onClose={onClose}>
      <p className="detail-none">고른 매장의 참가격 조사값만 보여요. 아무것도 고르지 않으면 성남 판매점 전부를 봐요(10곳까지).</p>
      {failed && <p className="cand-state" role="status">매장 목록을 불러오거나 저장하지 못했어요. 잠시 뒤 다시 해 주세요.</p>}
      {!failed && options === null && <p className="cand-state" role="status">매장 목록 불러오는 중</p>}
      {options !== null && options.length === 0 && <p className="cand-state">아직 받은 판매점 목록이 없어요(매일 07:20에 받아요).</p>}
      {options !== null && options.length > 0 && (
        <ul className="pick-list">
          {options.map((o) => {
            const on = chosen.includes(o.entpId)
            return (
              <li key={o.entpId}>
                <label className="pick-check">
                  <input type="checkbox" checked={on} disabled={busy || (!on && full)} onChange={(e) => toggle(o.entpId, e.target.checked)} />
                  <span className="pick-name">{o.name}</span>
                  <span className="tag">{storeTypeName(o.typeCode)}</span>
                </label>
              </li>
            )
          })}
        </ul>
      )}
      {options !== null && options.length > 0 && (
        <div className="sheet-foot">
          <button type="button" className="btn-primary btn-big" disabled={busy} onClick={save}>
            {chosen.length === 0 ? '성남 판매점 전부 보기' : `매장 ${chosen.length}곳만 보기`}
          </button>
        </div>
      )}
    </Frame>
  )
}

type FoodProps = { store: ListStore; itemId: string; productName: string; current: string | null; onDone: () => Promise<void>; onClose: () => void }

/** 식약처 품목(C002) 고르기(P7): 상품명으로 찾은 후보 중 같은 품목을 사람이 고른다. 이름·업체·식품유형·변경일을 보고 판단한다 */
export function FoodPickerSheet({ store, itemId, productName, current, onDone, onClose }: FoodProps) {
  const [state, setState] = useState<'loading' | 'failed' | { term: string | null; candidates: C002Row[] }>('loading')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => {
    store.searchFoodInfo(itemId).then(setState, () => setState('failed'))
  }, [store, itemId])
  const pick = (reportNo: string) => {
    if (busy) return
    setBusy(true)
    setMsg(null)
    store.chooseFoodInfo(itemId, reportNo).then(
      () => onDone().then(onClose, onClose),
      () => {
        setBusy(false)
        setMsg('저장하지 못했어요. 잠시 뒤 다시 해 주세요.')
      },
    )
  }
  return (
    <Frame title="식약처 품목 고르기" onClose={onClose}>
      <p className="detail-none">고른 상품 "{productName}"과 같은 품목을 식약처 품목제조보고에서 골라 주세요. 이름·업체·용량을 포장과 견줘 보세요.</p>
      {state === 'loading' && <p className="cand-state" role="status">식약처 품목 찾는 중</p>}
      {state === 'failed' && <p className="cand-state" role="status">식약처 품목을 찾지 못했어요. 잠시 뒤 다시 해 주세요.</p>}
      {msg && <p className="cand-state" role="alert">{msg}</p>}
      {typeof state === 'object' && state.candidates.length === 0 && <p className="cand-state">{state.term ? `"${state.term}"으로 찾은 식약처 품목이 없어요.` : '찾을 말이 없어요.'}</p>}
      {typeof state === 'object' && state.candidates.length > 0 && (
        <>
          <p className="src-line">"{state.term}"으로 찾음, {state.candidates.length}건(식품안전나라 C002)</p>
          <ul className="pick-list">
            {state.candidates.map((c) => (
              <li key={c.reportNo}>
                <button type="button" className="pick-row" aria-pressed={c.reportNo === current} disabled={busy} onClick={() => pick(c.reportNo)}>
                  <span className="pick-name">{c.name}</span>
                  <span className="pick-meta">{[c.maker, c.kind, c.changedOn ? `${koFullDay(c.changedOn)} 변경` : null, `보고번호 ${c.reportNo}`].filter(Boolean).join(', ')}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Frame>
  )
}
