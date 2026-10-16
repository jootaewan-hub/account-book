// 통계 화면의 '이번 달 살펴보기'(사실)와 '이렇게 해 보면'(개선점) 문장, 주별 지출, 월말 예상, 분류 추이.
// 모두 이미 불러온 내역으로만 계산한다. 문장은 한국어 문장형으로, 숫자는 won()으로 적는다.
import { addMonths, dayOf, daysInMonth } from './dates'
import { won } from './format'
import { sumType } from './ledger'
import { pctChange } from './stats'
import type { Category, Transaction } from './types'

export interface WeekRow {
  label: string
  from: number
  to: number
  amount: number
  /** 이번 달에서 아직 오지 않은 주 (막대 대신 빈칸) */
  future: boolean
}

/** 1~7, 8~14, 15~21, 22~28, 29~말일 */
export function weeklySpend(cur: Transaction[], ym: string, today: string): WeekRow[] {
  const days = daysInMonth(ym)
  const thisMonth = today.slice(0, 7)
  const rows: WeekRow[] = []
  for (let from = 1; from <= days; from += 7) {
    const to = from + 6 >= days ? days : from + 6
    const amount = cur.reduce((s, t) => {
      const d = dayOf(t.occurred_on)
      return t.type === 'expense' && d >= from && d <= to ? s + t.amount : s
    }, 0)
    const future = ym > thisMonth || (ym === thisMonth && from > dayOf(today))
    rows.push({ label: `${from}~${to}일`, from, to, amount, future })
  }
  return rows
}

export interface Projection {
  spent: number
  perDay: number
  projected: number
  daysPassed: number
  daysLeft: number
}

/** 이번 달 지금까지의 하루 평균으로 남은 날을 채운 월말 예상. 이번 달이 아니거나 사흘이 안 됐거나 지출이 없으면 null */
export function projectMonth(cur: Transaction[], ym: string, today: string): Projection | null {
  if (ym !== today.slice(0, 7)) return null
  const daysPassed = dayOf(today)
  if (daysPassed < 3) return null
  const spent = sumType(cur, 'expense', daysPassed)
  if (spent <= 0) return null
  const perDay = Math.round(spent / daysPassed)
  const daysLeft = daysInMonth(ym) - daysPassed
  return { spent, perDay, projected: spent + perDay * daysLeft, daysPassed, daysLeft }
}

/** ym을 끝으로 n개월의 한 분류 지출 (빈 달은 0). categoryId가 null이면 분류 없는 지출 */
export function categoryTrend(txs: Transaction[], categoryId: string | null, ym: string, n = 6): { ym: string; amount: number }[] {
  const out = Array.from({ length: n }, (_, i) => ({ ym: addMonths(ym, i - (n - 1)), amount: 0 }))
  for (const t of txs) {
    if (t.type !== 'expense' || t.category_id !== categoryId) continue
    const p = out.find((o) => t.occurred_on.startsWith(o.ym))
    if (p) p.amount += t.amount
  }
  return out
}

export interface InsightInput {
  cur: Transaction[]
  prev: Transaction[]
  ym: string
  today: string
  categories: Category[]
}

export interface Fact { key: string; text: string }
export interface Tip {
  key: string
  text: string
  /** 한 달에 아낄 수 있을 금액. 금액으로 말할 수 없는 제안은 null */
  saving: number | null
}

interface CatSum { id: string | null; name: string; amount: number; count: number; prev: number }

function byCategory(cur: Transaction[], prev: Transaction[], categories: Category[]): CatSum[] {
  const names = new Map(categories.map((c) => [c.id, c.name]))
  const m = new Map<string | null, CatSum>()
  for (const t of cur) {
    if (t.type !== 'expense') continue
    const row = m.get(t.category_id) ?? { id: t.category_id, name: (t.category_id && names.get(t.category_id)) || '분류 없음', amount: 0, count: 0, prev: 0 }
    row.amount += t.amount; row.count++
    m.set(t.category_id, row)
  }
  for (const t of prev) {
    if (t.type !== 'expense') continue
    const row = m.get(t.category_id)
    if (row) row.prev += t.amount
  }
  return [...m.values()].sort((a, b) => b.amount - a.amount)
}

