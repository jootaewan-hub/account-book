// @vitest-environment jsdom
// 일정 넣기·고치기 폼의 기간·중요도(D-054): 끝나는 날(선택)과 시작보다 앞이면 막기, 중요도 세 칸과 표시 효과 고르기(미리보기)
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CalEvent, EventInput } from '../../src/lib/types'

const state = { inserted: [] as EventInput[], updated: [] as [string, EventInput][] }
vi.mock('../../src/lib/api', () => ({
  friendlyError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  insertEvent: async (_h: string, e: EventInput) => { state.inserted.push(e) },
  updateEvent: async (id: string, e: EventInput) => { state.updated.push([id, e]) },
  deleteEvent: async () => {},
  insertAnniversary: async () => {}, updateAnniversary: async () => {}, deleteAnniversary: async () => {},
}))

const { PlanSheet } = await import('../../src/components/PlanSheet')
type Target = import('../../src/components/PlanSheet').PlanTarget

beforeEach(() => { state.inserted = []; state.updated = []; localStorage.clear() })
afterEach(cleanup)

function open(target: Target) {
  const toast = vi.fn()
  render(<PlanSheet target={target} householdId="h" today="2026-11-05" annivs={[]} onEventsChanged={async () => {}} onAnnivsChanged={async () => {}} onClose={() => {}} toast={toast} />)
  return toast
}
const end = () => screen.getByLabelText('끝나는 날 (선택)') as HTMLInputElement
const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed')

describe('일정 폼의 기간', () => {
  it('끝나는 날을 비우면 하루 일정(end_on null)으로 넣고, 달력 넣기 칸에 적던 이름을 가져온다', async () => {
    const toast = open({ kind: 'new', date: '2026-11-07', title: '치과 예약' })
    expect((screen.getByLabelText('무엇을') as HTMLInputElement).value).toBe('치과 예약')
    expect(screen.getByText('하루 일정이에요. 여러 날이면 끝나는 날을 골라 주세요.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '넣기' }))
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('일정을 넣었어요'))
    expect(state.inserted[0]).toMatchObject({ title: '치과 예약', date: '2026-11-07', end_on: null, priority: 'normal' })
  })

  it('끝나는 날을 고르면 "11월 7일 ~ 9일, 3일 동안"을 적고 그대로 넣는다. 시작과 같은 날이면 하루 일정이다', async () => {
    open({ kind: 'new', date: '2026-11-07', title: '가족 여행' })
    fireEvent.change(end(), { target: { value: '2026-11-09' } })
    expect(document.getElementById('ev-range-note')?.textContent).toBe('11월 7일 ~ 9일, 3일 동안')
    expect(screen.getByLabelText('시작 시간')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '넣기' }))
    await vi.waitFor(() => expect(state.inserted).toHaveLength(1))
    expect(state.inserted[0]).toMatchObject({ date: '2026-11-07', end_on: '2026-11-09' })
    cleanup()
    open({ kind: 'new', date: '2026-11-07', title: '하루' })
    fireEvent.change(end(), { target: { value: '2026-11-07' } })
    fireEvent.click(screen.getByRole('button', { name: '넣기' }))
    await vi.waitFor(() => expect(state.inserted).toHaveLength(2))
    expect(state.inserted[1].end_on).toBeNull()
  })

  it('끝나는 날이 시작보다 앞이면 까닭을 알리고 넣지 못한다. "끝나는 날 지우기"로 하루 일정으로 돌린다', () => {
    open({ kind: 'new', date: '2026-11-07', title: '가족 여행' })
    fireEvent.change(end(), { target: { value: '2026-11-05' } })
    expect(screen.getByRole('alert').textContent).toBe('끝나는 날이 시작하는 날보다 앞이에요.')
    expect(end().getAttribute('aria-invalid')).toBe('true')
    expect((screen.getByRole('button', { name: '넣기' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '넣기' }))
    expect(state.inserted).toEqual([])
    // 시작 날을 끝 뒤로 옮겨도 날짜를 몰래 고치지 않고 막는다
    fireEvent.change(end(), { target: { value: '2026-11-09' } })
    fireEvent.change(screen.getByLabelText('시작하는 날'), { target: { value: '2026-11-12' } })
    expect(screen.getByRole('alert')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '끝나는 날 지우기' }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect((screen.getByRole('button', { name: '넣기' }) as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('일정 폼의 중요도', () => {
  it('보통이면 효과 고르기가 없고, 중요·꼭을 고르면 효과 다섯 칸이 일정 이름 미리보기와 함께 나온다', async () => {
    open({ kind: 'new', date: '2026-11-07', title: '건강검진' })
    expect(pressed('보통')).toBe('true')
    expect(screen.queryByRole('group', { name: '달력에 보일 효과' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '꼭' }))
    const group = screen.getByRole('group', { name: '달력에 보일 효과' })
    expect([...group.querySelectorAll('.fx-name')].map((e) => e.textContent)).toEqual(['테두리', '채움', '숨쉬기', '점·별', '굵은 글자'])
    expect([...group.querySelectorAll('.fx-demo')].map((e) => [e.textContent, e.className])).toEqual([
      ['건강검진', 'fx-demo p-must fx-outline'], ['건강검진', 'fx-demo p-must fx-fill'], ['건강검진', 'fx-demo p-must fx-breathe'],
      ['건강검진', 'fx-demo p-must fx-mark'], ['건강검진', 'fx-demo p-must fx-bold'],
    ])
    expect(pressed('테두리')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '숨쉬기' }))
    expect(screen.getByText(/움직임 줄이기를 켠 기기에서는 테두리로 보여요/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '넣기' }))
    await vi.waitFor(() => expect(state.inserted).toHaveLength(1))
    expect(state.inserted[0]).toMatchObject({ priority: 'must', effect: 'breathe' })
    // 마지막으로 고른 효과는 이 기기에서 다음 일정의 처음 값이 된다
    cleanup()
    open({ kind: 'new', date: '2026-11-08', title: '회식' })
    fireEvent.click(screen.getByRole('button', { name: '중요' }))
    expect(pressed('숨쉬기')).toBe('true')
    expect(screen.getByRole('group', { name: '달력에 보일 효과' }).querySelector('.fx-demo.fx-breathe')?.className).toBe('fx-demo p-high fx-breathe')
  })

  it('고치기: 저장된 기간·중요도·효과가 채워져 있고, 이름만 바꿔도 그대로 보낸다', async () => {
    const saved: CalEvent = { id: 'e1', household_id: 'h', date: '2026-11-07', end_on: '2026-11-09', time: '14:00', title: '가족 여행', memo: null,
      place: null, address: null, lat: null, lng: null, scope: 'wife', priority: 'high', effect: 'mark' }
    open({ kind: 'event', event: saved })
    expect(end().value).toBe('2026-11-09')
    expect([pressed('중요'), pressed('점·별'), pressed('아내')]).toEqual(['true', 'true', 'true'])
    fireEvent.change(screen.getByLabelText('무엇을'), { target: { value: '제주 여행' } })
    fireEvent.click(screen.getByRole('button', { name: '고치기' }))
    await vi.waitFor(() => expect(state.updated).toHaveLength(1))
    expect(state.updated[0]).toEqual(['e1', { date: '2026-11-07', end_on: '2026-11-09', time: '14:00', title: '제주 여행', memo: null,
      place: null, address: null, lat: null, lng: null, scope: 'wife', priority: 'high', effect: 'mark',
      repeat_weeks: null, repeat_until: null, reminder_offset_minutes: null, reminder_recipient: null }])
  })
})
