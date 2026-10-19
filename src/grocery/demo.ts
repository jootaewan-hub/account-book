// 데모 데이터: 개발 중 화면 캡처 전용이다. 실제 가격·기록이 아니며 운영 화면에 쓰지 않는다.
import { groupAlerts, type AlertsResult } from './lib/alerts'
import type { Membership } from './lib/membership'
import type { DemoPrices } from './lib/store'
import type { Item } from './lib/types'
import { keyOf, type MarketBoard, type MarketSeries, type NearbyPrice, type SeriesKey, type TrendPoint } from './lib/market'
import type { Recalls } from './lib/marketStore'
import type { ShopPrice, StorePrice } from './lib/sources'
import { recentFridays } from '../../supabase/functions/_shared/tprice'

const H = 'demo'
const HUSBAND = 'demo-husband'
const WIFE = 'demo-wife'

export function demoSeed(): { me: Membership; items: Item[]; alerts: AlertsResult; prices: DemoPrices } {
  const me: Membership = {
    userId: HUSBAND,
    householdId: H,
    members: [
      { userId: HUSBAND, displayName: '남편', spouseRole: 'husband' },
      { userId: WIFE, displayName: '아내', spouseRole: 'wife' },
    ],
  }
  const mk = (
    n: number,
    name: string,
    spec: string | null,
    count: number,
    category: Item['category'],
    addedBy: string,
    addedAt: string,
    bought?: { by: string; at: string },
  ): Item => ({
    id: `demo-item-${n}`,
    householdId: H,
    name,
    spec,
    count,
    category,
    productKey: n === 3 ? 'demo-p-1' : null,
    productQty: n === 3 ? 1 : null,
    addedBy,
    addedAt,
    boughtBy: bought?.by ?? null,
    boughtAt: bought?.at ?? null,
    paid: null,
    transactionId: null,
  })
  const items: Item[] = [
    mk(1, '삼겹살', '600g', 1, '정육', WIFE, '2026-10-16T08:10:00+09:00'),
    mk(2, '한우 국거리', '300g', 1, '정육', WIFE, '2026-10-16T08:11:00+09:00'),
    mk(3, '비비고 왕교자', '1.05kg', 2, '냉동', HUSBAND, '2026-10-16T08:30:00+09:00'),
    mk(4, '대파', null, 1, '채소', WIFE, '2026-10-16T08:12:00+09:00'),
    mk(5, '양파', '1.5kg', 1, '채소', HUSBAND, '2026-10-15T20:00:00+09:00', {
      by: HUSBAND,
      at: '2026-10-16T09:20:00+09:00',
    }),
    mk(6, '○○ 냉동볶음밥', null, 1, '냉동', WIFE, '2026-10-16T08:40:00+09:00'),
  ]
  // 데모용 가상 기록(실제 식약처 기록이 아님)
  const alerts: AlertsResult = {
    ...groupAlerts([
      {
        item_id: 'demo-item-6',
        source: 'I0490',
        source_id: 'demo-1',
        product_name: '○○ 냉동볶음밥 300g',
        maker: '○○식품',
        reason: '이물 혼입',
        grade: '2등급',
        pack_unit: '300g',
        registered_on: '2026-10-14',
        level: 'similar',
      },
    ]),
    // 확인 시각은 늘 '방금 전'(캡처에서 정상 상태가 보이게)
    syncedAt: (() => {
      const t = new Date(Date.now() - 3600_000).toISOString()
      return { I0490: t, I2620: t, I2715: t }
    })(),
  }
  // 데모용 가상 가격(실제 다나와 값이 아님). 판매처 이름에 '예시'를 붙인다. 확인 시각은 늘 1시간 전.
  const at = new Date(Date.now() - 3600_000).toISOString()
  const dayAgo = new Date(Date.now() - 25 * 3600_000).toISOString()
  const dayAgoDate = new Date(Date.now() + 9 * 3600_000 - 24 * 3600_000).toISOString().slice(0, 10)
  // 조사일: 최근 금요일 중 둘째(값이 며칠 뒤 들어오는 실제 모양)
  const lastFriday = recentFridays(new Date(), 2)[1]
  const shop = (source: ShopPrice['source'], sourceId: string, url: string, v: Partial<ShopPrice>): ShopPrice => ({
    source, sourceId, url, addedAt: dayAgo, checkedAt: at, ok: true, error: null, pricedAt: null, name: null, price: null, imageUrl: null,
    rating: null, reviewCount: null, size: null, priceFrom: null, obsLow: null, obsHigh: null, obsAvg: null, changedOn: null, ...v,
  })
  const storeRow = (entpId: string, entpName: string, typeCode: string, inspectedOn: string | null, price: number | null, dc = false): StorePrice => ({
    goodId: '1001', goodName: '비비고 왕교자(1.12kg)', entpId, entpName, typeCode, inspectedOn, price, dc, plusOne: false,
  })
  const line = (qty: number, seller: string | null, price: number, delivery: number | null, unitPrice: number | null = null, mallCount: number | null = null) => ({
    price, seller, source: 'danawa' as const, qty, delivery, checkedAt: at, unitPrice, unitLabel: unitPrice ? '100g' : null, mallCount,
  })
  const prices: DemoPrices = {
    searches: {
      'demo-item-1': { status: 'none', candidateCount: 0, updatedAt: at },
      'demo-item-2': { status: 'searching', candidateCount: 0, updatedAt: at },
      'demo-item-6': { status: 'done', candidateCount: 3, updatedAt: at },
    },
    candidates: {
      'demo-item-6': [
        { productId: 'demo-p-2', name: '예시 냉동볶음밥 300g', imageUrl: null, rating: 4.6, foundAt: at,
          variants: [{ qty: 1, price: 3980, unitPrice: 1327, unitLabel: '100g', mallCount: 12 }, { qty: 4, price: 14900, unitPrice: 1242, unitLabel: '100g', mallCount: 30 }] },
        { productId: 'demo-p-3', name: '예시 새우볶음밥 420g', imageUrl: null, rating: 4.4, foundAt: at,
          variants: [{ qty: 1, price: 5480, unitPrice: 1305, unitLabel: '100g', mallCount: 8 }] },
        { productId: 'demo-p-4', name: '예시 볶음밥 3종 세트(300g×3)', imageUrl: null, rating: null, foundAt: at,
          variants: [{ qty: 1, price: 11900, unitPrice: null, unitLabel: null, mallCount: 5 }] },
      ],
    },
    products: {
      'demo-p-1': { id: 'demo-p-1', name: 'CJ제일제당 비비고 왕교자 1.05kg', imageUrl: null, rating: 4.8, reviewCount: 9099, ratedAt: at, pcode: '5643303' },
    },
    lines: {
      'demo-p-1': [
        line(1, null, 10380, null, 989, 26),
        line(1, '예시몰 A', 10380, 3000),
        line(1, '예시몰 B', 10900, 0),
        line(2, null, 21150, null, 1007, 120),
        line(3, null, 27650, null, 878, 279),
      ],
    },
    // 데모용 가상 몰 주소 값(실제 컬리·로우차트 값이 아님). 로우차트는 마지막 확인이 실패하고 하루 전 값이 남은 모양.
    shops: {
      'demo-p-1': [
        shop('kurly', '5082274', 'https://www.kurly.com/goods/5082274', { name: '[예시] 왕교자 만두 대용량 1.05kg', price: 10980, size: '1050g', pricedAt: at }),
        shop('lowchart', '9519439579-18170724212', 'https://www.lowchart.com/9519439579-18170724212', {
          name: '예시 왕교자 1.05kg, 2개', price: 21500, pricedAt: dayAgo, ok: false, error: 'http_503',
          priceFrom: dayAgoDate, obsLow: 21500, obsHigh: 27900, obsAvg: 25100, changedOn: dayAgoDate,
        }),
      ],
    },
    // 참가격 조사 상품 이름은 실제 목록의 이름 모양을 따랐다(docs/grocery/data-sources.md 2절). 가격은 가상 값.
    storeGoods: [
      { goodId: '1001', name: '비비고 왕교자(1.12kg)', detail: '냉동만두' },
      { goodId: '1002', name: '서울우유 흰우유(1L)', detail: null },
      { goodId: '1003', name: '대파(흙대파, 500~800g)', detail: null },
      { goodId: '1004', name: 'CJ 햇반(210g)', detail: '즉석밥' },
      { goodId: '1005', name: '농심 신라면(120g*5개입)', detail: '봉지라면' },
    ],
    storeLinks: { 'demo-item-3': '1001' },
    storePrices: {
      '1001': [
        storeRow('7', '이마트분당점', 'LM', lastFriday, 9980),
        storeRow('201', '롯데슈퍼 분당서현점', 'SM', lastFriday, 10480, true),
        storeRow('82', '농협하나로유통 성남점', 'SM', null, null),
      ],
    },
    stores: [
      { entpId: '7', name: '이마트분당점', typeCode: 'LM' },
      { entpId: '912', name: '이마트성남점', typeCode: 'LM' },
      { entpId: '82', name: '농협하나로유통 성남점', typeCode: 'SM' },
      { entpId: '201', name: '롯데슈퍼 분당서현점', typeCode: 'SM' },
      { entpId: '1948', name: '현대백화점판교점', typeCode: 'DP' },
    ],
  }
  return { me, items, alerts, prices }
}

