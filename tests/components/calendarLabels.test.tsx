// @vitest-environment jsdom
// 달력 칸의 기념일·일정 이름: 칸마다 두 개까지(기념일 먼저), 넘치면 +N. 화면 읽기는 칸의 aria-label이 맡는다
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { CalendarView } from '../../src/components/CalendarView'
import { makeLookup } from '../../src/lib/lookup'
import type { Anniversary, CalEvent } from '../../src/lib/types'

afterEach(cleanup)

const ev = (id: string, title: string, date = '2026-11-11', time: string | null = '18:00', scope: CalEvent['scope'] = 'shared'): CalEvent =>
  ({ id, household_id: 'h', date, time, title, memo: null, place: null, address: null, lat: null, lng: null, scope })
const anniv: Anniversary = {
  id: 'a1', household_id: 'h', name: '결혼기념일', kind: 'couple', category: '기념일', lunar: false, month: 11, day: 11,
  repeat_unit: 'year', repeat_every: 1, start_year: null,
} as Anniversary

it('칸에 기념일·일정 이름을 두 개까지, 넘치면 +N으로 보인다', () => {
  render(<CalendarView ym="2026-11" today="2026-11-02" sel="2026-11-02" cur={[]} prev={[]} lookup={makeLookup('u1', [], [], [])}
    annivs={[anniv]} events={[ev('e1', '라세느 뷔페 예약'), ev('e2', '치과'), ev('e3', '양인환대', '2026-11-07', '20:00', 'husband')]}
    onSelect={() => {}} onPlan={() => {}} onJump={() => {}} onEdit={() => {}} />)
  const day11 = screen.getByRole('button', { name: /^11월 11일/ })
  expect([...day11.querySelectorAll('.cal-lbl')].map((e) => e.textContent)).toEqual(['결혼기념일', '라세느 뷔페 예약', '+1'])
  expect(day11.getAttribute('aria-label')).toContain('일정 라세느 뷔페 예약, 치과')
  const day7 = screen.getByRole('button', { name: /^11월 7일/ })
  // 남편 일정은 왼쪽 띠(클래스)와 읽기 이름에 '(남편)'
  expect([...day7.querySelectorAll('.cal-lbl')].map((e) => [e.textContent, e.className])).toEqual([['양인환대', 'cal-lbl ev s-husband']])
  expect(day7.getAttribute('aria-label')).toContain('일정 양인환대(남편)')
  expect(screen.getByRole('button', { name: /^11월 12일/ }).querySelectorAll('.cal-lbl')).toHaveLength(0)
})

it('다가오는 일정·기념일은 30일 안의 것을 모두 보이고(네 개 제한 없음), 남편·아내 일정은 태그를 붙인다', () => {
  const list = [ev('e1', '치과', '2026-11-03'), ev('e2', '회식', '2026-11-05', '19:00', 'husband'), ev('e3', '양인환대', '2026-11-07'),
    ev('e4', '라세느', '2026-11-11'), ev('e5', '요가', '2026-11-12', '10:00', 'wife'), ev('e6', '안다즈', '2026-11-15'), ev('e7', '먼 일정', '2026-12-25')]
  render(<CalendarView ym="2026-11" today="2026-11-02" sel="2026-11-05" cur={[]} prev={[]} lookup={makeLookup('u1', [], [], [])}
    annivs={[]} events={list} onSelect={() => {}} onPlan={() => {}} onJump={() => {}} onEdit={() => {}} />)
  const row = screen.getByRole('group', { name: '다가오는 일정·기념일' })
  expect(row.querySelectorAll('.anniv-chip')).toHaveLength(6)
  expect(row.textContent).toContain('회식남편')
  expect(row.textContent).toContain('요가아내')
  expect(row.textContent).not.toContain('먼 일정')
  // 고른 날(5일) 줄에도 누구 일정 태그
  expect(document.querySelector('.anniv-list .anniv-row.k-event')?.textContent).toBe('회식남편19:00')
})
