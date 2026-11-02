// @vitest-environment jsdom
// 달력 칸의 기념일·일정 이름: 칸마다 두 개까지(기념일 먼저), 넘치면 +N. 화면 읽기는 칸의 aria-label이 맡는다
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { CalendarView } from '../../src/components/CalendarView'
import { makeLookup } from '../../src/lib/lookup'
import type { Anniversary, CalEvent } from '../../src/lib/types'

afterEach(cleanup)

const ev = (id: string, title: string, date = '2026-11-11', time: string | null = '18:00'): CalEvent =>
  ({ id, household_id: 'h', date, time, title, memo: null, place: null, address: null, lat: null, lng: null })
const anniv: Anniversary = {
  id: 'a1', household_id: 'h', name: '결혼기념일', kind: 'couple', category: '기념일', lunar: false, month: 11, day: 11,
  repeat_unit: 'year', repeat_every: 1, start_year: null,
} as Anniversary

it('칸에 기념일·일정 이름을 두 개까지, 넘치면 +N으로 보인다', () => {
  render(<CalendarView ym="2026-11" today="2026-11-02" sel="2026-11-02" cur={[]} prev={[]} lookup={makeLookup('u1', [], [], [])}
    annivs={[anniv]} events={[ev('e1', '라세느 뷔페 예약'), ev('e2', '치과'), ev('e3', '양인환대', '2026-11-07', '20:00')]}
    onSelect={() => {}} onPlan={() => {}} onJump={() => {}} onEdit={() => {}} />)
  const day11 = screen.getByRole('button', { name: /^11월 11일/ })
  expect([...day11.querySelectorAll('.cal-lbl')].map((e) => e.textContent)).toEqual(['결혼기념일', '라세느 뷔페 예약', '+1'])
  expect(day11.getAttribute('aria-label')).toContain('일정 라세느 뷔페 예약, 치과')
  const day7 = screen.getByRole('button', { name: /^11월 7일/ })
  expect([...day7.querySelectorAll('.cal-lbl')].map((e) => [e.textContent, e.className])).toEqual([['양인환대', 'cal-lbl ev']])
  expect(screen.getByRole('button', { name: /^11월 12일/ }).querySelectorAll('.cal-lbl')).toHaveLength(0)
})
