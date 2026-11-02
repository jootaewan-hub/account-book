// 담을 때 보는 지난 기록(D-042): 이름 맞추기(짧은 이름의 잘못 맞음 막기), 용량, 단위값 견주기, 보이는 글자
import { describe, expect, it } from 'vitest'
import { ledgerSeen, nameScore, packOf, seenFor, seenPrice, seenUnit, seenWhen, unitOfSeen, type SeenRecord } from '../../src/grocery/lib/seen'

const rec = (p: Partial<SeenRecord> & Pick<SeenRecord, 'name'>): SeenRecord => ({
  source: 'receipt', date: '2026-10-14', where: '이마트 분당점', quantity: 1, amount: 3000, unitPrice: null, packSize: null, packUnit: null, ...p,
})

describe('이름 맞추기 (nameScore)', () => {
  it('한 글자는 상품명의 한 단어와 같을 때만', () => {
    expect(nameScore('파', '대파 1단')).toBe(0)
    expect(nameScore('파', '국산 파 1단')).toBe(2)
    expect(nameScore('무', '무농약 콩나물')).toBe(0)
  })

  it('두 글자는 단어와 같거나 단어 끝(햇양파·서울우유), 뒤가 숫자(우유1L)일 때. 단어 앞만 같은 다른 물건은 아니다', () => {
    expect(nameScore('양파', '햇양파 1.5kg')).toBe(2)
    expect(nameScore('우유', '서울우유 1L')).toBe(2)
    expect(nameScore('우유', '우유1L')).toBe(2)
    expect(nameScore('양파', '양파링 스낵')).toBe(0)
    expect(nameScore('우유', '우유식빵')).toBe(0)
    expect(nameScore('대파', '깐대파 500g')).toBe(2)
    expect(nameScore('우유', '남양 맛있는우유GT 2.3L')).toBe(2)
  })

  it('세 글자 이상은 통째로 들어 있으면 2, 마지막 단어(종류)만 맞으면 1', () => {
    expect(nameScore('비비고 왕교자', '[비비고] 왕교자 만두 대용량 1.05kg')).toBe(2)
    expect(nameScore('비비고 왕교자', '왕교자 1.05kg*2')).toBe(1)
    expect(nameScore('해찬들 고추장', '순창 고추장 1kg')).toBe(1)
    expect(nameScore('해찬들 고추장', '해찬들 태양초 고추장 500g')).toBe(1)
    expect(nameScore('고추장', '순창 고추장 1kg')).toBe(2)
    expect(nameScore('비비고 왕교자', '풀무원 물만두')).toBe(0)
  })
})

describe('용량과 단위값', () => {
  it('적힌 용량이 먼저, 없으면 상품명의 g·ml 용량(kg·L은 바꾸고 x2는 곱한다)', () => {
    expect(packOf(rec({ name: '서울우유', packSize: 1000, packUnit: 'ml' }))).toEqual({ pack_size: 1000, pack_unit: 'ml' })
    expect(packOf(rec({ name: '비비고 왕교자 1.05kg x2' }))).toEqual({ pack_size: 2100, pack_unit: 'g' })
    // 수량 2인 줄의 'x2'는 그 수량이라 또 곱하지 않는다
    expect(packOf(rec({ name: '비비고 왕교자 1.05kg x2', quantity: 2 }))).toEqual({ pack_size: 1050, pack_unit: 'g' })
    expect(packOf(rec({ name: '남양 맛있는우유GT 2.3L' }))).toEqual({ pack_size: 2300, pack_unit: 'ml' })
    expect(packOf(rec({ name: '대파 1단' }))).toBeNull()
  })

  it('용량을 모르면 1개당으로 견주지 않는다(용량 모름)', () => {
    expect(unitOfSeen(rec({ name: '대파 1단', amount: 2980 }))).toBeNull()
    expect(unitOfSeen(rec({ name: '매일우유 900ml', quantity: 2, amount: 5560 }))).toEqual({ base: '100ml', price: 5560 / 18 })
    expect(unitOfSeen(rec({ name: '잘풀리는집 30롤', amount: 18900, packSize: 30, packUnit: '롤' }))).toEqual({ base: '1롤', price: 630 })
  })
})

