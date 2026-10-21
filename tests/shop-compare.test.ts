import { describe, expect, it } from 'vitest'
import { compareTrip, isGroceryEntry, matchPast, nameTokens, normName, pastLines, restockDays, trips, unitOf, type CompareLine } from '../src/lib/shopCompare'
import type { Transaction, TxItem } from '../src/lib/types'

type ItemIn = Partial<TxItem> & { name: string; amount: number }
let seq = 0
const tx = (id: string, date: string, title: string, items: ItemIn[], createdAt = '2026-10-20T08:00:00Z', categoryId: string | null = 'food'): Transaction => ({
  id, household_id: 'h', type: 'expense', occurred_on: date, amount: items.reduce((s, i) => s + i.amount, 0), title, memo: null, category_id: categoryId,
  payment_method_id: null, scope: 'shared', source: 'photo', created_by: 'u', created_at: createdAt, recurring_id: null, platform: null,
  items: items.map((i, k) => ({ id: `i${++seq}`, quantity: 1, unit_price: i.amount, pack_size: null, pack_unit: null, image_path: null, sort: k + 1, ...i })),
})
const line = (name: string, amount: number, p: Partial<CompareLine> = {}): CompareLine =>
  ({ key: `k${++seq}`, name, quantity: 1, unitPrice: amount, amount, packSize: null, packUnit: null, groceryName: null, ...p })
const FOOD = new Set(['food'])

describe('이름 맞추기', () => {
  it('정규화와 단어 나누기', () => {
    expect(normName('★진라면 순한맛 (120GX5)')).toBe('진라면순한맛120gx5')
    expect(nameTokens('*국산 양파 1.5kg(망)')).toEqual(['양파'])
    expect(nameTokens('서울 저지방 우유 1L*2')).toEqual(['서울', '저지방', '우유'])
    expect(nameTokens('오뚜기 하프케챱 280G')).toEqual(['오뚜기', '하프케챱'])
  })

  it('같은 상품: 정규화 이름 포함(짧은 쪽 4자 이상) 또는 단어 2개 겹침', () => {
    const past = pastLines([tx('p1', '2026-10-14', '이마트', [{ name: '서울저지방우유 1L*2입', amount: 5480, pack_size: 2000, pack_unit: 'ml' }])])
    expect(matchPast(line('서울 저지방 우유 1L*2', 5990), past)?.grade).toBe('product')
    expect(matchPast(line('오뚜기 하프 케챱', 2090), pastLines([tx('p2', '2026-10-14', '이마트', [{ name: '오뚜기 하프케챱 280G 기획', amount: 1990 }])]))?.grade).toBe('product')
    expect(matchPast(line('풀무원 그릭 플레인 400g', 3890), pastLines([tx('p3', '2026-10-14', '이마트', [{ name: '풀무원 국산콩 두부 300g', amount: 2800 }])]))).toBeNull()
    expect(matchPast(line('*국산 대파(봉) 600g', 3200), pastLines([tx('p4', '2026-10-14', '이마트', [{ name: '*국산 양파 1.5kg(망)', amount: 3990 }])]))).toBeNull()
    expect(matchPast(line('두부', 2800), pastLines([tx('p5', '2026-10-14', '이마트', [{ name: '부침두부 300g', amount: 2800 }])]))).toBeNull() // 두 글자는 포함으로 맞추지 않는다
  })

  it('같은 품목: 연결된 장보기 품목 이름이 지난 상품명에 들어 있을 때, 최근 것부터', () => {
    const past = pastLines([
      tx('p1', '2026-09-11', '이마트', [{ name: '해찬들 재래식 된장 1kg', amount: 7990, pack_size: 1000, pack_unit: 'g' }]),
      tx('p2', '2026-10-11', '홈플러스', [{ name: '샘표 토장 500g', amount: 4500, pack_size: 500, pack_unit: 'g' }, { name: '순창 된장 500g', amount: 4990, pack_size: 500, pack_unit: 'g' }]),
    ])
    const m = matchPast(line('청정원 순창 재래식 생된장 500g', 4990, { groceryName: '된장' }), past)
    expect(m?.grade).toBe('kind')
    expect(m?.line).toMatchObject({ date: '2026-10-11', name: '순창 된장 500g', place: '홈플러스' })
    expect(m?.all.map((p) => p.date)).toEqual(['2026-10-11', '2026-09-11'])
    expect(matchPast(line('청정원 순창 재래식 생된장 500g', 4990), past)).toBeNull()
  })

  it('지난 줄은 상품 줄만(배송비·봉투·할인 줄 제외), 가게는 플랫폼 또는 제목', () => {
    const past = pastLines([{ ...tx('p1', '2026-10-14', '이마트', [{ name: '배송비', amount: 3000 }, { name: '봉투 20L', amount: 500 }, { name: '할인액', amount: -1000 }, { name: '우유', amount: 2500 }]), platform: '컬리' }])
    expect(past.map((p) => [p.name, p.place])).toEqual([['우유', '컬리']])
  })
})

