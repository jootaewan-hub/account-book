import { describe, expect, it } from 'vitest'
import { buildEntries, itemLabel, ledgerCategoryFor, linksByTx, matchReceipt, parsePack, receiptLines, type PurchaseInput } from '../../src/grocery/lib/purchase'
import type { Item } from '../../src/grocery/lib/types'
import type { Category as LedgerCategory } from '../../src/lib/types'

const NAMES = ['식비', '장보기', '세제·소모품', '욕실·청소', '생활용품', '주방용품', '기타']
const cats = (hidden: string[] = []): LedgerCategory[] =>
  NAMES.map((name, i) => ({ id: `c-${name}`, household_id: 'h', type: 'expense', name, sort: i, archived: hidden.includes(name) }))

const item = (p: Partial<Item>): Item => ({
  id: 'i', householdId: 'h', name: '품목', spec: null, count: 1, category: '기타', productKey: null, productQty: null,
  addedBy: 'u', addedAt: 't', boughtBy: 'u', boughtAt: '2026-10-18T03:00:00Z', paid: null, transactionId: null, ...p,
})

describe('가계부 분류 대응표(통합 설계 6-3)', () => {
  it('먹거리 9개는 장보기', () => {
    for (const category of ['정육', '수산', '채소', '과일', '유제품', '계란', '가공', '냉동', '음료'] as const)
      expect(ledgerCategoryFor({ name: '아무거나', category }, cats())).toBe('c-장보기')
  })
  it('생활용품은 가계부 이름 규칙으로, 없으면 생활용품', () => {
    expect(ledgerCategoryFor({ name: '세탁 세제', category: '생활용품' }, cats())).toBe('c-세제·소모품')
    expect(ledgerCategoryFor({ name: '고무장갑', category: '생활용품' }, cats())).toBe('c-욕실·청소')
    expect(ledgerCategoryFor({ name: '건전지 아닌 무엇', category: '생활용품' }, cats())).toBe('c-세제·소모품') // '건전지' 규칙
    expect(ledgerCategoryFor({ name: '양초', category: '생활용품' }, cats())).toBe('c-생활용품')
  })
  it('기타는 가계부 이름 규칙으로, 없으면 장보기', () => {
    expect(ledgerCategoryFor({ name: '프라이팬', category: '기타' }, cats())).toBe('c-주방용품')
    expect(ledgerCategoryFor({ name: '고수', category: '기타' }, cats())).toBe('c-장보기')
  })
  it('대응한 분류가 숨겨졌으면 장보기, 그것도 없으면 null', () => {
    expect(ledgerCategoryFor({ name: '양초', category: '생활용품' }, cats(['생활용품']))).toBe('c-장보기')
    expect(ledgerCategoryFor({ name: '대파', category: '채소' }, cats(['장보기']))).toBeNull()
  })
})

describe('용량 읽기', () => {
  it('g·ml·셈 단위, kg·L는 g·ml로', () => {
    expect(parsePack('600g')).toEqual({ pack_size: 600, pack_unit: 'g' })
    expect(parsePack('1.05kg')).toEqual({ pack_size: 1050, pack_unit: 'g' })
    expect(parsePack('900ml')).toEqual({ pack_size: 900, pack_unit: 'ml' })
    expect(parsePack('2.3L')).toEqual({ pack_size: 2300, pack_unit: 'ml' })
    expect(parsePack('30구')).toEqual({ pack_size: 30, pack_unit: '구' })
    expect(parsePack('30롤')).toEqual({ pack_size: 30, pack_unit: '롤' })
  })
  it('못 읽으면 null', () => {
    expect(parsePack(null)).toBeNull()
    expect(parsePack('1단')).toBeNull()
    expect(parsePack('큰 것')).toBeNull()
    expect(parsePack('0g')).toBeNull()
  })
})

