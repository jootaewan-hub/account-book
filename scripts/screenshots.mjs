// 화면 캡처: 이미 떠 있는 개발 서버(npm run dev)에서 화면을 열어 screenshots/에 저장한다.
// 실행: VITE_SUPABASE_URL=https://kifdfpbwiebfgvdumqjf.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=<deploy.yml의 공개용 키> npm run dev (다른 창)
//       → npm run screens. BASE_URL로 주소를, OUT_DIR로 저장 폴더를 바꿀 수 있다.
// 두 가지를 찍는다.
//  - grocery-*: 장보기 화면만(?demo=grocery…, 메모리 데이터). 장보기 grocery-app의 scripts/screenshots.mjs에서 옮겼다.
//  - shell-*: 로그인한 가계부 셸 전체. Supabase로 가는 요청을 모두 가로채 scripts/shell-fixtures.mjs의 가짜 응답을 준다.
// 이름을 주면 그 화면만 다시 찍는다: npm run screens -- shell-grocery-390-light grocery-list-390-dark
import { existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { fakeSession, RECEIPT, TABLES, USER } from './shell-fixtures.mjs'

const BASE = process.env.BASE_URL ?? 'http://localhost:5173'
const OUT = process.env.OUT_DIR ? pathToFileURL(`${process.env.OUT_DIR.replace(/\/$/, '')}/`) : new URL('../screenshots/', import.meta.url)
mkdirSync(OUT, { recursive: true })
const SUPABASE = 'https://kifdfpbwiebfgvdumqjf.supabase.co'
const STORAGE_KEY = 'sb-kifdfpbwiebfgvdumqjf-auth-token'

const SIZES = { 390: { width: 390, height: 844 }, 1280: { width: 1280, height: 800 } }
const BOTH = ['light', 'dark']
const both = (w, f) => BOTH.map((c) => f(w, c))
const each = (f) => [390, 1280].flatMap((w) => both(w, f))

const SHEET_TEXT = '비비고 왕교자 1.05kg x2\n우유 900ml\n대파\n고추장 500g\n휴지 30롤'
// 쇼핑몰 상품명을 통째로 붙여 넣은 경우(60자 넘음): "이름이 길어 60자까지만 담아요"가 보여야 한다.
const LONG_LINE = '[무료배송] 풀무원 국산콩 두부 부침용 300g 2개입 + 찌개용 300g 2개입 냉장 신선 묶음 기획 특가 세트'
const SPLIT_TEXT = '양파 당근 감자 비비고 왕교자 파'
const G = '/?demo=grocery'
// 1x1 JPEG 한 장(사진·캡처 읽기 장면용, 내용은 쓰지 않는다: 데모 저장소가 가짜 값을 돌려준다)
const TINY_JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64')

const groceryShots = [
  ...each((w, c) => ({ name: `grocery-list-${w}-${c}`, path: G, w, c, full: true })),
  ...each((w, c) => ({ name: `grocery-add-sheet-${w}-${c}`, path: G, w, c, sheet: SHEET_TEXT })),
  ...both(390, (w, c) => ({ name: `grocery-add-sheet-split-${w}-${c}`, path: G, w, c, sheet: SPLIT_TEXT })),
  { name: 'grocery-add-sheet-long-390-light', path: G, w: 390, c: 'light', sheet: `${LONG_LINE}\n대파` },
  ...both(390, (w, c) => ({ name: `grocery-list-where-${w}-${c}`, path: G, w, c, where: true, full: true })),
  { name: 'grocery-row-remove-open-390-light', path: G, w: 390, c: 'light', openRemove: '삼겹살 600g' },
  ...both(390, (w, c) => ({ name: `grocery-removed-notice-${w}-${c}`, path: G, w, c, remove: '삼겹살 600g' })),
  ...each((w, c) => ({ name: `grocery-list-edit-${w}-${c}`, path: G, w, c, edit: true, full: true })),
  ...both(390, (w, c) => ({ name: `grocery-group-removed-${w}-${c}`, path: G, w, c, edit: true, groupRemove: true })),
  ...both(390, (w, c) => ({ name: `grocery-alert-sheet-${w}-${c}`, path: G, w, c, alert: '비슷한 제품 기록' })),
  { name: 'grocery-alert-sheet-1280-light', path: G, w: 1280, c: 'light', alert: '비슷한 제품 기록' },
  ...both(390, (w, c) => ({ name: `grocery-candidate-sheet-${w}-${c}`, path: G, w, c, pick: true })),
  { name: 'grocery-candidate-sheet-1280-light', path: G, w: 1280, c: 'light', pick: true },
  // 큰 용량·묶음 보기(D-014): 숨긴 후보를 버튼으로 펼친 모습
  ...both(390, (w, c) => ({ name: `grocery-candidate-sheet-bulk-${w}-${c}`, path: G, w, c, pick: true, showBulk: true })),
  ...['price', 'safety', 'rating'].flatMap((t) => both(390, (w, c) => ({ name: `grocery-item-detail-${t}-${w}-${c}`, path: G, w, c, detail: '비비고 왕교자', tab: t }))),
  { name: 'grocery-item-detail-price-1280-light', path: G, w: 1280, c: 'light', detail: '비비고 왕교자', tab: 'price' },
  { name: 'grocery-item-detail-safety-390-light-alert', path: G, w: 390, c: 'light', detail: '○○ 냉동볶음밥', tab: 'safety' },
  // P3 가격 출처: 참가격 상품 고르기, 자주 가는 매장, 주소 거절 문구
  ...both(390, (w, c) => ({ name: `grocery-store-good-sheet-${w}-${c}`, path: G, w, c, detail: '○○ 냉동볶음밥', tab: 'price', storeGood: true })),
  { name: 'grocery-store-pick-sheet-390-light', path: G, w: 390, c: 'light', detail: '비비고 왕교자', tab: 'price', storePick: true },
  { name: 'grocery-shop-url-error-390-light', path: G, w: 390, c: 'light', detail: '비비고 왕교자', tab: 'price', shopUrl: 'https://link.coupang.com/a/cXYZ12' },
  ...both(390, (w, c) => ({ name: `grocery-item-detail-store-${w}-${c}`, path: G, w, c, detail: '비비고 왕교자', tab: 'price', detailScroll: '.detail-links' })),
  { name: 'grocery-item-detail-store-1280-light', path: G, w: 1280, c: 'light', detail: '비비고 왕교자', tab: 'price', detailScroll: '.detail-links' },
  { name: 'grocery-item-detail-store-none-390-light', path: G, w: 390, c: 'light', detail: '○○ 냉동볶음밥', tab: 'price', detailScroll: '.detail-links' },
  // P2 우리가 산 값
  ...both(390, (w, c) => ({ name: `grocery-item-detail-price-ours-${w}-${c}`, path: G, w, c, detail: '비비고 왕교자', tab: 'price', detailScroll: '.ours-block' })),
  { name: 'grocery-item-detail-price-ours-1280-light', path: G, w: 1280, c: 'light', detail: '비비고 왕교자', tab: 'price', detailScroll: '.ours-block' },
  // P4 사진으로 찾기·캡처로 가격 넣기(데모 저장소의 가짜 읽기 값)
  ...both(390, (w, c) => ({ name: `grocery-photo-product-${w}-${c}`, path: G, w, c, pick: true, photoProduct: true })),
  ...both(390, (w, c) => ({ name: `grocery-capture-price-${w}-${c}`, path: G, w, c, detail: '비비고 왕교자', tab: 'price', capturePrice: true })),
  { name: 'grocery-capture-price-1280-light', path: G, w: 1280, c: 'light', detail: '비비고 왕교자', tab: 'price', capturePrice: true },
  { name: 'grocery-capture-saved-390-light', path: G, w: 390, c: 'light', detail: '비비고 왕교자', tab: 'price', capturePrice: true, captureSave: true },
  // P6 바코드로 상품 보기·사진으로 담기(헤드리스에는 카메라가 없어 "사진으로 읽기" 상태, 결과는 ?barcode=로)
  ...both(390, (w, c) => ({ name: `grocery-barcode-sheet-${w}-${c}`, path: G, w, c, barcode: true })),
  ...both(390, (w, c) => ({ name: `grocery-barcode-record-${w}-${c}`, path: `${G}&barcode=8801007001234`, w, c, barcode: true, barcodeWait: '회수 기록 있음' })),
  { name: 'grocery-barcode-record-1280-light', path: `${G}&barcode=8801007001234`, w: 1280, c: 'light', barcode: true, barcodeWait: '회수 기록 있음' },
  { name: 'grocery-barcode-none-390-light', path: `${G}&barcode=96385074`, w: 390, c: 'light', barcode: true, barcodeWait: '식약처 기록 없음' },
  ...both(390, (w, c) => ({ name: `grocery-add-photo-list-${w}-${c}`, path: G, w, c, sheet: '', photoList: true })),
  // P7 성분·대안
  ...both(390, (w, c) => ({ name: `grocery-item-detail-ingredients-${w}-${c}`, path: G, w, c, detail: '비비고 왕교자', tab: 'ingredients' })),
  { name: 'grocery-item-detail-ingredients-1280-light', path: G, w: 1280, c: 'light', detail: '비비고 왕교자', tab: 'ingredients' },
  ...both(390, (w, c) => ({ name: `grocery-item-detail-alternatives-${w}-${c}`, path: G, w, c, detail: '비비고 왕교자', tab: 'alternatives' })),
  { name: 'grocery-food-picker-390-light', path: G, w: 390, c: 'light', detail: '비비고 왕교자', tab: 'ingredients', foodPick: true },
  // 가계부에 넣기(D-011 길 ②): 목록 끝의 안내와 시트(총액, 품목마다, 금액 빈 오류)
  ...each((w, c) => ({ name: `grocery-record-sheet-${w}-${c}`, path: G, w, c, purchase: 'total' })),
  ...both(390, (w, c) => ({ name: `grocery-record-sheet-each-${w}-${c}`, path: G, w, c, purchase: 'each' })),
  { name: 'grocery-record-sheet-error-390-light', path: G, w: 390, c: 'light', purchase: 'error' },
  { name: 'grocery-recorded-390-light', path: G, w: 390, c: 'light', purchase: 'save', full: true },
  ...both(390, (w, c) => ({ name: `grocery-list-empty-${w}-${c}`, path: '/?demo=grocery-empty', w, c, wait: '아직 담은 게 없어요' })),
  // 농수산물 시세(D-012): 목록 | 시세 전환, 시세 화면, 시세 상세, 신선 품목 상세
  ...each((w, c) => ({ name: `grocery-market-${w}-${c}`, path: G, w, c, market: true, full: true })),
  { name: 'grocery-market-all-390-light', path: G, w: 390, c: 'light', market: true, showAll: true, full: true },
  { name: 'grocery-market-moves-y1-390-light', path: G, w: 390, c: 'light', market: true, period: '1년 전' },
  ...both(390, (w, c) => ({ name: `grocery-market-sheet-${w}-${c}`, path: G, w, c, market: true, marketOpen: '대파' })),
  { name: 'grocery-market-sheet-1280-light', path: G, w: 1280, c: 'light', market: true, marketOpen: '대파' },
  { name: 'grocery-market-sheet-chip-390-light', path: G, w: 390, c: 'light', market: true, marketOpen: '대파', chip: '쪽파', scroll: '.market-chart' },
  { name: 'grocery-market-sheet-national-390-dark', path: G, w: 390, c: 'dark', market: true, marketOpen: '돼지 삼겹살' },
  ...both(390, (w, c) => ({ name: `grocery-item-detail-market-${w}-${c}`, path: G, w, c, detail: '대파', tab: 'market' })),
  { name: 'grocery-item-detail-market-1280-light', path: G, w: 1280, c: 'light', detail: '대파', tab: 'market' },
  { name: 'grocery-item-detail-market-none-390-light', path: G, w: 390, c: 'light', detail: '한우 국거리', tab: 'market' },
  { name: 'grocery-market-empty-390-light', path: '/?demo=grocery-empty', w: 390, c: 'light', market: true, wait: '아직 받은 시세가 없어요' },
  { name: 'grocery-list-error-390-light', path: '/?demo=grocery-error', w: 390, c: 'light', wait: '목록을 불러오지 못했어요.' },
]

const TAB_SLUG = { 달력: 'cal', 내역: 'list', 장보기: 'grocery', 통계: 'stats', 고정: 'fixed', 설정: 'settings' }
// 가계부 셸: 탭 이름(아래 탭·왼쪽 메뉴의 글자)으로 연다. 설정은 '설정' 버튼(휴대폰 톱니, 넓은 화면 메뉴 줄)
const shellShots = [
  ...['달력', '내역', '장보기', '통계', '고정', '설정'].flatMap((tab) =>
    each((w, c) => ({ name: `shell-${TAB_SLUG[tab]}-${w}-${c}`, path: '/', w, c, shell: true, tab, full: tab !== '장보기' }))),
  // 장보기는 화면 높이 그대로: 아래 탭·담기 바가 화면 아래에 어떻게 겹치는지 본다
  ...both(390, (w, c) => ({ name: `shell-grocery-removed-${w}-${c}`, path: '/', w, c, shell: true, tab: '장보기', remove: '삼겹살 600g' })),
  ...each((w, c) => ({ name: `shell-grocery-add-sheet-${w}-${c}`, path: '/', w, c, shell: true, tab: '장보기', sheet: SHEET_TEXT })),
  // 셸 안 품목 상세: 가짜 데이터에 고른 상품·가격 줄이 있어 내용까지 보인다(P8). 다른 탭 내용은 grocery-item-detail-*(장보기 데모)에서 본다
  ...each((w, c) => ({ name: `shell-grocery-detail-${w}-${c}`, path: '/', w, c, shell: true, tab: '장보기', detail: '비비고 왕교자' })),
  ...each((w, c) => ({ name: `shell-entry-sheet-${w}-${c}`, path: '/', w, c, shell: true, tab: '내역', record: true })),
  // 고정 탭: 기간을 정한 항목 고치기 시트(기간 6개월)와 고정지출 추가 시트(기간 '계속')
  ...each((w, c) => ({ name: `shell-recurring-sheet-${w}-${c}`, path: '/', w, c, shell: true, tab: '고정', rcOpen: '자동차 취득세 할부' })),
  ...both(390, (w, c) => ({ name: `shell-recurring-add-${w}-${c}`, path: '/', w, c, shell: true, tab: '고정', rcAdd: '고정지출' })),
  ...both(390, (w, c) => ({ name: `shell-deeplink-grocery-${w}-${c}`, path: '/?tab=grocery', w, c, shell: true })),
  ...each((w, c) => ({ name: `shell-grocery-market-${w}-${c}`, path: '/', w, c, shell: true, tab: '장보기', market: true })),
  // 영수증 확인 화면의 '장보기 목록에서 찾은 품목'(D-011 길 ①). 가짜 영수증 응답(RECEIPT)
  ...each((w, c) => ({ name: `shell-smart-grocery-${w}-${c}`, path: '/', w, c, shell: true, tab: '내역', receipt: true })),
]

const shots = [...groceryShots, ...shellShots]
const only = process.argv.slice(2)
const selected = only.length ? shots.filter((s) => only.some((o) => s.name === o || s.name.startsWith(o))) : shots

/** Supabase로 가는 요청을 모두 가로챈다. 표·rpc는 TABLES, 쓰기는 빈 성공, 인증은 가짜 사용자 */
async function fakeSupabase(context) {
  await context.addInitScript(([key, session]) => localStorage.setItem(key, JSON.stringify(session)), [STORAGE_KEY, fakeSession()])
  await context.route(`${SUPABASE}/**`, async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (url.pathname.startsWith('/auth/v1/user')) return json(USER)
    if (url.pathname.startsWith('/auth/v1/token')) return json(fakeSession())
    if (url.pathname.startsWith('/auth/v1/logout')) return route.fulfill({ status: 204 })
    if (url.pathname === '/functions/v1/extract-entries') return json(RECEIPT)
    if (url.pathname.startsWith('/functions/v1/')) return json({ status: 'skipped' })
    if (url.pathname.startsWith('/storage/v1/')) return json([])
    const m = url.pathname.match(/^\/rest\/v1\/(.+)$/)
    if (!m) {
      if (process.env.DEBUG_SHOTS) console.log('[not mocked]', url.pathname)
      return json({ message: 'not mocked' }, 404)
    }
    const schema = req.headers()['accept-profile'] ?? req.headers()['content-profile'] ?? 'public'
    const key = `${schema}.${m[1]}`
    const method = req.method()
    if (method !== 'GET' && method !== 'HEAD' && !m[1].startsWith('rpc/')) return json([], method === 'POST' ? 201 : 200)
    if (process.env.DEBUG_SHOTS && !(key in TABLES)) console.log('[no fixture]', key, url.search.slice(0, 120))
    let rows = key in TABLES ? TABLES[key] : []
    // 같음 조건(id=eq.g5 등)은 적용한다: 한 건 조회(maybeSingle)는 행이 하나여야 하고, 상세는 그 품목·상품의 행만 봐야 한다
    if (Array.isArray(rows)) {
      for (const [k, v] of url.searchParams) {
        if (v.startsWith('eq.') && !['select', 'order', 'limit', 'offset'].includes(k)) rows = rows.filter((r) => !(k in r) || String(r[k]) === v.slice(3))
      }
    }
    if ((req.headers()['accept'] ?? '').includes('vnd.pgrst.object')) {
      const one = Array.isArray(rows) ? rows[0] : rows
      return one == null ? json({ code: 'PGRST116', message: 'no rows' }, 406) : json(one)
    }
    return json(rows)
  })
  // 실시간 연결은 열지 않는다(가짜 토큰으로 실제 서버에 붙지 않게)
  await context.routeWebSocket(/supabase\.co/, (ws) => ws.close())
}

