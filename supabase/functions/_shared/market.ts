// 농수산물 시세(D-012): 공공데이터포털 15156057 "한국농수산식품유통공사_일별 도,소매 가격정보".
// Deno(market-sync)와 브라우저·Vitest(장보기 화면)가 함께 import하므로 외부 라이브러리를 쓰지 않는다.
// 확인한 응답 모양과 코드: docs/grocery/data-sources.md 3-1(2026-10-19 실제 호출).
// 화면의 숫자는 이 응답의 exmn_dd_prc(조사일가격) 그대로다. 축산물 행의 kg환산가격은 가격과 맞지 않아 쓰지 않는다.

export const MARKET_API = 'https://apis.data.go.kr/B552845/perDay/price'

/** 소매 */
export const RETAIL = '01'
/** 성남 소매 조사처(B-유통). 성남 시군구(3112)의 유일한 조사처다 */
export const SEONGNAM_MARKET = '0310407'
export const SGG = { seongnam: '3112', suwon: '3111', seoul: '1101', national: '1000' } as const
/** 저장하는 시군구: 성남·수원·서울(채소·과일·수산)과 전국(축산물) */
export const KEEP_SGG: ReadonlySet<string> = new Set(Object.values(SGG))

/** 큰 숫자로 쓸 조사처의 순서(작을수록 먼저): 전국(축산물) 0, 성남 B-유통 1, 성남 다른 곳 2, 수원 3, 서울 4 */
export function marketPriority(sgg: string, mrkt: string): number {
  if (sgg === SGG.national) return 0
  if (sgg === SGG.seongnam) return mrkt === SEONGNAM_MARKET ? 1 : 2
  if (sgg === SGG.suwon) return 3
  if (sgg === SGG.seoul) return 4
  return 9
}

export type MarketItem = {
  /** 부류코드 */
  ctgry: string
  /** 품목코드 */
  item: string
  /** 화면 이름 */
  label: string
  /** 품종을 정하지 않았을 때 먼저 쓸 품종코드 */
  defaultVrty?: string
}

