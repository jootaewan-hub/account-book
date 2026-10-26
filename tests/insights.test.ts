import { describe, expect, it } from 'vitest'
import { categoryTrend, monthFacts, monthTips, projectMonth, weeklySpend } from '../src/lib/insights'
import type { Category, Transaction } from '../src/lib/types'

let seq = 0
const tx = (p: Partial<Transaction>): Transaction => ({
  id: String(++seq), household_id: 'h', type: 'expense', occurred_on: '2026-10-15', amount: 1000, title: '',
  memo: null, category_id: null, payment_method_id: null, scope: 'shared', source: 'manual',
  created_by: 'u', created_at: '', recurring_id: null, platform: null, ...p,
})
const cat = (id: string, name: string): Category => ({ id, household_id: 'h', type: 'expense', name, sort: 1, archived: false })
const CATS = [cat('food', '식비'), cat('cafe', '카페'), cat('etc', '기타'), cat('loan', '대출이자'), cat('shop', '쇼핑')]
const TODAY = '2026-10-16'
const base = { ym: '2026-10', today: TODAY, categories: CATS }

describe('주별 지출', () => {
  it('1~7, 8~14, 15~21, 22~28, 29~말일로 나누고, 이번 달의 아직 오지 않은 주는 표시한다', () => {
    const cur = [tx({ occurred_on: '2026-10-01', amount: 100 }), tx({ occurred_on: '2026-10-07', amount: 200 }),
      tx({ occurred_on: '2026-10-08', amount: 300 }), tx({ occurred_on: '2026-10-31', amount: 400 }), tx({ occurred_on: '2026-10-31', type: 'income', amount: 9999 })]
    const w = weeklySpend(cur, '2026-10', TODAY)
    expect(w.map((x) => [x.label, x.amount, x.future])).toEqual([
      ['1~7일', 300, false], ['8~14일', 300, false], ['15~21일', 0, false], ['22~28일', 0, true], ['29~31일', 400, true],
    ])
    expect(weeklySpend([], '2026-02', TODAY).map((x) => x.label)).toEqual(['1~7일', '8~14일', '15~21일', '22~28일'])
    expect(weeklySpend([], '2026-09', TODAY).every((x) => !x.future)).toBe(true)
  })
})

describe('월말 예상', () => {
  it('지난 날의 하루 평균으로 남은 날을 채운다. 이번 달이 아니거나 사흘이 안 됐으면 없음', () => {
    const cur = [tx({ occurred_on: '2026-10-02', amount: 100000 }), tx({ occurred_on: '2026-10-10', amount: 60000 })]
    expect(projectMonth(cur, '2026-10', TODAY)).toEqual({ spent: 160000, perDay: 10000, projected: 310000, daysPassed: 16, daysLeft: 15 })
    expect(projectMonth(cur, '2026-09', TODAY)).toBeNull()
    expect(projectMonth(cur, '2026-10', '2026-10-02')).toBeNull()
    expect(projectMonth([], '2026-10', TODAY)).toBeNull()
  })
})

describe('분류 추이', () => {
  it('ym을 끝으로 6개월, 빈 달은 0', () => {
    const txs = [tx({ category_id: 'cafe', occurred_on: '2026-05-03', amount: 5000 }), tx({ category_id: 'cafe', occurred_on: '2026-10-03', amount: 7000 }),
      tx({ category_id: 'food', occurred_on: '2026-10-03', amount: 99999 }), tx({ category_id: 'cafe', occurred_on: '2026-04-30', amount: 1 })]
    expect(categoryTrend(txs, 'cafe', '2026-10')).toEqual([
      { ym: '2026-05', amount: 5000 }, { ym: '2026-06', amount: 0 }, { ym: '2026-07', amount: 0 },
      { ym: '2026-08', amount: 0 }, { ym: '2026-09', amount: 0 }, { ym: '2026-10', amount: 7000 },
    ])
    expect(categoryTrend([tx({ occurred_on: '2026-10-01', amount: 3 })], null, '2026-10').at(-1)).toEqual({ ym: '2026-10', amount: 3 })
  })
})

