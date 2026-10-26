import { describe, expect, it } from 'vitest'
import { annivCategories, annivDateLabel, annivInput, annivKindOf, anniversariesInMonth, finishAnnivInput, newAnnivInput, nextOccurrence, occurrencesIn, upcomingAnniversaries } from '../src/lib/anniversaries'
import type { Anniversary } from '../src/lib/types'
import { electionDay, HOLIDAYS } from '../src/lib/holidays'
import { lunarToSolar, solarToLunar } from '../src/lib/lunar'

const year = (y: number) => Object.fromEntries(Object.entries(HOLIDAYS).filter(([d]) => d.startsWith(`${y}-`)))

describe('공휴일', () => {
  it('2026년: 노동절·제헌절·지방선거와 대체공휴일', () => {
    expect(year(2026)).toEqual({
      '2026-01-01': '신정', '2026-02-16': '설날 연휴', '2026-02-17': '설날', '2026-02-18': '설날 연휴',
      '2026-03-01': '삼일절', '2026-03-02': '대체휴일', '2026-05-01': '노동절', '2026-05-05': '어린이날',
      '2026-05-24': '부처님오신날', '2026-05-25': '대체휴일', '2026-06-03': '지방선거', '2026-06-06': '현충일',
      '2026-07-17': '제헌절', '2026-08-15': '광복절', '2026-08-17': '대체휴일',
      '2026-09-24': '추석 연휴', '2026-09-25': '추석', '2026-09-26': '추석 연휴',
      '2026-10-03': '개천절', '2026-10-05': '대체휴일', '2026-10-09': '한글날', '2026-12-25': '성탄절',
    })
  })

  it('2027년: 우주항공청 2027년 월력요항과 같다 (공휴일 24일, 대체공휴일 7일)', () => {
    const y = year(2027)
    expect(Object.keys(y)).toHaveLength(24)
    expect(Object.entries(y).filter(([, n]) => n === '대체휴일').map(([d]) => d)).toEqual([
      '2027-02-09', '2027-05-03', '2027-07-19', '2027-08-16', '2027-10-04', '2027-10-11', '2027-12-27',
    ])
    expect(y['2027-02-07']).toBe('설날') // 중국 음력은 2월 6일
    expect(y['2027-09-15']).toBe('추석')
    expect([y['2027-09-14'], y['2027-09-16']]).toEqual(['추석 연휴', '추석 연휴'])
  })

  it('평일에 겹친 공휴일과 대체공휴일끼리 겹친 경우', () => {
    expect(HOLIDAYS['2028-10-03']).toBe('개천절, 추석')
    expect(HOLIDAYS['2028-10-05']).toBe('대체휴일')
    // 2036년: 개천절과 추석 전날이 금요일에 겹치고, 추석 다음 날이 일요일 → 대체공휴일 이틀
    expect([HOLIDAYS['2036-10-06'], HOLIDAYS['2036-10-07']]).toEqual(['대체휴일', '대체휴일'])
  })

  it('해마다 공휴일 수 (2026~2037)', () => {
    const counts = Array.from({ length: 12 }, (_, i) => Object.keys(year(2026 + i)).length)
    expect(counts).toEqual([22, 24, 18, 20, 21, 18, 26, 22, 19, 20, 22, 21])
  })

  it('선거일 계산이 지난 실제 선거일과 같다', () => {
    const hol = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay() === 0 || d.endsWith('-06-06')
    expect(electionDay('2018-06-30', 30, hol)).toBe('2018-06-13') // 6월 6일 현충일이 겹쳐 다음 주
    expect(electionDay('2022-06-30', 30, hol)).toBe('2022-06-01')
    expect(electionDay('2024-05-29', 50, hol)).toBe('2024-04-10')
    expect(electionDay('2026-06-30', 30, hol)).toBe('2026-06-03')
    expect(HOLIDAYS['2030-06-12']).toBe('지방선거') // 6월 5일 다음 날이 현충일
  })
})

