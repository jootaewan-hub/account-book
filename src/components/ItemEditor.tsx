import { type ReactNode, useState } from 'react'
import { won } from '../lib/format'
import { blankItem, parseAmount, parseQuantity, withUnitPrice, type EditableItem } from '../lib/itemEdit'
import { ItemInfo } from './ItemInfo'

/**
 * 고칠 수 있는 품목 목록(D-052). 영수증 확인 화면(초안 품목)과 저장된 내역의 수정 시트(저장된 품목)가 함께 쓴다.
 * 줄마다 "고치기"를 누르면 이름·수량·금액 칸이 열리고, 개당 가격은 수량·금액에서 다시 센다. 줄을 빼거나 아래에서 더할 수 있다.
 * 결제 금액(total)을 주면 품목 합계와 다를 때 차이를 적는다(영수증은 원단위 절사로 몇 원 다를 수 있다).
 */
export function ItemEditor<T extends EditableItem>({ items, onChange, renderThumb, renderExtra, total, make }: {
  items: T[]
  onChange: (items: T[]) => void
  /** 줄 앞 44px 칸(상품 사진). 없으면 빈 자리 */
  renderThumb?: (it: T, i: number) => ReactNode
  /** 이름 줄 아래 더 보일 것(용량 칸 등). 고치는 중에도 보인다 */
  renderExtra?: (it: T, i: number) => ReactNode
  /** 결제 금액. 품목 합계와 다르면 차이를 적는다 */
  total?: number
  /** 새 줄을 만드는 법. 없으면 이름 없는 1개 0원 줄 */
  make?: () => T
}) {
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set())
  const sum = items.reduce((s, it) => s + it.amount, 0)
  const diff = total === undefined ? 0 : sum - total

  function toggle(i: number) {
    setOpen((o) => { const n = new Set(o); if (n.has(i)) n.delete(i); else n.add(i); return n })
  }
  function patch(i: number, p: Partial<EditableItem>) {
    onChange(items.map((it, j) => (j === i ? withUnitPrice({ ...it, ...p }) : it)))
  }
  function remove(i: number) {
    setOpen(new Set()) // 번호가 당겨지므로 열린 칸은 모두 닫는다
    onChange(items.filter((_, j) => j !== i))
  }
  function add() {
    setOpen((o) => new Set([...o, items.length]))
    onChange([...items, (make ? make() : blankItem()) as T])
  }

  return (
    <div className="item-editor">
      <ul className="item-list">
        {items.map((it, i) => {
          const editing = open.has(i)
          return (
            <li key={i} className={editing ? 'editing' : undefined}>
              {renderThumb ? renderThumb(it, i) : <span className="item-renderThumb empty" aria-hidden="true" />}
              <span className="item-main">
                {editing ? <ItemFields n={i + 1} it={it} onChange={(p) => patch(i, p)} /> : <ItemInfo it={it} />}
                {renderExtra?.(it, i)}
                <span className="item-actions">
                  <button type="button" className="link-btn" onClick={() => toggle(i)} aria-expanded={editing}>
                    {editing ? '접기' : '고치기'}
                  </button>
                  {editing && <button type="button" className="link-btn remove" onClick={() => remove(i)}>이 줄 빼기</button>}
                </span>
              </span>
              <span className="num">{won(it.amount)}</span>
            </li>
          )
        })}
        <li className="item-sum"><span>품목 합계</span><span className="num">{won(sum)}</span></li>
      </ul>
      {diff !== 0 && (
        <p className="tx-meta item-diff">품목 합계가 결제 금액 {won(total!)}원보다 {won(Math.abs(diff))}원 {diff > 0 ? '많아요' : '적어요'}. 금액이나 품목 줄을 맞춰 주세요.</p>
      )}
      <button type="button" className="ghost item-add" onClick={add}>품목 줄 더하기</button>
    </div>
  )
}

/** 한 줄의 이름·수량·금액 칸. 치는 동안 글자는 그대로 두고, 읽을 수 있을 때만 값을 올린다(용량 칸과 같은 방식) */
function ItemFields({ n, it, onChange }: { n: number; it: EditableItem; onChange: (p: Partial<EditableItem>) => void }) {
  const [qty, setQty] = useState(String(it.quantity))
  const [amt, setAmt] = useState(String(it.amount))
  const qtyBad = parseQuantity(qty) === null
  const amtBad = parseAmount(amt) === null
  return (
    <span className="item-fields">
      <input className="input" value={it.name} maxLength={60} placeholder="이름" aria-label={`${n}번째 품목 이름`}
        onChange={(e) => onChange({ name: e.target.value })} />
      <span className="row">
        <input className={`input num qty${qtyBad ? ' bad' : ''}`} inputMode="decimal" value={qty} placeholder="수량" aria-label={`${n}번째 품목 수량`}
          aria-invalid={qtyBad || undefined}
          onChange={(e) => {
            setQty(e.target.value)
            const q = parseQuantity(e.target.value)
            if (q !== null) onChange({ quantity: q })
          }} />
        <input className={`input num amt${amtBad ? ' bad' : ''}`} inputMode="numeric" value={amt} placeholder="금액" aria-label={`${n}번째 품목 금액`}
          aria-invalid={amtBad || undefined}
          onChange={(e) => {
            setAmt(e.target.value)
            const a = parseAmount(e.target.value)
            if (a !== null) onChange({ amount: a })
          }} />
        <span className="unit">원</span>
      </span>
      {(qtyBad || amtBad) && <span className="pack-hint">{qtyBad ? '수량은 0보다 큰 수로' : '금액은 숫자로'} 적어 주세요</span>}
    </span>
  )
}