const md = (date: string) => `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일`
const pct = (part: number, whole: number) => Math.round((part / whole) * 100)

/** 이번 달 살펴보기: 가장 큰 분류, 가장 큰 한 건, 월말 예상, 지난달 대비 가장 늘어난·줄어든 분류, 고정지출 비중 */
export function monthFacts({ cur, prev, ym, today, categories }: InsightInput): Fact[] {
  const total = sumType(cur, 'expense')
  if (total <= 0) return []
  const cats = byCategory(cur, prev, categories)
  const facts: Fact[] = []

  const top = cats[0]
  facts.push({ key: 'top', text: `${top.name}에 가장 많이 썼어요. ${won(top.amount)}원, 전체의 ${pct(top.amount, total)}%예요.` })

  const biggest = cur.filter((t) => t.type === 'expense').sort((a, b) => b.amount - a.amount)[0]
  const bName = biggest.title || cats.find((c) => c.id === biggest.category_id)?.name || '이름 없음'
  facts.push({ key: 'biggest', text: `가장 큰 지출은 ${md(biggest.occurred_on)} ${bName} ${won(biggest.amount)}원이에요.` })

  const proj = projectMonth(cur, ym, today)
  if (proj) {
    const prevTotal = sumType(prev, 'expense')
    const vs = prevTotal > 0 ? ` 지난달(${won(prevTotal)}원)보다 ${proj.projected > prevTotal ? '많아요' : '적어요'}.` : ''
    facts.push({ key: 'pace', text: `하루 평균 ${won(proj.perDay)}원 썼어요. 이대로면 월말에 약 ${won(proj.projected)}원이에요.${vs}` })
  }

  if (prev.some((t) => t.type === 'expense')) {
    // 지난달에도 있던 분류만 '늘었다'고 한다. 새로 생긴 분류는 늘어난 게 아니라 새로 쓴 것
    const up = cats.filter((c) => c.prev > 0 && c.amount - c.prev >= 10_000).sort((a, b) => (b.amount - b.prev) - (a.amount - a.prev))[0]
    if (up) facts.push({ key: 'up', text: `${up.name} 지출이 지난달보다 ${won(up.amount - up.prev)}원 늘었어요 (+${pctChange(up.amount, up.prev)}%).` })
    const down = cats.filter((c) => c.prev - c.amount >= 10_000).sort((a, b) => (b.prev - b.amount) - (a.prev - a.amount))[0]
    if (down) facts.push({ key: 'down', text: `${down.name} 지출은 지난달보다 ${won(down.prev - down.amount)}원 줄었어요 (${pctChange(down.amount, down.prev)}%).` })
  }

  const recurring = cur.filter((t) => t.type === 'expense' && t.recurring_id).reduce((s, t) => s + t.amount, 0)
  if (recurring > 0) facts.push({ key: 'recurring', text: `고정지출·구독으로 들어간 돈이 ${won(recurring)}원, 전체의 ${pct(recurring, total)}%예요.` })

  return facts
}

/** 횟수를 줄이자고 말하지 않는 분류 (내기 싫어도 내야 하는 것) */
const NOT_DISCRETIONARY = ['관리비', '공과금', '보험', '통신', '월세', '대출', '이자', '의료', '병원', '교육', '자녀', '구독', '세금', '저축', '투자', '교통']
const isDiscretionary = (name: string) => !NOT_DISCRETIONARY.some((w) => name.includes(w))

