// 담을 때 보는 "지난 기록"(D-042): 담으려는 품목 이름과 비슷한 지난 영수증·쇼핑 주문 캡처의 상품 줄과 가격 캡처를
// 기록에 적힌 이름·용량·가격 그대로 보이고, 용량을 아는 줄끼리만 100g·100ml·1개당 값으로 견준다.
// 이름 맞추기는 영수증 ↔ 장보기 품목 연결(purchase.ts matchReceipt)과 같은 기준에, 두 글자 이름의 잘못 맞음(양파 → 양파링)을 더 막는다.
import { parsePack } from './purchase'
import { formatUnitPrice, perUnit } from '../../lib/units'

/** receipt: 사진으로 넣은 매장 영수증, order: 사진으로 넣은 쇼핑 주문, capture: 가격 캡처, ledger: 그 밖의 가계부 기록(직접·문자·장보기 기록) */
export type SeenSource = 'receipt' | 'order' | 'capture' | 'ledger'

/** 지난 기록 한 줄. 숫자는 기록에 적힌 값만 */
export type SeenRecord = {
  source: SeenSource
  /** 산 날·캡처한 날 YYYY-MM-DD */
  date: string
  /** 영수증은 가게, 주문은 쇼핑몰(플랫폼), 캡처는 판매처 */
  where: string
  /** 기록에 적힌 상품명 그대로 */
  name: string
  quantity: number
  /** 그 줄 금액(수량을 모두 합친 값). 캡처는 화면의 상품 값(배송비 뺌) */
  amount: number
  /** 1개 값(기록에 있으면) */
  unitPrice: number | null
  packSize: number | null
  packUnit: string | null
  /** 캡처에 적힌 배송비 */
  delivery?: number | null
}

export type SeenMatch = SeenRecord & {
  /** 2: 품목 이름이 통째로 든 줄(같은 상품일 가능성이 큼), 1: 품목 종류만 맞는 줄 */
  score: 1 | 2
  /** 100g·100ml·1개당 값. 용량을 모르면 null */
  unit: { base: string; price: number } | null
  /** 같은 단위끼리 견줬을 때 가장 싼 줄 */
  cheapest: boolean
}

const norm = (s: string) => s.replace(/[\s\-_/()[\]·.,★☆*+]+/g, '').toLowerCase()
const words = (s: string) => s.split(/[\s,()[\]/·★☆*+]+/).map((w) => w.replace(/[^가-힣a-z0-9]/gi, '').toLowerCase()).filter(Boolean)
/** 상품명 속 용량(1.05kg, 900ml, 2L x 6). g·ml만 읽는다(셈 단위는 이름만으로는 틀리기 쉽다) */
const NAME_PACK = /(\d+(?:\.\d+)?)\s*(kg|g|ml|l|리터)(?![a-z])(?:\s*[x×*]\s*(\d+))?/i

/**
 * 기록의 1개 용량: 적힌 용량이 먼저, 없으면 상품명에서 g·ml 용량을 읽는다.
 * 이름의 'x2'는 수량이 1일 때만 곱한다(수량 2인 줄의 'x2'는 그 수량이라 또 곱하면 단위값이 반이 된다)
 */
export function packOf(r: Pick<SeenRecord, 'name' | 'packSize' | 'packUnit' | 'quantity'>): { pack_size: number; pack_unit: string } | null {
  if (r.packSize && r.packUnit) return { pack_size: r.packSize, pack_unit: r.packUnit }
  const m = NAME_PACK.exec(r.name)
  if (!m) return null
  const unit = m[2].toLowerCase() === '리터' ? 'l' : m[2]
  const p = parsePack(`${m[1]}${unit}`)
  if (!p) return null
  const times = m[3] ? Number(m[3]) : 1
  return times > 1 && times < 100 && r.quantity === 1 ? { ...p, pack_size: Math.round(p.pack_size * times * 1000) / 1000 } : p
}

/** 100g·100ml·1개당 값. 용량을 모르면 null(용량 없는 줄을 "1개당"으로 견주지 않는다) */
export function unitOfSeen(r: SeenRecord): { base: string; price: number } | null {
  const pack = packOf(r)
  if (!pack || !(r.quantity > 0) || !(r.amount > 0)) return null
  return perUnit({ amount: r.amount, quantity: r.quantity, pack_size: pack.pack_size, pack_unit: pack.pack_unit })
}

/**
 * 품목 이름이 지난 기록 상품명과 맞는 정도. 0이면 안 맞음.
 * - 한 글자(파·무): 상품명의 한 단어와 같을 때만 2
 * - 두 글자(양파·우유): 단어 안에서 뒤에 한글이 이어지지 않을 때(햇양파·서울우유·우유1L) 2. 뒤에 한글이 붙은 것(양파링·우유식빵)은 다른 물건이라 0
 * - 세 글자 이상: 상품명(공백·기호 뺌)에 통째로 들어 있으면 2, 아니면 마지막 단어(종류)로 위 규칙을 다시 봐서 맞으면 1
 */
export function nameScore(itemName: string, recordName: string): 0 | 1 | 2 {
  const gn = norm(itemName)
  if (!gn) return 0
  const ws = words(recordName)
  // 두 글자는 단어 안에서 뒤에 한글이 이어지지 않을 때만(햇양파·서울우유·우유1L·맛있는우유GT). 뒤에 한글이 붙은 것(양파링·우유식빵)은 다른 물건
  const short = (g: string) => ws.some((w) => {
    if (g.length !== 2) return w === g
    for (let i = w.indexOf(g); i >= 0; i = w.indexOf(g, i + 1)) if (!/[가-힣]/.test(w.charAt(i + 2))) return true
    return false
  })
  if (gn.length === 1) return ws.includes(gn) ? 2 : 0
  if (gn.length === 2) return short(gn) ? 2 : 0
  if (norm(recordName).includes(gn)) return 2
  const iw = words(itemName)
  const head = iw[iw.length - 1]
  if (iw.length > 1 && head && head.length >= 2 && (head.length === 2 ? short(head) : norm(recordName).includes(head))) return 1
  return 0
}

