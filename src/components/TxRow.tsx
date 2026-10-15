import { won } from '../lib/format'
import { SCOPE_LABEL, type Lookup } from '../lib/lookup'
import type { Transaction } from '../lib/types'
import { useItemImages } from '../hooks/useItemImages'

export function TxRow({ t, lookup, onClick }: { t: Transaction; lookup: Lookup; onClick: () => void }) {
  const cat = lookup.categoryName(t.category_id)
  const photo = t.items?.find((i) => i.image_path)?.image_path ?? null
  const urls = useItemImages(photo ? [photo] : [])
  const items = t.items?.length ?? 0
  return (
    <button className="tx" onClick={onClick}>
      {photo && urls.get(photo)
        ? <img className="tx-thumb" src={urls.get(photo)} alt="" loading="lazy" />
        : <span className={`glyph${t.type === 'income' ? ' inc' : ''}`} aria-hidden="true">{cat.charAt(0)}</span>}
      <span style={{ minWidth: 0 }}>
        <span className="tx-title" style={{ display: 'block' }}>{t.title || cat}</span>
        <span className="tx-meta">
          <span className={`who ${lookup.colorOf(t.scope)}`}>{SCOPE_LABEL[t.scope]}</span>
          {t.platform && <span className="tag">{t.platform}</span>}
          <span>{cat}</span>
          {items > 0 && <span>품목 {items}개</span>}
          {t.created_by !== lookup.me && <span className="tag">{lookup.personLabel(t.created_by)} 입력</span>}
        </span>
      </span>
      <span className={`tx-amt num${t.type === 'income' ? ' inc' : ''}`}>{t.type === 'income' ? '+' : '-'}{won(t.amount)}</span>
    </button>
  )
}