/** 매일 받는 품목(약 50개). 코드는 명세서 첨부 코드표(2026-10-19)에서 옮겼다. */
export const MARKET_ITEMS: readonly MarketItem[] = [
  // 식량작물
  { ctgry: '100', item: '151', label: '고구마' },
  { ctgry: '100', item: '152', label: '감자' },
  // 채소류
  { ctgry: '200', item: '211', label: '배추' },
  { ctgry: '200', item: '212', label: '양배추' },
  { ctgry: '200', item: '213', label: '시금치' },
  { ctgry: '200', item: '214', label: '상추', defaultVrty: '01' },
  { ctgry: '200', item: '215', label: '얼갈이배추' },
  { ctgry: '200', item: '221', label: '수박' },
  { ctgry: '200', item: '222', label: '참외' },
  { ctgry: '200', item: '223', label: '오이', defaultVrty: '02' },
  { ctgry: '200', item: '224', label: '호박', defaultVrty: '01' },
  { ctgry: '200', item: '225', label: '토마토' },
  { ctgry: '200', item: '226', label: '딸기' },
  { ctgry: '200', item: '231', label: '무' },
  { ctgry: '200', item: '232', label: '당근', defaultVrty: '00' },
  { ctgry: '200', item: '242', label: '풋고추', defaultVrty: '00' },
  { ctgry: '200', item: '245', label: '양파', defaultVrty: '00' },
  { ctgry: '200', item: '246', label: '파', defaultVrty: '00' },
  { ctgry: '200', item: '247', label: '생강' },
  { ctgry: '200', item: '251', label: '가지' },
  { ctgry: '200', item: '252', label: '미나리' },
  { ctgry: '200', item: '253', label: '깻잎' },
  { ctgry: '200', item: '254', label: '부추' },
  { ctgry: '200', item: '255', label: '피망' },
  { ctgry: '200', item: '256', label: '파프리카' },
  { ctgry: '200', item: '258', label: '깐마늘(국산)', defaultVrty: '01' },
  { ctgry: '200', item: '261', label: '브로콜리' },
  { ctgry: '200', item: '262', label: '양상추' },
  { ctgry: '200', item: '263', label: '청경채' },
  { ctgry: '200', item: '265', label: '콩나물' },
  { ctgry: '200', item: '279', label: '알배기배추' },
  { ctgry: '200', item: '422', label: '방울토마토', defaultVrty: '01' },
  // 특용작물(버섯)
  { ctgry: '300', item: '315', label: '느타리버섯', defaultVrty: '00' },
  { ctgry: '300', item: '316', label: '팽이버섯' },
  { ctgry: '300', item: '317', label: '새송이버섯' },
  { ctgry: '300', item: '321', label: '양송이버섯' },
  { ctgry: '300', item: '322', label: '표고버섯' },
  // 과일류
  { ctgry: '400', item: '411', label: '사과' },
  { ctgry: '400', item: '412', label: '배' },
  { ctgry: '400', item: '414', label: '포도' },
  { ctgry: '400', item: '415', label: '감귤' },
  { ctgry: '400', item: '416', label: '단감' },
  { ctgry: '400', item: '418', label: '바나나' },
  { ctgry: '400', item: '419', label: '키위', defaultVrty: '01' },
  { ctgry: '400', item: '421', label: '오렌지' },
  { ctgry: '400', item: '424', label: '레몬' },
  { ctgry: '400', item: '429', label: '블루베리' },
  // 축산물: 일반 시세는 전국 값 하나(4301·4304·9901·9903·4402). 512·514·535는 0건, 515·516은 친환경만이라 쓰지 않는다
  { ctgry: '500', item: '4301', label: '소고기', defaultVrty: '22' },
  { ctgry: '500', item: '4304', label: '돼지고기', defaultVrty: '27' },
  { ctgry: '500', item: '4402', label: '수입 돼지고기' },
  { ctgry: '500', item: '9901', label: '닭', defaultVrty: '99' },
  { ctgry: '500', item: '9903', label: '계란', defaultVrty: '23' },
  // 수산물
  { ctgry: '600', item: '611', label: '고등어' },
  { ctgry: '600', item: '613', label: '갈치' },
  { ctgry: '600', item: '615', label: '명태' },
  { ctgry: '600', item: '619', label: '오징어' },
  { ctgry: '600', item: '638', label: '마른멸치' },
  { ctgry: '600', item: '644', label: '굴' },
  { ctgry: '600', item: '653', label: '전복' },
  { ctgry: '600', item: '654', label: '새우' },
  { ctgry: '600', item: '656', label: '꽃게' },
  { ctgry: '600', item: '658', label: '홍합' },
  { ctgry: '600', item: '661', label: '바지락' },
]

const BY_ITEM = new Map(MARKET_ITEMS.map((m) => [m.item, m]))
export function marketItem(item: string): MarketItem | null {
  return BY_ITEM.get(item) ?? null
}