describe('이번 달 살펴보기', () => {
  it('지출이 없으면 비어 있다', () => {
    expect(monthFacts({ ...base, cur: [tx({ type: 'income', amount: 1 })], prev: [] })).toEqual([])
  })

  it('가장 큰 분류, 가장 큰 한 건, 월말 예상, 지난달 대비 가장 늘어난 분류를 문장으로', () => {
    const cur = [
      tx({ category_id: 'loan', title: '대출이자', occurred_on: '2026-10-16', amount: 3_000_000 }),
      tx({ category_id: 'food', title: '마트', occurred_on: '2026-10-03', amount: 600_000 }),
      tx({ category_id: 'cafe', title: '카페', occurred_on: '2026-10-05', amount: 400_000 }),
    ]
    const prev = [tx({ category_id: 'food', occurred_on: '2026-09-03', amount: 500_000 }), tx({ category_id: 'cafe', occurred_on: '2026-09-05', amount: 100_000 })]
    const facts = monthFacts({ ...base, cur, prev })
    const keys = facts.map((f) => f.key)
    expect(keys).toEqual(['top', 'biggest', 'pace', 'up'])
    expect(facts[0].text).toContain('대출이자')
    expect(facts[0].text).toContain('75%')
    expect(facts[1].text).toContain('3,000,000원')
    expect(facts[1].text).toContain('10월 16일')
    expect(facts[2].text).toContain('하루 평균 250,000원')
    expect(facts[2].text).toContain('7,750,000원')
    expect(facts[3].text).toContain('카페')
    expect(facts[3].text).toContain('300,000원')
    expect(facts[3].text).toContain('+300%')
  })

  it('지난달 기록이 없으면 늘어난 분류 문장은 없고, 지난달 월이면 월말 예상도 없다', () => {
    const cur = [tx({ category_id: 'food', title: '마트', amount: 1000 })]
    expect(monthFacts({ ...base, cur, prev: [] }).map((f) => f.key)).toEqual(['top', 'biggest', 'pace'])
    expect(monthFacts({ ...base, ym: '2026-09', cur: [tx({ occurred_on: '2026-09-02', category_id: 'food', amount: 1000 })], prev: [] }).map((f) => f.key))
      .toEqual(['top', 'biggest'])
  })
})

describe('살펴보기와 고정지출 예정분 (D-030 보충)', () => {
  it('가장 큰 한 건은 실제로 나간 것 중에서, 고정지출 문장은 앞으로 나갈 몫을 밝힌다. 월말 예상은 오늘까지만 센다', () => {
    const rent = tx({ occurred_on: '2026-10-25', amount: 500000, title: '월세', recurring_id: 'r', source: 'recurring', planned: { kind: 'fixed', round: null } })
    const phone = tx({ occurred_on: '2026-10-05', amount: 55000, title: '휴대폰', recurring_id: 'p', source: 'recurring' })
    const cur = [rent, phone, tx({ occurred_on: '2026-10-03', amount: 45000, title: '외식', category_id: 'food' })]
    const facts = Object.fromEntries(monthFacts({ ...base, cur, prev: [] }).map((f) => [f.key, f.text]))
    expect(facts.biggest).toBe('가장 큰 지출은 10월 5일 휴대폰 55,000원이에요.')
    expect(facts.recurring).toBe('고정지출·구독이 555,000원(앞으로 나갈 500,000원 포함), 전체의 93%예요.')
    expect(facts.pace).toBe('하루 평균 6,250원 썼어요. 이대로면 월말에 약 193,750원이에요.')
  })
})