async function launch() {
  try {
    return await chromium.launch()
  } catch (e) {
    // 이 판의 Playwright 브라우저가 없으면 미리 깔린 Chromium을 쓴다(클라우드 환경)
    if (existsSync('/opt/pw-browsers/chromium')) return chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
    throw e
  }
}

const browser = await launch()
const problems = []
try {
  for (const s of selected) {
    try {
      const context = await browser.newContext({
        viewport: SIZES[s.w],
        deviceScaleFactor: s.w === 390 ? 2 : 1,
        colorScheme: s.c,
        reducedMotion: 'reduce', // 캡처가 움직임 중간에 찍히지 않게
        locale: 'ko-KR',
      })
      // 장보기 데모도 실제 서버로 나가는 요청이 없어야 한다. 셸이 아니어도 가로채 둔다
      await fakeSupabase(context)
      const page = await context.newPage()
      page.on('pageerror', (e) => problems.push(`${s.name}: ${e.message}`))
      // DEBUG_SHOTS=1이면 콘솔 오류와 가짜 Supabase가 모르는 요청도 적는다(셸 가짜 데이터를 채울 때 쓴다)
      if (process.env.DEBUG_SHOTS) page.on('console', (m) => { if (m.type() === 'error') problems.push(`${s.name} [console] ${m.text().slice(0, 300)}`) })
      if (process.env.DEBUG_SHOTS) {
        page.on('response', (r) => { if (r.status() >= 400) problems.push(`${s.name} [${r.status()}] ${r.request().method()} ${r.url().slice(0, 200)}`) })
        page.on('requestfailed', (r) => problems.push(`${s.name} [failed] ${r.method()} ${r.url().slice(0, 200)} ${r.failure()?.errorText ?? ''}`))
      }
      await page.goto(BASE + s.path, { waitUntil: 'networkidle' })
      await page.evaluate(() => document.fonts.ready)
      if (s.shell) {
        await page.locator('.tabbar').waitFor()
        if (s.tab) {
          if (s.tab === '설정') await page.getByRole('button', { name: '설정', exact: true }).locator('visible=true').first().click()
          else await page.locator('.tabbar .tab', { hasText: s.tab }).click()
        }
        if (s.tab === '장보기' || s.path.includes('tab=grocery')) await page.getByText('살 것', { exact: true }).waitFor()
        else await page.waitForLoadState('networkidle')
      } else if (s.path === G) {
        await page.getByText('살 것', { exact: true }).waitFor()
      }
      if (s.market) {
        await page.getByRole('group', { name: '장보기 보기' }).getByRole('button', { name: '시세' }).click()
        if (!s.wait) await page.getByText(/지켜보는 품목|아직 받은 시세가 없어요/).first().waitFor()
      }
      if (s.wait) await page.getByText(s.wait).waitFor()
      if (s.showAll) await page.getByRole('button', { name: '펼치기' }).click()
      if (s.period) await page.getByRole('group', { name: '비교 기간' }).getByRole('button', { name: s.period }).click()
      if (s.marketOpen) {
        await page.locator('.market-row .row-name', { hasText: s.marketOpen }).first().click()
        await page.getByRole('dialog').waitFor()
        await page.locator('.market-chart, .market-panel .detail-none').first().waitFor()
      }
      if (s.chip) {
        await page.locator('.market-chip', { hasText: s.chip }).click()
        await page.locator('.market-now-name', { hasText: s.chip }).waitFor()
      }
      if (s.scroll) await page.locator(s.scroll).first().scrollIntoViewIfNeeded()
      if (s.where) await page.getByRole('button', { name: '어디서 살지' }).click()
      if (s.record) {
        await page.locator('.fab, .side-record').locator('visible=true').first().click()
        await page.getByRole('dialog').first().waitFor()
      }
      if (s.rcOpen) {
        await page.locator('.rc-row', { hasText: s.rcOpen }).click()
        await page.getByRole('dialog').first().waitFor()
      }
      if (s.rcAdd) {
        await page.getByRole('button', { name: `+ ${s.rcAdd} 추가` }).click()
        await page.getByRole('dialog').first().waitFor()
      }
      if (s.receipt) {
      await page.locator('.fab, .side-record').locator('visible=true').first().click()
      await page.getByRole('button', { name: '영수증', exact: true }).click()
      // 1x1 JPEG 한 장(내용은 쓰지 않는다: 분석 응답은 가짜)
      const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64')
      await page.locator('input[type=file]').setInputFiles({ name: 'r.jpg', mimeType: 'image/jpeg', buffer: jpeg })
      await page.getByRole('button', { name: /장 분석하기$/ }).click()
      await page.getByText('장보기 목록에서 찾은 품목').waitFor()
      await page.locator('.grocery-match').scrollIntoViewIfNeeded()
    }
    if (s.sheet !== undefined) {
        await page.getByRole('button', { name: '담기', exact: true }).locator('visible=true').first().click()
        await page.getByRole('dialog').waitFor()
        await page.getByLabel('살 것').fill(s.sheet)
      }
      if (s.alert) {
        await page.getByRole('button', { name: s.alert }).first().click()
        await page.getByRole('dialog').waitFor()
      }
      if (s.edit) await page.getByRole('button', { name: '편집' }).click()
      if (s.groupRemove) {
        await page.locator('.group-remove').first().click()
        await page.getByRole('button', { name: '되돌리기' }).waitFor()
      }
      if (s.pick) {
        // pickItem: 그 품목 줄의 상품 고르기(없으면 첫 줄)
        const scope = s.pickItem ? page.locator('.row', { hasText: s.pickItem }) : page
        await scope.getByRole('button', { name: '상품 고르기' }).first().click()
        await page.getByRole('dialog').waitFor()
        await page.locator('.cand-variant').first().waitFor()
      }
      if (s.showBulk) {
        await page.getByRole('button', { name: /큰 용량·묶음 \d+개 보기/ }).click()
        await page.getByRole('button', { name: '큰 용량·묶음 숨기기' }).waitFor()
      }
      if (s.detail) {
        await page.locator('.row-name', { hasText: s.detail }).first().click()
        await page.getByRole('dialog').waitFor()
        const label = s.shell ? null : { price: '가격', safety: '안전', rating: '평가', market: '시세', ingredients: '성분', alternatives: '대안' }[s.tab]
        if (label) await page.getByRole('tab', { name: label }).click()
        if (label === '가격') await page.getByText('매장 가격(참가격)').waitFor()
        if (s.detailScroll) await page.locator(s.detailScroll).first().scrollIntoViewIfNeeded()
      }
      if (s.foodPick) {
        await page.getByRole('button', { name: '다른 품목으로 바꾸기' }).click()
        await page.locator('.pick-row').first().waitFor()
      }
      if (s.barcode) {
        await page.getByRole('button', { name: '바코드로 상품 보기' }).click()
        await page.getByRole('dialog').waitFor()
        if (s.barcodeWait) await page.getByText(s.barcodeWait).first().waitFor()
        else await page.getByRole('button', { name: '사진으로 읽기' }).waitFor()
      }
      if (s.photoList) {
        await page.getByLabel('목록 사진').setInputFiles({ name: 'l.jpg', mimeType: 'image/jpeg', buffer: TINY_JPEG })
        await page.getByText('담을 것', { exact: false }).first().waitFor()
      }
      if (s.photoProduct) {
        await page.getByLabel('포장 사진').setInputFiles({ name: 'p.jpg', mimeType: 'image/jpeg', buffer: TINY_JPEG })
        await page.getByRole('button', { name: '이 이름으로 검색' }).waitFor()
      }
      if (s.capturePrice) {
        await page.getByLabel('가격 캡처 사진').setInputFiles({ name: 'c.jpg', mimeType: 'image/jpeg', buffer: TINY_JPEG })
        await page.getByRole('button', { name: '이 값으로 넣기' }).waitFor()
        await page.getByRole('button', { name: '이 값으로 넣기' }).scrollIntoViewIfNeeded()
      }
      if (s.captureSave) {
        await page.getByRole('button', { name: '이 값으로 넣기' }).click()
        await page.getByText('캡처(남편)').first().waitFor()
        await page.locator('.price-list').first().scrollIntoViewIfNeeded()
      }
      if (s.storeGood) {
        await page.getByRole('button', { name: '참가격 상품 고르기' }).click()
        // 검색어는 품목 이름으로 채워져 있다. 데모 목록에 맞는 상품이 없으므로 비워 전체 목록을 찍는다
        await page.getByLabel('참가격 상품 이름으로 찾기').fill('')
        await page.locator('.pick-row').first().waitFor()
      }
      if (s.storePick) {
        await page.getByRole('button', { name: '매장 고르기' }).click()
        await page.locator('.pick-check').first().waitFor()
      }
      if (s.shopUrl) {
        await page.getByLabel('상품 페이지 주소').fill(s.shopUrl)
        await page.getByRole('button', { name: '주소 넣기' }).click()
        await page.getByRole('alert').waitFor()
        await page.getByRole('alert').scrollIntoViewIfNeeded()
      }
      if (s.purchase) {
      await page.getByRole('button', { name: '가계부에 넣기', exact: true }).click()
      await page.getByRole('dialog').waitFor()
      if (s.purchase === 'total' || s.purchase === 'save') await page.getByLabel('낸 금액(원)').fill('12400')
      if (s.purchase === 'each') {
        await page.getByRole('button', { name: '품목마다' }).click()
        const inputs = page.getByLabel(/금액\(원\)$/)
        await inputs.first().fill('3500')
      }
      if (s.purchase === 'error') await page.locator('.sheet-foot .btn-primary').click()
      if (s.purchase === 'save') {
        await page.locator('.sheet-foot .btn-primary').click()
        await page.getByText(/가계부에 \d+건 넣었어요/).waitFor()
      }
    }
    if (s.openRemove) await page.getByRole('button', { name: `${s.openRemove} 빼기` }).focus()
      if (s.remove) {
        await page.getByRole('button', { name: `${s.remove} 빼기` }).focus()
        await page.keyboard.press('Enter')
        await page.getByRole('button', { name: '되돌리기' }).waitFor()
      }
      await page.waitForTimeout(450)

      // 숫자로 확인할 수 있는 것은 여기서 먼저 잡는다: 가로 스크롤, 44px보다 작은 버튼, "0원", 금지 문구,
      // 화면 아래 고정 요소끼리 겹침(장보기 담기 바·알림과 가계부 아래 탭)
      const check = await page.evaluate(() => {
        const out = []
        if (document.documentElement.scrollWidth > window.innerWidth) out.push(`가로 스크롤 ${document.documentElement.scrollWidth}px`)
        for (const el of document.querySelectorAll('button, a, input, textarea, [role="button"]')) {
          // label로 감싼 입력(체크 상자 등)은 label 전체가 누르는 곳이다
          const r = (el.tagName === 'INPUT' && el.closest('label') ? el.closest('label') : el).getBoundingClientRect()
          const cs = getComputedStyle(el)
          if (r.width === 0 || cs.visibility === 'hidden' || el.closest('.sr-only')) continue
          // 장보기 규칙(44px)은 장보기 화면 안에서만 잰다. 가계부 화면은 가계부 DESIGN.md 기준이라 여기서 재지 않는다
          if (!el.closest('.grocery')) continue
          const ext = el.hasAttribute('data-touch-extend') ? getComputedStyle(el, '::before') : null
          const extH = ext ? -parseFloat(ext.top) - parseFloat(ext.bottom) : 0
          const extW = ext ? -parseFloat(ext.left) - parseFloat(ext.right) : 0
          if (r.height + extH < 44 || r.width + extW < 44) out.push(`작은 터치 대상 ${Math.round(r.width)}x${Math.round(r.height)} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 20)}"`)
        }
        const g = document.querySelector('.grocery')
        const text = g ? g.innerText : ''
        if (/(^|[^\d,])0원/.test(text)) out.push('"0원" 있음')
        for (const w of ['AI', '분석 중', '안전함', '문제 없음', ' · ']) if (text.includes(w)) out.push(`금지 문구 "${w}"`)
        const box = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return cs.display === 'none' || r.height === 0 ? null : r }
        const tab = box('.tabbar')
        for (const sel of ['.grocery .bottom-bar', '.grocery .notice']) {
          const b = box(sel)
          if (tab && b && getComputedStyle(document.querySelector('.tabbar')).position === 'fixed' && b.bottom > tab.top + 0.5)
            out.push(`${sel}이(가) 아래 탭과 겹침(아래 끝 ${Math.round(b.bottom)}, 탭 위 ${Math.round(tab.top)})`)
        }
        return out
      })
      for (const p of check) problems.push(`${s.name}: ${p}`)

      await page.screenshot({ path: fileURLToPath(new URL(`${s.name}.png`, OUT)), fullPage: Boolean(s.full) })
      console.log(`저장 ${s.name}.png`)
      await context.close()
    } catch (e) {
      // 한 화면이 실패해도 나머지는 찍는다
      problems.push(`${s.name}: 찍지 못함 — ${String(e.message).split('\n').slice(0, process.env.DEBUG_SHOTS ? 12 : 1).join(' / ')}`)
    }
  }
} finally {
  await browser.close()
}

if (problems.length) {
  console.log('\n확인할 것:')
  for (const p of problems) console.log(`- ${p}`)
  process.exitCode = 1
} else {
  console.log('\n자동 확인: 문제 없음(눈으로도 확인할 것)')
}
