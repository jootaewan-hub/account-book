// @vitest-environment jsdom
// 기념일 폼(D-033): 고치기에서 이름만 바꿔도 반복·시작 해·카테고리가 그대로 저장되고, 반복·카테고리를 고를 수 있다.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AnniversaryForm } from '../../src/components/AnniversaryForm'
import { annivInput, newAnnivInput } from '../../src/lib/anniversaries'
import type { Anniversary, AnniversaryInput } from '../../src/lib/types'

afterEach(cleanup)

const TODAY = '2026-10-26'
const saved: Anniversary = { id: 'a', household_id: 'h', name: '건강검진', kind: 'other', category: '병원', lunar: false, month: 5, day: 1,
  repeat_unit: 'year', repeat_every: 2, start_year: 2024 }

function open(initial: AnniversaryInput, editing = true) {
  const onSave = vi.fn(async (_v: AnniversaryInput) => {})
  render(<AnniversaryForm initial={initial} today={TODAY} categories={['병원', '생일', '기념일']} editing={editing} onSave={onSave} onCancel={() => {}} />)
  return onSave
}

describe('기념일 폼', () => {
  it('2년마다 항목의 이름만 바꿔 고쳐도 반복·시작 해·카테고리가 그대로다', async () => {
    const onSave = open(annivInput(saved))
    expect((screen.getByRole('button', { name: '몇 년마다' }) as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true')
    fireEvent.change(screen.getByRole('textbox', { name: '기념일 이름' }), { target: { value: '종합검진' } })
    fireEvent.click(screen.getByRole('button', { name: '고치기' }))
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0][0]).toEqual({ ...annivInput(saved), name: '종합검진' })
  })

  it('카테고리를 칩으로 고르거나 직접 적고, 매달을 고르면 음력이 사라지고 시작한 해·달을 받는다', async () => {
    const onSave = open(newAnnivInput(TODAY), false)
    fireEvent.change(screen.getByRole('textbox', { name: '기념일 이름' }), { target: { value: '아이 용돈' } })
    fireEvent.click(screen.getByRole('button', { name: '생일' }))
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: '카테고리' }).value).toBe('생일')
    fireEvent.change(screen.getByRole('textbox', { name: '카테고리' }), { target: { value: '용돈' } })
    fireEvent.click(screen.getByRole('button', { name: '음력' }))
    fireEvent.click(screen.getByRole('button', { name: '매달' }))
    expect(screen.queryByRole('button', { name: '음력' })).toBeNull()
    expect(screen.getByRole('combobox', { name: '시작한 해' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '넣기' }))
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0][0]).toMatchObject({ name: '아이 용돈', category: '용돈', kind: 'other', lunar: false, repeat_unit: 'month', repeat_every: 1, start_year: 2026, month: 10 })
  })

  it('몇 년마다를 고르면 숫자 칸이 나오고, 지우고 다시 적어도 칸이 남아 그 값으로 저장한다. 2보다 작으면 2', async () => {
    const onSave = open(newAnnivInput(TODAY), false)
    fireEvent.change(screen.getByRole('textbox', { name: '기념일 이름' }), { target: { value: '여권 갱신' } })
    fireEvent.click(screen.getByRole('button', { name: '몇 년마다' }))
    // 휴대폰에서 2를 지우고 10을 치는 동안(빈칸 → 1 → 10) 숫자 칸이 사라지지 않는다
    const box = () => screen.getByRole<HTMLInputElement>('spinbutton', { name: '몇 년마다' })
    for (const value of ['', '1', '10']) {
      fireEvent.change(box(), { target: { value } })
      expect(box().value).toBe(value)
    }
    fireEvent.click(screen.getByRole('button', { name: '넣기' }))
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0][0]).toMatchObject({ repeat_unit: 'year', repeat_every: 10, start_year: 2026 })
  })

  it('몇 달마다 칸을 비우거나 1로 두고 벗어나면 2로 맞춘다', async () => {
    const onSave = open(newAnnivInput(TODAY), false)
    fireEvent.change(screen.getByRole('textbox', { name: '기념일 이름' }), { target: { value: '정기 점검' } })
    fireEvent.click(screen.getByRole('button', { name: '몇 달마다' }))
    const box = screen.getByRole<HTMLInputElement>('spinbutton', { name: '몇 달마다' })
    expect(box.value).toBe('3')
    fireEvent.change(box, { target: { value: '1' } })
    fireEvent.blur(box)
    expect(box.value).toBe('2')
    fireEvent.click(screen.getByRole('button', { name: '넣기' }))
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0][0]).toMatchObject({ repeat_unit: 'month', repeat_every: 2 })
  })
})
