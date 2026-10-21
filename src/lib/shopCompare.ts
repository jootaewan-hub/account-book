// 영수증 확인 화면의 "이번 장보기 살펴보기"(설계 2026-10-21 fuel-and-grocery-compare 3-2).
// 최근 1년 우리 가계부 품목 줄과 이번 영수증을 이름으로 맞춰 값·구매 간격을 견준다. 외부 가격은 쓰지 않고, 숫자는 우리 기록의 날짜·가게와 함께 낸다.
import { pctChange } from './stats'
import { perUnit } from './units'
import type { Transaction } from './types'

/** 이 분류의 영수증을 "장보기"로 본다 */
export const GROCERY_CATEGORY_NAMES: ReadonlySet<string> = new Set(['장보기', '식비'])

/** 이름 정규화: 공백·기호 빼고 소문자 */
export function normName(s: string): string {
  return s.replace(/[\s★☆*·,()[\]/+]+/g, '').toLowerCase()
}

// 용량·수량 토큰(1.5kg, 120gx5, 30구, 2입…)과 꾸밈말은 단어로 치지 않는다
const SIZE_TOKEN = /^x?\d+(?:[.,]\d+)?(?:g|kg|mg|ml|l|리터|cc|구|개입|개|팩|봉|병|캔|장|롤|입|ea|매|p|단|망|모|판|근|마리|포기|box|박스|세트)?(?:[x×*]\d+)?$/i
const FILLER = new Set(['국산', '수입', '특가', '행사', '기획', '증정', '세트', '묶음', '할인', '대용량', '무료배송', '당일배송', '정품', '최저가', '신상', '신제품', '본품', '프리미엄'])

/** 이름을 단어로: 2자 이상, 용량·수량·꾸밈말 제외 */
export function nameTokens(s: string): string[] {
  return s.split(/[\s,/()[\]★☆*·+]+/)
    .map((t) => t.replace(/[^가-힣a-z0-9.]/gi, '').replace(/\.+$/, '').toLowerCase())
    .filter((t) => t.length >= 2 && !SIZE_TOKEN.test(t) && !FILLER.has(t))
}

/** 이번 영수증의 상품 줄 하나 */
export type CompareLine = {
  key: string
  name: string
  quantity: number
  unitPrice: number | null
  amount: number
  packSize: number | null
  packUnit: string | null
  /** 이 줄과 맞춰진(체크·제안된) 장보기 품목 이름. 없으면 null */
  groceryName: string | null
}

/** 지난 기록의 상품 줄 하나 */
export type PastLine = {
  txId: string
  date: string
  /** 플랫폼 또는 내역 제목(가게 이름) */
  place: string
  name: string
  quantity: number
  unitPrice: number | null
  amount: number
  packSize: number | null
  packUnit: string | null
}

/** 상품 줄인가: 금액이 있고 배송비·봉투 줄이 아닌 것(지난 기록에는 is_product가 없다) */
const isProductName = (name: string) => !/^(배송비|봉투|종량제|쇼핑백|비닐)/.test(name.trim())