/**
 * 품목 하나의 지난 기록. 이름이 통째로 맞는 줄 먼저, 그 안에서 용량을 아는 줄은 단위값이 싼 순서, 모르는 줄은 최근 순서.
 * 같은 상품명·같은 곳은 가장 최근 한 줄만 남긴다. 가장 싼 표시는 같은 단위(100g끼리 등)에서 두 줄 이상일 때만.
 */
export function seenFor(itemName: string, records: SeenRecord[], limit = 20): SeenMatch[] {
  const matched: SeenMatch[] = []
  const seen = new Set<string>()
  const byRecent = [...records].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  for (const r of byRecent) {
    const score = nameScore(itemName, r.name)
    if (!score) continue
    const key = `${norm(r.name)}|${r.where}|${r.source}`
    if (seen.has(key)) continue
    seen.add(key)
    matched.push({ ...r, score, unit: unitOfSeen(r), cheapest: false })
  }
  // 순서: 맞는 정도 → 용량 아는 줄 먼저 → 같은 단위끼리 싼 순서 → 최근 순서
  const rank = (m: SeenMatch) => [-m.score, m.unit ? 0 : 1, m.unit?.base ?? '', m.unit?.price ?? 0, -Date.parse(m.date)] as const
  matched.sort((a, b) => {
    const x = rank(a)
    const y = rank(b)
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1
    return 0
  })
  // '가장 쌈'은 용량을 아는 줄이 있는 가장 높은 맞음 단계 안에서만 붙인다(종류만 같은 줄이 같은 상품 줄 위에 오지 않게)
  const top = Math.max(0, ...matched.filter((m) => m.unit).map((m) => m.score))
  const bases = new Map<string, SeenMatch[]>()
  for (const m of matched) if (m.unit && m.score === top) bases.set(m.unit.base, [...(bases.get(m.unit.base) ?? []), m])
  for (const group of bases.values()) {
    if (group.length < 2) continue
    const min = Math.min(...group.map((m) => m.unit!.price))
    for (const m of group) if (m.unit!.price === min) m.cheapest = true
  }
  return matched.slice(0, limit)
}

const SOURCE_LABEL: Record<SeenSource, string> = { receipt: '영수증', order: '주문', capture: '캡처', ledger: '가계부 기록' }

/** '10월 14일 이마트 영수증' */
export function seenWhen(r: Pick<SeenRecord, 'date' | 'where' | 'source'>): string {
  const [, m, d] = r.date.split('-').map(Number)
  return `${m}월 ${d}일 ${r.where ? `${r.where} ` : ''}${SOURCE_LABEL[r.source]}`
}

/** '2개 12,900원' · 캡처면 배송비도 */
export function seenPrice(r: SeenRecord): string {
  const qty = r.quantity !== 1 ? `${Number.isInteger(r.quantity) ? r.quantity : Math.round(r.quantity * 100) / 100}개 ` : ''
  const delivery = r.source === 'capture' && r.delivery ? ` + 배송비 ${r.delivery.toLocaleString('ko-KR')}원` : ''
  return `${qty}${r.amount.toLocaleString('ko-KR')}원${delivery}`
}

/** '100g당 614원', 용량을 모르면 '용량 모름' */
export function seenUnit(m: SeenMatch): string {
  return m.unit ? `${m.unit.base}당 ${formatUnitPrice(m.unit.price)}원` : '용량 모름'
}

/** 가계부 지출 내역 한 건(지난 기록용으로 읽는 칸) */
export type LedgerTx = {
  occurred_on: string
  platform: string | null
  title: string
  merchant?: string | null
  source?: string | null
  transaction_items?: { name: string; quantity: number; unit_price: number | null; amount: number; pack_size: number | null; pack_unit: string | null }[] | null
}

/**
 * 가계부 내역 → 지난 기록. 사진으로 넣은 것만 영수증(플랫폼 없음)·주문(플랫폼 있음)으로 부르고, 그 밖(직접·문자·장보기 기록)은 '가계부 기록'.
 * 어디서: 플랫폼 → 가게 이름 칸 → 내역 이름(상품명과 같으면 비움). 배송비·봉투 줄과 금액 없는 줄은 뺀다
 */
export function ledgerSeen(txs: LedgerTx[]): SeenRecord[] {
  const out: SeenRecord[] = []
  for (const t of txs) {
    for (const it of t.transaction_items ?? []) {
      if (!(it.amount > 0) || /^(배송비|봉투|종량제|쇼핑백|비닐)/.test(it.name.trim())) continue
      const source: SeenSource = t.source === 'photo' ? (t.platform ? 'order' : 'receipt') : 'ledger'
      const where = t.platform || t.merchant?.trim() || (t.title.trim() !== it.name.trim() ? t.title.trim() : '')
      out.push({ source, date: t.occurred_on, where, name: it.name, quantity: Number(it.quantity) || 1, amount: it.amount, unitPrice: it.unit_price,
        packSize: it.pack_size === null ? null : Number(it.pack_size), packUnit: it.pack_unit })
    }
  }
  return out
}
