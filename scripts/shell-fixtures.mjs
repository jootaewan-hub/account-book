// 화면 캡처용 가짜 Supabase 응답(로그인한 가계부 셸). 숫자와 이름은 캡처 확인용 예시이며 실제 데이터가 아니다.
// screenshots.mjs가 Supabase로 가는 요청을 모두 가로채 이 값으로 답한다. 실제 서버로는 아무 요청도 나가지 않는다.

const HH = '00000000-0000-4000-8000-0000000000aa'
export const ME = '00000000-0000-4000-8000-00000000000a'
const YOU = '00000000-0000-4000-8000-00000000000b'

const kst = new Date(Date.now() + 9 * 3600_000)
const ym = kst.toISOString().slice(0, 7)
const day = (d) => `${ym}-${String(Math.min(d, Number(kst.toISOString().slice(8, 10)))).padStart(2, '0')}`
const ago = (min) => new Date(Date.now() - min * 60_000).toISOString()
const prevYm = (() => { const [y, m] = ym.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}` })()
/** n일 전 날짜(한국 시간). 영수증 비교·주유 추이처럼 '며칠 전'이 뜻을 갖는 장면에 쓴다 */
const daysAgo = (n) => new Date(kst.getTime() - n * 86_400_000).toISOString().slice(0, 10)

const EXPENSE = ['식비', '외식', '카페', '배달', '장보기', '생활용품', '교통', '차량·주유', '통신', '관리비', '구독', '의료', '문화', '기타']
const categories = [
  ...EXPENSE.map((name, i) => ({ id: `c${i}`, household_id: HH, type: 'expense', name, sort: i + 1, archived: false })),
  ...['월급', '부수입', '기타'].map((name, i) => ({ id: `i${i}`, household_id: HH, type: 'income', name, sort: i + 1, archived: false })),
]
const cat = (name, type = 'expense') => categories.find((c) => c.name === name && c.type === type).id

/** 주유 기록(통계 주유 묶음·영수증 확인 화면의 지난 주유 비교). 날짜는 오늘 기준 며칠 전 */
const FUEL = [
  { id: 't20', occurred_on: daysAgo(3), amount: 58150, title: 'GS칼텍스 분당주유소', liters: 35.2, price_per_liter: 1652, fuel_type: '휘발유' },
  { id: 't21', occurred_on: daysAgo(19), amount: 48870, title: 'SK에너지 야탑주유소', liters: 30, price_per_liter: 1629, fuel_type: '휘발유' },
  { id: 't22', occurred_on: daysAgo(46), amount: 46740, title: 'GS칼텍스 분당주유소', liters: 28.5, price_per_liter: 1640, fuel_type: '휘발유' },
]

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
  // 고지서로 넣은 지난달 분 관리비: 고정 탭의 '아파트 관리비'(r3) 이번 달 분으로 연결돼 '지난번 금액'과 합계에 보인다
  tx('t8', 26, 167860, `관리비 (${Number(prevYm.slice(5))}월분)`, '관리비',
    { recurring_id: 'r3', recurring_month: `${ym}-01`, source: 'photo', memo: `관리비 고지서 ${Number(prevYm.slice(5))}월분` }),
  // 주유 세 번(통계 주유 묶음·내역 행의 '휘발유 35.2L, 1,652원/L'). 숫자는 캡처 확인용 예시
  ...FUEL.map((f) => tx(f.id, 1, f.amount, f.title, '차량·주유', { occurred_on: f.occurred_on, source: 'photo', fuel_fills: { liters: f.liters, price_per_liter: f.price_per_liter, fuel_type: f.fuel_type } })),
  // 지난 장보기 두 번(영수증 확인 화면의 '이번 장보기 살펴보기'): 우유는 그때 더 쌌고, 두부는 이틀 전에도 샀다(이레 전과 이틀 전 → 간격 5일의 절반 3일 안)
  tx('t30', 1, 19080, '이마트 분당점', '장보기', { occurred_on: daysAgo(7), source: 'photo', transaction_items: [
    { id: 'i30a', name: '서울우유 900ml', quantity: 2, unit_price: 2400, amount: 4800, pack_size: 900, pack_unit: 'ml', image_path: null, sort: 1 },
    { id: 'i30b', name: '국산 대파 1단', quantity: 1, unit_price: 3500, amount: 3500, pack_size: null, pack_unit: null, image_path: null, sort: 2 },
    { id: 'i30c', name: '계란 30구', quantity: 1, unit_price: 7980, amount: 7980, pack_size: 30, pack_unit: '구', image_path: null, sort: 3 },
    { id: 'i30d', name: '부침두부 300g', quantity: 1, unit_price: 2800, amount: 2800, pack_size: 300, pack_unit: 'g', image_path: null, sort: 4 },
  ] }),
  tx('t31', 1, 2800, '이마트 분당점', '장보기', { occurred_on: daysAgo(2), source: 'photo', transaction_items: [
    { id: 'i31a', name: '부침두부 300g', quantity: 1, unit_price: 2800, amount: 2800, pack_size: 300, pack_unit: 'g', image_path: null, sort: 1 },
  ] }),
]

// 가짜 Supabase는 조건과 상관없이 표의 행을 그대로 돌려주므로(한 건 조회는 첫 행), 상세를 여는 '비비고 왕교자'를 첫 행에 두고 고른 상품(p1)을 붙인다
const groceryItems = [
  ['g5', '비비고 왕교자', '1.05kg', 1, '냉동'],
  ['g1', '삼겹살', '600g', 1, '정육'],
  ['g2', '대파', null, 1, '채소'],
  ['g3', '우유', '900ml', 2, '유제품'],
  ['g4', '계란', '30구', 1, '계란'],
  ['g6', '두부', '300g', 2, '가공'],
  ['g7', '휴지', '30롤', 1, '생활용품'],
].map(([id, name, spec, count, category], i) => ({
  id, household_id: HH, name, spec, count, category, product_key: null, product_id: null, product_qty: null,
  added_by: i % 2 ? YOU : ME, added_at: ago(300 - i), bought_by: null, bought_at: null, paid: null,
}))
groceryItems[0] = { ...groceryItems[0], product_id: 'p1', product_qty: 1 }
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
  // 고정 탭: 계속 내는 구독 하나와 기간(6개월)을 정한 고정지출 하나(취득세 할부). 금액은 캡처 확인용 예시
  'public.recurring': [
    { id: 'r1', household_id: HH, kind: 'subscription', type: 'expense', title: '넷플릭스', amount: 17000, day_of_month: 5, every_months: 1,
      category_id: categories.find((c) => c.name === '구독')?.id ?? null, payment_method_id: null, scope: 'shared', start_month: '2026-01-01',
      end_month: null, generated_through: null, active: true, memo: null, installment_months: null, created_by: ME, created_at: ago(200), updated_at: ago(200) },
    { id: 'r2', household_id: HH, kind: 'fixed', type: 'expense', title: '자동차 취득세 할부', amount: 120000, day_of_month: 10, every_months: 1,
      category_id: categories.find((c) => c.name === '세금')?.id ?? null, payment_method_id: null, scope: 'shared', start_month: '2026-09-01',
      end_month: '2027-02-01', generated_through: null, active: true, memo: null, installment_months: null, created_by: ME, created_at: ago(40), updated_at: ago(40) },
    { id: 'r3', household_id: HH, kind: 'utility', type: 'expense', title: '아파트 관리비', amount: null, day_of_month: 25, every_months: 1,
      category_id: categories.find((c) => c.name === '관리비')?.id ?? null, payment_method_id: null, scope: 'shared', start_month: '2026-01-01',
      end_month: null, generated_through: null, active: true, memo: null, installment_months: null, created_by: ME, created_at: ago(200), updated_at: ago(200) },
    { id: 'r4', household_id: HH, kind: 'installment', type: 'expense', title: '냉장고', amount: 100000, day_of_month: 15, every_months: 1,
      category_id: null, payment_method_id: null, scope: 'shared', start_month: '2026-09-01',
      end_month: '2027-01-01', generated_through: null, active: true, memo: null, installment_months: 6, created_by: ME, created_at: ago(50), updated_at: ago(50) },
  ],
  'public.utility_bills': [],
  'public.fuel_fills': FUEL.map((f, i) => ({ id: `f${i}`, household_id: HH, transaction_id: f.id, liters: f.liters, price_per_liter: f.price_per_liter, fuel_type: f.fuel_type,
    created_by: ME, created_at: ago(60), transactions: { occurred_on: f.occurred_on, amount: f.amount, title: f.title } })),
  'public.rpc/generate_recurring': 0,
  'public.rpc/monthly_totals': [],
  'public.rpc/export_token': null,
  'grocery.items': groceryItems,
  'grocery.item_searches': groceryItems
    .filter((i) => !['정육', '수산', '채소', '과일'].includes(i.category))
    .map((i) => ({ item_id: i.id, status: 'done', candidate_count: 3, updated_at: ago(20) })),
  'grocery.rpc/item_alerts': [],
  // 상세(비비고 왕교자, 고른 상품 p1)의 응답: 숫자는 캡처 확인용 예시(실제 다나와 값 아님)
  'grocery.rpc/item_prices': [{ item_id: 'g5', price: 10380, seller: '예시몰 A', source: 'danawa', qty: 1, delivery: 3000, checked_at: ago(60) }],
  'grocery.products': [{ id: 'p1', source_id: '5643303', name: 'CJ제일제당 비비고 왕교자 1.05kg', image_url: null, rating: 4.8, review_count: 9099, rated_at: ago(60) }],
  'grocery.price_checks': [{ id: 'c1', checked_at: ago(60), ok: true, error: null }],
  'grocery.price_quotes': [
    { qty: 1, seller: '예시몰 A', price: 10380, delivery: 3000, unit_price: null, unit_label: null, mall_count: null },
    { qty: 1, seller: null, price: 10380, delivery: null, unit_price: 989, unit_label: '100g', mall_count: 26 },
  ],
  'grocery.captured_quotes': [],
  'grocery.item_candidates': [],
  'grocery.product_info': [],
  'grocery.rpc/item_safety': [],
  'grocery.rpc/shop_prices': [],
  'grocery.rpc/item_store_link': [],
  'grocery.rpc/item_store_prices': [],
  'grocery.rpc/our_purchases': [],
  'grocery.sync_runs': ['I0490', 'I2620', 'I2715', 'kamis'].map((source) => ({ source, ran_at: ago(180) })),
  'grocery.rpc/last_synced': ['I0490', 'I2620', 'I2715', 'kamis'].map((source) => ({ source, ran_at: ago(180) })),
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
    date: daysAgo(0), time: '18:20', merchant: '이마트 분당점', platform: null, amount: 17390, is_income: false, is_cancellation: false,
    card_last4: null, payment_hint: null, installment_months: null, category: '장보기', type: 'expense', items_match: true, fuel: null,
    items: [
      { name: '국산 대파 1단', is_product: true, quantity: 1, unit_price: 3000, amount: 3000, pack_size: null, pack_unit: null, category: '장보기', image_box: null },
      { name: '서울우유 900ml', is_product: true, quantity: 2, unit_price: 2500, amount: 5000, pack_size: 900, pack_unit: 'ml', category: '장보기', image_box: null },
      { name: '농심 신라면 5입', is_product: true, quantity: 1, unit_price: 5000, amount: 5000, pack_size: 5, pack_unit: '입', category: '장보기', image_box: null },
      { name: '부침두부 300g', is_product: true, quantity: 1, unit_price: 2800, amount: 2800, pack_size: 300, pack_unit: 'g', category: '장보기', image_box: null },
      { name: '포카칩 오리지널 66g', is_product: true, quantity: 1, unit_price: 1590, amount: 1590, pack_size: 66, pack_unit: 'g', category: '장보기', image_box: null },
    ],
  }],
}

/** 주유소 영수증 가짜 응답(영수증 확인 화면의 주유 칸). 리터·단가는 캡처 확인용 예시 */
export const FUEL_RECEIPT = {
  model: 'claude-haiku-5-5',
  note: null,
  entries: [{
    date: daysAgo(0), time: '08:12', merchant: 'GS칼텍스 분당주유소', platform: null, amount: 59990, is_income: false, is_cancellation: false,
    card_last4: null, payment_hint: null, installment_months: null, category: '차량·주유', type: 'expense', items_match: null, items: [],
    fuel: { liters: 35.6, price_per_liter: 1685, fuel_type: '휘발유' },
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

// 관리비 고지서 읽기 응답(가짜): 지난달 분, 납부 마감은 이번 달 26일. 숫자는 캡처 확인용 예시
export const BILL = {
  model: 'claude-sonnet-5-5',
  bill: {
    is_bill: true, bill_month: prevYm, due_date: `${ym}-26`, total: 167860, sum_match: true, note: null,
    charges: [
      { name: '일반관리비', amount: 54000, prev_month: 53000, last_year: 51000 },
      { name: '세대전기료', amount: 61000, prev_month: 58000, last_year: null },
      { name: '난방비', amount: 52860, prev_month: null, last_year: 60000 },
    ],
    usages: [
      { name: '전기', amount: 312, unit: 'kWh', prev_month: 280, last_year: 350 },
      { name: '수도', amount: 12, unit: 'm³', prev_month: 10, last_year: null },
    ],
  },
}