/** 장보기 이름 키워드 → 품목·품종. 긴 키워드가 먼저 맞는다(같은 길이면 품종을 정한 것). 한 글자 키워드('파', '무', '배', '굴', '감')는 단어 전체가 같을 때만 */
const KEYWORDS: readonly (readonly [string, string, string?])[] = [
  ['고구마', '151'], ['감자', '152'],
  ['알배기', '279'], ['알배추', '279'], ['얼갈이', '215'], ['양배추', '212'], ['배추', '211'],
  ['시금치', '213'], ['적상추', '214', '01'], ['청상추', '214', '02'], ['상추', '214'],
  ['수박', '221'], ['참외', '222'], ['오이', '223'],
  ['애호박', '224', '01'], ['쥬키니', '224', '02'], ['주키니', '224', '02'], ['단호박', '224', '03'], ['호박', '224'],
  ['대추방울토마토', '422', '02'], ['방울토마토', '422'], ['토마토', '225'], ['딸기', '226'],
  ['무', '231'], ['당근', '232'],
  ['꽈리고추', '242', '02'], ['청양고추', '242', '03'], ['오이고추', '242', '04'], ['풋고추', '242', '00'],
  ['양파', '245'], ['대파', '246', '00'], ['쪽파', '246', '02'], ['파', '246', '00'],
  ['생강', '247'], ['가지', '251'], ['미나리', '252'], ['깻잎', '253'], ['부추', '254'], ['피망', '255'], ['파프리카', '256'],
  ['깐마늘', '258'], ['마늘', '258'], ['브로콜리', '261'], ['양상추', '262'], ['청경채', '263'], ['콩나물', '265'],
  ['애느타리', '315', '01'], ['느타리', '315'], ['팽이', '316'], ['새송이', '317'], ['양송이', '321'], ['표고', '322'],
  ['사과', '411'], ['부사', '411', '05'], ['홍로', '411', '07'], ['배', '412'],
  ['샤인머스캣', '414', '12'], ['샤인머스켓', '414', '12'], ['거봉', '414', '02'], ['캠벨', '414', '01'], ['포도', '414'],
  ['감귤', '415'], ['귤', '415'], ['단감', '416'], ['감', '416'], ['바나나', '418'], ['키위', '419'], ['참다래', '419'],
  ['오렌지', '421'], ['레몬', '424'], ['블루베리', '429'],
  ['한우', '4301'], ['소고기', '4301'], ['쇠고기', '4301'], ['안심', '4301', '21'], ['등심', '4301', '22'],
  ['설도', '4301', '36'], ['양지', '4301', '40'], ['소갈비', '4301', '50'],
  ['수입삼겹살', '4402', '27'], ['삼겹살', '4304', '27'], ['삼겹', '4304', '27'], ['목살', '4304', '68'], ['목심', '4304', '68'],
  ['앞다리', '4304', '25'], ['돼지갈비', '4304', '28'], ['돼지고기', '4304'], ['돼지', '4304'], ['돈육', '4304'], ['한돈', '4304'],
  ['생닭', '9901'], ['통닭', '9901'], ['육계', '9901'], ['토종닭', '9901', '01'], ['닭', '9901'],
  ['계란', '9903'], ['달걀', '9903'],
  ['고등어', '611'], ['갈치', '613'], ['명태', '615'], ['동태', '615'], ['오징어', '619'], ['멸치', '638'],
  ['굴', '644'], ['전복', '653'], ['새우', '654'], ['꽃게', '656'], ['홍합', '658'], ['바지락', '661'],
]
// 길이가 같으면 품종까지 정한 키워드가 먼저('한우 등심'은 소고기 등심)
const SORTED = [...KEYWORDS].sort((a, b) => b[0].length - a[0].length || Number(b[2] !== undefined) - Number(a[2] !== undefined))

export type MarketMatch = { item: string; vrty: string | null; label: string }

/**
 * 장보기 품목 이름(과 용량) → 시세 품목. 못 찾으면 null(화면은 "확인 못 함").
 * 계란은 용량이 10구면 특란10구(21), 그 밖에는 품목 기본(특란30구, 23)을 쓴다.
 */
export function matchMarket(name: string, spec: string | null = null): MarketMatch | null {
  const text = name.replace(/\s+/g, ' ').trim()
  const squashed = text.replace(/\s+/g, '')
  const words = text.split(' ')
  for (const [kw, item, vrty] of SORTED) {
    const hit = kw.length === 1 ? words.includes(kw) : squashed.includes(kw)
    if (!hit) continue
    const m = marketItem(item)
    if (!m) continue
    let v = vrty ?? null
    if (item === '9903' && !v) v = /(^|\D)10\s*구/.test(`${text} ${spec ?? ''}`) ? '21' : null
    return { item, vrty: v, label: m.label }
  }
  return null
}

export class MarketApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MarketApiError'
  }
}

/** 저장하는 행(grocery.price_points의 열과 같은 이름) */
export type MarketRow = {
  item_cd: string
  vrty_cd: string
  grd_cd: string
  sgg_cd: string
  /** 축산물(전국) 행은 시장이 없어 빈 글자 */
  mrkt_cd: string
  /** YYYY-MM-DD */
  exmn_ymd: string
  ctgry_cd: string
  item_nm: string
  vrty_nm: string
  grd_nm: string
  sgg_nm: string
  mrkt_nm: string
  unit: string
  unit_sz: string
  price: number
  orgnl_reg_dt: string | null
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '')

