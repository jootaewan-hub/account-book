import { describe, expect, it } from 'vitest'
import { expandEvents } from '../src/lib/events'
import type { CalEvent } from '../src/lib/types'

const series: CalEvent = {
  id: 'event', household_id: 'home', date: '2026-11-06', time: '19:00', title: '운동', memo: null,
  place: null, address: null, lat: null, lng: null, scope: 'shared', repeat_weeks: 2,
}

describe('일정 반복 회차', () => {
  it('격주 일정을 과거 시작일에서 계산하고 건너뛴 회차와 종료일 뒤를 뺀다', () => {
    const rows = expandEvents([{ ...series, repeat_until: '2027-01-15', skipped_on: ['2026-12-18'] }], '2026-12-01', '2027-02-01')
    expect(rows.map((row) => [row.id, row.date, row.series_start])).toEqual([
      ['event', '2026-12-04', '2026-11-06'],
      ['event', '2027-01-01', '2026-11-06'],
      ['event', '2027-01-15', '2026-11-06'],
    ])
  })

  it('여러 날 일정은 시작 날이 조회 시작 전이어도 그대로 남는다', () => {
    const event = { ...series, repeat_weeks: null, end_on: '2026-12-02' }
    expect(expandEvents([event], '2026-12-01', '2026-12-30')).toEqual([event])
  })
})
