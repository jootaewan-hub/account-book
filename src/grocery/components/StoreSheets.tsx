// 참가격 상품 고르기·자주 가는 매장 고르기 시트(P3). 품목 상세 위에 겹쳐 열린다(Escape·Tab은 맨 위 시트만 받는다, lib/dialog.ts).
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useClosing, useFocusTrap, useScrollLock } from '../../lib/dialog'
import { filterGoods, storeTypeName, type StoreGood, type StoreOption } from '../lib/sources'
import { koFullDay } from '../lib/alerts'
import { SOURCE_NAME, type IngredientRow, type IngredientSource, type NutritionRow } from '../lib/foodInfo'
import type { ListStore } from '../lib/store'

const CLOSE_MS = 250

function Frame({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const sheet = useRef<HTMLDivElement>(null)
  const closeBtn = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const { closing, close } = useClosing(onClose, CLOSE_MS)
  useScrollLock(true)
  useFocusTrap(sheet, !closing, { onEscape: close, initialFocus: closeBtn })
  return (
    <div className={`sheet-layer sheet-nested${closing ? ' is-closing' : ''}`}>
      <div className="sheet-backdrop" onClick={close} aria-hidden="true" />
      <div className="sheet" ref={sheet} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId}>
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

type IngredientsProps = { store: ListStore; itemId: string; itemName: string; productName: string | null; current: string | null; onDone: () => Promise<void>; onClose: () => void }
type IngredientsState = 'loading' | 'failed' | { term: string | null; candidates: IngredientRow[]; failed: { source: IngredientSource; reason: string }[] }

/** 식약처 품목제조보고 고르기(D-020): 고른 상품명(구절, 구체적인 것부터) 또는 품목 이름으로 식품(C002)·축산물(I1310)·건강기능식품(C003) 목록을 찾아 사람이 고른다.
 *  이름·업체·식품유형·소비기한·변경일을 보고 판단한다. 검색어를 바꿔 다시 찾을 수 있다 */
export function IngredientsPickerSheet({ store, itemId, itemName, productName, current, onDone, onClose }: IngredientsProps) {
  const [query, setQuery] = useState(productName ?? itemName)
  const [state, setState] = useState<IngredientsState>('loading')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const search = (q?: string) => {
    setState('loading')
    store.searchIngredients(itemId, q).then(setState, () => setState('failed'))
  }
  useEffect(() => {
    search()
    // 열릴 때는 검색어 없이 한 번 찾는다(서버가 상품명 구절 → 품목 이름 순으로 찾는다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, itemId])
  const pick = (c: IngredientRow) => {
    if (busy) return
    setBusy(true)
    setMsg(null)
    store.chooseIngredients(itemId, c.source, c.reportNo).then(
      () => onDone().then(onClose, onClose),
      () => {
        setBusy(false)
        setMsg('저장하지 못했어요. 잠시 뒤 다시 해 주세요.')
      },
    )
  }
  return (
    <Frame title="식약처 품목 고르기" onClose={onClose}>
      <p className="detail-none">
        {productName ? `고른 상품 "${productName}"과` : `"${itemName}"과`} 같은 품목을 식약처 품목제조보고(식품·축산물·건강기능식품)에서 골라 주세요. 이름·업체·용량을 포장과 견줘 보세요.
      </p>
      <form
        className="cand-search"
        onSubmit={(e) => {
          e.preventDefault()
          const q = query.replace(/\s+/g, ' ').trim()
          if (q) search(q)
        }}
      >
        <input className="cand-input" aria-label="식약처 품목 찾을 이름" value={query} maxLength={60} onChange={(e) => setQuery(e.target.value)} />
        <button type="submit" className="btn-secondary" disabled={state === 'loading'}>다시 찾기</button>
      </form>
      {state === 'loading' && <p className="cand-state" role="status">식약처 품목제조보고 찾는 중</p>}
      {state === 'failed' && <p className="cand-state" role="status">식약처 품목을 찾지 못했어요. 잠시 뒤 다시 해 주세요.</p>}
      {msg && <p className="cand-state" role="alert">{msg}</p>}
      {typeof state === 'object' && state.failed.length > 0 && (
        <p className="cand-state">{state.failed.map((f) => `${SOURCE_NAME[f.source]} 목록(${f.source})은 확인 못 함(${f.reason})`).join(', ')}</p>
      )}
      {typeof state === 'object' && state.candidates.length === 0 && (
        <p className="cand-state">{state.term ? `"${state.term}"으로 찾은 식약처 품목이 없어요. 이름을 바꿔 다시 찾아 보세요.` : '찾을 말이 없어요.'}</p>
      )}
      {typeof state === 'object' && state.candidates.length > 0 && (
        <>
          <p className="src-line">"{state.term}"으로 찾음, {state.candidates.length}건(식품안전나라 품목제조보고)</p>
          <ul className="pick-list">
            {state.candidates.map((c) => (
              <li key={`${c.source}-${c.reportNo}`}>
                <button type="button" className="pick-row" aria-pressed={c.reportNo === current} disabled={busy} onClick={() => pick(c)}>
                  <span className="pick-name">{c.name}</span>
                  <span className="pick-meta">
                    {[SOURCE_NAME[c.source], c.maker, c.kind, c.shelfLife ? `소비기한 ${c.shelfLife}` : null, c.changedOn ? `${koFullDay(c.changedOn)} 변경` : null, `보고번호 ${c.reportNo}`].filter(Boolean).join(', ')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Frame>
  )
}

type NutritionProps = { store: ListStore; itemId: string; itemName: string; current: string | null; onDone: () => Promise<void>; onClose: () => void }

/** 영양성분 식품 고르기(P9, D-018): 품목 이름으로 식품영양성분DB를 찾아 사람이 고른다. 신선 품목도 된다. 숫자는 응답 값 그대로 */
export function NutritionPickerSheet({ store, itemId, itemName, current, onDone, onClose }: NutritionProps) {
  const [query, setQuery] = useState(itemName)
  const [state, setState] = useState<'loading' | 'failed' | { term: string | null; candidates: NutritionRow[] }>('loading')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const search = (q?: string) => {
    setState('loading')
    store.searchNutrition(itemId, q).then(setState, () => setState('failed'))
  }
  useEffect(() => {
    search()
    // 열릴 때 품목 이름으로 한 번 찾는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, itemId])
  const pick = (c: NutritionRow) => {
    if (busy || !c.foodCd || typeof state !== 'object') return
    setBusy(true)
    setMsg(null)
    store.chooseNutrition(itemId, state.term ?? query, c.foodCd).then(
      () => onDone().then(onClose, onClose),
      () => {
        setBusy(false)
        setMsg('저장하지 못했어요. 잠시 뒤 다시 해 주세요.')
      },
    )
  }
  return (
    <Frame title="영양성분 식품 고르기" onClose={onClose}>
      <p className="detail-none">식품영양성분DB에서 "{itemName}"에 맞는 식품을 골라 주세요. 이름·제조사·기준량을 보고 판단하세요.</p>
      <form
        className="cand-search"
        onSubmit={(e) => {
          e.preventDefault()
          const q = query.replace(/\s+/g, ' ').trim()
          if (q) search(q)
        }}
      >
        <input className="cand-input" aria-label="영양성분 찾을 이름" value={query} maxLength={60} onChange={(e) => setQuery(e.target.value)} />
        <button type="submit" className="btn-secondary" disabled={state === 'loading'}>다시 찾기</button>
      </form>
      {state === 'loading' && <p className="cand-state" role="status">식품영양성분DB 찾는 중</p>}
      {state === 'failed' && <p className="cand-state" role="status">식품을 찾지 못했어요. 잠시 뒤 다시 해 주세요.</p>}
      {msg && <p className="cand-state" role="alert">{msg}</p>}
      {typeof state === 'object' && state.candidates.length === 0 && <p className="cand-state">{state.term ? `"${state.term}"으로 찾은 식품이 없어요. 이름을 바꿔 다시 찾아 보세요.` : '찾을 말이 없어요.'}</p>}
      {typeof state === 'object' && state.candidates.length > 0 && (
        <>
          <p className="src-line">"{state.term}"으로 찾음, {state.candidates.length}건(식품영양성분DB)</p>
          <ul className="pick-list">
            {state.candidates.map((c, i) => (
              <li key={c.foodCd ?? `row-${i}`}>
                <button type="button" className="pick-row" aria-pressed={c.foodCd !== null && c.foodCd === current} disabled={busy || !c.foodCd} onClick={() => pick(c)}>
                  <span className="pick-name">{c.foodName ?? '이름 없음'}</span>
                  <span className="pick-meta">
                    {[c.maker, c.basis ? `기준 ${c.basis}` : null, c.kcal !== null ? `${c.kcal.toLocaleString('ko-KR')}kcal` : '열량 확인 못 함'].filter(Boolean).join(', ')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Frame>
  )
}