/** 이렇게 해 보면: 규칙으로 찾는 개선점. 아낄 수 있는 금액이 큰 것부터, 금액이 없는 제안은 뒤에 */
export function monthTips({ cur, prev, ym, today, categories }: InsightInput): Tip[] {
  const total = sumType(cur, 'expense')
  if (total <= 0) return []
  const cats = byCategory(cur, prev, categories)
  const tips: Tip[] = []

  // 이대로면 지난달을 넘긴다
  const proj = projectMonth(cur, ym, today)
  const prevTotal = sumType(prev, 'expense')
  if (proj && prevTotal > 0 && proj.projected > prevTotal * 1.1) {
    const over = proj.projected - prevTotal
    if (proj.spent < prevTotal && proj.daysLeft > 0) {
      const budget = Math.floor((prevTotal - proj.spent) / proj.daysLeft)
      tips.push({ key: 'pace', saving: over,
        text: `이대로면 월말에 지난달(${won(prevTotal)}원)보다 약 ${won(over)}원 더 쓰게 돼요. 남은 ${proj.daysLeft}일을 하루 ${won(budget)}원 안에서 쓰면 지난달과 같아져요.` })
    } else {
      tips.push({ key: 'pace', saving: over, text: `벌써 지난달 전체(${won(prevTotal)}원)보다 ${won(proj.spent - prevTotal)}원 더 썼어요. 남은 ${proj.daysLeft}일은 꼭 필요한 것만 사 보세요.` })
    }
  }

  // 지난달보다 크게 늘어난 분류
  const surge = cats.filter((c) => c.prev > 0 && c.amount - c.prev >= 50_000 && (pctChange(c.amount, c.prev) ?? 0) >= 30)
    .sort((a, b) => (b.amount - b.prev) - (a.amount - a.prev))[0]
  if (surge) {
    tips.push({ key: 'surge', saving: surge.amount - surge.prev,
      text: `${surge.name} 지출이 지난달보다 ${pctChange(surge.amount, surge.prev)}% 늘었어요 (${won(surge.prev)}원 → ${won(surge.amount)}원). 지난달 수준으로 돌리면 ${won(surge.amount - surge.prev)}원을 아껴요.` })
  }

  // 잦은 소액 지출
  const frequent = cats.filter((c) => c.count >= 8 && c.amount / c.count <= 15_000 && isDiscretionary(c.name)).sort((a, b) => b.count - a.count)[0]
  if (frequent) {
    const avg = Math.round(frequent.amount / frequent.count)
    tips.push({ key: 'frequent', saving: avg * 4,
      text: `${frequent.name} ${frequent.count}번, 한 번에 평균 ${won(avg)}원이에요. 주에 한 번만 줄여도 한 달 약 ${won(avg * 4)}원이에요.` })
  }

  // 큰 지출 한 건이 고정 탭에 없다
  const big = cur.filter((t) => t.type === 'expense' && t.title && !t.recurring_id).sort((a, b) => b.amount - a.amount)[0]
  if (big && big.amount / total >= 0.3) {
    tips.push({ key: 'fixed', saving: null,
      text: `${big.title} ${won(big.amount)}원이 이번 달의 ${pct(big.amount, total)}%예요. 매달 나가는 돈이라면 고정 탭에 등록해 두면 날짜에 맞춰 자동으로 들어가요.` })
  }

  // 분류가 안 나뉘어 있다
  const vague = cats.filter((c) => c.id === null || c.name === '기타').reduce((s, c) => s + c.amount, 0)
  if (vague / total >= 0.4) {
    tips.push({ key: 'uncategorized', saving: null, text: `기타·분류 없음이 전체의 ${pct(vague, total)}%예요. 분류를 나누면 어디에 쓰는지가 보여요.` })
  }

  // 배송비
  const ship = cur.filter((t) => t.type === 'expense' && t.title === '배송비')
  if (ship.length >= 3) {
    tips.push({ key: 'shipping', saving: null, text: `배송비로 ${won(ship.reduce((s, t) => s + t.amount, 0))}원 썼어요 (${ship.length}번). 장바구니에 모아 한 번에 주문하면 줄어요.` })
  }

  return tips.sort((a, b) => (b.saving ?? -1) - (a.saving ?? -1))
}
