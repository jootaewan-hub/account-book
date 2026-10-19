// 참가격(한국소비자원 생필품 가격 정보 GW, 공공데이터포털 15158701)의 주소 만들기와 XML 응답 읽기(P3, D-013 ①).
// Deno(Edge Function)와 Node(Vitest)가 함께 import하므로 외부 라이브러리 없이 정규식만 쓴다.
// 확인한 사실(docs/grocery/data-sources.md 2절, 2026-10-19 실제 호출): 응답은 XML만, 항목 태그는 iros.openapi.service.vo.*VO
// (상품은 명세상 item), 가격 조회는 entpId나 goodId가 꼭 필요(없으면 resultCode 05), 조사일은 격주 금요일.
// 확인 필요: 요청의 goodInspectDay 날짜 모양은 YYYYMMDD로 보낸다(명세에 보기가 없음). 응답의 날짜는 두 모양 다 읽는다.

export const TPRICE_BASE = 'https://apis.data.go.kr/B551919/ProductPriceInfoService/'
/** 성남 지역 상세코드(기준정보 AR): 수정구·중원구·분당구 */
export const SEONGNAM_AREAS: readonly string[] = ['020918000', '020919000', '020925000']

export type TpriceKind = 'stores' | 'goods' | 'prices' | 'std'
export type TpriceParams = { entpId?: string; goodId?: string; classCode?: string; /** YYYY-MM-DD */ day?: string }

export class TpriceApiError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message)
    this.name = 'TpriceApiError'
  }
}

export type TpriceStore = {
  entpId: string
  entpName: string
  entpTypeCode: string
  entpAreaCode: string
  areaDetailCode: string
  roadAddr: string | null
  telno: string | null
}
export type TpriceGood = {
  goodId: string
  goodName: string
  goodTotalCnt: number | null
  goodTotalDivCode: string | null
  goodBaseCnt: number | null
  goodUnitDivCode: string | null
  goodSmlclsCode: string | null
  detailMean: string | null
  productEntpCode: string | null
}
export type TpricePrice = {
  /** YYYY-MM-DD */
  goodInspectDay: string
  entpId: string
  goodId: string
  goodPrice: number
  /** 입력 일시(ISO). 못 읽으면 null */
  inputAt: string | null
  dc: boolean
  plusOne: boolean
  dcStart: string | null
  dcEnd: string | null
}
export type TpriceStd = { code: string; codeName: string; highCode: string | null }

const ENC_KEY = (k: string) => {
  const t = k.trim()
  return t.includes('%') ? t : encodeURIComponent(t)
}

/** 요청 주소. 가격(prices)은 serviceKey가 소문자이고 goodInspectDay가 필수, entpId나 goodId 중 하나가 꼭 있어야 한다. */
export function tpriceUrl(kind: TpriceKind, apiKey: string, p: TpriceParams = {}): string {
  const key = ENC_KEY(apiKey)
  const q: string[] = []
  if (kind === 'prices') {
    if (!p.day || !/^\d{4}-\d{2}-\d{2}$/.test(p.day)) throw new Error('tprice prices: day(YYYY-MM-DD) required')
    if (!p.entpId && !p.goodId) throw new Error('tprice prices: entpId or goodId required')
    q.push(`serviceKey=${key}`, `goodInspectDay=${p.day.replace(/-/g, '')}`)
    if (p.entpId) q.push(`entpId=${encodeURIComponent(p.entpId)}`)
    if (p.goodId) q.push(`goodId=${encodeURIComponent(p.goodId)}`)
    return `${TPRICE_BASE}getProductPriceInfoSvc?${q.join('&')}`
  }
  q.push(`ServiceKey=${key}`)
  if (kind === 'stores') {
    if (p.entpId) q.push(`entpId=${encodeURIComponent(p.entpId)}`)
    return `${TPRICE_BASE}getStoreInfoSvc.do?${q.join('&')}`
  }
  if (kind === 'goods') {
    if (p.goodId) q.push(`goodId=${encodeURIComponent(p.goodId)}`)
    return `${TPRICE_BASE}getProductInfoSvc.do?${q.join('&')}`
  }
  if (!p.classCode) throw new Error('tprice std: classCode required')
  q.push(`classCode=${encodeURIComponent(p.classCode)}`)
  return `${TPRICE_BASE}getStandardInfoSvc.do?${q.join('&')}`
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
function text(v: string | undefined): string | null {
  if (v === undefined) return null
  const cdata = v.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/)
  const raw = cdata ? cdata[1] : v
  const s = raw
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim()
  return s === '' ? null : s
}

/** 한 항목 안의 <tag>값</tag>를 모은다(빈 <tag/>는 null) */
function fields(body: string): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  for (const m of body.matchAll(/<([A-Za-z][\w.]*)(?:\s[^>]*)?>([\s\S]*?)<\/\1>|<([A-Za-z][\w.]*)(?:\s[^>]*)?\/>/g)) {
    const name = m[1] ?? m[3]
    if (!(name in out)) out[name] = m[1] ? text(m[2]) : null
  }
  return out
}

const ROW_TAG = /<((?:iros\.openapi\.service\.vo\.[A-Za-z]+)|item)>([\s\S]*?)<\/\1>/g