/** 지난 지출 내역의 상품 줄. 최근 날짜 먼저 */
export function pastLines(txs: Transaction[]): PastLine[] {
  const out: PastLine[] = []
  for (const t of txs) {
    if (t.type !== 'expense') continue
    for (const it of t.items ?? []) {
      if (it.amount <= 0 || !isProductName(it.name)) continue
      out.push({ txId: t.id, date: t.occurred_on, place: t.platform || t.title, name: it.name, quantity: it.quantity, unitPrice: it.unit_price, amount: it.amount, packSize: it.pack_size, packUnit: it.pack_unit })
    }
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}

export type MatchGrade = 'product' | 'kind'
export type PastMatch = { grade: MatchGrade; line: PastLine; all: PastLine[] }

const MIN_CONTAIN = 4

function sameProduct(a: string, b: string): boolean {
  const na = normName(a), nb = normName(b)
  if (!na || !nb) return false
  const short = na.length <= nb.length ? na : nb
  const long = short === na ? nb : na
  if (short.length >= MIN_CONTAIN && long.includes(short)) return true
  const ta = new Set(nameTokens(a))
  let hits = 0
  for (const t of new Set(nameTokens(b))) if (ta.has(t)) hits++
  return hits >= 2
}

/**
 * 이번 줄과 같은 상품(이름 포함·단어 2개 겹침)을 지난 줄에서 찾고, 없으면 연결된 장보기 품목 이름이 든 줄(같은 품목, 다른 상품일 수 있음)을 찾는다.
 * line은 가장 최근 것, all은 같은 등급으로 맞은 줄 전부(최근순).
 */
export function matchPast(line: CompareLine, past: PastLine[]): PastMatch | null {
  const product = past.filter((p) => sameProduct(line.name, p.name))
  if (product.length) return { grade: 'product', line: product[0], all: product }
  const g = line.groceryName ? normName(line.groceryName) : ''
  if (!g) return null
  const kind = past.filter((p) => normName(p.name).includes(g))
  return kind.length ? { grade: 'kind', line: kind[0], all: kind } : null
}

/** 견줄 값: 용량이 있으면 100g·100ml·1개당, 없으면 개당(1개). 수량이 없으면 null */
export function unitOf(l: { quantity: number; unitPrice: number | null; amount: number; packSize: number | null; packUnit: string | null }): { base: string; price: number } | null {
  if (!(l.quantity > 0) || !(l.amount > 0)) return null
  const u = perUnit({ amount: l.amount, quantity: l.quantity, pack_size: l.packSize, pack_unit: l.packUnit })
  if (u) return u
  return { base: '1개', price: l.unitPrice ?? l.amount / l.quantity }
}

// 품목 종류별 "이 안에 또 샀으면 아직 남았을 수 있다" 날수. 추측값이라 쓰면서 고친다(설계 3-2 ③). 위에서부터 먼저 맞는 것
const RESTOCK_DAYS: [number, string[]][] = [
  [45, ['된장', '고추장', '쌈장', '간장', '청국장', '소스', '기름', '올리브유', '식용유', '설탕', '소금', '조미료', '잼', '케찹', '케첩', '마요', '식초', '미림', '맛술',
    '참치액', '참깨', '들깨', '후추', '허브', '다시다', '연두', '고춧가루', '카레', '시럽', '밀가루', '부침가루', '튀김가루', '잡곡', '국수', '스파게티', '파스타']],
  [10, ['라면', '과자', '칩', '쿠키', '비스킷', '시리얼', '그래놀라', '커피', '녹차', '홍차', '초콜릿', '사탕', '젤리', '캔디', '음료', '탄산', '생수', '맥주', '소주', '와인',
    '막걸리', '햇반', '즉석밥', '만두', '냉동', '통조림', '참치캔', '스팸']],
  [5, ['우유', '요거트', '요구르트', '두부', '계란', '달걀', '샐러드', '치즈', '버터', '소시지', '베이컨', '어묵', '식빵', '두유', '콩나물', '숙주']],
  [3, ['채소', '야채', '과일', '상추', '깻잎', '시금치', '배추', '양배추', '대파', '쪽파', '양파', '마늘', '감자', '고구마', '당근', '오이', '호박', '버섯', '토마토', '사과',
    '바나나', '딸기', '포도', '수박', '참외', '복숭아', '키위', '정육', '삼겹살', '목살', '앞다리', '등심', '안심', '갈비', '닭', '돼지', '소고기', '한우', '수산', '고등어',
    '갈치', '오징어', '새우', '연어', '조개']],
]
const DEFAULT_RESTOCK_DAYS = 7

/** 이름(과 연결된 장보기 품목 이름)으로 고른 종류의 날수 */
export function restockDays(name: string, groceryName: string | null): number {
  const text = `${name} ${groceryName ?? ''}`.replace(/\s+/g, '').toLowerCase()
  for (const [days, words] of RESTOCK_DAYS) if (words.some((w) => text.includes(w))) return days
  return DEFAULT_RESTOCK_DAYS
}

export type TripRef = { date: string; place: string; count: number; total: number }

const TRIP_GAP_MS = 5 * 60_000
const MIN_TRIP_LINES = 3
const productCount = (t: Transaction) => (t.items ?? []).filter((it) => it.amount > 0 && isProductName(it.name)).length

/**
 * 지난 내역을 "장보기 한 번"으로 묶는다: 같은 날짜이고 created_at이 5분 안에 이어지는 내역들(상품별로 나눠 저장한 영수증도 한 번).
 * 상품 줄 합이 3개 이상이고 내역 하나라도 분류가 장보기·식비인 묶음만. 최근 날짜 먼저.
 */
export function trips(txs: Transaction[], groceryCategoryIds: ReadonlySet<string>): TripRef[] {
  const sorted = txs.filter((t) => t.type === 'expense').slice().sort((a, b) => a.created_at.localeCompare(b.created_at))
  const clusters: Transaction[][] = []
  for (const t of sorted) {
    const last = clusters[clusters.length - 1]
    const prev = last?.[last.length - 1]
    if (prev && prev.occurred_on === t.occurred_on && Date.parse(t.created_at) - Date.parse(prev.created_at) <= TRIP_GAP_MS) last.push(t)
    else clusters.push([t])
  }
  return clusters
    .filter((c) => c.some((t) => t.category_id !== null && groceryCategoryIds.has(t.category_id)))
    .map((c) => {
      const count = c.reduce((s, t) => s + productCount(t), 0)
      const multi = c.find((t) => (t.items?.length ?? 0) >= 2)
      const place = multi ? multi.platform || multi.title : c.find((t) => t.platform)?.platform ?? '장보기'
      return { date: c[0].occurred_on, place: place || '장보기', count, total: c.reduce((s, t) => s + t.amount, 0), created: c[c.length - 1].created_at }
    })
    .filter((t) => t.count >= MIN_TRIP_LINES)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.created.localeCompare(a.created)))
    .map(({ created: _created, ...t }) => t)
}

