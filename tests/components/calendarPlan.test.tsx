// @vitest-environment jsdom
// 달력의 고정지출 예정분(D-030): 고정지출은 이미 정해진 지출이라 쓴 돈·남은 돈에 넣고, 칸에서는 점선 금액·예정 줄로 구별한다.
// App처럼 plannedTxs로 만든 예정 내역을 실제 내역과 함께 넘긴다.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CalendarView } from '../../src/components/CalendarView'
import { addMonths } from '../../src/lib/dates'
import { makeLookup } from '../../src/lib/lookup'
import { plannedTxs } from '../../src/lib/recurring'
import type { Recurring, Transaction } from '../../src/lib/types'

afterEach(cleanup)

const TODAY = '2026-10-26'
const lookup = makeLookup('u1', [], [], [])
const rec = (p: Partial<Recurring>): Recurring => ({
  id: 'r', household_id: 'h', kind: 'fixed', type: 'expense', title: '월세', amount: 500000, day_of_month: 25,
  every_months: 1, category_id: null, payment_method_id: null, scope: 'shared', start_month: '2026-01-01',
  end_month: null, active: true, memo: null, installment_months: null, ...p,
})
const RECURRING = [
  rec({ id: 'rent' }),
  rec({ id: 'tv', kind: 'subscription', title: '넷플릭스', amount: 17000, day_of_month: 5 }),
  rec({ id: 'gym', title: '헬스장', amount: 60000, day_of_month: 28 }),
  rec({ id: 'util', kind: 'utility', title: '아파트 관리비', amount: null, day_of_month: 25 }),
]
const lunch: Transaction = {
  id: 'x', household_id: 'h', type: 'expense', occurred_on: '2026-10-03', amount: 100000, title: '외식', memo: null, category_id: null,
  payment_method_id: null, scope: 'shared', source: 'manual', created_by: 'u1', created_at: '', recurring_id: null, platform: null,
}

function show(ym: string, sel: string, real: Transaction[] = []) {
  const onEdit = vi.fn()
  const cur = [...real, ...plannedTxs(RECURRING, real, ym, TODAY)]
  const prev = plannedTxs(RECURRING, real, addMonths(ym, -1), TODAY)
  render(<CalendarView ym={ym} today={TODAY} sel={sel} cur={cur} prev={prev} lookup={lookup} annivs={[]} events={[]}
    onSelect={() => {}} onPlan={() => {}} onJump={() => {}} onEdit={onEdit} />)
  return { onEdit }
}

describe('달력의 고정지출 예정분', () => {
  it('다음 달: 나갈 돈에 고정지출을 넣고, 칸에는 예정 금액, 금액이 없는 관리비는 숫자를 내지 않는다', () => {
    show('2026-11', '2026-11-25')
    expect(screen.getByText('11월에 나갈 돈')).toBeTruthy()
    expect(document.querySelector('.hero-num')?.textContent).toBe('577,000원')
    expect(screen.getByText(/고정지출 예정/).textContent).toBe('고정지출 예정 577,000원, 3건 포함')
    expect(screen.getByRole('button', { name: /11월 25일.*고정지출 예정 500,000원/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /11월 5일.*고정지출 예정 17,000원/ })).toBeTruthy()
    expect(screen.queryByText(/관리비/)).toBeNull()
  })

  it('고른 날: 예정 줄과 "나갈 예정"이 보이고, "썼어요"·"기록이 없어요"는 나오지 않는다. 누르면 예정 내역 그대로 넘긴다', () => {
    const { onEdit } = show('2026-11', '2026-11-25')
    expect(screen.getByText('500,000원 나갈 예정')).toBeTruthy()
    expect(screen.queryByText(/썼어요/)).toBeNull()
    expect(screen.queryByText(/이 날 기록이 없어요/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /월세.*예정/ }))
    expect(onEdit.mock.calls[0][0]).toMatchObject({ id: 'plan:rent:2026-11', planned: { kind: 'fixed', round: null } })
  })

  it('이번 달: 쓴 돈에 오늘 뒤 고정지출을 더하고, 지난 날짜(5일·25일)는 예정이 아니다', () => {
    show('2026-10', '2026-10-28', [lunch])
    expect(screen.getByText('10월에 쓴 돈')).toBeTruthy()
    expect(document.querySelector('.hero-num')?.textContent).toBe('160,000원')
    expect(screen.getByText(/고정지출 예정/).textContent).toBe('고정지출 예정 60,000원, 1건 포함')
    expect(screen.getByText('60,000원 나갈 예정')).toBeTruthy()
  })
})