/** 결과 코드를 확인하고 항목(행)들을 돌려준다. 00이 아니면 TpriceApiError. */
function rows(xml: string): Record<string, string | null>[] {
  const gw = xml.match(/<returnReasonCode>\s*([^<]*?)\s*<\/returnReasonCode>/)
  if (gw) {
    const msg = xml.match(/<returnAuthMsg>\s*([^<]*?)\s*<\/returnAuthMsg>/)?.[1] ?? xml.match(/<errMsg>\s*([^<]*?)\s*<\/errMsg>/)?.[1] ?? ''
    throw new TpriceApiError(gw[1], msg || 'gateway error')
  }
  const code = xml.match(/<resultCode>\s*([^<]*?)\s*<\/resultCode>/)?.[1]
  if (code === undefined) throw new TpriceApiError('unreadable', 'no resultCode in response')
  if (code !== '00') throw new TpriceApiError(code, text(xml.match(/<resultMsg>([\s\S]*?)<\/resultMsg>/)?.[1]) ?? 'error')
  return [...xml.matchAll(ROW_TAG)].map((m) => fields(m[2]))
}

const numOrNull = (v: string | null | undefined): number | null => {
  if (v == null) return null
  const n = Number(v.replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}
const posInt = (v: string | null | undefined): number | null => {
  const n = numOrNull(v)
  return n !== null && Number.isInteger(n) && n > 0 ? n : null
}
/** YYYYMMDD나 YYYY-MM-DD → YYYY-MM-DD */
function day(v: string | null | undefined): string | null {
  if (!v) return null
  const m = v.match(/^(\d{4})-?(\d{2})-?(\d{2})$/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}
/** "2026-10-15 15:32:07"·"20261015153207"(한국 시간) → ISO */
function dttm(v: string | null | undefined): string | null {
  if (!v) return null
  const m = v.match(/^(\d{4})-?(\d{2})-?(\d{2})[ T]?(\d{2}):?(\d{2}):?(\d{2})?$/)
  if (!m) return null
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? '00'}+09:00`
  const t = Date.parse(iso)
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

export function parseTpriceStores(xml: string): TpriceStore[] {
  const out: TpriceStore[] = []
  for (const r of rows(xml)) {
    if (!r.entpId || !r.entpName) continue
    const road = [r.roadAddrBasic, r.roadAddrDetail].filter(Boolean).join(' ')
    out.push({
      entpId: r.entpId,
      entpName: r.entpName,
      entpTypeCode: r.entpTypeCode ?? '',
      entpAreaCode: r.entpAreaCode ?? '',
      areaDetailCode: r.areaDetailCode ?? '',
      roadAddr: road || null,
      telno: r.entpTelno ?? null,
    })
  }
  return out
}

export const isSeongnam = (s: TpriceStore): boolean => SEONGNAM_AREAS.includes(s.areaDetailCode)

export function parseTpriceGoods(xml: string): TpriceGood[] {
  const out: TpriceGood[] = []
  for (const r of rows(xml)) {
    if (!r.goodId || !r.goodName) continue
    out.push({
      goodId: r.goodId,
      goodName: r.goodName,
      goodTotalCnt: numOrNull(r.goodTotalCnt),
      goodTotalDivCode: r.goodTotalDivCode ?? null,
      goodBaseCnt: numOrNull(r.goodBaseCnt),
      goodUnitDivCode: r.goodUnitDivCode ?? null,
      goodSmlclsCode: r.goodSmlclsCode ?? null,
      detailMean: r.detailMean ?? r.datailMean ?? null,
      productEntpCode: r.productEntpCode ?? null,
    })
  }
  return out
}

/** 가격 줄. 조사일을 못 읽거나 가격이 양의 정수가 아닌 줄(0, "-")은 뺀다(출처 값이 아님). */
export function parseTpricePrices(xml: string): TpricePrice[] {
  const out: TpricePrice[] = []
  for (const r of rows(xml)) {
    const on = day(r.goodInspectDay)
    const price = posInt(r.goodPrice)
    if (!on || !r.entpId || !r.goodId || price === null) continue
    out.push({
      goodInspectDay: on,
      entpId: r.entpId,
      goodId: r.goodId,
      goodPrice: price,
      inputAt: dttm(r.inputDttm),
      dc: r.goodDcYn === 'Y',
      plusOne: r.plusoneYn === 'Y',
      dcStart: day(r.goodDcStartDay),
      dcEnd: day(r.goodDcEndDay),
    })
  }
  return out
}

export function parseTpriceStd(xml: string): TpriceStd[] {
  return rows(xml)
    .filter((r) => r.code && r.codeName)
    .map((r) => ({ code: r.code!, codeName: r.codeName!, highCode: r.highCode ?? null }))
}

/** 한국 날짜 기준으로 오늘(포함) 이전의 금요일 n개(YYYY-MM-DD, 최근 순). 조사일 후보로 쓴다. */
export function recentFridays(now: Date, n = 5): string[] {
  const kst = new Date(now.getTime() + 9 * 3600_000)
  const back = (kst.getUTCDay() - 5 + 7) % 7 // 금요일(5)까지 되돌아갈 날수
  const first = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() - back)
  return Array.from({ length: n }, (_, i) => new Date(first - i * 7 * 86400_000).toISOString().slice(0, 10))
}