describe('값 비교와 최근 구매', () => {
  it('용량이 있으면 100ml당으로, 없으면 개당으로', () => {
    expect(unitOf({ quantity: 1, unitPrice: 5990, amount: 5990, packSize: 2000, packUnit: 'ml' })).toEqual({ base: '100ml', price: 299.5 })
    expect(unitOf({ quantity: 2, unitPrice: null, amount: 5000, packSize: null, packUnit: null })).toEqual({ base: '1개', price: 2500 })
    expect(unitOf({ quantity: 0, unitPrice: null, amount: 5000, packSize: null, packUnit: null })).toBeNull()
    const history = [tx('p1', '2026-10-14', '이마트', [{ name: '서울저지방우유 1L*2입', amount: 5480, pack_size: 2000, pack_unit: 'ml' }])]
    const r = compareTrip([line('서울 저지방 우유 1L*2', 5990, { packSize: 2000, packUnit: 'ml' })], history, '2026-10-21', 5990, FOOD)
    expect(r.pricier).toHaveLength(1)
    expect(r.pricier[0].price).toMatchObject({ base: '100ml', now: 299.5, prev: 274, diff: 25.5, pct: 9.3, ref: { date: '2026-10-14', place: '이마트' } })
    expect(r.cheaper).toEqual([])
    expect(r.first).toEqual([])
  })

  it('같은 품목 등급은 용량 값이 없으면 값을 견주지 않고, 단위가 다르면 견주지 않는다', () => {
    const past = [tx('p1', '2026-09-11', '이마트', [{ name: '해찬들 재래식 된장 1kg', amount: 7990, pack_size: 1000, pack_unit: 'g' }])]
    const kind = compareTrip([line('청정원 생된장', 4990, { groceryName: '된장' })], past, '2026-10-21', 4990, FOOD)
    expect(kind.pricier.concat(kind.cheaper)).toEqual([])
    expect(kind.first).toEqual([])
    const withPack = compareTrip([line('청정원 생된장 500g', 4990, { groceryName: '된장', packSize: 500, packUnit: 'g' })], past, '2026-10-21', 4990, FOOD)
    expect(withPack.pricier[0].price).toMatchObject({ base: '100g', now: 998, prev: 799, diff: 199 })
    const other = compareTrip([line('청정원 생된장 500ml', 4990, { groceryName: '된장', packSize: 500, packUnit: 'ml' })], past, '2026-10-21', 4990, FOOD)
    expect(other.pricier.concat(other.cheaper)).toEqual([])
  })

  it('최근에 또 산 것: 종류 표(추측)와 지난 구매 간격 중앙값의 절반', () => {
    expect(restockDays('청정원 순창 재래식 생된장 500g', '된장')).toBe(45)
    expect(restockDays('서울 저지방 우유', null)).toBe(5)
    expect(restockDays('포카칩오리지널66g', null)).toBe(10)
    expect(restockDays('*국산 대파(봉) 600g', '대파')).toBe(3)
    expect(restockDays('이름 없는 것', null)).toBe(7)
    const once = [tx('p1', '2026-10-11', '이마트', [{ name: '청정원 순창 재래식 생된장 500g', amount: 4990 }])]
    const r = compareTrip([line('청정원 순창 재래식 생된장 500g', 4990)], once, '2026-10-21', 4990, FOOD)
    expect(r.recent).toHaveLength(1)
    expect(r.recent[0].recent).toMatchObject({ days: 10, limit: 45, ref: { date: '2026-10-11' } })
    const twice = [
      tx('p1', '2026-08-22', '이마트', [{ name: '청정원 순창 재래식 생된장 500g', amount: 4990 }]),
      tx('p2', '2026-09-21', '이마트', [{ name: '청정원 순창 재래식 생된장 500g', amount: 4990 }]),
    ]
    expect(compareTrip([line('청정원 순창 재래식 생된장 500g', 4990)], twice, '2026-10-01', 4990, FOOD).recent[0].recent).toMatchObject({ days: 10, limit: 15 })
    expect(compareTrip([line('청정원 순창 재래식 생된장 500g', 4990)], twice, '2026-10-11', 4990, FOOD).recent).toEqual([])
    // 같은 날 기록은 지난 구매로 보지 않는다(같은 영수증을 다시 올린 경우)
    expect(compareTrip([line('청정원 순창 재래식 생된장 500g', 4990)], once, '2026-10-11', 4990, FOOD).first).toHaveLength(1)
  })
})