export type PriceChange = { now: number; prev: number; base: string; diff: number; pct: number | null; ref: PastLine }
export type RecentBuy = { ref: PastLine; days: number; limit: number }

export type LineVerdict = {
  key: string
  name: string
  match: PastMatch | null
  /** 같은 단위(100g·100ml·1개)끼리 견준 값. 못 견주면 null */
  price: PriceChange | null
  /** 기준 날수 안에 또 샀으면 */
  recent: RecentBuy | null
  /** 장보기 목록을 쓴 영수증인데 목록 품목과 맞춰지지 않은 줄 */
  offList: boolean
  /** 이 영수증 안에 같은 이름이 또 있는 줄 */
  duplicate: boolean
}

export type CompareResult = {
  count: number
  total: number
  prevTrip: TripRef | null
  pricier: LineVerdict[]
  cheaper: LineVerdict[]
  recent: LineVerdict[]
  offList: LineVerdict[]
  duplicates: LineVerdict[]
  /** 어느 등급으로도 못 맞춘 줄(처음 사는 것) */
  first: LineVerdict[]
  listUsed: boolean
}

const round1 = (n: number) => Math.round(n * 10) / 10
const dayNumber = (date: string) => Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000)

/** 같은 상품의 지난 구매가 2번 이상이면 날짜 간격 중앙값의 절반(올림, 최소 1), 아니면 종류 표 */
function recentLimit(line: CompareLine, all: PastLine[]): number {
  const dates = [...new Set(all.map((p) => p.date))].sort()
  if (dates.length >= 2) {
    const gaps = dates.slice(1).map((d, i) => dayNumber(d) - dayNumber(dates[i])).sort((a, b) => a - b)
    const mid = gaps.length % 2 ? gaps[(gaps.length - 1) / 2] : (gaps[gaps.length / 2 - 1] + gaps[gaps.length / 2]) / 2
    return Math.max(1, Math.ceil(mid / 2))
  }
  return restockDays(line.name, line.groceryName)
}

/** 이 영수증을 장보기로 보는가: 분류가 장보기·식비이거나 장보기 품목과 맞춰진 줄이 있을 때 */
export function isGroceryEntry(categoryName: string | null, lines: CompareLine[]): boolean {
  return (categoryName !== null && GROCERY_CATEGORY_NAMES.has(categoryName)) || lines.some((l) => l.groceryName !== null)
}

/** 이번 영수증의 상품 줄들을 지난 기록(이 날짜보다 앞선 것)과 견준다 */
export function compareTrip(lines: CompareLine[], history: Transaction[], date: string, total: number, groceryCategoryIds: ReadonlySet<string>): CompareResult {
  const past = pastLines(history).filter((p) => p.date < date)
  const listUsed = lines.some((l) => l.groceryName !== null)
  const names = lines.map((l) => normName(l.name))
  const verdicts: LineVerdict[] = lines.map((line, i) => {
    const match = matchPast(line, past)
    let price: PriceChange | null = null
    let recent: RecentBuy | null = null
    if (match) {
      const now = unitOf(line), prev = unitOf(match.line)
      if (now && prev && now.base === prev.base && (match.grade === 'product' || now.base !== '1개')) {
        price = { now: round1(now.price), prev: round1(prev.price), base: now.base, diff: round1(now.price - prev.price), pct: pctChange(now.price, prev.price), ref: match.line }
      }
      const days = dayNumber(date) - dayNumber(match.line.date)
      const limit = recentLimit(line, match.all)
      if (days < limit) recent = { ref: match.line, days, limit }
    }
    return { key: line.key, name: line.name, match, price, recent, offList: listUsed && line.groceryName === null, duplicate: names[i] !== '' && names.filter((n) => n === names[i]).length > 1 }
  })
  const byPct = (sign: 1 | -1) => (a: LineVerdict, b: LineVerdict) => sign * ((b.price!.pct ?? b.price!.diff) - (a.price!.pct ?? a.price!.diff))
  const seen = new Set<string>()
  return {
    count: lines.length,
    total,
    prevTrip: trips(history, groceryCategoryIds).find((t) => t.date < date) ?? null,
    pricier: verdicts.filter((v) => v.price && v.price.diff > 0).sort(byPct(1)),
    cheaper: verdicts.filter((v) => v.price && v.price.diff < 0).sort(byPct(-1)),
    recent: verdicts.filter((v) => v.recent),
    offList: verdicts.filter((v) => v.offList),
    duplicates: verdicts.filter((v) => v.duplicate && !seen.has(normName(v.name)) && seen.add(normName(v.name))),
    first: verdicts.filter((v) => !v.match),
    listUsed,
  }
}
