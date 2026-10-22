// 사진으로 상품 찾기·캡처로 가격 넣기(P4)의 화면 조각: 사진 고르기(숨긴 파일 입력 + 버튼), 읽은 값 확인·고치기 폼.
// 진행 문구는 하는 일 그대로("사진 읽는 중"). 읽은 값은 사람이 고친 뒤에만 쓴다(검색어·저장).
import { useRef, useState, type FormEvent } from 'react'
import { fileToJpeg, type PreparedImage } from '../../lib/image'
import type { PriceRead, ProductRead } from '../lib/photo'
import type { CapturedQuoteInput } from '../lib/photo'
import { productQuery } from '../../../supabase/functions/grocery-photo/text'

type PickProps = { label: string; inputLabel: string; disabled?: boolean; onImage: (img: PreparedImage) => void; className?: string }

/** 사진 고르기: 보이는 버튼과 숨긴 파일 입력(카메라·앨범은 기기가 고른다) */
export function PhotoPick({ label, inputLabel, disabled, onImage, className = 'btn-secondary detail-link' }: PickProps) {
  const ref = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState<string | null>(null)
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        className="photo-input"
        aria-label={inputLabel}
        onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          setMsg(null)
          try {
            onImage(await fileToJpeg(f))
          } catch {
            setMsg('사진을 열지 못했어요. 다른 사진으로 해 주세요.')
          }
        }}
      />
      <button type="button" className={className} disabled={disabled} onClick={() => ref.current?.click()}>{label}</button>
      {msg && <p className="cand-state" role="alert">{msg}</p>}
    </>
  )
}

type ProductFormProps = { read: ProductRead; onSearch: (query: string) => void; onCancel: () => void }

/** 포장 사진에서 읽은 값: 고친 뒤 그 이름으로 다나와를 찾는다. 읽은 값은 검색어로만 쓴다 */
export function ProductReadForm({ read, onSearch, onCancel }: ProductFormProps) {
  const [name, setName] = useState(read.name ?? '')
  const [brand, setBrand] = useState(read.brand ?? '')
  const [size, setSize] = useState(read.size ?? '')
  const query = productQuery({ name: name.trim() || null, brand: brand.trim() || null, size: size.trim() || null, note: null })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (query) onSearch(query)
  }
  return (
    <form className="read-form" onSubmit={submit} aria-label="사진에서 읽은 값">
      <p className="detail-sub">사진에서 읽은 값</p>
      {read.note && <p className="read-note">{read.note}</p>}
      <label className="read-field"><span>상품 이름</span><input className="cand-input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /></label>
      <label className="read-field"><span>브랜드</span><input className="cand-input" value={brand} maxLength={60} onChange={(e) => setBrand(e.target.value)} /></label>
      <label className="read-field"><span>용량</span><input className="cand-input" value={size} maxLength={60} onChange={(e) => setSize(e.target.value)} /></label>
      <p className="src-line">검색어: {query || '(읽은 값이 없어요. 직접 적어 주세요)'}</p>
      <div className="read-actions">
        <button type="submit" className="btn-primary" disabled={!query}>이 이름으로 검색</button>
        <button type="button" className="btn-text" onClick={onCancel}>취소</button>
      </div>
    </form>
  )
}

type PriceFormProps = { read: PriceRead & { qty: number }; busy: boolean; onSave: (q: CapturedQuoteInput) => Promise<void>; onCancel: () => void }

/** 캡처에서 읽은 값: 고친 값만 저장한다. 판매처·가격은 꼭 있어야 한다 */
export function PriceReadForm({ read, busy, onSave, onCancel }: PriceFormProps) {
  const [seller, setSeller] = useState(read.seller ?? '')
  const [price, setPrice] = useState(read.price !== null ? String(read.price) : '')
  const [qty, setQty] = useState(String(read.qty))
  const [delivery, setDelivery] = useState(read.delivery !== null ? String(read.delivery) : '')
  const [msg, setMsg] = useState<string | null>(null)
  const priceN = Number(price.replace(/,/g, ''))
  const qtyN = Number(qty)
  const deliveryN = delivery.trim() === '' ? null : Number(delivery.replace(/,/g, ''))
  const ok = seller.trim().length > 0 && Number.isInteger(priceN) && priceN > 0 && Number.isInteger(qtyN) && qtyN >= 1 && qtyN <= 99
    && (deliveryN === null || (Number.isInteger(deliveryN) && deliveryN >= 0))
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!ok || busy) return
    setMsg(null)
    onSave({ seller: seller.trim().slice(0, 40), price: priceN, qty: qtyN, delivery: deliveryN }).catch(() => setMsg('저장하지 못했어요. 잠시 뒤 다시 해 주세요.'))
  }
  return (
    <form className="read-form" onSubmit={submit} aria-label="캡처에서 읽은 값">
      <p className="detail-sub">캡처에서 읽은 값</p>
      {read.name && <p className="src-line">상품명: {read.name}{read.size ? `, ${read.size}` : ''}</p>}
      {read.note && <p className="read-note">{read.note}</p>}
      <label className="read-field"><span>판매처</span><input className="cand-input" value={seller} maxLength={40} onChange={(e) => setSeller(e.target.value)} /></label>
      <label className="read-field"><span>가격(원)</span><input className="cand-input num" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
      <label className="read-field"><span>수량(개)</span><input className="cand-input num" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} /></label>
      <label className="read-field"><span>배송비(원, 모르면 비움)</span><input className="cand-input num" inputMode="numeric" value={delivery} onChange={(e) => setDelivery(e.target.value)} /></label>
      {msg && <p className="cand-state" role="alert">{msg}</p>}
      <div className="read-actions">
        <button type="submit" className="btn-primary" disabled={!ok || busy}>이 값으로 넣기</button>
        <button type="button" className="btn-text" onClick={onCancel}>취소</button>
      </div>
    </form>
  )
}
