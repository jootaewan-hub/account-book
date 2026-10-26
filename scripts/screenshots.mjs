// 화면 캡처: 이미 떠 있는 개발 서버(npm run dev)에서 화면을 열어 screenshots/에 저장한다.
// 실행: VITE_SUPABASE_URL=https://kifdfpbwiebfgvdumqjf.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=<deploy.yml의 공개용 키> npm run dev (다른 창)
//       → npm run screens. BASE_URL로 주소를, OUT_DIR로 저장 폴더를 바꿀 수 있다.
// 두 가지를 찍는다.
//  - grocery-*: 장보기 화면만(?demo=grocery…, 메모리 데이터). 장보기 grocery-app의 scripts/screenshots.mjs에서 옮겼다.
//  - shell-*: 로그인한 가계부 셸 전체. Supabase로 가는 요청을 모두 가로채 scripts/shell-fixtures.mjs의 가짜 응답을 준다.
// 이름을 주면 그 화면만 다시 찍는다: npm run screens -- shell-grocery-390-light grocery-list-390-dark
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { BILL, fakeSession, FUEL_RECEIPT, LONG_RECEIPT, RECEIPT, TABLES, USER } from './shell-fixtures.mjs'

const BASE = process.env.BASE_URL ?? 'http://localhost:5188' // vite.config.ts server.port와 같다
const OUT = process.env.OUT_DIR ? pathToFileURL(`${process.env.OUT_DIR.replace(/\/$/, '')}/`) : new URL('../screenshots/', import.meta.url)
mkdirSync(OUT, { recursive: true })
const SUPABASE = 'https://kifdfpbwiebfgvdumqjf.supabase.co'
const STORAGE_KEY = 'sb-kifdfpbwiebfgvdumqjf-auth-token'
// 새 버전 알림(src/lib/changelog.ts takeNewRelease)이 모든 장면에 뜨지 않게 지금 버전을 본 것으로 둔다(package.json version = 최신 릴리스)
const RELEASE = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version

const SIZES = { 390: { width: 390, height: 844 }, 1280: { width: 1280, height: 800 } }
const BOTH = ['light', 'dark']
const both = (w, f) => BOTH.map((c) => f(w, c))
const each = (f) => [390, 1280].flatMap((w) => both(w, f))

const SHEET_TEXT = '비비고 왕교자 1.05kg x2\n우유 900ml\n대파\n고추장 500g\n휴지 30롤'
// 쇼핑몰 상품명을 통째로 붙여 넣은 경우(60자 넘음): "이름이 길어 60자까지만 담아요"가 보여야 한다.
const LONG_LINE = '[무료배송] 풀무원 국산콩 두부 부침용 300g 2개입 + 찌개용 300g 2개입 냉장 신선 묶음 기획 특가 세트'
const SPLIT_TEXT = '양파 당근 감자 비비고 왕교자 파'
const G = '/?demo=grocery'
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
// 1x1 JPEG 한 장(사진·캡처 읽기 장면용, 내용은 쓰지 않는다: 데모 저장소가 가짜 값을 돌려준다)
const TINY_JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64')

