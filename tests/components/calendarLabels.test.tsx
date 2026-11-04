// @vitest-environment jsdom
// 달력 칸의 기념일·일정 이름: 칸마다 두 개까지(기념일 먼저), 넘치면 +N. 화면 읽기는 칸의 aria-label이 맡는다
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
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

// 기간·중요도(D-054)
const NONE = { onSelect: () => {}, onJump: () => {}, onEdit: () => {} }
const trip: CalEvent = { ...ev('t', '가족 여행', '2026-11-07', null), end_on: '2026-11-09', priority: 'must', effect: 'fill' }

it('기간 일정은 기간 안의 날마다 칸에 보이고(첫날·가운데·마지막 날 모양), 읽기 이름에 중요도와 기간을 적는다', () => {
  render(<CalendarView ym="2026-11" today="2026-11-02" sel="2026-11-08" cur={[]} prev={[]} lookup={makeLookup('u1', [], [], [])}
    annivs={[]} events={[trip]} onPlan={() => {}} {...NONE} />)
  const cls = (d: number) => [...screen.getByRole('button', { name: new RegExp(`^11월 ${d}일`) }).querySelectorAll('.cal-lbl')].map((e) => [e.textContent, e.className])
  expect(cls(6)).toEqual([])
  expect(cls(7)).toEqual([['가족 여행', 'cal-lbl ev s-shared p-must fx-fill r-start']])
  // 8일은 일요일: 줄이 바뀐 첫 칸
  expect(cls(8)).toEqual([['가족 여행', 'cal-lbl ev s-shared p-must fx-fill r-mid r-head']])
  expect(cls(9)).toEqual([['가족 여행', 'cal-lbl ev s-shared p-must fx-fill r-end']])
  expect(cls(10)).toEqual([])
  expect(screen.getByRole('button', { name: /^11월 8일/ }).getAttribute('aria-label')).toContain('일정 가족 여행(꼭, 11월 7일 ~ 9일)')
  // 고른 날(가운데 날) 줄: "꼭" 글자 태그와 기간, 효과 클래스. 다가오는 칩에도 기간과 태그
  const row = document.querySelector('.anniv-list .anniv-row.k-event')
  expect(row?.textContent).toBe('가족 여행꼭11월 7일 ~ 9일')
  expect(row?.className).toBe('anniv-row k-event p-must fx-fill')
  const chip = screen.getByRole('group', { name: '다가오는 일정·기념일' }).querySelector('.anniv-chip')
  expect(chip?.textContent).toBe('가족 여행꼭11월 7일 ~ 9일D-5')
  expect(chip?.className).toBe('anniv-chip k-event p-must fx-fill')
})

it('앞 달에 시작한 기간 일정도 이번 달 날짜에 보이고, 오늘도 이어지면 다가오는 칩은 "하는 중"이며 누르면 오늘로 간다', () => {
  const onJump = vi.fn()
  render(<CalendarView ym="2026-11" today="2026-11-02" sel="2026-11-02" cur={[]} prev={[]} lookup={makeLookup('u1', [], [], [])}
    annivs={[]} events={[{ ...ev('b', '출장', '2026-10-30', null, 'husband'), end_on: '2026-11-03' }]} onPlan={() => {}} onSelect={() => {}} onEdit={() => {}} onJump={onJump} />)
  expect([1, 2, 3, 4].map((d) => screen.getByRole('button', { name: new RegExp(`^11월 ${d}일`) }).querySelector('.cal-lbl')?.className))
    .toEqual(['cal-lbl ev s-husband r-mid r-head', 'cal-lbl ev s-husband r-mid', 'cal-lbl ev s-husband r-end', undefined])
  const chip = screen.getByRole('group', { name: '다가오는 일정·기념일' }).querySelector('.anniv-chip') as HTMLElement
  expect(chip.textContent).toBe('출장남편10월 30일 ~ 11월 3일하는 중')
  fireEvent.click(chip)
  expect(onJump).toHaveBeenCalledWith('2026-11-02')
})

it('칸에는 꼭 → 중요 → 보통 순서로 두 개까지 보이고, 점·별 효과는 이름 앞에 표시가 붙는다', () => {
  const list: CalEvent[] = [ev('n', '산책'), { ...ev('h', '치과'), priority: 'high', effect: 'mark' }, { ...ev('m', '건강검진'), priority: 'must', effect: 'mark' }]
  render(<CalendarView ym="2026-11" today="2026-11-02" sel="2026-11-11" cur={[]} prev={[]} lookup={makeLookup('u1', [], [], [])}
    annivs={[]} events={list} onPlan={() => {}} {...NONE} />)
  const labels = [...screen.getByRole('button', { name: /^11월 11일/ }).querySelectorAll('.cal-lbl')]
  expect(labels.map((e) => e.textContent)).toEqual(['건강검진', '치과', '+1'])
  expect(labels[0].querySelector('.fx-m.star svg')).toBeTruthy()
  expect(labels[1].querySelector('.fx-m.dot')).toBeTruthy()
  // 고른 날 줄은 시간 순서 그대로(받은 순서)이고 글자 태그로도 알린다
  expect([...document.querySelectorAll('.anniv-list .anniv-row')].map((e) => e.textContent)).toEqual(['산책18:00', '치과중요18:00', '건강검진꼭18:00'])
})

it('고른 날의 넣기 칸: 이름을 적고 넣기를 누르면 바로 넣고 칸을 비운다. 비어 있으면 넣지 않고 알린다. 자세히 넣기는 적던 이름을 가져간다', async () => {
  const onQuickAdd = vi.fn(async (_t: string) => true)
  const onPlan = vi.fn()
  render(<CalendarView ym="2026-11" today="2026-11-02" sel="2026-11-05" cur={[]} prev={[]} lookup={makeLookup('u1', [], [], [])}
    annivs={[]} events={[]} onPlan={onPlan} onQuickAdd={onQuickAdd} {...NONE} />)
  const input = screen.getByRole('textbox', { name: '11월 5일에 일정 넣기' }) as HTMLInputElement
  fireEvent.click(screen.getByRole('button', { name: '넣기' }))
  expect(onQuickAdd).not.toHaveBeenCalled()
  expect(screen.getByRole('alert').textContent).toBe('일정 이름을 적어 주세요.')
  fireEvent.change(input, { target: { value: ' 치과 예약 ' } })
  expect(screen.queryByRole('alert')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '자세히 넣기' }))
  expect(onPlan).toHaveBeenCalledWith({ kind: 'new', date: '2026-11-05', title: '치과 예약' })
  fireEvent.click(screen.getByRole('button', { name: '넣기' }))
  await vi.waitFor(() => expect(input.value).toBe(''))
  expect(onQuickAdd).toHaveBeenCalledWith('치과 예약')
})
