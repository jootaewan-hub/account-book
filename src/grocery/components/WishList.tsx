import { useCallback, useEffect, useRef, useState } from 'react'
import { friendlyError } from '../../lib/api'
import { whenText, won } from '../../lib/explore'
import { makeLookup } from '../../lib/lookup'
import type { Member } from '../../lib/types'
import type { Wish, WishStore } from '../../lib/wishes'

export function WishList({ store, members, version, onNew, onEdit, onSearch }: {
  store: WishStore; members: Member[]; version: number
  onNew: () => void; onEdit: (wish: Wish) => void; onSearch: (name: string) => void
}) {
  const [rows, setRows] = useState<Wish[] | null>(null)
  const [error, setError] = useState('')
  const [bought, setBought] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const seq = useRef(0)
  const lookup = makeLookup('', members, [], [])
  const reload = useCallback(async () => {
    const n = ++seq.current
    try { const all = await store.list(); if (n === seq.current) { setRows(all); setError('') } }
    catch (e) { if (n === seq.current) setError(friendlyError(e)) }
  }, [store])
  // eslint-disable-next-line react/exhaustive-effect-dependencies -- 편집창에서 저장한 뒤 실시간 알림을 기다리지 않고 다시 읽는다
  useEffect(() => { void reload() }, [reload, version])
  useEffect(() => {
    const off = store.subscribe(() => void reload())
    const visible = () => { if (document.visibilityState === 'visible') void reload() }
    document.addEventListener('visibilitychange', visible)
    return () => { seq.current++; off(); document.removeEventListener('visibilitychange', visible) }
  }, [store, reload])

  async function toggle(wish: Wish) {
    if (busy) return
    setBusy(wish.id)
    try { await store.setBought(wish.id, !wish.bought_at); await reload() }
    catch (e) { setError(friendlyError(e)) }
    finally { setBusy(null) }
  }

  const shown = rows?.filter((wish) => Boolean(wish.bought_at) === bought) ?? []
  return (
    <section className="wish-page" aria-label="함께 살 물건 보관함">
      <div className="wish-head"><div><h2>함께 살 물건</h2><p className="wish-hint">둘이 골라 두고, 사고 싶을 때 다시 살펴봐요.</p></div>
        <button className="btn-primary" onClick={onNew}>물건 보관</button></div>
      <div className="seg" role="group" aria-label="보관 상태">
        <button aria-pressed={!bought} onClick={() => setBought(false)}>보관 중{rows ? ` ${rows.filter((r) => !r.bought_at).length}` : ''}</button>
        <button aria-pressed={bought} onClick={() => setBought(true)}>산 물건{rows ? ` ${rows.filter((r) => r.bought_at).length}` : ''}</button>
      </div>
      {error && <div className="wish-error" role="alert"><p>{error}</p><button className="btn-text" onClick={() => void reload()}>다시 불러오기</button></div>}
      {rows === null && !error && <>
        <div className="skeleton" aria-hidden="true"><div className="sk sk-wish" /><div className="sk sk-wish" /></div>
        <p className="sr-only" role="status">보관한 물건 불러오는 중</p>
      </>}
      {rows !== null && shown.length === 0 && <p className="wish-empty">{bought ? '아직 산 물건이 없어요.' : '고민 중인 물건을 보관해 보세요. 알아보기의 검색 결과에서도 바로 보관할 수 있어요.'}</p>}
      <ul className={`wish-list${rows !== null ? ' fade-in' : ''}`}>
        {shown.map((wish) => <li key={wish.id} className="wish-card">
          <button className="wish-title" onClick={() => onEdit(wish)}>{wish.title}</button>
          {wish.target_price !== null && <p className="wish-target num">목표 {won(wish.target_price)} <span>직접 정한 금액</span></p>}
          {wish.quote && <div className="wish-price"><p className="num">보관 당시 {won(wish.quote.price)}</p>
            <p>{wish.quote.source}, {whenText(wish.quote.checkedAt)} 확인</p><p>{wish.quote.note.replaceAll(' · ', ', ')}</p></div>}
          {wish.memo && <p className="wish-memo">{wish.memo}</p>}
          <p className="wish-by">{lookup.personLabel(wish.created_by)} 보관{wish.bought_at ? `, ${whenText(wish.bought_at)} 구입 표시` : ''}</p>
          <div className="wish-actions">
            {wish.url && <a className="btn-text" href={wish.url} target="_blank" rel="noopener noreferrer">상품 보기</a>}
            <button className="btn-text" onClick={() => onSearch(wish.title)}>가격 다시 찾기</button>
            <button className="btn-secondary" disabled={busy !== null} onClick={() => void toggle(wish)}>{busy === wish.id ? '저장 중' : wish.bought_at ? '다시 보관' : '샀어요'}</button>
          </div>
        </li>)}
      </ul>
      {bought && <p className="wish-hint">구입 표시는 가계부 지출을 만들지 않아요. 영수증이나 기록하기로 넣어 주세요.</p>}
    </section>
  )
}
