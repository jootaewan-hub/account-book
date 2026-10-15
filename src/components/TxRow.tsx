import { won } from '../lib/format'
import { SCOPE_LABEL, type Lookup } from '../lib/lookup'
import type { Transaction } from '../lib/types'

export function TxRow({ t, lookup, onClick }: { t: Transaction; lookup: Lookup; onClick: () => void }) {
  const cat = lookup.categoryName(t.category_id)
  return (
    <button className="tx" onClick={onClick}>
      <span className={`glyph${t.type === 'income' ? ' inc' : ''}`} aria-hidden="true">{cat.charAt(0)}</span>
      <span style={{ minWidth: 0 }}>
        <span className="tx-title" style={{ display: 'block' }}>{t.title || cat}</span>
        <span className="tx-meta">
          <span className={`who ${lookup.colorOf(t.scope)}`}>{SCOPE_LABEL[t.scope]}</span>
          <span>{lookup.methodLabel(t.payment_method_id)}</span>
          <span>{cat}</span>
          {t.created_by !== lookup.me && <span className="tag">{lookup.personLabel(t.created_by)} 입력</span>}
        </span>
      </span>
      <span className={`tx-amt num${t.type === 'income' ? ' inc' : ''}`}>{t.type === 'income' ? '+' : '-'}{won(t.amount)}</span>
    </button>
  )
}
