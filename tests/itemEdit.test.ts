// 품목 줄 고치기(D-052)의 순수 함수: 개당 가격 다시 세기, 글자 읽기, 저장 전 정리, 전·후 차이
import { describe, expect, it } from 'vitest'
import { blankItem, cleanItems, diffItems, parseAmount, parseQuantity, withUnitPrice } from '../src/lib/itemEdit'
import type { TxItem } from '../src/lib/types'

const row = (id: string, name: string, quantity: number, amount: number, sort: number, extra: Partial<TxItem> = {}): TxItem => ({
  id, name, quantity, unit_price: quantity > 0 && amount > 0 ? Math.round(amount / quantity) : null, amount,
  pack_size: null, pack_unit: null, image_path: null, sort, ...extra,
})

describe('withUnitPrice', () => {
  it('수량·금액이 양수면 금액 ÷ 수량(반올림), 아니면 null', () => {
    expect(withUnitPrice({ ...blankItem(), quantity: 2, amount: 7000 }).unit_price).toBe(3500)
    expect(withUnitPrice({ ...blankItem(), quantity: 3, amount: 10000 }).unit_price).toBe(3333)
    expect(withUnitPrice({ ...blankItem(), quantity: 1, amount: 0 }).unit_price).toBeNull()
    expect(withUnitPrice({ ...blankItem(), quantity: 1, amount: -1000 }).unit_price).toBeNull()
  })
  it('다른 칸(용량·사진 등)은 그대로 둔다', () => {
    const it0 = { ...blankItem(), quantity: 2, amount: 7000, pack_size: 900, pack_unit: 'ml', photo: 'x' }
    expect(withUnitPrice(it0)).toEqual({ ...it0, unit_price: 3500 })
  })
})

describe('parseQuantity·parseAmount', () => {
  it('수량은 0보다 큰 수, 소수 셋째 자리까지', () => {
    expect(parseQuantity('2')).toBe(2)
    expect(parseQuantity('1.5')).toBe(1.5)
    expect(parseQuantity('0.325')).toBe(0.325)
    expect(parseQuantity('0')).toBeNull()
    expect(parseQuantity('-1')).toBeNull()
    expect(parseQuantity('1.2345')).toBeNull()
    expect(parseQuantity('')).toBeNull()
    expect(parseQuantity('두 개')).toBeNull()
  })
  it('금액은 정수, 쉼표 무시, 음수(할인·반품 줄) 허용', () => {
    expect(parseAmount('7,000')).toBe(7000)
    expect(parseAmount(' 12980 ')).toBe(12980)
    expect(parseAmount('-1360')).toBe(-1360)
    expect(parseAmount('0')).toBe(0)
    expect(parseAmount('1.5')).toBeNull()
    expect(parseAmount('')).toBeNull()
    expect(parseAmount('12345678901')).toBeNull()
  })
})

describe('cleanItems', () => {
  it('이름을 다듬고, 이름도 금액도 없는 줄은 빼고, 이름 없이 금액만 있는 줄은 번호를 알린다', () => {
    const items = [
      { ...blankItem(), name: '  서울우유 1L ', amount: 2980 },
      blankItem(), // 더하기만 누르고 둔 줄
      { ...blankItem(), amount: 1500 }, // 이름을 안 적은 줄
    ]
    const r = cleanItems(items)
    expect(r.items.map((it) => it.name)).toEqual(['서울우유 1L', ''])
    expect(r.missingName).toBe(2)
    expect(cleanItems([{ ...blankItem(), name: 'a'.repeat(70), amount: 1 }]).items[0].name).toHaveLength(60)
    expect(cleanItems([{ ...blankItem(), name: '사과', amount: 3000 }]).missingName).toBeNull()
  })
})

describe('diffItems', () => {
  const before = [row('a', '서울우유', 2, 8360, 0), row('b', '추황배', 1, 12980, 1, { image_path: 'h/x.jpg' }), row('c', '봉투', 1, 100, 2)]

  it('바뀐 칸만 update, 새 줄은 insert, 빠진 줄은 remove(사진 경로 포함), sort는 후의 순서', () => {
    const after = [
      { ...before[1] }, // 맨 앞으로: sort만 바뀜
      { ...before[0], quantity: 2, amount: 7000, unit_price: 3500 }, // 할인을 반영해 금액 고침
      { ...blankItem(), name: '양파 1망', amount: 3980, unit_price: 3980 }, // 새 줄
      // 봉투(c)는 뺐다
    ]
    const d = diffItems(before, after)
    expect(d.update).toEqual([
      { id: 'b', patch: { sort: 0 } },
      { id: 'a', patch: { unit_price: 3500, amount: 7000, sort: 1 } },
    ])
    expect(d.insert).toEqual([{ name: '양파 1망', quantity: 1, unit_price: 3980, amount: 3980, pack_size: null, pack_unit: null, sort: 2 }])
    expect(d.remove.map((r) => r.id)).toEqual(['c'])
  })

  it('아무것도 안 고치면 모두 비어 있다', () => {
    const d = diffItems(before, before.map((b) => ({ ...b })))
    expect(d).toEqual({ insert: [], update: [], remove: [] })
  })

  it('용량만 적어도 update에 들어간다', () => {
    const d = diffItems(before, before.map((b, i) => (i === 0 ? { ...b, pack_size: 1000, pack_unit: 'ml' } : b)))
    expect(d.update).toEqual([{ id: 'a', patch: { pack_size: 1000, pack_unit: 'ml' } }])
  })
})