describe('장보기 묶음과 목록', () => {
  it('상품별로 나눈 영수증도 같은 시각이면 한 번의 장보기, 장보기·식비 분류인 묶음만', () => {
    const t = [...Array(4)].map((_, i) => tx(`s${i}`, '2026-10-14', `상품${i}`, [{ name: `상품${i}`, amount: 1000 }], `2026-10-20T08:00:3${i}Z`, 'food'))
    expect(trips(t, FOOD)).toEqual([{ date: '2026-10-14', place: '장보기', count: 4, total: 4000 }])
    expect(trips(t, new Set(['other']))).toEqual([]) // 쿠팡 가전 주문 같은 묶음은 지난 장보기가 아니다
    expect(trips([tx('a', '2026-10-14', '이마트', [{ name: 'x', amount: 1 }])], FOOD)).toEqual([]) // 상품 3개 미만
    // 한 내역에 상품이 여럿이면 가게는 그 내역의 제목, 묶음이 여럿이면 최근 날짜 먼저
    const big = tx('b', '2026-10-21', '뉴코아 야탑점', [{ name: 'a', amount: 100 }, { name: 'b', amount: 200 }, { name: 'c', amount: 300 }], '2026-10-21T09:00:00Z')
    expect(trips([...t, big], FOOD).map((x) => [x.date, x.place, x.count, x.total])).toEqual([['2026-10-21', '뉴코아 야탑점', 3, 600], ['2026-10-14', '장보기', 4, 4000]])
    // 6분 떨어진 내역은 다른 묶음
    const late = tx('s9', '2026-10-14', '상품9', [{ name: '상품9', amount: 1000 }, { name: '상품10', amount: 1000 }, { name: '상품11', amount: 1000 }], '2026-10-20T08:07:00Z', 'food')
    expect(trips([...t, late], FOOD)).toHaveLength(2)
  })

  it('지난 장보기는 이번 날짜보다 앞선 묶음, 없으면 null', () => {
    const t = [...Array(3)].map((_, i) => tx(`s${i}`, '2026-10-14', `상품${i}`, [{ name: `상품${i}`, amount: 1000 }], `2026-10-20T08:00:3${i}Z`, 'food'))
    expect(compareTrip([line('x', 1)], t, '2026-10-21', 1, FOOD).prevTrip).toEqual({ date: '2026-10-14', place: '장보기', count: 3, total: 3000 })
    expect(compareTrip([line('x', 1)], t, '2026-10-14', 1, FOOD).prevTrip).toBeNull()
    expect(compareTrip([line('x', 1)], [], '2026-10-21', 1, FOOD).prevTrip).toBeNull()
  })

  it('목록에 없던 것은 목록을 쓴 영수증에서만, 같은 것이 두 줄', () => {
    const lines = [line('삼겹살', 10000, { groceryName: '삼겹살' }), line('삼겹살', 9000), line('포카칩', 1590)]
    const r = compareTrip(lines, [], '2026-10-21', 20590, FOOD)
    expect(r.listUsed).toBe(true)
    expect(r.offList.map((v) => v.name)).toEqual(['삼겹살', '포카칩'])
    expect(r.duplicates.map((v) => v.name)).toEqual(['삼겹살'])
    expect(r.first.map((v) => v.name)).toEqual(['삼겹살', '삼겹살', '포카칩'])
    expect(r.count).toBe(3)
    const noList = compareTrip([line('포카칩', 1590)], [], '2026-10-21', 1590, FOOD)
    expect(noList.listUsed).toBe(false)
    expect(noList.offList).toEqual([])
  })

  it('장보기로 보는 영수증: 분류가 장보기·식비이거나 장보기 품목과 맞춰진 줄이 있을 때', () => {
    expect(isGroceryEntry('장보기', [line('x', 1)])).toBe(true)
    expect(isGroceryEntry('식비', [])).toBe(true)
    expect(isGroceryEntry('가전·전자', [line('x', 1, { groceryName: '건전지' })])).toBe(true)
    expect(isGroceryEntry('외식', [line('Lasagna', 25900)])).toBe(false)
    expect(isGroceryEntry(null, [])).toBe(false)
  })
})