describe('음력 변환', () => {
  it('설날·추석과 윤달 뒤의 달', () => {
    expect(lunarToSolar(2027, 1, 1)).toBe('2027-02-07')
    expect(lunarToSolar(2028, 8, 15)).toBe('2028-10-03')
    expect(lunarToSolar(2028, 6, 1)).toBe('2028-07-22') // 2028년은 윤5월 뒤
    expect(lunarToSolar(2024, 1, 1)).toBeNull() // 표 밖
  })

  it('양력 → 음력 (윤달 표시 포함, 표 밖은 null)', () => {
    expect(solarToLunar('2027-02-07')).toEqual({ year: 2027, month: 1, day: 1, leap: false })
    expect(solarToLunar('2027-02-06')).toMatchObject({ year: 2026, month: 12, day: 30 })
    expect(solarToLunar('2028-07-22')).toEqual({ year: 2028, month: 6, day: 1, leap: false })
    expect(solarToLunar(lunarToSolar(2028, 5, 29)!)).toMatchObject({ month: 5, day: 29, leap: false })
    expect(solarToLunar('2028-06-23')).toMatchObject({ month: 5, leap: true }) // 2028년 윤5월
    expect(solarToLunar('2024-12-01')).toBeNull()
  })

  it('29일까지인 달의 30일은 그 달 마지막 날로 본다', () => {
    // 음력 2027년 1월은 29일까지
    expect(lunarToSolar(2027, 1, 30)).toBe(lunarToSolar(2027, 1, 29))
  })
})

describe('기념일', () => {
  const list = [
    { name: '음력 생일 A', kind: 'birthday' as const, lunar: true, month: 9, day: 9 },
    { name: '음력 생일 B', kind: 'birthday' as const, lunar: true, month: 1, day: 15 },
    { name: '양력 기념일', kind: 'couple' as const, lunar: false, month: 10, day: 20 },
    { name: '윤일', kind: 'other' as const, lunar: false, month: 2, day: 29 },
  ]

  it('음력 기념일을 그해 양력으로 (korean-lunar-calendar로 계산한 값과 같다)', () => {
    expect(occurrencesIn(list[0], 2026)).toEqual(['2026-10-19'])
    expect(occurrencesIn({ lunar: true, month: 10, day: 1 }, 2026)).toEqual(['2026-11-09'])
    expect(occurrencesIn(list[1], 2027)).toEqual(['2027-02-21'])
    expect(occurrencesIn({ lunar: true, month: 8, day: 1 }, 2027)).toEqual(['2027-09-01'])
  })

  it('양력 2월 29일은 평년에 2월 28일', () => {
    expect(occurrencesIn(list[3], 2027)).toEqual(['2027-02-28'])
    expect(occurrencesIn(list[3], 2028)).toEqual(['2028-02-29'])
  })

  it('음력 12월 기념일은 다음 해 양력 1~2월에 올 수 있다', () => {
    const d = lunarToSolar(2026, 12, 20)!
    expect(d.startsWith('2027-')).toBe(true)
    expect(occurrencesIn({ lunar: true, month: 12, day: 20 }, 2027)).toEqual([d])
  })

  it('달력의 날짜별 기념일과 가까운 순서 D-day', () => {
    const oct = anniversariesInMonth(list, '2026-10')
    expect(Object.fromEntries([...oct].map(([d, a]) => [d, a.map((x) => x.name)]))).toEqual({
      '2026-10-19': ['음력 생일 A'], '2026-10-20': ['양력 기념일'],
    })
    expect(nextOccurrence(list[2], '2026-10-20')).toBe('2026-10-20')
    expect(nextOccurrence(list[2], '2026-10-21')).toBe('2027-10-20')
    expect(upcomingAnniversaries(list, '2026-10-15').map((u) => [u.a.name, u.days])).toEqual([
      ['음력 생일 A', 4], ['양력 기념일', 5], ['음력 생일 B', 129], ['윤일', 136],
    ])
  })
})