// 데모용 시세(실제 KAMIS 조사값이 아님). 조사처 이름은 실제 응답의 가린 이름 모양만 따랐다. 날짜는 늘 오늘 기준.
export function demoMarket(): {
  board: MarketBoard
  trends: Record<string, TrendPoint[]>
  nearby: Record<string, NearbyPrice[]>
  watches: SeriesKey[]
  recalls: Recalls
} {
  const kst = new Date(Date.now() + 9 * 3600_000)
  const ago = (n: number) => new Date(kst.getTime() - n * 86400_000).toISOString().slice(0, 10)
  // 마지막 조사일: 사흘 전부터 거꾸로 가장 가까운 평일
  const weekday = (n: number) => {
    let k = n
    while ([0, 6].includes(new Date(`${ago(k)}T00:00:00Z`).getUTCDay())) k++
    return k
  }
  const last = weekday(1)
  const dp = (n: number, price: number) => ({ on: ago(weekday(n)), price })
  type Def = {
    item: string; vrty: string; grd: string; ctgry: string; itemNm: string; vrtyNm: string; grdNm: string; unit: string; unitSz: string
    sgg: string; sggNm: string; mrkt: string; mrktNm: string; cur: number; prev: number; w1: number | null; m1: number | null; y1: number | null
    low: number | null; high: number | null; markets: number
  }
  const SN = { sgg: '3112', sggNm: '성남', mrkt: '0310407', mrktNm: 'B-유통' }
  const NAT = { sgg: '1000', sggNm: '전국', mrkt: '', mrktNm: '' }
  const defs: Def[] = [
    { item: '246', vrty: '00', grd: '04', ctgry: '200', itemNm: '파', vrtyNm: '대파', grdNm: '상품', unit: 'kg', unitSz: '1', ...SN, cur: 1980, prev: 1980, w1: 2100, m1: 2650, y1: 3120, low: 1980, high: 4780, markets: 12 },
    { item: '246', vrty: '02', grd: '04', ctgry: '200', itemNm: '파', vrtyNm: '쪽파', grdNm: '상품', unit: 'kg', unitSz: '1', ...SN, cur: 3960, prev: 3960, w1: 4160, m1: 4380, y1: null, low: 3500, high: 6980, markets: 11 },
    { item: '245', vrty: '00', grd: '04', ctgry: '200', itemNm: '양파', vrtyNm: '양파', grdNm: '상품', unit: 'kg', unitSz: '1', ...SN, cur: 1960, prev: 1960, w1: 2060, m1: 2010, y1: 2480, low: 1960, high: 2660, markets: 12 },
    { item: '211', vrty: '02', grd: '04', ctgry: '200', itemNm: '배추', vrtyNm: '여름(고랭지)', grdNm: '상품', unit: '포기', unitSz: '1', ...SN, cur: 5340, prev: 5340, w1: 5820, m1: 7200, y1: 4980, low: 4580, high: 7900, markets: 11 },
    { item: '411', vrty: '07', grd: '04', ctgry: '400', itemNm: '사과', vrtyNm: '홍로', grdNm: '상품', unit: '개', unitSz: '10', ...SN, cur: 18600, prev: 18600, w1: 19800, m1: 24500, y1: 21300, low: 11400, high: 29800, markets: 12 },
    { item: '611', vrty: '03', grd: '30', ctgry: '600', itemNm: '고등어', vrtyNm: '국산(염장)', grdNm: '-', unit: '손', unitSz: '1', sgg: '3111', sggNm: '수원', mrkt: '0310001', mrktNm: '지동', cur: 5900, prev: 5900, w1: 5600, m1: 5480, y1: 4900, low: 4790, high: 10900, markets: 9 },
    { item: '4304', vrty: '27', grd: '27', ctgry: '500', itemNm: '돼지', vrtyNm: '삼겹살', grdNm: '삼겹살', unit: 'g', unitSz: '100', ...NAT, cur: 2580, prev: 2590, w1: 2610, m1: 2490, y1: 2450, low: null, high: null, markets: 0 },
    { item: '9903', vrty: '23', grd: '1', ctgry: '500', itemNm: '계란', vrtyNm: '특란30구', grdNm: '일반란', unit: '구', unitSz: '30', ...NAT, cur: 6980, prev: 6990, w1: 6890, m1: 6720, y1: 7120, low: null, high: null, markets: 0 },
  ]
  const series: MarketSeries[] = defs.map((d) => ({
    item: d.item, vrty: d.vrty, grd: d.grd, ctgry: d.ctgry, itemNm: d.itemNm, vrtyNm: d.vrtyNm, grdNm: d.grdNm, unit: d.unit, unitSz: d.unitSz,
    sgg: d.sgg, sggNm: d.sggNm, mrkt: d.mrkt, mrktNm: d.mrktNm,
    cur: { on: ago(last), price: d.cur },
    prev: dp(last + 1, d.prev),
    w1: d.w1 === null ? null : dp(last + 7, d.w1),
    m1: d.m1 === null ? null : dp(last + 30, d.m1),
    y1: d.y1 === null ? null : dp(last + 365, d.y1),
    low: d.low, high: d.high, markets: d.markets,
    firstOn: ago(last + 400), days: 30, fetchedAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
  }))
  // 추이: 1개월 전 값에서 1주 전 값을 거쳐 지금 값으로 가는 선(평일만), 띠는 그 위아래
  const trends: Record<string, TrendPoint[]> = {}
  for (const s of series) {
    const pts: TrendPoint[] = []
    for (let n = last + 44; n >= last; n--) {
      const on = ago(n)
      if ([0, 6].includes(new Date(`${on}T00:00:00Z`).getUTCDay())) continue
      const a = s.m1?.price ?? s.cur.price
      const b = s.w1?.price ?? s.cur.price
      const k = n - last
      const v = k >= 7 ? b + ((a - b) * (k - 7)) / 37 : s.cur.price + ((b - s.cur.price) * k) / 7
      const price = Math.round((v + ((n * 37) % 5) * (s.cur.price / 400)) / 10) * 10
      pts.push({
        on, price, markets: s.markets,
        low: s.low === null ? null : Math.min(price, Math.round((price * 0.82) / 10) * 10),
        high: s.high === null ? null : Math.round((price * 1.6) / 10) * 10,
      })
    }
    pts[pts.length - 1] = { ...pts[pts.length - 1], price: s.cur.price, low: s.low, high: s.high }
    trends[keyOf(s)] = pts
  }
  const greenOnion = series[0]
  const nearby: Record<string, NearbyPrice[]> = {
    [keyOf(greenOnion)]: [
      ['성남', 'B-유통', '0310407', 1980], ['서울', 'B-유통', '0110406', 1990], ['서울', 'C-유통', '0110403', 2160],
      ['수원', '지동', '0310001', 2280], ['서울', '복조리', '0110213', 2500], ['수원', 'B-유통', '0310402', 2540],
      ['서울', '경동', '0110212', 2660], ['서울', 'I-유통', '0110409', 2780], ['서울', 'K-유통', '0110407', 2870],
      ['서울', 'L-유통', '0110410', 3150], ['서울', 'B`-유통', '0110411', 3490], ['서울', 'E-유통', '0110408', 4780],
    ].map(([sggNm, mrktNm, mrkt, price]) => ({ sggNm: sggNm as string, mrktNm: mrktNm as string, mrkt: mrkt as string, price: price as number })),
  }
  const recalls: Recalls = {
    syncedAt: new Date(Date.now() - 3600_000).toISOString(),
    records: [
      { source: 'I0490', sourceId: 'demo-r1', productName: '○○ 냉동볶음밥 300g', maker: '○○식품', reason: '이물 혼입', grade: '2등급', packUnit: '300g', registeredOn: ago(5) },
      { source: 'I0490', sourceId: 'demo-r2', productName: '△△ 참기름 320ml', maker: '△△유지', reason: '벤조피렌 기준 초과', grade: '1등급', packUnit: '320ml', registeredOn: ago(9) },
    ],
  }
  return { board: { series, syncedAt: new Date(Date.now() - 2 * 3600_000).toISOString() }, trends, nearby, watches: [series[0], series[6], series[2]], recalls }
}
