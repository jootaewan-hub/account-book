// @vitest-environment jsdom
// 내역 탭 고르기(D-027): 행·날짜 단위로 고르고, 두 번 눌러 화면에 보이는 고른 내역만 지운다.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ListView } from '../../src/components/ListView'
import { makeLookup } from '../../src/lib/lookup'
import type { Transaction } from '../../src/lib/types'

afterEach(cleanup)

const ME = 'u1'
const lookup = makeLookup(ME, [], [], [{ id: 'food', household_id: 'h', type: 'expense', name: '장보기', sort: 1, archived: false }])
const tx = (id: string, occurred_on: string, title: string, amount: number, p: Partial<Transaction> = {}): Transaction => ({
  id, household_id: 'h', type: 'expense', occurred_on, amount, title, memo: null, category_id: 'food', payment_method_id: null,
  scope: 'shared', source: 'photo', created_by: ME, created_at: `${occurred_on}T12:00:00Z`, recurring_id: null, platform: null, ...p,
})
const CUR = [
  tx('a', '2026-10-25', '서울우유 1L', 2980), tx('b', '2026-10-25', '계란 30구', 8900), tx('c', '2026-10-25', '대파', 2480),
  tx('d', '2026-10-24', '점심 김밥', 4500, { scope: 'husband' }),
]

function setup() {
  const onDeleteMany = vi.fn(async (_ids: string[]) => {})
  const onEdit = vi.fn()
  const onPickingChange = vi.fn()
  render(<ListView cur={CUR} lookup={lookup} focus={null} onClearFocus={() => {}} onEdit={onEdit} onDeleteMany={onDeleteMany} onPickingChange={onPickingChange} />)
  return { onDeleteMany, onEdit, onPickingChange }
}

describe('내역 고르기', () => {
  it('고르기 중에는 행을 눌러도 수정이 열리지 않고 골라진다. 두 번 눌러야 지운다', async () => {
    const { onDeleteMany, onEdit, onPickingChange } = setup()
    fireEvent.click(screen.getByRole('button', { name: '고르기' }))
    expect(onPickingChange).toHaveBeenLastCalledWith(true)
    fireEvent.click(screen.getByRole('checkbox', { name: /서울우유/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /대파/ }))
    expect(onEdit).not.toHaveBeenCalled()
    expect(screen.getByRole('region', { name: '고른 내역' }).textContent).toContain('2건 골랐어요, 지출 5,460원')
    fireEvent.click(screen.getByRole('button', { name: '2건 삭제' }))
    expect(onDeleteMany).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '한 번 더 누르면 2건 지워요' }))
    await vi.waitFor(() => expect(onDeleteMany).toHaveBeenCalledWith(['a', 'c']))
    await vi.waitFor(() => expect(onPickingChange).toHaveBeenLastCalledWith(false))
  })

  it('날짜를 누르면 그날 내역을 전부 고르고, 다시 누르면 푼다. 일부만 고르면 반쯤 찬 표시', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: '고르기' }))
    const day = screen.getByRole('checkbox', { name: /25일/ }) as HTMLInputElement
    fireEvent.click(day)
    expect(screen.getByRole('button', { name: '3건 삭제' })).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: /계란/ }))
    expect(day.checked).toBe(false)
    expect(day.indeterminate).toBe(true)
    fireEvent.click(day)
    expect(day.checked).toBe(true)
    fireEvent.click(day)
    expect((screen.getByRole('button', { name: '0건 삭제' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('찾기·사람 칩을 바꾸면 고른 것을 비워 안 보이는 내역은 지우지 않는다', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: '고르기' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /25일/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /김밥/ }))
    expect(screen.getByRole('button', { name: '4건 삭제' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /남편/ }))
    expect(screen.getByRole('button', { name: '0건 삭제' })).toBeTruthy()
  })

  it('지우기가 실패하면 고른 것을 그대로 두고 이유를 보여 준다', async () => {
    const onDeleteMany = vi.fn(async () => { throw new Error('Failed to fetch') })
    render(<ListView cur={CUR} lookup={lookup} focus={null} onClearFocus={() => {}} onEdit={() => {}} onDeleteMany={onDeleteMany} />)
    fireEvent.click(screen.getByRole('button', { name: '고르기' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /대파/ }))
    fireEvent.click(screen.getByRole('button', { name: '1건 삭제' }))
    fireEvent.click(screen.getByRole('button', { name: '한 번 더 누르면 1건 지워요' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', '인터넷 연결을 확인해 주세요.')
    expect(screen.getByRole('button', { name: '1건 삭제' })).toBeTruthy()
  })
})
