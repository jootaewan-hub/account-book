// 화면 캡처용 가짜 Supabase 응답(로그인한 가계부 셸). 숫자와 이름은 캡처 확인용 예시이며 실제 데이터가 아니다.
// screenshots.mjs가 Supabase로 가는 요청을 모두 가로채 이 값으로 답한다. 실제 서버로는 아무 요청도 나가지 않는다.

const HH = '00000000-0000-4000-8000-0000000000aa'
export const ME = '00000000-0000-4000-8000-00000000000a'
const YOU = '00000000-0000-4000-8000-00000000000b'

const kst = new Date(Date.now() + 9 * 3600_000)
const ym = kst.toISOString().slice(0, 7)
const day = (d) => `${ym}-${String(Math.min(d, Number(kst.toISOString().slice(8, 10)))).padStart(2, '0')}`
const ago = (min) => new Date(Date.now() - min * 60_000).toISOString()

const EXPENSE = ['식비', '외식', '카페', '배달', '장보기', '생활용품', '교통', '통신', '관리비', '구독', '의료', '문화', '기타']
const categories = [
  ...EXPENSE.map((name, i) => ({ id: `c${i}`, household_id: HH, type: 'expense', name, sort: i + 1, archived: false })),
  ...['월급', '부수입', '기타'].map((name, i) => ({ id: `i${i}`, household_id: HH, type: 'income', name, sort: i + 1, archived: false })),
]
const cat = (name, type = 'expense') => categories.find((c) => c.name === name && c.type === type).id

const tx = (id, d, amount, title, category, extra = {}) => ({
  id, household_id: HH, type: 'expense', occurred_on: day(d), amount, title, memo: null, category_id: cat(category),
  payment_method_id: null, scope: 'shared', source: 'manual', created_by: ME, created_at: ago(60), recurring_id: null,
  recurring_month: null, platform: null, transaction_items: [], ...extra,
})

const transactions = [
  { ...tx('t0', 1, 3200000, '월급', '기타'), type: 'income', category_id: cat('월급', 'income') },
  tx('t1', 2, 48200, '이마트', '장보기'),
  tx('t2', 3, 12900, '비비고 왕교자 1.05kg', '장보기', { platform: '쿠팡', source: 'photo' }),
  tx('t3', 5, 6500, '스타벅스', '카페', { scope: 'wife', created_by: YOU }),
  tx('t4', 8, 32000, '동네 고깃집', '외식'),
  tx('t5', 11, 17000, '넷플릭스', '구독'),
  tx('t6', 14, 23800, '배달의민족', '배달'),
  tx('t7', 18, 9800, '휴지 30롤', '생활용품', { platform: '쿠팡' }),
]

const groceryItems = [
  ['g1', '삼겹살', '600g', 1, '정육'],
  ['g2', '대파', null, 1, '채소'],
  ['g3', '우유', '900ml', 2, '유제품'],
  ['g4', '계란', '30구', 1, '계란'],
  ['g5', '비비고 왕교자', '1.05kg', 1, '냉동'],
  ['g6', '두부', '300g', 2, '가공'],
  ['g7', '휴지', '30롤', 1, '생활용품'],
].map(([id, name, spec, count, category], i) => ({
  id, household_id: HH, name, spec, count, category, product_key: null, product_id: null, product_qty: null,
  added_by: i % 2 ? YOU : ME, added_at: ago(300 - i), bought_by: null, bought_at: null, paid: null,
}))
groceryItems[5] = { ...groceryItems[5], bought_by: YOU, bought_at: ago(30) }

/** `${스키마}.${표 또는 rpc/함수}` → 응답 행 */
export const TABLES = {
  'public.households': [{ id: HH, name: '우리집', invite_code: 'ABCD2345' }],
  'public.members': [
    { household_id: HH, user_id: ME, display_name: '태완', role: 'owner', spouse_role: 'husband' },
    { household_id: HH, user_id: YOU, display_name: '배우자', role: 'partner', spouse_role: 'wife' },
  ],
  'public.payment_methods': [],
  'public.categories': categories,
  'public.anniversaries': [{ id: 'a1', household_id: HH, name: '결혼기념일', kind: 'couple', lunar: false, month: 11, day: 2 }],
  'public.events': [],
  'public.transactions': transactions,
  'public.recurring': [],
  'public.utility_bills': [],
  'public.rpc/generate_recurring': 0,
  'public.rpc/monthly_totals': [],
  'public.rpc/export_token': null,
  'grocery.items': groceryItems,
  'grocery.item_searches': groceryItems
    .filter((i) => !['정육', '수산', '채소', '과일'].includes(i.category))
    .map((i) => ({ item_id: i.id, status: 'done', candidate_count: 3, updated_at: ago(20) })),
  'grocery.rpc/item_alerts': [],
  'grocery.rpc/item_prices': [],
  'grocery.sync_runs': ['I0490', 'I2620', 'I2715'].map((source) => ({ source, ran_at: ago(180) })),
}

export const USER = {
  id: ME, aud: 'authenticated', role: 'authenticated', email: 'demo@example.com',
  app_metadata: { provider: 'email', household_id: HH }, user_metadata: {}, created_at: '2026-10-01T00:00:00Z',
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
/** 서명 없는 가짜 토큰. 실제 서버로 가지 않으므로 검증되지 않는다 */
export function fakeSession() {
  const exp = Math.floor(Date.now() / 1000) + 365 * 24 * 3600
  const access_token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: ME, aud: 'authenticated', role: 'authenticated', exp })}.fake`
  return { access_token, token_type: 'bearer', expires_in: 365 * 24 * 3600, expires_at: exp, refresh_token: 'fake', user: USER }
}