const groceryShots = [
  ...each((w, c) => ({ name: `grocery-list-${w}-${c}`, path: G, w, c, full: true })),
  ...each((w, c) => ({ name: `grocery-add-sheet-${w}-${c}`, path: G, w, c, sheet: SHEET_TEXT })),
  ...both(390, (w, c) => ({ name: `grocery-add-sheet-split-${w}-${c}`, path: G, w, c, sheet: SPLIT_TEXT })),
  // 연달아 빼기(D-017): 알림이 "2개 뺐어요"로 합쳐진다
  ...both(390, (w, c) => ({ name: `grocery-row-remove-two-${w}-${c}`, path: G, w, c, remove: '삼겹살 600g', removeAlso: '한우 국거리 300g' })),
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
  // 몰 주소 자동 찾기(D-024): 자동으로 넣은 주소("자동으로 찾음")와 사람이 고를 후보("같은 상품인지 확인해 주세요")
  ...each((w, c) => ({ name: `grocery-item-detail-find-${w}-${c}`, path: G, w, c, detail: '비비고 왕교자', tab: 'price', detailScroll: '.find-row' })),
  ...both(390, (w, c) => ({ name: `grocery-item-detail-find-auto-${w}-${c}`, path: G, w, c, detail: '비비고 왕교자', tab: 'price', detailScroll: '.tag-auto' })),
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
  // 영양성분 이름 검색(P9): 신선 품목(대파)의 성분 탭과 식품 고르기 시트
  ...both(390, (w, c) => ({ name: `grocery-item-detail-ingredients-fresh-${w}-${c}`, path: G, w, c, detail: '대파', tab: 'ingredients' })),
  { name: 'grocery-nutrition-picker-390-light', path: G, w: 390, c: 'light', detail: '비비고 왕교자', tab: 'ingredients', nutritionPick: true },
  // 원재료 칸(D-020)까지 스크롤: 상품명으로 자동 맞춘 품목의 원재료·출처 줄
  ...both(390, (w, c) => ({ name: `grocery-item-detail-ingredients-raw-${w}-${c}`, path: G, w, c, detail: '비비고 왕교자', tab: 'ingredients', detailScroll: '.ingredients-text' })),
  { name: 'grocery-item-detail-ingredients-raw-1280-light', path: G, w: 1280, c: 'light', detail: '비비고 왕교자', tab: 'ingredients', detailScroll: '.ingredients-text' },
  // 상품을 안 고른 품목(냉동볶음밥)의 원재료(D-020): "식약처 품목 찾기" 버튼과, 이름으로 찾은 후보(식품·축산물·건강기능식품) 고르기 시트
  ...both(390, (w, c) => ({ name: `grocery-item-detail-ingredients-noproduct-${w}-${c}`, path: G, w, c, detail: '냉동볶음밥', tab: 'ingredients' })),
  // 상품명 자동 맞춤이 못 고른 화면(D-026): "같은 상품인지 확인해 주세요" 후보, 업체를 찾지 못함(수입품일 수 있음)
  ...each((w, c) => ({ name: `grocery-item-detail-ingredients-unsure-${w}-${c}`, path: `${G}&match=unsure`, w, c, detail: '비비고 왕교자', tab: 'ingredients', detailScroll: '.pick-list' })),
  ...each((w, c) => ({ name: `grocery-item-detail-ingredients-nomaker-${w}-${c}`, path: `${G}&match=maker_missing`, w, c, detail: '비비고 왕교자', tab: 'ingredients', detailScroll: '.detail-link' })),
  { name: 'grocery-ingredients-picker-noproduct-390-light', path: G, w: 390, c: 'light', detail: '냉동볶음밥', tab: 'ingredients', ingredientsPick: true },
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
  // 영수증 확인 화면 맨 위(D-027): 기본은 한 내역, "상품 N개를 하나씩 따로 저장"을 켜면 상품마다 나뉜다
  ...each((w, c) => ({ name: `shell-smart-bundle-${w}-${c}`, path: '/', w, c, shell: true, tab: '내역', receipt: true, splitToggle: false })),
  ...both(390, (w, c) => ({ name: `shell-smart-split-${w}-${c}`, path: '/', w, c, shell: true, tab: '내역', receipt: true, splitToggle: true })),
  // 나눠 찍은 긴 영수증(D-029): 두 조각이 한 내역으로 이어지고 날짜는 1번 사진 것, '사진 1~2번을 긴 영수증 한 장으로' 안내
  ...each((w, c) => ({ name: `shell-smart-long-${w}-${c}`, path: '/', w, c, shell: true, tab: '내역', receipt: true, longReceipt: true })),
  // 저장하지 않기로 한 초안(체크 해제)이 저장할 초안과 구별되는지
  ...both(390, (w, c) => ({ name: `shell-smart-draft-off-${w}-${c}`, path: '/', w, c, shell: true, tab: '내역', receipt: true, draftOff: true })),
  // 내역 고르기(D-027): 날짜 하나 전부 + 다른 날 한 건을 고른 상태, 아래에 고른 내역 줄. 휴대폰은 한 번 누른 확인 상태도
  ...each((w, c) => ({ name: `shell-list-pick-${w}-${c}`, path: '/', w, c, shell: true, tab: '내역', listPick: { day: 1, row: '스타벅스' } })),
  ...both(390, (w, c) => ({ name: `shell-list-pick-confirm-${w}-${c}`, path: '/', w, c, shell: true, tab: '내역', listPick: { day: 1, row: '스타벅스', confirm: true } })),
  // 나눠 저장한 내역의 수정 시트: 같은 영수증 내역 목록과 '4건 모두 삭제'
  ...each((w, c) => ({ name: `shell-entry-batch-${w}-${c}`, path: '/', w, c, shell: true, tab: '내역', batch: '샘표 진간장' })),
  // 꺼 둔 구독 줄(고정 탭), 숨긴 분류 칩(설정)이 켜진 것과 구별되는지
  // (휴대폰 고정 탭의 꺼 둔 줄은 shell-fixed-390-*의 전체 화면에서 본다. 설정의 분류 칩은 휴대폰에서 아래 탭에 가려 넓은 화면만)
  ...both(1280, (w, c) => ({ name: `shell-settings-cats-${w}-${c}`, path: '/', w, c, shell: true, tab: '설정' })),
  // 설정 '앱' 카드: 지금 버전·업데이트 확인·홈 화면 앱 안내. 휴대폰은 아래 탭에 가리지 않게 카드를 가운데로 둔다.
  // 개발 서버도 version.json을 주므로(vite.config.ts) 누르면 '최신 버전' 상태가 된다. ua: 아이폰 Safari로 열어 공유 메뉴 안내를 본다
  ...each((w, c) => ({ name: `shell-settings-app-${w}-${c}`, path: '/', w, c, shell: true, tab: '설정', center: '.app-card' })),
  ...both(390, (w, c) => ({ name: `shell-settings-app-latest-${w}-${c}`, path: '/', w, c, shell: true, tab: '설정', press: '업데이트 확인', pressWait: '지금이 최신 버전이에요.', center: '.app-card' })),
  ...both(390, (w, c) => ({ name: `shell-settings-app-ios-${w}-${c}`, path: '/', w, c, shell: true, tab: '설정', ua: IPHONE_UA, center: '.app-card' })),
  // 앱 파일 다시 받기를 누르면 새 주소(?u=)로 다시 열리고, 표시를 지운 뒤 설정 탭에서 '새로 받았어요'가 보여야 한다(개발 서버라 서비스 워커는 없다)
  ...both(390, (w, c) => ({ name: `shell-settings-app-refreshed-${w}-${c}`, path: '/', w, c, shell: true, tab: '설정', press: '업데이트 확인', pressWait: '지금이 최신 버전이에요.', refreshFlow: true, center: '.app-card' })),
  // 업데이트 내역(설정 '앱' 카드): 지금 버전 v·빌드, 최신 릴리스, 펼친 지난 업데이트. 새 버전을 처음 열 때의 알림
  ...each((w, c) => ({ name: `shell-settings-release-${w}-${c}`, path: '/', w, c, shell: true, tab: '설정', releaseOpen: true })),
  ...both(390, (w, c) => ({ name: `shell-new-release-${w}-${c}`, path: '/', w, c, shell: true, tab: '내역', newRelease: true })),
  // 알림(토스트): 짧은 문장과 줄이 바뀌는 긴 문장. 저장 흐름 없이 알림 칸에 글만 넣어 모양을 본다
  ...each((w, c) => ({ name: `shell-toast-short-${w}-${c}`, path: '/', w, c, shell: true, tab: '내역', toast: '저장했어요' })),
  ...each((w, c) => ({ name: `shell-toast-long-${w}-${c}`, path: '/', w, c, shell: true, tab: '내역', toast: '저장했어요. 할부 남은 회차는 고정 탭의 할부에 넣었어요. 장보기 연결은 하지 못했어요' })),
  // 이번 장보기 살펴보기(설계 2026-10-21): 지난 장보기 대비, 비싸진·싸진 것, 최근에 또 산 것, 목록에 없던 것. 가짜 과거 영수증 두 번
  ...each((w, c) => ({ name: `shell-smart-compare-${w}-${c}`, path: '/', w, c, shell: true, tab: '내역', receipt: true, compare: true })),
  // 통계 탭 주유 묶음(설계 2026-10-21): 리터당 가격·지난번 대비·추이 그래프·달별. 가짜 주유 기록 3건
  ...each((w, c) => ({ name: `shell-stats-fuel-${w}-${c}`, path: '/', w, c, shell: true, tab: '통계', scroll: '.fuel-card' })),
  // 주유소 영수증 확인 화면(설계 2026-10-21): 유종·주유량·리터당 칸과 지난 주유 대비. 가짜 응답(FUEL_RECEIPT)
  ...each((w, c) => ({ name: `shell-smart-fuel-${w}-${c}`, path: '/', w, c, shell: true, tab: '내역', receipt: true, fuel: true })),
  // 관리비 고지서 확인 화면(D-019): 고정 탭에 관리비 항목이 없으면 '관리비' 항목을 만든다는 안내, 있으면 그 항목에 연결한다는 안내. 가짜 고지서 응답(BILL)
  ...each((w, c) => ({ name: `shell-bill-review-${w}-${c}`, path: '/', w, c, shell: true, tab: '내역', bill: true, noUtility: true })),
  ...both(390, (w, c) => ({ name: `shell-bill-review-linked-${w}-${c}`, path: '/', w, c, shell: true, tab: '내역', bill: true })),
]