describe('기념일 반복·카테고리 (D-033)', () => {
  const at = (p: Partial<Anniversary>) => ({ lunar: false, month: 3, day: 10, repeat_unit: 'year' as const, repeat_every: 1, start_year: null, ...p })

  it('N년마다: 시작 해부터 N년 간격, 그 전 해에는 없고, 다가오는 날은 N년 뒤까지 찾는다', () => {
    const every3 = at({ repeat_every: 3, start_year: 2024 })
    expect([2023, 2024, 2025, 2026, 2027].map((y) => occurrencesIn(every3, y).length)).toEqual([0, 1, 0, 0, 1])
    expect(nextOccurrence(every3, '2026-10-26')).toBe('2027-03-10')
    expect(nextOccurrence(at({ repeat_every: 5, start_year: 2023 }), '2026-10-26')).toBe('2028-03-10')
    // 음력은 음력 해로 센다: 2년마다 음력 8월 15일(2026년부터) → 2026·2028년 추석
    const lunar2 = at({ lunar: true, month: 8, day: 15, repeat_every: 2, start_year: 2026 })
    expect(occurrencesIn(lunar2, 2026)).toEqual(['2026-09-25'])
    expect(occurrencesIn(lunar2, 2027)).toEqual([])
  })

  it('개월마다: 시작 달부터 N개월 간격, 그 달에 없는 날은 마지막 날', () => {
    const monthly = at({ repeat_unit: 'month', start_year: 2026, month: 10, day: 31 })
    expect(occurrencesIn(monthly, 2026)).toEqual(['2026-10-31', '2026-11-30', '2026-12-31'])
    expect(anniversariesInMonth([monthly], '2027-02').get('2027-02-28')).toHaveLength(1)
    expect(anniversariesInMonth([monthly], '2026-09').size).toBe(0)
    const quarterly = at({ repeat_unit: 'month', repeat_every: 3, start_year: 2026, month: 1, day: 5 })
    expect(occurrencesIn(quarterly, 2026)).toEqual(['2026-01-05', '2026-04-05', '2026-07-05', '2026-10-05'])
    expect(nextOccurrence(quarterly, '2026-10-26')).toBe('2027-01-05')
    // 해마다(시작 해 없음)는 예전과 같다
    expect(upcomingAnniversaries([{ ...at({ month: 11, day: 2 }), name: '결혼기념일' }], '2026-10-26')[0].days).toBe(7)
  })

  it('반복 말, 아이콘 종류, 카테고리 목록', () => {
    expect(annivDateLabel(at({}))).toBe('3월 10일')
    expect(annivDateLabel(at({ lunar: true }))).toBe('음력 3월 10일')
    expect(annivDateLabel(at({ repeat_every: 2, start_year: 2026 }))).toBe('2년마다 3월 10일')
    expect(annivDateLabel(at({ repeat_unit: 'month', start_year: 2026 }))).toBe('매달 10일')
    expect(annivDateLabel(at({ repeat_unit: 'month', repeat_every: 3, start_year: 2026 }))).toBe('3개월마다 10일')
    expect([annivKindOf('생일', '엄마'), annivKindOf(null, '할머니 기일'), annivKindOf('기념일', 'x'), annivKindOf('병원', '건강검진')])
      .toEqual(['birthday', 'memorial', 'couple', 'other'])
    expect(annivCategories([{ category: '병원' }, { category: '생일' }, { category: '병원' }, { category: null }]))
      .toEqual(['병원', '생일', '기념일', '추모', '명절', '갱신'])
  })

  it('저장 값 다듬기: 해마다는 시작 해를 두지 않고, 그 밖은 시작 해가 있고, 매달은 양력. 고치기 폼 값은 모든 칸을 옮긴다', () => {
    const base = newAnnivInput('2026-10-26')
    expect(base).toMatchObject({ month: 10, day: 26, repeat_unit: 'year', repeat_every: 1, start_year: 2026 })
    expect(finishAnnivInput({ ...base, name: ' 엄마 생신 ', category: ' 생일 ' }, 2026))
      .toMatchObject({ name: '엄마 생신', category: '생일', kind: 'birthday', start_year: null })
    expect(finishAnnivInput({ ...base, name: '여권', category: '  ', repeat_every: 10, start_year: null }, 2026))
      .toMatchObject({ category: null, kind: 'other', repeat_every: 10, start_year: 2026 })
    expect(finishAnnivInput({ ...base, name: '용돈', repeat_unit: 'month', lunar: true }, 2026)).toMatchObject({ lunar: false, start_year: 2026 })
    const saved: Anniversary = { id: 'a', household_id: 'h', name: '건강검진', kind: 'other', category: '병원', lunar: false, month: 5, day: 1,
      repeat_unit: 'year', repeat_every: 2, start_year: 2024 }
    expect(annivInput(saved)).toEqual({ name: '건강검진', kind: 'other', category: '병원', lunar: false, month: 5, day: 1,
      repeat_unit: 'year', repeat_every: 2, start_year: 2024 })
  })
})
