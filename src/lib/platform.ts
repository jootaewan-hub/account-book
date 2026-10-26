// 온라인 쇼핑·배달 플랫폼 이름 정리. 모델이 읽은 이름이나 내역 이름(가맹점)을 같은 표기로 맞춘다.

// 긴 표기를 먼저 맞춘다 (예: 쿠팡이츠 ≠ 쿠팡)
const PLATFORMS: [string, string[]][] = [
  ['쿠팡이츠', ['쿠팡이츠', 'coupangeats']],
  ['쿠팡', ['쿠팡', 'coupang']],
  ['오늘의집', ['오늘의집', 'ohou', '버킷플레이스']],
  ['컬리', ['마켓컬리', '컬리', 'kurly']],
  ['네이버', ['네이버페이', '네이버쇼핑', '스마트스토어', '네이버', 'naverpay', 'naver', 'npay']],
  ['11번가', ['11번가', '십일번가', '11st']],
  ['G마켓', ['g마켓', '지마켓', 'gmarket']],
  ['옥션', ['옥션', 'auction']],
  ['SSG닷컴', ['ssg닷컴', 'ssg.com', '쓱닷컴']],
  ['무신사', ['무신사', 'musinsa']],
  ['29CM', ['29cm']],
  ['에이블리', ['에이블리', 'ably']],
  ['지그재그', ['지그재그', 'zigzag']],
  ['알리익스프레스', ['알리익스프레스', 'aliexpress']],
  ['테무', ['테무', 'temu']],
  ['배달의민족', ['배달의민족', '배민', '우아한형제들']],
  ['요기요', ['요기요', 'yogiyo']],
  ['카카오 선물하기', ['카카오선물하기', '카카오톡선물하기']],
  ['당근', ['당근마켓', '당근페이']],
]
// 두 글자짜리 별칭('당근', '알리')이나 흔한 말('선물하기')은 두지 않는다.
// 내역 이름에 부분 일치로 찾기 때문에 '당근, 양파, 두부' 같은 장보기가 플랫폼으로 잡힌다.
const ALIASES = PLATFORMS.flatMap(([name, aliases]) => aliases.map((a) => [a, name] as const))
  .sort((a, b) => b[0].length - a[0].length)

/** 입력 칸 추천 목록 */
export const PLATFORM_NAMES = PLATFORMS.map(([name]) => name)

/** 음식 배달 앱: 내역 이름은 상품(메뉴)보다 가게 이름이 알아보기 쉽다 */
export const DELIVERY_PLATFORMS = new Set(['쿠팡이츠', '배달의민족', '요기요'])

/** 어디서 샀나에서 플랫폼도 가게 이름도 없는 결제의 묶음. 이름이 있는 가게는 한 번만 갔어도 따로 보인다 */
export const OTHER_PLATFORM = '이름 없는 결제'

/** 이름으로 아는 플랫폼을 찾는다. 모르면 null */
export function platformOf(text: string | null | undefined): string | null {
  const t = (text ?? '').replace(/\s+/g, '').toLowerCase()
  if (!t) return null
  return ALIASES.find(([alias]) => t.includes(alias))?.[1] ?? null
}

/** 플랫폼 칸에 저장할 이름: 아는 플랫폼이면 같은 표기로, 모르는 온라인 몰이면 적힌 그대로 */
export function normalizePlatform(name: string | null | undefined): string | null {
  const s = (name ?? '').trim()
  if (!s) return null
  return platformOf(s) ?? s.slice(0, 30)
}

/** 내역의 플랫폼: 저장된 값, 없으면(예전 내역) 내역 이름으로 짐작 */
export function platformOfTx(t: { platform?: string | null; title: string }): string | null {
  return t.platform ? normalizePlatform(t.platform) : platformOf(t.title)
}
