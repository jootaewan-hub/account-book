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
// 어제 장 봐서 이미 가계부에 넣은 품목(영수증 확인 화면에서 '이미 넣었어요'로 보인다)
groceryItems.push({ id: 'g8', household_id: HH, name: '라면', spec: null, count: 1, category: '가공', product_key: null, product_id: null,
  product_qty: null, added_by: ME, added_at: ago(2000), bought_by: ME, bought_at: ago(1500), paid: 5000, transaction_id: 't7' })
for (const i of groceryItems) i.transaction_id ??= null

function marketRow(item, vrty, grd, ctgry, itemNm, vrtyNm, grdNm, unit, unitSz, cur, w1) {
  return {
    item_cd: item, vrty_cd: vrty, grd_cd: grd, ctgry_cd: ctgry, item_nm: itemNm, vrty_nm: vrtyNm, grd_nm: grdNm, unit, unit_sz: unitSz,
    sgg_cd: '3112', sgg_nm: '성남', mrkt_cd: '0310407', mrkt_nm: 'B-유통', cur_on: day(16), cur_price: cur, prev_on: day(15), prev_price: cur,
    w1_on: day(8), w1_price: w1, m1_on: null, m1_price: null, y1_on: null, y1_price: null, low: cur, high: cur + 900, markets: 8,
    first_on: day(1), days: 12, fetched_at: ago(120),
  }
}

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
  'grocery.sync_runs': ['I0490', 'I2620', 'I2715', 'kamis'].map((source) => ({ source, ran_at: ago(180) })),
  // 시세판(D-012) 두 줄: 숫자는 캡처 확인용 예시(실제 조사값 아님)
  'grocery.rpc/market_board': [
    marketRow('246', '00', '04', '200', '파', '대파', '상품', 'kg', '1', 1980, 2100),
    marketRow('245', '00', '04', '200', '양파', '양파', '상품', 'kg', '1', 1960, 2060),
  ],
  'grocery.rpc/market_trend': [],
  'grocery.watch': [{ item_cd: '246', vrty_cd: '00', grd_cd: '04' }],
  'grocery.food_alerts': [],
}

/** 영수증 사진 분석(extract-entries) 가짜 응답: 장보기 목록과 이름이 맞는 상품이 섞인 마트 영수증 */
export const RECEIPT = {
  model: 'claude-haiku-5-5',
  note: null,
  entries: [{
    date: day(19), time: '18:20', merchant: '이마트 분당점', platform: null, amount: 15800, is_income: false, is_cancellation: false,
    card_last4: null, payment_hint: null, installment_months: null, category: '장보기', type: 'expense', items_match: true,
    items: [
      { name: '국산 대파 1단', is_product: true, quantity: 1, unit_price: 3000, amount: 3000, pack_size: null, pack_unit: null, category: '장보기', image_box: null },
      { name: '서울우유 900ml', is_product: true, quantity: 2, unit_price: 2500, amount: 5000, pack_size: 900, pack_unit: 'ml', category: '장보기', image_box: null },
      { name: '농심 신라면 5입', is_product: true, quantity: 1, unit_price: 5000, amount: 5000, pack_size: 5, pack_unit: '입', category: '장보기', image_box: null },
      { name: '부침두부 300g', is_product: true, quantity: 1, unit_price: 2800, amount: 2800, pack_size: 300, pack_unit: 'g', category: '장보기', image_box: null },
    ],
  }],
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