describe('품목 하나의 지난 기록 (seenFor)', () => {
  const rows = [
    rec({ name: '서울우유 1L', amount: 2980, date: '2026-10-27', packSize: 1000, packUnit: 'ml' }),
    rec({ source: 'order', where: '쿠팡', name: '매일우유 오리지널 900ml', quantity: 2, amount: 5560, date: '2026-10-21' }),
    rec({ name: '남양 맛있는우유GT 2.3L', amount: 6480, date: '2026-10-15', where: '홈플러스' }),
    rec({ name: '우유식빵', amount: 3800, date: '2026-10-24', where: '파리바게뜨' }),
    rec({ name: '서울우유 1L', amount: 2780, date: '2026-09-01', packSize: 1000, packUnit: 'ml' }), // 같은 곳 같은 상품의 옛 줄은 뺀다
  ]

  it('맞는 줄만, 같은 단위끼리 싼 순서, 가장 싼 줄 표시', () => {
    const m = seenFor('우유', rows)
    // 100ml당: 남양 6,480/2,300ml ≈ 282원, 서울우유 2,980/1,000ml = 298원, 매일우유 5,560/(2×900ml) ≈ 309원
    expect(m.map((x) => x.name)).toEqual(['남양 맛있는우유GT 2.3L', '서울우유 1L', '매일우유 오리지널 900ml'])
    expect(m.map((x) => x.cheapest)).toEqual([true, false, false])
    expect(m[1].date).toBe('2026-10-27') // 같은 곳 같은 상품은 최근 줄
  })

  it('이름이 통째로 맞는 줄이 종류만 맞는 줄보다 먼저, 용량 모르는 줄은 뒤, 단위가 다르면 견주지 않는다', () => {
    const m = seenFor('비비고 왕교자', [
      rec({ name: '왕교자 1.05kg*2', amount: 21900, date: '2026-09-13' }),
      rec({ source: 'order', where: '쿠팡', name: '비비고 왕교자 1.05kg x2', quantity: 2, amount: 21960, date: '2026-10-12' }),
      rec({ source: 'capture', where: '쿠팡', name: '비비고 왕교자', amount: 9900, date: '2026-10-30' }),
    ])
    expect(m.map((x) => [x.name, x.score])).toEqual([['비비고 왕교자 1.05kg x2', 2], ['비비고 왕교자', 2], ['왕교자 1.05kg*2', 1]])
    expect(m[1].unit).toBeNull()
    // '가장 쌈'은 맨 위 맞음 단계(2점)에서 용량 아는 줄끼리만: 한 줄뿐이라 붙지 않고, 1점 줄은 더 싸도 붙지 않는다
    expect(m.filter((x) => x.cheapest)).toEqual([])
    const two = seenFor('비비고 왕교자', [
      rec({ name: '왕교자 1.05kg*2', amount: 15000 }),
      rec({ source: 'order', where: '쿠팡', name: '비비고 왕교자 1.05kg', amount: 10980 }),
      rec({ source: 'order', where: '컬리', name: '비비고 왕교자 1.05kg', amount: 10480 }),
    ])
    expect(two.filter((x) => x.cheapest).map((x) => x.where)).toEqual(['컬리'])
  })

  it('맞는 기록이 없으면 빈 목록', () => {
    expect(seenFor('양파', rows)).toEqual([])
    expect(seenFor('파', [rec({ name: '대파 1단' })])).toEqual([])
  })
})

describe('보이는 글자', () => {
  it('날짜·어디서·출처, 값(수량·배송비), 단위값', () => {
    expect(seenWhen({ date: '2026-10-14', where: '이마트 분당점', source: 'receipt' })).toBe('10월 14일 이마트 분당점 영수증')
    expect(seenWhen({ date: '2026-10-20', where: '쿠팡', source: 'order' })).toBe('10월 20일 쿠팡 주문')
    expect(seenWhen({ date: '2026-10-30', where: '쿠팡', source: 'capture' })).toBe('10월 30일 쿠팡 캡처')
    expect(seenPrice(rec({ name: 'x', quantity: 2, amount: 21960 }))).toBe('2개 21,960원')
    expect(seenPrice(rec({ source: 'capture', name: 'x', amount: 9900, delivery: 3000 }))).toBe('9,900원 + 배송비 3,000원')
    const [m] = seenFor('우유', [rec({ name: '서울우유 1L', amount: 2980 })])
    expect(seenUnit(m)).toBe('100ml당 298원')
    const [d] = seenFor('대파', [rec({ name: '대파 1단' })])
    expect(seenUnit(d)).toBe('용량 모름')
  })
})

describe('가계부 내역 → 지난 기록 (ledgerSeen)', () => {
  const item = (name: string, amount = 3000) => ({ name, quantity: 1, unit_price: amount, amount, pack_size: null, pack_unit: null })

  it('사진으로 넣은 것만 영수증·주문, 그 밖은 가계부 기록. 어디서는 플랫폼 → 가게 칸 → 내역 이름(상품명과 같으면 비움)', () => {
    const rows = ledgerSeen([
      { occurred_on: '2026-10-14', platform: null, title: '이마트 분당점', source: 'photo', transaction_items: [item('서울우유 1L'), item('배송비'), item('봉투', 100), item('할인', 0)] },
      { occurred_on: '2026-10-20', platform: '쿠팡', title: '비비고 왕교자', source: 'photo', transaction_items: [item('비비고 왕교자 1.05kg')] },
      { occurred_on: '2026-10-21', platform: null, title: '깐대파 500g', merchant: '이마트 분당점', source: 'photo', transaction_items: [item('깐대파 500g')] },
      // 장보기 '기록'(품목마다 금액)으로 넣은 매장 구매: 가게 이름은 메모에만 있다
      { occurred_on: '2026-10-22', platform: null, title: '비비고 왕교자 1.05kg', memo: '산 곳: 이마트 분당점', source: 'manual', transaction_items: [item('비비고 왕교자 1.05kg')] },
      { occurred_on: '2026-10-22', platform: '쿠팡', title: '우유 900ml', source: 'manual', transaction_items: [item('우유 900ml')] },
      { occurred_on: '2026-10-23', platform: null, title: '이마트24', source: 'text', transaction_items: null },
      { occurred_on: '2026-10-24', platform: null, title: '동네 반찬가게', source: 'manual', transaction_items: [item('멸치볶음')] },
    ])
    expect(rows.map((r) => [r.source, r.where, r.name])).toEqual([
      ['receipt', '이마트 분당점', '서울우유 1L'],
      ['order', '쿠팡', '비비고 왕교자 1.05kg'],
      ['receipt', '이마트 분당점', '깐대파 500g'],
      ['list', '이마트 분당점', '비비고 왕교자 1.05kg'],
      ['list', '쿠팡', '우유 900ml'],
      ['ledger', '동네 반찬가게', '멸치볶음'],
    ])
    expect(seenWhen(rows[3])).toBe('10월 22일 이마트 분당점 장보기 기록')
    expect(seenWhen(rows[5])).toBe('10월 24일 동네 반찬가게 가계부 기록')
  })
})
