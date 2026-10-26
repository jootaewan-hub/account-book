import { won } from '../lib/format'
import { fuelText } from '../lib/fuel'
import { SCOPE_LABEL, type Lookup } from '../lib/lookup'
import { KIND_LABEL, type PlannedCharge } from '../lib/recurring'
import type { Scope, Transaction } from '../lib/types'
import { useItemImages } from '../hooks/useItemImages'
import { serviceOf } from '../lib/services'
import { qtyPriceLabel } from '../lib/units'
import { ServiceLogo } from './ServiceLogo'

const WHO_TAG: Record<Scope, string> = { shared: '', husband: 'who-husband', wife: 'who-wife', child: 'who-child' }

/** picked: 내역 탭에서 고르는 중일 때 골랐는지(D-027). 고르는 중이면 행을 누를 때 수정 대신 고르기·풀기가 된다 */
export function TxRow({ t, lookup, onClick, picked }: { t: Transaction; lookup: Lookup; onClick: () => void; picked?: boolean }) {
  const cat = lookup.categoryName(t.category_id)
  const photo = t.items?.find((i) => i.image_path)?.image_path ?? null
  const urls = useItemImages(photo ? [photo] : [])
  // 구독(반복 내역·구독 분류)이면 서비스 로고를 그린다. 그 밖의 행에는 아이콘을 붙이지 않는다.
  const logo = !photo && (t.recurring_id || cat === '구독') && serviceOf(t.title) !== null
  const thumb = photo ? urls.get(photo) : undefined
  const items = t.items?.length ?? 0
  // 상품 하나짜리 내역은 이름이 곧 상품명이라 품목 수 대신 수량 × 개당 가격을 보여 준다
  const one = items === 1 && t.items![0].quantity !== 1 ? qtyPriceLabel(t.items![0]) : null
  // 주유 내역은 품목 대신 '휘발유 35.2L, 1,652원/L'
  const meta = [cat, t.fuel ? fuelText(t.fuel) : null, items > 1 ? `품목 ${items}개` : null, one, t.created_by !== lookup.me ? `${lookup.personLabel(t.created_by)} 입력` : null]
    .filter(Boolean).join(', ')
  const lead = thumb || logo
  // 할부 회차 (저장할 때·자동 입력할 때 메모 앞에 "할부 2/3회"로 적는다). 태그로 보여 주므로 메모 글에서는 뺀다
  const inst = /^할부 (\d+)\/(\d+)회/.exec(t.memo ?? '')
  const memo = (t.memo ?? '').replace(/^할부 \d+\/\d+회,?\s*/, '')
  const body = (
    <>
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
    </>
  )
  if (picked === undefined) return <button className={`tx${lead ? ' has-lead' : ''}`} onClick={onClick}>{body}</button>
  return (
    <label className={`tx picking${lead ? ' has-lead' : ''}${picked ? ' picked' : ''}`}>
      <input type="checkbox" checked={picked} onChange={onClick} />
      {body}
    </label>
  )
}

/**
 * 달력의 고정지출 예정 줄(D-030). 아직 내역이 아니라 고칠 내역이 없으므로, 누르면 고정 탭으로 간다.
 * 실제 내역 줄(TxRow)과 같은 자리에 두되 '예정' 점선 태그와 흐린 금액으로 구별한다
 */
export function PlannedRow({ p, lookup, onClick }: { p: PlannedCharge; lookup: Lookup; onClick: () => void }) {
  const { r } = p
  const logo = r.kind === 'subscription' && serviceOf(r.title) !== null
  // 할부는 '할부 n/m' 태그가 종류를 말해 주므로 종류 글자를 되풀이하지 않는다
  const meta = [p.round ? null : KIND_LABEL[r.kind], r.category_id ? lookup.categoryName(r.category_id) : null].filter(Boolean).join(', ')
  return (
    <button className={`tx plan${logo ? ' has-lead' : ''}`} onClick={onClick}>
      {logo ? <ServiceLogo name={r.title} size={40} /> : null}
      <span style={{ minWidth: 0 }}>
        <span className="tx-title">{r.title}</span>
        <span className="tx-meta">
          <span className="tag plan">예정</span>
          {p.round && <span className="tag">할부 {p.round[0]}/{p.round[1]}</span>}
          {r.scope !== 'shared' && <span className={`tag ${WHO_TAG[r.scope]}`}>{SCOPE_LABEL[r.scope]}</span>}
          <span className="num">{meta}</span>
        </span>
      </span>
      <span className="tx-amt num">{won(p.amount)}원</span>
    </button>
  )
}
