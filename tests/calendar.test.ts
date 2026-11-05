import { describe, expect, it } from 'vitest'
import { annivCategories, annivDateLabel, annivIconOf, annivInput, annivKindOf, anniversariesInMonth, finishAnnivInput, newAnnivInput, nextOccurrence, occurrencesIn, upcomingAnniversaries } from '../src/lib/anniversaries'
import { addDays, byPriority, eventsByDate, fxClass, isRange, rangeDays, rangeError, rangeLabel, rangePart, shortDate, upcomingEvents, whenLabel } from '../src/lib/events'
import type { Anniversary, CalEvent } from '../src/lib/types'
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

  it('기념일 그림(D-049): 같은 생일·결혼기념일이라도 누구의 날인지에 따라 그림이 다르다', () => {
    // 2026-11-03 우리 가구 기념일 이름·카테고리 그대로
    const rows: [string, string | null, 'birthday' | 'couple' | 'memorial' | 'other', string][] = [
      ['아버지생신', '생일', 'birthday', 'father'], ['어머니생신', '생일', 'birthday', 'mother'],
      ['장인어른생신', '생일', 'birthday', 'father-in-law'], ['장모님 생신', '생일', 'birthday', 'mother-in-law'],
      ['내생일', '생일', 'birthday', 'party'], ['동생생일', '생일', 'birthday', 'balloon'], ['아인이 태어난날', '생일', 'birthday', 'baby'], ['하리생일', '생일', 'birthday', 'cake'],
      ['우리결혼기념일', '기념일', 'couple', 'ring'], ['부모님 결혼기념일', '기념일', 'couple', 'bouquet'], ['장인장모님 결혼기념일', '기념일', 'couple', 'tulip'],
      ['예나처음만난날', '기념일', 'couple', 'two-hearts'], ['예나랑시작', '기념일', 'couple', 'love-letter'],
      ['별이떠난날', '추모', 'memorial', 'dove'], ['루까 축일', null, 'other', 'church'], ['전역날', null, 'other', 'medal'],
    ]
    expect(rows.map(([name, category, kind]) => annivIconOf({ name, category, kind }))).toEqual(rows.map((r) => r[3]))
    // 화면 예시 데이터와 그 밖의 말
    expect(annivIconOf({ name: '할머니 기일', category: '추모', kind: 'memorial' })).toBe('candle')
    expect(annivIconOf({ name: '건강검진', category: '병원', kind: 'other' })).toBe('hospital')
    expect(annivIconOf({ name: '아이 용돈', category: null, kind: 'other' })).toBe('money')
    expect(annivIconOf({ name: '결혼기념일', category: '기념일', kind: 'couple' })).toBe('ring')
    expect(annivIconOf({ name: '여권', category: '갱신', kind: 'other' })).toBe('document')
    expect(annivIconOf({ name: '추석', category: '명절', kind: 'other' })).toBe('moon')
    expect(annivIconOf({ name: '할아버지 생신', category: '생일', kind: 'birthday' })).toBe('elder')
    // 우리 기념일이 아니면 '시작'·'만난'으로 연애 그림을 고르지 않는다
    expect(annivIconOf({ name: '운동 시작한 날', category: null, kind: 'other' })).toBe('star')
    expect(annivIconOf({ name: '100일', category: '기념일', kind: 'couple' })).toBe('heart-ribbon')
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

describe('기간 일정·중요도 (D-054)', () => {
  const ev = (id: string, date: string, end_on: string | null = null, more: Partial<CalEvent> = {}): CalEvent =>
    ({ id, household_id: 'h', date, end_on, time: null, title: id, memo: null, place: null, address: null, lat: null, lng: null, scope: 'shared', ...more })

  it('날짜 더하기는 달·해를 넘긴다', () => {
    expect([addDays('2026-11-30', 1), addDays('2026-12-31', 1), addDays('2028-02-28', 1), addDays('2026-03-01', -1)])
      .toEqual(['2026-12-01', '2027-01-01', '2028-02-29', '2026-02-28'])
  })

  it('기간 글: 같은 달은 끝 날만, 달·해가 다르면 다 적는다', () => {
    expect(rangeLabel(ev('a', '2026-11-07'))).toBe('11월 7일')
    expect(rangeLabel(ev('a', '2026-11-07', '2026-11-09'))).toBe('11월 7일 ~ 9일')
    expect(rangeLabel(ev('a', '2026-11-28', '2026-12-02'))).toBe('11월 28일 ~ 12월 2일')
    expect(rangeLabel(ev('a', '2026-12-30', '2027-01-02'))).toBe('2026년 12월 30일 ~ 2027년 1월 2일')
    expect([rangeDays(ev('a', '2026-11-07')), rangeDays(ev('a', '2026-11-07', '2026-11-09'))]).toEqual([1, 3])
    // 다가오는 목록의 날짜 글(D-055)
    expect([shortDate('2026-11-08'), shortDate('2026-12-01')]).toEqual(['11월 8일 (일)', '12월 1일 (화)'])
  })

  it('끝나는 날이 시작과 같거나 없으면(이 칸 전의 일정 포함) 하루 일정이다', () => {
    expect([isRange(ev('a', '2026-11-07', '2026-11-07')), isRange(ev('a', '2026-11-07')), isRange({ date: '2026-11-07' }), isRange(ev('a', '2026-11-07', '2026-11-08'))])
      .toEqual([false, false, false, true])
  })

  it('고른 날 줄: 하루 일정은 시간, 기간 일정은 기간과 시작 시간', () => {
    expect(whenLabel(ev('a', '2026-11-07'))).toBe('하루 종일')
    expect(whenLabel(ev('a', '2026-11-07', null, { time: '14:00' }))).toBe('14:00')
    expect(whenLabel(ev('a', '2026-11-07', '2026-11-09'))).toBe('11월 7일 ~ 9일')
    expect(whenLabel(ev('a', '2026-11-07', '2026-11-09', { time: '14:00' }))).toBe('11월 7일 ~ 9일, 14:00')
  })

  it('끝나는 날 검사: 비면 통과, 시작보다 앞·1년 넘김은 막는다', () => {
    expect(rangeError('2026-11-07', null)).toBeNull()
    expect(rangeError('2026-11-07', '2026-11-07')).toBeNull()
    expect(rangeError('2026-11-07', '2026-11-06')).toBe('끝나는 날이 시작하는 날보다 앞이에요.')
    expect(rangeError('2026-11-07', '2027-11-08')).toBeNull() // 366일째
    expect(rangeError('2026-11-07', '2027-11-09')).toBe('기간은 1년까지 정할 수 있어요.')
    expect(rangeError('2026-11-07', '11/9')).toBe('날짜를 다시 골라 주세요.')
  })

  it('기간 안의 날마다 들어가고, 보는 범위 밖은 자른다(앞 달에 시작한 일정도 이번 달 날짜에 보인다)', () => {
    const trip = ev('여행', '2026-10-30', '2026-11-02')
    const m = eventsByDate([trip, ev('치과', '2026-11-02'), ev('출장', '2026-11-29', '2026-12-03')], '2026-11-01', '2026-11-30')
    expect([...m.keys()]).toEqual(['2026-11-01', '2026-11-02', '2026-11-29', '2026-11-30'])
    expect(m.get('2026-11-02')?.map((e) => e.id)).toEqual(['여행', '치과'])
    expect([rangePart(trip, '2026-10-30'), rangePart(trip, '2026-11-01'), rangePart(trip, '2026-11-02'), rangePart(ev('a', '2026-11-02'), '2026-11-02')])
      .toEqual(['start', 'mid', 'end', 'only'])
  })

  it('달력 칸 순서는 꼭 → 중요 → 보통(같으면 받은 순서), 효과 클래스는 중요·꼭에만', () => {
    const list = [ev('a', '2026-11-07'), ev('b', '2026-11-07', null, { priority: 'high', effect: 'mark' }), ev('c', '2026-11-07', null, { priority: 'must', effect: 'fill' }),
      ev('d', '2026-11-07', null, { priority: 'high' })]
    expect(byPriority(list).map((e) => e.id)).toEqual(['c', 'b', 'd', 'a'])
    expect(list.map(fxClass)).toEqual(['', 'p-high fx-mark', 'p-must fx-fill', 'p-high fx-outline'])
    // 보통 일정은 효과 칸에 값이 있어도 쓰지 않는다
    expect(fxClass({ priority: 'normal', effect: 'breathe' })).toBe('')
  })

  it('다가오는 일정: 이미 시작해 오늘도 이어지는 일정은 "하는 중"으로 맨 앞, 끝난 일정·30일 뒤는 뺀다', () => {
    const list = [ev('끝남', '2026-10-28', '2026-11-01'), ev('여행', '2026-10-30', '2026-11-04'), ev('오늘', '2026-11-02'), ev('치과', '2026-11-05'),
      ev('먼', '2026-12-25'), ev('긴 출장', '2026-11-30', '2026-12-20')]
    expect(upcomingEvents(list, '2026-11-02').map((u) => [u.e.id, u.date, u.days, u.ongoing])).toEqual([
      ['여행', '2026-11-02', 0, true], ['오늘', '2026-11-02', 0, false], ['치과', '2026-11-05', 3, false], ['긴 출장', '2026-11-30', 28, false],
    ])
  })
})
