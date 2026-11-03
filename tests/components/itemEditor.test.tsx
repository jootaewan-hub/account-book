// @vitest-environment jsdom
// 고칠 수 있는 품목 목록(D-052): 고치기 칸 열기, 금액·수량 고치면 개당 가격 다시 세기, 줄 빼기·더하기, 결제 금액과 차이
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ItemEditor } from '../../src/components/ItemEditor'
import type { EditableItem } from '../../src/lib/itemEdit'

afterEach(cleanup)

const items: EditableItem[] = [
  { name: '서울우유 1L', quantity: 2, unit_price: 4180, amount: 8360, pack_size: 1000, pack_unit: 'ml' },
  { name: '추황배', quantity: 1, unit_price: 12980, amount: 12980, pack_size: null, pack_unit: null },
]

describe('ItemEditor', () => {
  it('처음에는 읽기 줄만 보이고, 고치기를 누르면 이름·수량·금액 칸이 열린다', () => {
    render(<ItemEditor items={items} onChange={() => {}} />)
    expect(screen.getByText('서울우유 1L')).toBeTruthy()
    expect(screen.queryByLabelText('1번째 품목 이름')).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: '고치기' })[0])
    expect((screen.getByLabelText('1번째 품목 이름') as HTMLInputElement).value).toBe('서울우유 1L')
    expect((screen.getByLabelText('1번째 품목 수량') as HTMLInputElement).value).toBe('2')
    expect((screen.getByLabelText('1번째 품목 금액') as HTMLInputElement).value).toBe('8360')
    expect(screen.getByRole('button', { name: '이 줄 빼기' })).toBeTruthy()
  })

  it('금액을 고치면 개당 가격을 수량으로 다시 세고, 수량이 잘못되면 올리지 않고 안내한다', () => {
    const onChange = vi.fn()
    render(<ItemEditor items={items} onChange={onChange} />)
    fireEvent.click(screen.getAllByRole('button', { name: '고치기' })[0])
    fireEvent.change(screen.getByLabelText('1번째 품목 금액'), { target: { value: '7,000' } })
    expect(onChange).toHaveBeenLastCalledWith([{ ...items[0], amount: 7000, unit_price: 3500 }, items[1]])
    fireEvent.change(screen.getByLabelText('1번째 품목 수량'), { target: { value: '0' } })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/수량은 0보다 큰 수로/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('1번째 품목 수량'), { target: { value: '3' } })
    expect(onChange).toHaveBeenLastCalledWith([{ ...items[0], quantity: 3, unit_price: 2787 }, items[1]])
    fireEvent.change(screen.getByLabelText('1번째 품목 이름'), { target: { value: '서울우유 1L 2입' } })
    expect(onChange).toHaveBeenLastCalledWith([{ ...items[0], name: '서울우유 1L 2입' }, items[1]])
  })

  it('이 줄 빼기는 그 줄만 빼고, 품목 줄 더하기는 빈 줄을 열어 둔다', () => {
    const onChange = vi.fn()
    render(<ItemEditor items={items} onChange={onChange} />)
    fireEvent.click(screen.getAllByRole('button', { name: '고치기' })[1])
    fireEvent.click(screen.getByRole('button', { name: '이 줄 빼기' }))
    expect(onChange).toHaveBeenLastCalledWith([items[0]])
    fireEvent.click(screen.getByRole('button', { name: '품목 줄 더하기' }))
    expect(onChange).toHaveBeenLastCalledWith([...items, { name: '', quantity: 1, unit_price: null, amount: 0, pack_size: null, pack_unit: null }])
  })

  it('결제 금액과 품목 합계가 다르면 차이를 적고, 같으면 적지 않는다', () => {
    const { rerender } = render(<ItemEditor items={items} onChange={() => {}} total={21340} />)
    expect(screen.queryByText(/품목 합계가 결제 금액/)).toBeNull()
    rerender(<ItemEditor items={items} onChange={() => {}} total={20000} />)
    expect(screen.getByText(/결제 금액 20,000원보다 1,340원 많아요/)).toBeTruthy()
    expect(screen.getByText('21,340')).toBeTruthy()
  })

  it('앞 칸과 아래 칸은 넘겨준 대로 그린다(사진·용량 칸)', () => {
    render(<ItemEditor items={items} onChange={() => {}}
      renderThumb={(it) => <img alt={`${it.name} 사진`} src="x" />} renderExtra={(it) => <span>{it.name} 용량</span>} />)
    expect(screen.getByAltText('추황배 사진')).toBeTruthy()
    expect(screen.getByText('서울우유 1L 용량')).toBeTruthy()
  })
})
