import { describe, expect, it } from 'vitest'
import { historyPriceGroups, summarizePurchaseHistory } from '../../src/grocery/lib/history'
import type { SeenRecord } from '../../src/grocery/lib/seen'

const record = (p: Partial<SeenRecord> = {}): SeenRecord => ({
  source: 'receipt', date: '2026-11-01', where: '마트', name: '서울우유 1L', quantity: 1,
  amount: 3000, unitPrice: null, packSize: null, packUnit: null, ...p,
})

describe('장보기 구매량과 가격 변화', () => {
  it('첫 구매일부터 오늘까지의 날짜를 쓰고 가격 캡처는 구매량에 넣지 않는다', () => {
    const { products, days, firstPurchase } = summarizePurchaseHistory([
      record({ date: '2026-10-25', source: 'capture' }),
      record(),
      record({ date: '2026-11-05', name: '서울우유 900ml ×2', amount: 6300 }),
      record({ date: '2026-11-05', name: '서울우유 900ml ×2', quantity: 2, amount: 6300 }),
      record({ date: '2026-11-08' }),
    ], { to: '2026-11-06' })
    expect({ days, firstPurchase }).toEqual({ days: 6, firstPurchase: '2026-11-01' })
    expect(products[0]).toMatchObject({ name: '서울우유', purchaseDays: 2, purchaseRows: 3, amounts: [{ unit: 'ml', quantity: 4600 }] })
  })

  it('용량이 없는 기록을 임의 환산하지 않고 g·ml와 포장 수량을 따로 둔다', () => {
    const { products } = summarizePurchaseHistory([
      record({ name: '우유', amount: 2000, quantity: 3 }),
      record({ name: '우유 100g당 300원' }),
      record({ name: '계란 30구', quantity: 2, amount: 17000 }),
    ], { from: '2026-10-01', to: '2026-11-06' })
    expect(products.find((x) => x.name === '우유')).toMatchObject({ amounts: [], unknownVolume: 1, unknownQuantity: 3 })
    expect(products.find((x) => x.name.includes('100g당'))?.amounts).toEqual([])
    expect(products.find((x) => x.name === '계란')?.amounts).toEqual([{ unit: '구', quantity: 60 }])
  })

  it('같은 상품의 같은 단위만 비교하고 구매가와 가격 캡처를 분리한다', () => {
    const { products } = summarizePurchaseHistory([
      record(),
      record({ source: 'order', date: '2026-11-06', name: '서울우유 500ml', amount: 1800 }),
      record({ source: 'capture', date: '2026-11-06', amount: 3900 }),
      record({ source: 'capture', date: '2026-11-05', amount: 2600 }),
      record({ name: '서울우유', packSize: 250, packUnit: 'g', amount: 2100 }),
    ], { to: '2026-11-06' })
    expect(historyPriceGroups(products[0].rows).map((g) => [g.base, g.capture, g.change])).toEqual([
      ['100ml', false, 20],
      ['100g', false, null],
      ['100ml', true, 50],
    ])
  })

  it('가격 캡처에 적힌 단위당 값을 쓰고 구매량은 만들지 않는다', () => {
    const { products, days } = summarizePurchaseHistory([
      record({ source: 'capture', name: '햇딸기', unitPrice: 1900, unitLabel: '100g당' }),
      record({ source: 'capture', name: '햇딸기', unitPrice: 15000, unitLabel: '1kg당', date: '2026-11-05' }),
    ], { to: '2026-11-06' })
    expect(days).toBe(0)
    expect(products[0].amounts).toEqual([])
    expect(historyPriceGroups(products[0].rows)[0]).toMatchObject({ base: '100g', capture: true, latest: { price: 1500 } })
  })
})
