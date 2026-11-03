// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ItemInfo } from '../../src/components/ItemInfo'

describe('상품 줄 설명 (ItemInfo)', () => {
  it('접힌 할인이 있으면 "할인 N원 뺌(원래 M원)"을 수량·1개 가격 뒤에 보인다(D-051)', () => {
    const { container } = render(<ItemInfo it={{ name: '파스퇴르 후레쉬우유', quantity: 2, unit_price: 3500, amount: 7000, pack_size: 900, pack_unit: 'ml', discount: -1360 }} />)
    expect(container.querySelector('.item-sub')?.textContent).toBe('2개 × 3,500원, 100ml당 389원, 할인 1,360원 뺌(원래 8,360원)')
  })
  it('할인이 0이거나 칸이 없으면(저장된 품목) 할인 문구가 없다', () => {
    const { container } = render(<ItemInfo it={{ name: '계란 30구', quantity: 1, unit_price: 12980, amount: 12980, pack_size: 30, pack_unit: '구', discount: 0 }} />)
    expect(container.querySelector('.item-sub')?.textContent).toBe('1개 × 12,980원, 1구당 433원')
    const { container: saved } = render(<ItemInfo it={{ name: '대파', quantity: 1, unit_price: null, amount: 3000, pack_size: null, pack_unit: null }} />)
    expect(saved.querySelector('.item-sub')).toBeNull()
  })
})