/** 조사일가격 글자 → 원. 쉼표를 빼고 양의 정수(또는 소수점 아래가 0)만 받는다. 아니면 null(그 행은 버린다) */
export function parsePrice(v: unknown): number | null {
  const s = str(v).replace(/,/g, '')
  const m = s.match(/^(\d+)(?:\.0+)?$/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

/**
 * API 응답(JSON) → 저장할 행과 전체 건수.
 * 소매만, KEEP_SGG의 시군구만, 조사일이 YYYYMMDD이고 가격이 양의 정수인 행만 남긴다.
 * 오류 응답(인증키 오류 등)은 MarketApiError(코드와 문구, 키는 담기지 않는다).
 */
export function parseMarket(body: unknown): { rows: MarketRow[]; total: number; seen: number } {
  const b = body as Record<string, any> | null
  const gw = b?.OpenAPI_ServiceResponse?.cmmMsgHeader
  if (gw) throw new MarketApiError(`${str(gw.returnReasonCode)} ${str(gw.errMsg)}`.trim())
  const res = b?.response
  if (!res || typeof res !== 'object') throw new MarketApiError('응답 형식을 읽지 못함')
  const code = str(res.header?.resultCode)
  if (code !== '0' && code !== '00') throw new MarketApiError(`${code} ${str(res.header?.resultMsg)}`.trim())
  const raw = res.body?.items?.item
  const items: Record<string, unknown>[] = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : []
  const rows: MarketRow[] = []
  for (const x of items) {
    const ymd = str(x.exmn_ymd)
    const price = parsePrice(x.exmn_dd_prc)
    const sgg = str(x.sgg_cd)
    if (str(x.se_cd) !== RETAIL || !KEEP_SGG.has(sgg) || !/^\d{8}$/.test(ymd) || price === null) continue
    const item = str(x.item_cd)
    if (!item) continue
    const reg = str(x.orgnl_reg_dt)
    rows.push({
      item_cd: item,
      vrty_cd: str(x.vrty_cd),
      grd_cd: str(x.grd_cd),
      sgg_cd: sgg,
      mrkt_cd: str(x.mrkt_cd),
      exmn_ymd: `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`,
      ctgry_cd: str(x.ctgry_cd),
      item_nm: str(x.item_nm),
      vrty_nm: str(x.vrty_nm),
      grd_nm: str(x.grd_nm),
      sgg_nm: str(x.sgg_nm),
      mrkt_nm: str(x.mrkt_nm),
      unit: str(x.unit),
      unit_sz: str(x.unit_sz),
      price,
      orgnl_reg_dt: reg && !Number.isNaN(Date.parse(reg)) ? new Date(reg).toISOString() : null,
    })
  }
  const total = Number(res.body?.totalCount ?? items.length)
  return { rows, total: Number.isFinite(total) ? total : items.length, seen: items.length }
}

export const PAGE_ROWS = 1000

/** 축산물(전국 값만 있는 품목) */
export const isNational = (m: Pick<MarketItem, 'ctgry'>) => m.ctgry === '500'

/**
 * 시군구마다 따로 부른다(서울·수원·성남만 받아 응답을 줄인다). 축산물은 전국 값만 있어 시군구 조건 없이 한 번 부른다
 * (null). 시군구 조건이 무시되더라도 parseMarket이 KEEP_SGG만 남긴다.
 */
export function regionsOf(m: Pick<MarketItem, 'ctgry'>): (string | null)[] {
  return isNational(m) ? [null] : [SGG.seongnam, SGG.suwon, SGG.seoul]
}

/** 한 품목·시군구·기간·쪽의 요청 주소. 키는 앞뒤 공백을 빼고 인코딩한다(이미 %가 들어 있으면 그대로) */
export function marketUrl(key: string, m: Pick<MarketItem, 'ctgry' | 'item'>, from: string, to: string, page = 1, sgg: string | null = null): string {
  const k = key.trim()
  const params = new URLSearchParams({
    pageNo: String(page),
    numOfRows: String(PAGE_ROWS),
    returnType: 'JSON',
    'cond[exmn_ymd::GTE]': from.replaceAll('-', ''),
    'cond[exmn_ymd::LTE]': to.replaceAll('-', ''),
    'cond[se_cd::EQ]': RETAIL,
    'cond[ctgry_cd::EQ]': m.ctgry,
    'cond[item_cd::EQ]': m.item,
  })
  if (sgg) params.set('cond[sgg_cd::EQ]', sgg)
  return `${MARKET_API}?serviceKey=${k.includes('%') ? k : encodeURIComponent(k)}&${params}`
}

/** 단위 글자: "1kg", "10개", "100g", "30구" */
export function unitText(unitSz: string, unit: string): string {
  return `${unitSz}${unit}`
}
