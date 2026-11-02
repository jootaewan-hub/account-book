// @vitest-environment jsdom
// 영수증 상품 줄의 용량 칸(D-045): 글자 읽기와 입력 동작
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PackInput } from '../../src/components/PackInput'
import { packText, parsePackText, perUnitLabel } from '../../src/lib/units'

afterEach(cleanup)

describe('용량 글자 (parsePackText·packText)', () => {
  it('g·ml로 바꾸고 x2는 곱한다, 셈 단위는 그대로', () => {
    expect(parsePackText('900ml')).toEqual({ pack_size: 900, pack_unit: 'ml' })
    expect(parsePackText('1.5kg')).toEqual({ pack_size: 1500, pack_unit: 'g' })
    expect(parsePackText('2L')).toEqual({ pack_size: 2000, pack_unit: 'ml' })
    expect(parsePackText('1.8 리터')).toEqual({ pack_size: 1800, pack_unit: 'ml' })
    expect(parsePackText('1.05kg x2')).toEqual({ pack_size: 2100, pack_unit: 'g' })
    expect(parsePackText('30롤')).toEqual({ pack_size: 30, pack_unit: '롤' })
    expect(parsePackText('10개입')).toEqual({ pack_size: 10, pack_unit: '입' })
    expect(parsePackText('큰 거')).toBeNull()
    expect(parsePackText('0g')).toBeNull()
    expect(packText(1050, 'g')).toBe('1050g')
    expect(packText(null, null)).toBe('')
  })
})

describe('용량 칸 (PackInput)', () => {
  it('읽을 수 있을 때만 값을 올리고, 못 읽으면 안내, 비우면 용량 없음', () => {
    const onChange = vi.fn()
    render(<PackInput name="서울우유" size={null} unit={null} onChange={onChange} />)
    const input = screen.getByLabelText('서울우유 용량') as HTMLInputElement
    fireEvent.change(input, { target: { value: '900' } })
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByText(/숫자와 단위로 적어 주세요/)).toBeTruthy()
    fireEvent.change(input, { target: { value: '900ml' } })
    expect(onChange).toHaveBeenLastCalledWith({ pack_size: 900, pack_unit: 'ml' })
    expect(screen.queryByText(/숫자와 단위로 적어 주세요/)).toBeNull()
    fireEvent.change(input, { target: { value: '' } })
    expect(onChange).toHaveBeenLastCalledWith({ pack_size: null, pack_unit: null })
    // 채운 용량은 품목 줄의 용량당 값에 쓰인다
    expect(perUnitLabel({ amount: 2980, quantity: 1, pack_size: 900, pack_unit: 'ml' })).toBe('100ml당 331원')
  })

  it('영수증에서 읽은 용량은 칸에 채워 둔다', () => {
    render(<PackInput name="비비고 왕교자" size={1050} unit="g" onChange={() => {}} />)
    expect((screen.getByLabelText('비비고 왕교자 용량') as HTMLInputElement).value).toBe('1050g')
  })
})