describe('이렇게 해 보면 (개선점)', () => {
  it('기타·분류 없음이 40% 이상이면 분류를 나누라고 한다', () => {
    const cur = [tx({ category_id: 'etc', amount: 60 }), tx({ category_id: null, amount: 10 }), tx({ category_id: 'food', amount: 30 })]
    const tips = monthTips({ ...base, cur, prev: [] })
    expect(tips.map((t) => t.key)).toContain('uncategorized')
    expect(tips.find((t) => t.key === 'uncategorized')!.text).toContain('70%')
    expect(monthTips({ ...base, cur: [tx({ category_id: 'etc', amount: 39 }), tx({ category_id: 'food', amount: 61 })], prev: [] }).map((t) => t.key))
      .not.toContain('uncategorized')
  })

  it('한 건이 30% 이상인데 고정 탭에 없으면 등록을 권한다. 반복으로 들어온 내역은 제외', () => {
    const big = tx({ title: '대출이자', amount: 3_000_000 })
    const rest = [tx({ amount: 1_000_000 })]
    expect(monthTips({ ...base, cur: [big, ...rest], prev: [] }).find((t) => t.key === 'fixed')?.text).toContain('대출이자')
    expect(monthTips({ ...base, cur: [{ ...big, recurring_id: 'r1' }, ...rest], prev: [] }).map((t) => t.key)).not.toContain('fixed')
  })

  it('분류가 지난달보다 30%·5만원 이상 늘면 그 차액을 아낄 수 있다고 한다', () => {
    const cur = [tx({ category_id: 'cafe', amount: 160_000 })]
    const prev = [tx({ category_id: 'cafe', occurred_on: '2026-09-10', amount: 100_000 })]
    const t = monthTips({ ...base, cur, prev }).find((x) => x.key === 'surge')!
    expect(t.text).toContain('카페')
    expect(t.text).toContain('60%')
    expect(t.saving).toBe(60_000)
    expect(monthTips({ ...base, cur: [tx({ category_id: 'cafe', amount: 120_000 })], prev }).map((x) => x.key)).not.toContain('surge')
  })

  it('한 분류에 8번 이상, 한 번에 평균 1만 5천원 이하면 횟수를 줄이자고 한다 (주 1회 × 4)', () => {
    const cur = Array.from({ length: 10 }, (_, i) => tx({ category_id: 'cafe', occurred_on: `2026-10-${String(i + 1).padStart(2, '0')}`, amount: 5000 }))
    const t = monthTips({ ...base, cur, prev: [] }).find((x) => x.key === 'frequent')!
    expect(t.text).toContain('카페')
    expect(t.text).toContain('10번')
    expect(t.saving).toBe(20_000)
    const bills = Array.from({ length: 10 }, () => tx({ category_id: 'loan', amount: 5000 }))
    expect(monthTips({ ...base, cur: bills, prev: [] }).map((x) => x.key)).not.toContain('frequent')
  })

  it('배송비가 3건 이상이면 합계를 알려 주고, 이대로면 지난달을 넘길 때는 남은 날 예산을 알려 준다', () => {
    const cur = [tx({ title: '배송비', amount: 3000 }), tx({ title: '배송비', amount: 3000 }), tx({ title: '배송비', amount: 2500 }),
      tx({ title: '마트', occurred_on: '2026-10-02', amount: 600_000 })]
    const prev = [tx({ occurred_on: '2026-09-02', amount: 900_000 })]
    const tips = monthTips({ ...base, cur, prev })
    expect(tips.find((t) => t.key === 'shipping')?.text).toContain('8,500원')
    // 16일까지 608,500원 → 하루 38,031원 → 월말 약 1,178,965원. 지난달 900,000원까지 남은 291,500원을 15일로 나누면 하루 19,433원
    const pace = tips.find((t) => t.key === 'pace')!
    expect(pace.text).toContain('900,000원')
    expect(pace.text).toContain('남은 15일')
    expect(pace.text).toContain('19,433원')
    // 이미 지난달 전체를 넘겼으면 남은 날 예산 대신 그 사실을 말한다
    const over = monthTips({ ...base, cur: [tx({ occurred_on: '2026-10-02', amount: 1_000_000 })], prev }).find((t) => t.key === 'pace')!
    expect(over.text).toContain('벌써')
    expect(over.text).toContain('100,000원')
  })

  it('아낄 수 있는 금액이 큰 것부터, 금액이 없는 것은 뒤에', () => {
    const cur = [
      ...Array.from({ length: 8 }, (_, i) => tx({ category_id: 'cafe', occurred_on: `2026-10-${String(i + 1).padStart(2, '0')}`, amount: 4000 })),
      tx({ category_id: 'shop', amount: 300_000 }), tx({ category_id: 'etc', amount: 400_000 }),
    ]
    const prev = [tx({ category_id: 'shop', occurred_on: '2026-09-01', amount: 100_000 })]
    const tips = monthTips({ ...base, cur, prev })
    // pace: 월말 예상 − 지난달 = 아낄 수 있는 돈이 가장 큼. 기타 400,000은 이름이 없어 고정 탭 제안(fixed)은 안 나온다
    expect(tips.map((t) => t.key)).toEqual(['pace', 'surge', 'frequent', 'uncategorized'])
  })

  it('지출이 없으면 비어 있다', () => {
    expect(monthTips({ ...base, cur: [], prev: [] })).toEqual([])
  })
})
