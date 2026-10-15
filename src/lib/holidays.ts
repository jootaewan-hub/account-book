// 2026~2037년 관공서 공휴일 (달력에 빨간 날로 표시).
//
// 근거
// - 관공서의 공휴일에 관한 규정 (대통령령 제36290호, 2026.4.30. 개정, 2026.5.1. 시행, 제헌절 부분은 2026.5.11. 시행)
//   제2조: 공휴일 목록 (노동절·제헌절이 2026년부터 공휴일)
//   제3조: 대체공휴일
//     ① 1. 국경일·부처님 오신 날·노동절·어린이날·기독탄신일이 토요일이나 일요일과 겹칠 때
//        2. 설·추석 연휴가 일요일과 겹칠 때
//        3. 위 공휴일(설·추석 포함)이 평일에 다른 공휴일과 겹칠 때
//        → 그 공휴일 다음의 첫 번째 비공휴일
//     ② 대체공휴일끼리 겹치면 그 다음 첫 번째 비공휴일까지, ③ 대체공휴일이 토요일이면 그 다음 첫 번째 비공휴일
//     (신정·현충일·선거일은 대체공휴일이 없다)
// - 공직선거법 제34조: 임기만료 선거일은 임기만료일 전 70일(대통령)·50일(국회의원)·30일(지방) 이후 첫 수요일.
//   그날이 공휴일이거나 전날·다음 날이 공휴일이면 그다음 주 수요일.
//   2030년 이후 선거일은 현행법으로 계산한 값이라 법이 바뀌면 달라질 수 있다.
// - 음력 공휴일(설날·부처님오신날·추석)은 lunar.ts의 음력 표로 계산한다. 2027·2028 설날은 중국 음력보다 하루 늦다.
// - 2027년은 우주항공청 「2027년 월력요항」(2026.6.29.)과 대조했다.
// - 정부가 수시로 정하는 임시공휴일은 미리 알 수 없어 넣지 않는다.
import { lunarToSolar } from './lunar'

/** 임기만료 선거: [이름, 임기만료일, 며칠 전부터] */
const ELECTIONS: [string, string, number][] = [
  ['지방선거', '2026-06-30', 30],
  ['국회의원선거', '2028-05-29', 50],
  ['대통령선거', '2030-06-03', 70],
  ['지방선거', '2030-06-30', 30],
  ['국회의원선거', '2032-05-29', 50],
  ['지방선거', '2034-06-30', 30],
  ['대통령선거', '2035-06-03', 70],
  ['국회의원선거', '2036-05-29', 50],
]

export const HOLIDAY_YEARS = { from: 2026, to: 2037 }

// none: 대체공휴일 없음, weekend: 토·일요일과 겹치면 대체, sunday: 일요일과 겹치면 대체 (설·추석)
type Rule = 'none' | 'weekend' | 'sunday'
interface Day { date: string; name: string; rule: Rule }

const FIXED: [string, string, Rule][] = [
  ['01-01', '신정', 'none'], ['03-01', '삼일절', 'weekend'], ['05-01', '노동절', 'weekend'], ['05-05', '어린이날', 'weekend'],
  ['06-06', '현충일', 'none'], ['07-17', '제헌절', 'weekend'], ['08-15', '광복절', 'weekend'], ['10-03', '개천절', 'weekend'],
  ['10-09', '한글날', 'weekend'], ['12-25', '성탄절', 'weekend'],
]

const shift = (date: string, days: number) => {
  const t = new Date(`${date}T00:00:00Z`)
  t.setUTCDate(t.getUTCDate() + days)
  return t.toISOString().slice(0, 10)
}
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() // 0 일요일 ~ 6 토요일

function baseDays(): Day[] {
  const out: Day[] = []
  for (let y = HOLIDAY_YEARS.from; y <= HOLIDAY_YEARS.to; y++) {
    for (const [md, name, rule] of FIXED) out.push({ date: `${y}-${md}`, name, rule })
    const [seol, buddha, chuseok] = [lunarToSolar(y, 1, 1)!, lunarToSolar(y, 4, 8)!, lunarToSolar(y, 8, 15)!]
    out.push({ date: shift(seol, -1), name: '설날 연휴', rule: 'sunday' }, { date: seol, name: '설날', rule: 'sunday' }, { date: shift(seol, 1), name: '설날 연휴', rule: 'sunday' })
    out.push({ date: buddha, name: '부처님오신날', rule: 'weekend' })
    out.push({ date: shift(chuseok, -1), name: '추석 연휴', rule: 'sunday' }, { date: chuseok, name: '추석', rule: 'sunday' }, { date: shift(chuseok, 1), name: '추석 연휴', rule: 'sunday' })
  }
  return out
}

/** 제3조에 따라 대체공휴일 날짜를 고른다 */
function substitutes(days: Day[]): string[] {
  const byDate = new Map<string, Day[]>()
  for (const d of days) byDate.set(d.date, [...(byDate.get(d.date) ?? []), d])
  const taken = new Set(days.map((d) => d.date))
  const out: string[] = []
  for (const date of [...byDate.keys()].sort()) {
    const list = byDate.get(date)!
    const dow = weekday(date)
    const eligible = list.filter((d) => d.rule !== 'none').length
    const count = dow === 6 ? list.filter((d) => d.rule === 'weekend').length
      : dow === 0 ? eligible
      : Math.min(list.length - 1, eligible) // 평일에 두 공휴일이 겹치면 하루를 돌려준다
    for (let i = 0; i < count; i++) {
      let s = shift(date, 1)
      while (weekday(s) === 0 || weekday(s) === 6 || taken.has(s)) s = shift(s, 1)
      taken.add(s)
      out.push(s)
    }
  }
  return out
}

/** 공직선거법 제34조로 선거일을 정한다 */
export function electionDay(termEnd: string, before: number, isHoliday: (date: string) => boolean): string {
  let d = shift(termEnd, -before)
  while (weekday(d) !== 3) d = shift(d, 1)
  while (isHoliday(d) || isHoliday(shift(d, -1)) || isHoliday(shift(d, 1))) d = shift(d, 7)
  return d
}

function build(): Record<string, string> {
  const base = baseDays()
  const first = new Set([...base.map((d) => d.date), ...substitutes(base)])
  const elections: Day[] = ELECTIONS.map(([name, end, before]) => ({ date: electionDay(end, before, (x) => first.has(x)), name, rule: 'none' }))
  const all = [...base, ...elections]
  const map: Record<string, string> = {}
  for (const d of all) map[d.date] = map[d.date] ? `${map[d.date]}, ${d.name}` : d.name
  for (const s of substitutes(all)) map[s] = '대체휴일'
  return Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)))
}

export const HOLIDAYS: Record<string, string> = build()