const shots = [...groceryShots, ...shellShots]
const only = process.argv.slice(2)
const selected = only.length ? shots.filter((s) => only.some((o) => s.name === o || s.name.startsWith(o))) : shots

/** Supabase로 가는 요청을 모두 가로챈다. 표·rpc는 TABLES, 쓰기는 빈 성공, 인증은 가짜 사용자 */
async function fakeSupabase(context, s = {}) {
  await context.addInitScript(([key, session, release]) => {
    localStorage.setItem(key, JSON.stringify(session))
    if (release) localStorage.setItem('ab:seenRelease', release)
  }, [STORAGE_KEY, fakeSession(), s.newRelease ? null : RELEASE])
  await context.route(`${SUPABASE}/**`, async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (url.pathname.startsWith('/auth/v1/user')) return json(USER)
    if (url.pathname.startsWith('/auth/v1/token')) return json(fakeSession())
    if (url.pathname.startsWith('/auth/v1/logout')) return route.fulfill({ status: 204 })
    if (url.pathname === '/functions/v1/extract-entries') {
      let body = null
      try { body = req.postDataJSON() } catch { /* JSON이 아니면 영수증 응답 */ }
      return json(body?.mode === 'bill' ? BILL : s.fuel ? FUEL_RECEIPT : s.longReceipt ? LONG_RECEIPT : RECEIPT)
    }
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
    // noUtility: 고정 탭에 관리비·공과금 항목이 없는 가구(고지서가 '관리비' 항목을 만드는 안내를 본다)
    if (s.noUtility && key === 'public.recurring') rows = rows.filter((r) => r.kind !== 'utility')
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
        ...(s.ua ? { userAgent: s.ua, hasTouch: true, isMobile: true } : {}),
      })
      // 장보기 데모도 실제 서버로 나가는 요청이 없어야 한다. 셸이 아니어도 가로채 둔다
      await fakeSupabase(context, s)
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
      if (s.press) await page.getByRole('button', { name: s.press, exact: true }).click()
      if (s.pressWait) await page.getByText(s.pressWait).waitFor()
      if (s.refreshFlow) {
        await page.getByRole('button', { name: '앱 파일 다시 받기' }).click()
        await page.getByText('앱 파일을 새로 받았어요.').waitFor()
        if (new URL(page.url()).searchParams.has('u')) problems.push(`${s.name}: 주소에 다시 받기 표시(u)가 남았다`)
        if (!(await page.locator('.app-card').isVisible())) problems.push(`${s.name}: 다시 연 뒤 설정 탭이 아니다`)
      }
      if (s.releaseOpen) {
        await page.locator('.release-older summary').click()
        await page.locator('.release-notes').evaluate((el) => el.scrollIntoView({ block: 'start' }))
      }
      if (s.newRelease) await page.locator('.toast.on').waitFor()
      if (s.center) await page.locator(s.center).first().evaluate((el) => el.scrollIntoView({ block: 'center' }))
      if (s.where) await page.getByRole('button', { name: '어디서 살지' }).click()
      if (s.record) {
        await page.locator('.fab, .side-record').locator('visible=true').first().click()
        await page.getByRole('dialog').first().waitFor()
      }
      if (s.listPick) {
        await page.getByRole('button', { name: '고르기', exact: true }).click()
        await page.locator('.day-pick input').nth(s.listPick.day).check()
        await page.locator('.tx.picking', { hasText: s.listPick.row }).click()
        if (s.listPick.confirm) await page.locator('.pick-bar .danger').click()
      }
      if (s.batch) {
        await page.locator('.tx', { hasText: s.batch }).first().click()
        await page.getByRole('dialog').first().waitFor()
        await page.locator('.batch-del').waitFor()
        await page.locator('.batch-del').evaluate((el) => el.scrollIntoView({ block: 'end' }))
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
      if (s.fuel) {
        await page.getByText('리터당(원)').waitFor()
        await page.locator('.fuel-block').scrollIntoViewIfNeeded()
      } else if (s.compare) {
        await page.getByText('이번 장보기 살펴보기').waitFor()
        await page.getByText('지난번보다 비싸진 것').waitFor()
        await page.locator('.cmp-card').scrollIntoViewIfNeeded()
      } else if (s.longReceipt) {
        await page.getByText(/긴 영수증 한 장으로/).waitFor()
        await page.locator('.draft-group').first().evaluate((el) => el.closest('.sheet')?.scrollTo({ top: 0 }))
      } else if (s.splitToggle !== undefined) {
        await page.locator('.split-toggle').waitFor()
        if (s.splitToggle) await page.locator('.split-toggle input').check()
        await page.locator('.split-toggle').evaluate((el) => el.closest('.sheet')?.scrollTo({ top: 0 }))
      } else if (s.draftOff) {
        await page.locator('.draft-head input').first().waitFor()
        await page.locator('.draft-head input').first().uncheck()
        await page.locator('.draft-head').first().evaluate((el) => el.scrollIntoView({ block: 'start' }))
      } else {
        await page.getByText('장보기 목록에서 찾은 품목').waitFor()
        await page.locator('.grocery-match').scrollIntoViewIfNeeded()
      }
    }
    if (s.toast) {
      await page.evaluate((text) => {
        const t = document.querySelector('.toast')
        if (!t) throw new Error('알림 칸이 없다')
        t.textContent = text
        t.classList.add('on')
      }, s.toast)
    }
    if (s.bill) {
      await page.locator('.fab, .side-record').locator('visible=true').first().click()
      await page.getByRole('button', { name: '관리비 고지서', exact: true }).click()
      await page.locator('input[type=file]').setInputFiles({ name: 'b.jpg', mimeType: 'image/jpeg', buffer: TINY_JPEG })
      await page.getByRole('button', { name: /장 분석하기$/ }).click()
      await page.locator('#bill-date').waitFor()
      // 날짜 아래의 안내 문구(항목을 만든다/연결한다)까지 보이게 저장 버튼을 화면에 넣는다
      await page.getByRole('button', { name: '저장', exact: true }).scrollIntoViewIfNeeded()
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
      if (s.ingredientsPick) {
        await page.getByRole('button', { name: '식약처 품목 찾기' }).click()
        await page.locator('.pick-row').first().waitFor()
      }
      if (s.nutritionPick) {
        // 탭을 열면 자동으로 맞추므로 "다른 식품으로 바꾸기"로 시트를 연다
        await page.getByRole('button', { name: '다른 식품으로 바꾸기' }).click()
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
      if (s.removeAlso) {
        await page.getByRole('button', { name: `${s.removeAlso} 빼기` }).focus()
        await page.keyboard.press('Enter')
        await page.getByText('2개 뺐어요.').waitFor()
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
