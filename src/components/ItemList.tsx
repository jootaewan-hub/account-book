import { won } from '../lib/format'
import type { TxItem } from '../lib/types'
import { useItemImages } from '../hooks/useItemImages'

/** 품목 목록: 상품 사진, 이름, 수량, 금액 */
export function ItemList({ items }: { items: TxItem[] }) {
  const urls = useItemImages(items.map((i) => i.image_path))
  const sum = items.reduce((s, i) => s + i.amount, 0)
  return (
    <ul className="item-list">
      {items.map((i) => (
        <li key={i.id}>
          {i.image_path && urls.get(i.image_path)
            ? <img className="item-thumb" src={urls.get(i.image_path)} alt="" loading="lazy" />
            : <span className="item-thumb empty" aria-hidden="true" />}
          <span className="item-name">{i.name}{i.quantity !== 1 && <span className="muted num"> ×{Number(i.quantity)}</span>}</span>
          <span className="num">{won(i.amount)}</span>
        </li>
      ))}
      <li className="item-sum"><span>합계</span><span className="num">{won(sum)}</span></li>
    </ul>
  )
}
