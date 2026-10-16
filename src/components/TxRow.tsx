import { won } from '../lib/format'
import { SCOPE_LABEL, type Lookup } from '../lib/lookup'
import type { Scope, Transaction } from '../lib/types'
import { useItemImages } from '../hooks/useItemImages'
import { serviceOf } from '../lib/services'
import { qtyPriceLabel } from '../lib/units'
import { ServiceLogo } from './ServiceLogo'

const WHO_TAG: Record<Scope, string> = { shared: '', husband: 'who-husband', wife: 'who-wife', child: 'who-child' }

export function TxRow({ t, lookup, onClick }: { t: Transaction; lookup: Lookup; onClick: () => void }) {
  const cat = lookup.categoryName(t.category_id)
  const photo = t.items?.find((i) => i.image_path)?.image_path ?? null
  const urls = useItemImages(photo ? [photo] : [])
  // 구독(반복 내역·구독 분류)이면 서비스 로고를 그린다. 그 밖의 행에는 아이콘을 붙이지 않는다.
  const logo = !photo && (t.recurring_id || cat === '구독') && serviceOf(t.title) !== null
  const thumb = photo ? urls.get(photo) : undefined
  const items = t.items?.length ?? 0
  // 상품 하나짜리 내역은 이름이 곧 상품명이라 품목 수 대신 수량 × 개당 가격을 보여 준다
  const one = items === 1 && t.items![0].quantity !== 1 ? qtyPriceLabel(t.items![0]) : null
  const meta = [cat, items > 1 ? `품목 ${items}개` : null, one, t.created_by !== lookup.me ? `${lookup.personLabel(t.created_by)} 입력` : null]
    .filter(Boolean).join(', ')
  const lead = thumb || logo
  // 할부 회차 (저장할 때·자동 입력할 때 메모 앞에 "할부 2/3회"로 적는다). 태그로 보여 주므로 메모 글에서는 뺀다
  const inst = /^할부 (\d+)\/(\d+)회/.exec(t.memo ?? '')
  const memo = (t.memo ?? '').replace(/^할부 \d+\/\d+회,?\s*/, '')
  return (
    <button className={`tx${lead ? ' has-lead' : ''}`} onClick={onClick}>
      {thumb ? <img className="tx-thumb" src={thumb} alt="" loading="lazy" /> : logo ? <ServiceLogo name={t.title} size={40} /> : null}
      <span style={{ minWidth: 0 }}>
        <span className="tx-title">{t.title || cat}</span>
        <span className="tx-meta">
          {t.platform && <span className="tag">{t.platform}</span>}
          {inst && <span className="tag">할부 {inst[1]}/{inst[2]}</span>}
          {t.scope !== 'shared' && <span className={`tag ${WHO_TAG[t.scope]}`}>{SCOPE_LABEL[t.scope]}</span>}
          <span className="num">{meta}</span>
          {memo && <span className="tx-memo">{memo}</span>}
        </span>
      </span>
      <span className={`tx-amt num${t.type === 'income' ? ' inc' : ''}`}>{t.type === 'income' ? '+' : ''}{won(t.amount)}원</span>
    </button>
  )
}