describe('가계부에 넣을 내역 만들기', () => {
  const base: PurchaseInput = { date: '2026-10-18', place: '이마트', scope: 'shared', mode: 'each', amounts: {}, total: null, categoryOf: {} }
  const a = item({ id: 'a', name: '대파', category: '채소' })
  const b = item({ id: 'b', name: '우유', spec: '900ml', count: 2, category: '유제품' })
  const c = item({ id: 'c', name: '세제', category: '생활용품' })

  it('품목마다 금액: 품목마다 내역 하나, 합계는 적은 금액과 같다', () => {
    const r = buildEntries([a, b], { ...base, amounts: { a: 3000, b: 5000 }, categoryOf: { a: 'c-장보기', b: 'c-장보기' } }, cats())
    if ('error' in r) throw new Error(r.error)
    expect(r.entries).toHaveLength(2)
    expect(r.entries.reduce((s, e) => s + e.tx.amount, 0)).toBe(8000)
    const milk = r.entries[1]
    expect(milk.tx.title).toBe('우유 900ml')
    expect(milk.items).toEqual([{ name: '우유 900ml', quantity: 2, unit_price: null, amount: 5000, pack_size: 900, pack_unit: 'ml' }])
    expect(milk.links).toEqual([{ item_id: 'b', paid: 5000 }])
    expect(r.entries[0].items[0].unit_price).toBe(3000) // 1개면 개당 = 금액
    // 매장에서 산 것은 플랫폼 없이 메모에 가게 이름
    expect(milk.tx.platform).toBeNull()
    expect(milk.tx.memo).toBe('산 곳: 이마트')
    expect(milk.tx.source).toBe('manual')
  })

  it('온라인 몰이면 플랫폼 칸에 넣고 메모는 비운다', () => {
    const r = buildEntries([a], { ...base, place: '쿠팡', amounts: { a: 3000 } }, cats())
    if ('error' in r) throw new Error(r.error)
    expect(r.entries[0].tx.platform).toBe('쿠팡')
    expect(r.entries[0].tx.memo).toBeNull()
  })

  it('품목마다 금액인데 하나라도 비면 그 품목을 알려 준다', () => {
    expect(buildEntries([a, b], { ...base, amounts: { a: 3000 } }, cats())).toEqual({ error: '우유 금액을 적어 주세요.' })
    expect(buildEntries([a], { ...base, amounts: { a: 0 } }, cats())).toEqual({ error: '대파 금액을 적어 주세요.' })
    expect(buildEntries([a], { ...base, amounts: { a: 12.5 } }, cats())).toEqual({ error: '대파 금액을 적어 주세요.' })
  })

  it('총액: 내역 하나, 매장이면 가게 이름, 품목 줄 없이 메모에 품목, 금액은 연결에 넣지 않는다', () => {
    const r = buildEntries([a, b], { ...base, mode: 'total', total: 8000, categoryOf: { a: 'c-장보기', b: 'c-장보기' } }, cats())
    if ('error' in r) throw new Error(r.error)
    expect(r.entries).toHaveLength(1)
    const e = r.entries[0]
    expect(e.tx).toMatchObject({ amount: 8000, title: '이마트', memo: '대파, 우유 900ml', category_id: 'c-장보기', platform: null })
    expect(e.items).toEqual([])
    expect(e.links).toEqual([{ item_id: 'a', paid: null }, { item_id: 'b', paid: null }])
  })

  it('총액: 온라인이거나 가게를 안 적으면 상품명으로, 분류가 섞이면 장보기', () => {
    const r = buildEntries([a, c], { ...base, place: '', mode: 'total', total: 9000, categoryOf: { a: 'c-장보기', c: 'c-세제·소모품' } }, cats())
    if ('error' in r) throw new Error(r.error)
    expect(r.entries[0].tx.title).toBe('대파, 세제')
    expect(r.entries[0].tx.category_id).toBe('c-장보기')
  })

  it('총액: 이름이 길면 첫 상품 외 N건', () => {
    const many = Array.from({ length: 8 }, (_, k) => item({ id: `m${k}`, name: `아주 긴 이름의 장보기 품목 ${k}번` }))
    const r = buildEntries(many, { ...base, place: '컬리', mode: 'total', total: 50000 }, cats())
    if ('error' in r) throw new Error(r.error)
    expect(r.entries[0].tx.title).toBe('아주 긴 이름의 장보기 품목 0번 외 7건')
    expect(r.entries[0].tx.platform).toBe('컬리')
  })

  it('총액이 없거나 0이면 오류, 품목이 없으면 오류, 이미 넣은 품목이 섞이면 오류', () => {
    expect(buildEntries([a], { ...base, mode: 'total', total: null }, cats())).toEqual({ error: '낸 금액을 적어 주세요.' })
    expect(buildEntries([a], { ...base, mode: 'total', total: 0 }, cats())).toEqual({ error: '낸 금액을 적어 주세요.' })
    expect(buildEntries([], base, cats())).toEqual({ error: '넣을 품목을 골라 주세요.' })
    expect(buildEntries([item({ transactionId: 't' })], { ...base, mode: 'total', total: 1000 }, cats()))
      .toEqual({ error: '이미 가계부에 넣은 품목이 섞여 있어요.' })
  })

  it('품목 줄 이름은 이름과 용량', () => {
    expect(itemLabel({ name: '삼겹살', spec: '600g' })).toBe('삼겹살 600g')
    expect(itemLabel({ name: '대파', spec: null })).toBe('대파')
  })
})

