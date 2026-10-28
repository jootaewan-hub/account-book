import { useCallback, useEffect, useId, useState, type FormEvent } from 'react'
import { friendlyError } from '../lib/api'
import { whenText, won } from '../lib/explore'
import { normalizeWish, wishUrl, type Wish, type WishStore, type WishTarget } from '../lib/wishes'
import { Sheet } from './Sheet'

/** 장보기와 알아보기에서 함께 쓰는 보관 편집창. 장보기 바깥의 공통 시트로 렌더한다. */
export function WishSheet({ target, store, onSaved, onClose }: {
  target: WishTarget; store: WishStore; onSaved: (message: string) => void; onClose: () => void
}) {
  const initial = 'wish' in target ? target.wish : target.seed
  const [existing, setExisting] = useState<Wish | null>('wish' in target ? target.wish : null)
  const [title, setTitle] = useState(initial.title)
  const [url, setUrl] = useState(initial.url ?? '')
  const [price, setPrice] = useState(initial.target_price?.toString() ?? '')
  const [memo, setMemo] = useState(initial.memo ?? '')
  const [quote, setQuote] = useState(initial.quote)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState('seed' in target && Boolean(target.seed.url))
  const [confirmDelete, setConfirmDelete] = useState(false)
  const id = useId()

  const loadExisting = useCallback((wish: Wish) => {
    setExisting(wish); setTitle(wish.title); setUrl(wish.url ?? ''); setPrice(wish.target_price?.toString() ?? '')
    setMemo(wish.memo ?? ''); setQuote(wish.quote); setNotice('이미 보관한 물건이에요. 기존 목표 가격과 메모를 이어서 고쳐요.')
  }, [])

  useEffect(() => {
    if ('wish' in target || !target.seed.url) return
    let alive = true
    store.byUrl(target.seed.url).then((wish) => { if (alive && wish) loadExisting(wish) })
      .catch((e) => { if (alive) setError(friendlyError(e)) })
      .finally(() => { if (alive) setChecking(false) })
    return () => { alive = false }
  }, [store, target, loadExisting])

  async function save(e: FormEvent) {
    e.preventDefault()
    if (busy || checking) return
    setError(''); setBusy(true)
    try {
      const input = normalizeWish({ title, url, target_price: price.trim() ? Number(price) : null, memo })
      if (!existing && input.url) {
        const found = await store.byUrl(input.url)
        if (found) { loadExisting(found); setBusy(false); return }
      }
      await store.save({ ...input, quote }, existing?.id)
      onSaved(existing ? '보관한 물건을 고쳤어요' : '함께 살 물건에 보관했어요')
    } catch (e) { setError(friendlyError(e)); setBusy(false) }
  }

  async function remove() {
    if (!existing || busy) return
    if (!confirmDelete) { setConfirmDelete(true); return }
    setBusy(true); setError('')
    try { await store.remove(existing.id); onSaved('보관함에서 지웠어요') }
    catch (e) { setError(friendlyError(e)); setBusy(false) }
  }

  function changeLink(value: string) {
    if (quote && wishUrl(value) !== wishUrl(url)) {
      setQuote(null)
      setNotice('상품 링크를 바꿔 이전 상품의 가격 기록은 뺐어요.')
    }
    setUrl(value)
  }

  return (
    <Sheet open title={existing ? '보관한 물건 고치기' : '함께 살 물건 보관'} onClose={busy ? () => {} : onClose}>
      <form className="wish-editor" onSubmit={save}>
        <p className="wish-note">둘이 함께 보고 고르는 물건이에요.</p>
        {notice && <p className="banner">{notice}</p>}
        <div className="field"><label htmlFor={`${id}-title`}>물건 이름</label>
          <input id={`${id}-title`} className="input" value={title} maxLength={200} required onChange={(e) => setTitle(e.target.value)} placeholder="예: 거실에 둘 스탠드" /></div>
        <div className="field"><label htmlFor={`${id}-url`}>상품 링크</label>
          <input id={`${id}-url`} className="input" type="url" value={url} maxLength={2000} onChange={(e) => changeLink(e.target.value)} placeholder="https://… (없으면 비워 두기)" /></div>
        <div className="field"><label htmlFor={`${id}-price`}>목표 가격</label>
          <input id={`${id}-price`} className="input num" inputMode="numeric" value={price} maxLength={10} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ''))} placeholder="이 정도면 사고 싶은 금액 (원)" />
          <span className="wish-note">직접 정하는 금액이에요. 비워 두어도 돼요.</span></div>
        <div className="field"><label htmlFor={`${id}-memo`}>메모</label>
          <textarea id={`${id}-memo`} className="input" rows={3} value={memo} maxLength={500} onChange={(e) => setMemo(e.target.value)} placeholder="색상·크기나 같이 확인할 점" /></div>
        {quote && <div className="card wish-quote">
          <b className="num">보관 당시 {won(quote.price)}</b>
          <p className="wish-note">{quote.source}, {whenText(quote.checkedAt)} 확인</p>
          <p className="wish-note">{quote.note.replaceAll(' · ', ', ')}. 지금 가격은 달라질 수 있어요.</p>
        </div>}
        {checking && <p className="wish-note" role="status">이미 보관한 링크인지 확인 중</p>}
        {error && <p className="err" role="alert">{error}</p>}
        <button className="primary" disabled={busy || checking}>{busy ? '저장 중…' : existing ? '저장하기' : '보관하기'}</button>
        {existing && <button type="button" className="danger" disabled={busy} onClick={() => void remove()}>{confirmDelete ? '한 번 더 누르면 지워요' : '보관함에서 삭제'}</button>}
      </form>
    </Sheet>
  )
}
