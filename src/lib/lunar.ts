// 음력 → 양력 변환 (2025~2037년 음력).
// 표는 한국천문연구원 음양력 자료 기반 표(korean-lunar-calendar 0.3.6)에서 뽑았고,
// 161개 달의 시작일이 모두 astronomy-engine으로 계산한 한국시간(UTC+9) 합삭 날짜와 일치함을 확인했다.
// 윤달 위치는 중국 농력(lunar-javascript)과도 같다.

/** 음력 해마다 [1월 1일의 양력 날짜, 윤달(없으면 0), 달 길이(1=30일, 0=29일, 윤달은 그 달 바로 뒤)] */
const YEARS: Record<number, [string, number, string]> = {
  2025: ['2025-01-29', 6, '1010010101110'],
  2026: ['2026-02-17', 0, '101001010111'],
  2027: ['2027-02-07', 0, '010100100111'],
  2028: ['2028-01-27', 5, '0110100100110'],
  2029: ['2029-02-13', 0, '110110010011'],
  2030: ['2030-02-03', 0, '010110101010'],
  2031: ['2031-01-23', 3, '1010101101010'],
  2032: ['2032-02-11', 0, '100101101101'],
  2033: ['2033-01-31', 11, '0100101011101'],
  2034: ['2034-02-19', 0, '010010101110'],
  2035: ['2035-02-08', 0, '101001001101'],
  2036: ['2036-01-28', 6, '1101001001101'],
  2037: ['2037-02-15', 0, '110100100101'],
}

export const LUNAR_RANGE = { from: 2025, to: 2037 }

const shift = (date: string, days: number) => {
  const t = new Date(`${date}T00:00:00Z`)
  t.setUTCDate(t.getUTCDate() + days)
  return t.toISOString().slice(0, 10)
}

/**
 * 음력 y년 m월 d일(윤달이 아닌 달)의 양력 날짜. 표 밖의 해면 null.
 * 그 달이 29일까지인데 30일을 물으면 그 달 마지막 날(29일)로 본다.
 */
export function lunarToSolar(y: number, m: number, d: number): string | null {
  const row = YEARS[y]
  if (!row || m < 1 || m > 12 || d < 1 || d > 30) return null
  const [start, leap, bits] = row
  let offset = 0
  for (let i = 1; i < m; i++) {
    offset += bits[i - 1 + (leap && i > leap ? 1 : 0)] === '1' ? 30 : 29
    if (i === leap) offset += bits[i] === '1' ? 30 : 29 // 윤달
  }
  const len = bits[m - 1 + (leap && m > leap ? 1 : 0)] === '1' ? 30 : 29
  return shift(start, offset + Math.min(d, len) - 1)
}

/** 양력 날짜의 음력 월·일 (윤달이면 leap). 표 밖이면 null */
export function solarToLunar(date: string): { year: number; month: number; day: number; leap: boolean } | null {
  const y = Number(date.slice(0, 4))
  for (const ly of [y, y - 1]) {
    const row = YEARS[ly]
    if (!row) continue
    const [start, leap, bits] = row
    let offset = Math.round((Date.parse(date) - Date.parse(start)) / 86_400_000)
    if (offset < 0) continue
    for (let i = 0; i < bits.length; i++) {
      const len = bits[i] === '1' ? 30 : 29
      if (offset < len) {
        // i번째 달: 윤달이 있으면 윤달 뒤로 한 칸씩 밀린다
        const isLeap = leap > 0 && i === leap
        const month = leap > 0 && i >= leap ? i : i + 1
        return { year: ly, month, day: offset + 1, leap: isLeap }
      }
      offset -= len
    }
  }
  return null
}