describe('영수증 상품 ↔ 장보기 품목 맞추기', () => {
  const lines = (...names: string[]) => names.map((name, k) => ({ key: `L${k}`, name }))
  it('이름이 상품명에 들어 있으면 맞춘다', () => {
    const m = matchReceipt(lines('국산 대파 1단', '서울우유 900ml', '오뚜기 진라면'), [{ id: 'a', name: '대파' }, { id: 'b', name: '우유' }])
    expect(m.get('a')).toBe('L0')
    expect(m.get('b')).toBe('L1')
  })
  it('한 글자 품목은 단어가 같을 때만(파 ≠ 파프리카)', () => {
    expect(matchReceipt(lines('파프리카 2입'), [{ id: 'a', name: '파' }]).size).toBe(0)
    expect(matchReceipt(lines('무 1개', '파 1단'), [{ id: 'a', name: '파' }]).get('a')).toBe('L1')
  })
  it('공백·기호를 무시한다', () => {
    expect(matchReceipt(lines('CJ비비고왕교자1.05kg'), [{ id: 'a', name: '비비고 왕교자' }]).get('a')).toBe('L0')
  })
  it('상품 줄 하나에는 품목 하나만, 긴 이름이 먼저', () => {
    const m = matchReceipt(lines('비비고 왕교자 1.05kg'), [{ id: 'short', name: '교자' }, { id: 'long', name: '비비고 왕교자' }])
    expect(m.get('long')).toBe('L0')
    expect(m.has('short')).toBe(false)
  })
  it('맞는 게 없으면 비어 있다', () => {
    expect(matchReceipt(lines('배송비'), [{ id: 'a', name: '대파' }]).size).toBe(0)
  })
})

describe('영수증 초안 → 상품 줄 → 연결 묶음', () => {
  const draft = (key: string, p: Partial<Parameters<typeof receiptLines>[0][number]> = {}) =>
    ({ key, include: true, type: 'expense' as const, title: '이마트', amount: 10000, items: [], ...p })

  it('상품이 하나뿐인 초안은 초안 금액(할인 반영), 여럿이면 줄 금액, 배송비·할인 줄은 빼고, 수입·뺀 초안은 넣지 않는다', () => {
    const lines = receiptLines([
      draft('0-0', { title: '대파', amount: 2700, items: [{ name: '국산 대파', amount: 3000 }] }),
      draft('1', { amount: 9000, items: [{ name: '우유', amount: 5000 }, { name: '두부', amount: 4000 }, { name: '배송비', amount: 3000 }, { name: '쿠폰', amount: -3000 }] }),
      draft('2', { title: '스타벅스', amount: 6500 }),
      draft('3', { type: 'income', title: '환불' }),
      draft('4', { include: false, title: '빼 둔 것' }),
    ])
    expect(lines).toEqual([
      { key: '0-0:0', draftKey: '0-0', name: '국산 대파', amount: 2700 },
      { key: '1:0', draftKey: '1', name: '우유', amount: 5000 },
      { key: '1:1', draftKey: '1', name: '두부', amount: 4000 },
      { key: '2:t', draftKey: '2', name: '스타벅스', amount: 6500 },
    ])
  })

  it('고른 짝을 내역별로 묶고, 저장 안 한 초안의 짝은 버린다', () => {
    const lines = receiptLines([
      draft('a', { items: [{ name: '대파', amount: 3000 }] , amount: 3000 }),
      draft('b', { amount: 9000, items: [{ name: '우유', amount: 5000 }, { name: '두부', amount: 4000 }] }),
    ])
    const picks = new Map([['g1', 'a:0'], ['g2', 'b:0'], ['g3', 'b:1'], ['g4', 'x:0']])
    const out = linksByTx(lines, picks, new Map([['a', 'tx-a'], ['b', 'tx-b']]))
    expect(out.get('tx-a')).toEqual([{ item_id: 'g1', paid: 3000 }])
    expect(out.get('tx-b')).toEqual([{ item_id: 'g2', paid: 5000 }, { item_id: 'g3', paid: 4000 }])
    expect(linksByTx(lines, picks, new Map([['a', 'tx-a']])).has('tx-b')).toBe(false)
  })
})
