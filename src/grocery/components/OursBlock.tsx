// 품목 상세 가격 탭의 "우리가 산 값"(P2): 연결된 내역·"맞아요"로 확인한 기록과, 이름이 비슷한 우리 기록(확인 전, 맞아요/아니에요).
import { ourMetaText, ourPriceText, ourUnitText, OURS_TAG, splitOurs, type OurPurchase } from '../lib/ours'
import type { Member } from '../lib/types'

type Props = {
  rows: OurPurchase[]
  members: readonly Member[]
  busy: boolean
  onDecide: (row: OurPurchase, same: boolean) => Promise<void>
}

function whoClass(m: Member): string {
  if (m.spouseRole === 'husband') return 'who-dot who-husband'
  if (m.spouseRole === 'wife') return 'who-dot who-wife'
  return 'who-dot who-none'
}

function Meta({ r, members }: { r: OurPurchase; members: readonly Member[] }) {
  const m = ourMetaText(r, members)
  return (
    <p className="src-line ours-meta">
      <span className="num">{m.day}</span>
      <span aria-hidden="true">·</span>
      {m.who ? (
        <span className="who">
          <span className={whoClass(m.who)} aria-hidden="true" />
          {m.who.displayName}
        </span>
      ) : (
        <span>누군가</span>
      )}
      <span aria-hidden="true">·</span>
      <span>{m.where}</span>
    </p>
  )
}

function Price({ r }: { r: OurPurchase }) {
  const unit = ourUnitText(r)
  return (
    <p className="price-v num">
      {ourPriceText(r)}
      {unit && (
        <>
          <br />
          <span className="src-line">{unit}</span>
        </>
      )}
    </p>
  )
}

export function OursBlock({ rows, members, busy, onDecide }: Props) {
  const { ours, similar } = splitOurs(rows)
  return (
    <div className="detail-block ours-block">
      <p className="detail-sub">우리가 산 값</p>
      {ours.length === 0 && <p className="detail-none">가계부에 넣은 이 품목의 기록이 아직 없어요. 장 본 뒤 "가계부에 넣기"를 하면 여기에 쌓여요.</p>}
      {ours.length > 0 && (
        <ul className="price-list">
          {ours.map((r) => (
            <li key={r.transactionItemId ?? r.transactionId} className="price-row ours-row">
              <div>
                <p className="price-where">
                  <span className="tag tag-ours">{OURS_TAG}</span>
                  <span>{r.name}</span>
                </p>
                <Meta r={r} members={members} />
              </div>
              <Price r={r} />
            </li>
          ))}
        </ul>
      )}
      {similar.length > 0 && (
        <>
          <p className="detail-sub">이름이 비슷한 우리 기록</p>
          <p className="src-line">가계부에 적힌 상품명 그대로예요. 같은 상품이면 "맞아요"를 눌러 우리가 산 값으로 올려요.</p>
          <ul className="price-list">
            {similar.map((r) => (
              <li key={r.transactionItemId ?? r.transactionId} className="price-row ours-row">
                <div>
                  <p className="price-where"><span>{r.name}</span></p>
                  <Meta r={r} members={members} />
                  <p className="shop-actions">
                    <button type="button" className="btn-text" disabled={busy} onClick={() => void onDecide(r, true)}>같은 상품 맞아요</button>
                    <button type="button" className="btn-text" disabled={busy} onClick={() => void onDecide(r, false)}>아니에요</button>
                  </p>
                </div>
                <Price r={r} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
