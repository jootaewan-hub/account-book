// @vitest-environment jsdom
// 달력의 고정지출 예정분(D-030): 오늘 뒤에 나갈 고정지출을 칸·고른 날·남은 돈 아래 줄에 따로 보이고, 쓴 돈에는 넣지 않는다.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CalendarView } from '../../src/components/CalendarView'
import { makeLookup } from '../../src/lib/lookup'
import type { Recurring, Transaction } from '../../src/lib/types'

afterEach(cleanup)

const lookup = makeLookup('u1', [], [], [])
const rec = (p: Partial<Recurring>): Recurring => ({
  id: 'r', household_id: 'h', kind: 'fixed', type: 'expense', title: '월세', amount: 500000, day_of_month: 25,
  every_months: 1, category_id: null, payment_method_id: null, scope: 'shared', start_month: '2026-01-01',
  end_month: null, active: true, memo: null, installment_months: null, ...p,
})
const RECURRING = [
  rec({ id: 'rent' }),
  rec({ id: 'tv', kind: 'subscription', title: '넷플릭스', amount: 17000, day_of_month: 5 }),
  rec({ id: 'util', kind: 'utility', title: '아파트 관리비', amount: null, day_of_month: 25 }),
]

function show(ym: string, sel: string, opts: { cur?: Transaction[]; loading?: boolean } = {}) {
  const onOpenFixed = vi.fn()
  render(<CalendarView ym={ym} today="2026-10-26" sel={sel} cur={opts.cur ?? []} prev={[]} loading={opts.loading} lookup={lookup} annivs={[]} events={[]}
    recurring={RECURRING} onSelect={() => {}} onPlan={() => {}} onJump={() => {}} onEdit={() => {}} onOpenFixed={onOpenFixed} />)
  return { onOpenFixed }
}

describe('달력의 고정지출 예정분', () => {
  it('다음 달: 칸·남은 돈 아래 줄에 예정 금액, 쓴 돈은 0원, 금액이 없는 관리비는 숫자를 내지 않는다', () => {
    show('2026-11', '2026-11-25')
    expect(screen.getByRole('button', { name: /11월 25일.*고정지출 예정 500,000원/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /11월 5일.*고정지출 예정 17,000원/ })).toBeTruthy()
    expect(screen.getByText(/11월에 나갈 고정지출/).textContent).toBe('11월에 나갈 고정지출 517,000원, 2건')
    expect(screen.getByText('11월에 쓴 돈')).toBeTruthy()
    expect(screen.queryByText(/관리비/)).toBeNull()
  })

  it('고른 날: 예정 줄이 보이고 "기록이 없어요"는 나오지 않으며, 누르면 고정 탭으로 간다', () => {
    const { onOpenFixed } = show('2026-11', '2026-11-25')
    expect(screen.getByText('500,000원 나갈 예정')).toBeTruthy()
    expect(screen.queryByText(/이 날 기록이 없어요/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /월세.*예정/ }))
    expect(onOpenFixed).toHaveBeenCalledOnce()
  })

  it('이번 달은 오늘 뒤만, 지난 날짜는 예정이 없다', () => {
    show('2026-10', '2026-10-05')
    expect(screen.queryByText(/이번 달 남은 고정지출/)).toBeNull()
    expect(screen.getByText(/이 날 기록이 없어요/)).toBeTruthy()
  })

  it('달 내역을 받는 중에는 예정도 숨긴다(이미 넣은 분을 가려낼 수 없다)', () => {
    show('2026-11', '2026-11-25', { loading: true })
    expect(screen.queryByText(/나갈 고정지출/)).toBeNull()
    expect(screen.getByText('불러오는 중…')).toBeTruthy()
  })
})
