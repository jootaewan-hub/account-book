import { won } from '../lib/format'
import type { ReceiptGroceryItem } from '../grocery/lib/ledgerLink'
import type { ReceiptLine } from '../grocery/lib/purchase'

/**
 * 영수증·쇼핑 주문 확인 화면의 "장보기 목록에서 찾은 품목"(D-011 길 ①).
 * 영수증 상품 이름과 맞는 장보기 품목을 미리 체크해 보여 주고, 저장하면 체크한 품목을 그 내역에 연결한다.
 * 이미 가계부에 넣은 장보기 품목이 같은 이름으로 맞으면 흐리게 보여 준다(같은 장보기를 두 번 넣지 않게).
 */
export function GroceryMatchCard({ items, lines, suggested, linkedMatches, picks, onToggle }: {
  items: ReceiptGroceryItem[]
  lines: ReceiptLine[]
  /** 장보기 품목 id → 맞춘 상품 줄 key (연결 안 된 품목) */
  suggested: ReadonlyMap<string, string>
  /** 이미 가계부에 넣은 장보기 품목 id → 같은 이름의 상품 줄 key */
  linkedMatches: ReadonlyMap<string, string>
  picks: ReadonlyMap<string, string>
  onToggle: (itemId: string) => void
}) {
  const lineOf = (key: string) => lines.find((l) => l.key === key)
  const nameOf = (id: string) => {
    const g = items.find((x) => x.id === id)
    return g ? [g.name, g.spec].filter(Boolean).join(' ') : ''
  }
  return (
    <div className="card grocery-match">
      <h3 className="section-title">장보기 목록에서 찾은 품목</h3>
      <p className="grocery-match-lead">체크한 품목은 이 내역과 연결되고, 장보기 목록에서 산 것으로 바뀌어요.</p>
      {[...suggested].map(([id, key]) => {
        const line = lineOf(key)
        if (!line) return null
        return (
          <label key={id} className="check grocery-match-row">
            <input type="checkbox" checked={picks.has(id)} onChange={() => onToggle(id)} />
            <span>
              <b>{nameOf(id)}</b>
              <span className="grocery-match-line">영수증의 {line.name}, <span className="num">{won(line.amount)}원</span></span>
            </span>
          </label>
        )
      })}
      {[...linkedMatches].map(([id]) => (
        <p key={id} className="grocery-match-done">{nameOf(id)}: 이 장보기는 이미 가계부에 넣었어요.</p>
      ))}
    </div>
  )
}
