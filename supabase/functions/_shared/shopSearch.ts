// 알아보기 가격 비교의 몰 검색(D-036): 마켓컬리 앱 검색 API, 다이소몰 상품 검색, 오늘의집 검색 화면,
// 번개장터 검색 API, 당근 중고거래 검색 화면을 같은 모양으로 읽는다. 응답 모양은 2026-10-28 실제 호출로 확인했다
// (tests/explore/fixtures). 컬리·다이소 칸 이름은 NomaDamas/k-skill(MIT) 패키지의 parse.js와 같다. 가격은 응답 값 그대로 쓴다.
// Deno(Edge Function)와 Node(Vitest)가 함께 불러 외부 라이브러리를 쓰지 않는다.
export type ShopSource = 'kurly' | 'daiso' | 'ohou' | 'bunjang' | 'daangn'
export const SHOP_SOURCES: ShopSource[] = ['kurly', 'daiso', 'ohou', 'bunjang', 'daangn']

export type ShopItem = {
  id: string
  name: string
  /** 지금 파는 값(할인가가 있으면 할인가). 없으면 null */
  price: number | null
  /** 할인 전 값(할인이 없으면 null) */
  listPrice: number | null
  discountRate: number | null
  soldOut: boolean
  url: string
  /** 응답에 있는 그대로(컬리는 "9,999+" 같은 글자로 온다) */
  reviews: string | null
  rating: number | null
  /** 배송 유형·픽업 여부·광고·예약 중 같은 짧은 표시 */
  tags: string[]
  /** 중고 매물(번개장터·당근): 거래 동네와 올린(끌어올린) 시각. 새 상품은 null */
  place?: string | null
  postedAt?: string | null
}

export class ShopSearchError extends Error {
  code: string
  constructor(code: string) {
    super(code)
    this.name = 'ShopSearchError'
    this.code = code
  }
}

export const SHOP_LABEL: Record<ShopSource, string> = { kurly: '마켓컬리', daiso: '다이소', ohou: '오늘의집', bunjang: '번개장터', daangn: '당근' }

/** 당근 동네(지역 검색 API의 한 줄) */
export type DaangnRegion = { id: string; name: string; fullName: string }

/** 당근이 아닌 출처의 검색 주소. 당근은 동네를 먼저 찾아야 해서 daangnRegionUrl → daangnSearchUrl */
export function shopSearchUrl(source: Exclude<ShopSource, 'daangn'>, query: string): string {
  const q = encodeURIComponent(query)
  if (source === 'kurly') return `https://api.kurly.com/search/v4/sites/market/normal-search?keyword=${q}&page=1`
  if (source === 'ohou') return `https://ohou.se/search/index?query=${q}`
  if (source === 'bunjang') return `https://api.bunjang.co.kr/api/search/v8/pw/product/specs/keyword?q=${q}`
  // 다이소몰은 검색어를 쿼리스트링 searchTerm으로 받는다(이름이 틀리면 400 대신 전체 목록을 준다: k-skill 원본 경고)
  return `https://www.daisomall.co.kr/ssn/search/SearchGoods?searchTerm=${q}&searchQuery=&pageNum=1&brndCd=&cntPerPage=20&userId=&newPdYn=&massOrPsblYn=&pkupOrPsblYn=&fdrmOrPsblYn=&quickOrPsblYn=&searchSort=&isCategory=1`
}

const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v.replace(/,/g, '')))) return Number(v.replace(/,/g, ''))
  return null
}
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null)

type KurlyRaw = {
  no?: number | string; name?: string; salesPrice?: number; discountedPrice?: number | null; discountRate?: number | null
  isSoldOut?: boolean; reviewCount?: string | number; deliveryTypeNames?: string[]; adInfo?: unknown
}

function readKurly(body: unknown): ShopItem[] {
  const sections = (body as { data?: { listSections?: { data?: { items?: KurlyRaw[] } }[] } })?.data?.listSections
  if (!Array.isArray(sections)) throw new ShopSearchError('parse_failed')
  const items = sections.flatMap((s) => (Array.isArray(s?.data?.items) ? s.data.items : []))
  return items.flatMap((i) => {
    const id = text(i.no)
    if (!id || !/^\d+$/.test(id) || !i.name) return []
    const sales = num(i.salesPrice)
    const disc = num(i.discountedPrice)
    const discounted = disc !== null && sales !== null && disc < sales
    return [{
      id,
      name: i.name,
      price: discounted ? disc : sales,
      listPrice: discounted ? sales : null,
      discountRate: discounted ? num(i.discountRate) : null,
      soldOut: i.isSoldOut === true,
      url: `https://www.kurly.com/goods/${id}`,
      reviews: text(i.reviewCount),
      rating: null,
      tags: [...(i.adInfo ? ['광고'] : []), ...(Array.isArray(i.deliveryTypeNames) ? i.deliveryTypeNames.filter((t) => typeof t === 'string' && t) : [])],
    }]
  })
}

type DaisoRaw = { pdNo?: string; pdNm?: string; exhPdNm?: string; pdPrc?: string | number; avgStscVal?: string; revwCnt?: string; pkupOrPsblYn?: string; pdsOrPsblYn?: string; soldOutYn?: string }

function readDaiso(body: unknown): ShopItem[] {
  const results = (body as { resultSet?: { result?: { resultDocuments?: DaisoRaw[] }[] } })?.resultSet?.result
  if (!Array.isArray(results)) throw new ShopSearchError('parse_failed')
  // 결과 묶음 중 상품 문서가 있는 첫 묶음(첫 묶음은 비어 있을 때가 있다)
  const docs = results.find((r) => Array.isArray(r?.resultDocuments) && r.resultDocuments.length > 0)?.resultDocuments ?? []
  return docs.flatMap((d) => {
    const id = text(d.pdNo)
    const name = text(d.exhPdNm) ?? text(d.pdNm)
    if (!id || !/^[0-9A-Za-z]{1,30}$/.test(id) || !name) return []
    const price = num(d.pdPrc)
    const reviews = num(d.revwCnt)
    return [{
      id,
      name,
      price: price !== null && price > 0 ? price : null,
      listPrice: null,
      discountRate: null,
      soldOut: d.soldOutYn === 'Y',
      url: `https://www.daisomall.co.kr/pd/pdr/SCR_PDR_0001?pdNo=${encodeURIComponent(id)}`,
      reviews: reviews !== null && reviews > 0 ? reviews.toLocaleString('ko-KR') : null,
      rating: reviews ? num(d.avgStscVal) : null,
      tags: [...(d.pkupOrPsblYn === 'Y' ? ['매장 픽업'] : []), ...(d.pdsOrPsblYn === 'Y' ? ['택배'] : [])],
    }]
  })
}

/**
 * 오늘의집 검색 화면은 React Router가 화면 데이터를 turbo-stream(납작한 배열: 값은 자기 칸에 두고, 객체는 {"_<키 칸>": <값 칸>},
 * 배열은 값 칸 번호, 음수는 null·undefined 같은 특수값)으로 HTML에 넣어 보낸다. 그 배열을 풀어 상품 카드(type Production·Deal, price.sellingPrice)를 찾는다.
 */
export function decodeTurboStream(html: string): unknown {
  const chunks = [...html.matchAll(/streamController\.enqueue\(("(?:[^"\\]|\\.)*")\);/g)].map((m) => JSON.parse(m[1]) as string)
  if (chunks.length === 0) throw new ShopSearchError('parse_failed')
  const first = chunks.join('').split('\n').find((l) => l.trim())
  let arr: unknown[]
  try {
    arr = JSON.parse(first ?? '')
  } catch {
    throw new ShopSearchError('parse_failed')
  }
  if (!Array.isArray(arr)) throw new ShopSearchError('parse_failed')
  const memo = new Map<number, unknown>()
  const dec = (i: unknown): unknown => {
    if (typeof i !== 'number') return null
    if (i < 0) return i === -4 ? 0 : null // -4 = -0, 그 밖의 음수(null·undefined·NaN·무한대·빈칸)는 null
    if (memo.has(i)) return memo.get(i)
    const v = arr[i]
    if (Array.isArray(v)) {
      if (typeof v[0] === 'string') return null // 날짜·Promise 같은 특수값은 쓰지 않는다
      const out: unknown[] = []
      memo.set(i, out)
      for (const x of v) out.push(dec(x))
      return out
    }
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {}
      memo.set(i, out)
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        const key = k.startsWith('_') ? arr[Number(k.slice(1))] : k
        if (typeof key === 'string') out[key] = dec(x)
      }
      return out
    }
    return v
  }
  return dec(0)
}

type OhouCard = {
  id?: string; type?: string; name?: string; isSoldOut?: boolean; brand?: { name?: string }
  price?: { sellingPrice?: string; originalPrice?: string | null; discountRate?: string | null }
  badgeProperties?: { isFreeDelivery?: boolean; isSpecialPrice?: boolean; isSelling?: boolean; isDiscontinued?: boolean }
  reviewStatistic?: { reviewCount?: number; reviewAverage?: number }
  link?: { landingUrl?: string }
}

function readOhou(html: string): ShopItem[] {
  const root = decodeTurboStream(html)
  const cards: OhouCard[] = []
  const seen = new Set<unknown>()
  const walk = (o: unknown) => {
    if (!o || typeof o !== 'object' || seen.has(o)) return
    seen.add(o)
    if (Array.isArray(o)) return o.forEach(walk)
    const c = o as OhouCard
    if ((c.type === 'Production' || c.type === 'Deal') && c.price?.sellingPrice !== undefined && c.link?.landingUrl) cards.push(c)
    else Object.values(o).forEach(walk)
  }
  walk(root)
  const ids = new Set<string>()
  return cards.flatMap((c) => {
    const id = text(c.id)
    const url = c.link?.landingUrl ?? ''
    if (!id || ids.has(id) || !c.name || !/^https:\/\/(store\.)?ohou\.se\//.test(url)) return []
    ids.add(id)
    const price = num(c.price?.sellingPrice)
    const list = num(c.price?.originalPrice)
    const discounted = list !== null && price !== null && list > price
    const reviews = num(c.reviewStatistic?.reviewCount)
    const b = c.badgeProperties ?? {}
    return [{
      id,
      name: c.name,
      price,
      listPrice: discounted ? list : null,
      discountRate: discounted ? num(c.price?.discountRate) : null,
      soldOut: c.isSoldOut === true || b.isDiscontinued === true || b.isSelling === false,
      url,
      reviews: reviews ? reviews.toLocaleString('ko-KR') : null,
      rating: reviews ? num(c.reviewStatistic?.reviewAverage) : null,
      tags: [...(c.brand?.name ? [c.brand.name] : []), ...(b.isSpecialPrice ? ['특가'] : []), ...(b.isFreeDelivery ? ['무료배송'] : [])],
    }]
  })
}

type BunjangRaw = { pid?: number | string; name?: string; price?: number | string; status?: string; updatedAt?: string; ad?: boolean; type?: string }
const BUNJANG_STATUS: Record<string, string> = { RESERVED: '예약 중', SOLD_OUT: '판매 완료', SOLD: '판매 완료' }

function readBunjang(body: unknown): ShopItem[] {
  const blocks = (body as { data?: { searchSpec?: { uiBlockList?: { blockType?: string; searchResponse?: { data?: BunjangRaw[] } }[] } } })?.data?.searchSpec?.uiBlockList
  if (!Array.isArray(blocks)) throw new ShopSearchError('parse_failed')
  // 본 목록(productList.grid.main) 블록의 상품. 추천 묶음은 쓰지 않는다
  const main = blocks.find((b) => b?.blockType === 'productList.grid.main')?.searchResponse?.data ?? []
  return main.flatMap((x) => {
    const id = text(x.pid)
    if (!id || !/^\d+$/.test(id) || !x.name || (x.type && x.type !== 'PRODUCT')) return []
    const price = num(x.price)
    const status = BUNJANG_STATUS[x.status ?? '']
    return [{
      id,
      name: x.name,
      price: price !== null && price > 0 ? price : null,
      listPrice: null,
      discountRate: null,
      soldOut: status === '판매 완료',
      url: `https://m.bunjang.co.kr/products/${id}`,
      reviews: null,
      rating: null,
      tags: [...(x.ad ? ['광고'] : []), ...(status && status !== '판매 완료' ? [status] : [])],
      place: null,
      postedAt: text(x.updatedAt),
    }]
  })
}

export function daangnRegionUrl(name: string): string {
  return `https://www.daangn.com/kr/api/v1/regions/keyword?keyword=${encodeURIComponent(name)}`
}

/** 동네 이름이 같은 첫 후보(없으면 첫 후보). 응답 모양이 다르거나 후보가 없으면 오류 */
export function parseDaangnRegion(bodyText: string, name: string): DaangnRegion {
  let body: { locations?: { id?: number | string; name?: string; name1?: string; name2?: string; name3?: string }[] }
  try {
    body = JSON.parse(bodyText)
  } catch {
    throw new ShopSearchError('parse_failed')
  }
  const locs = Array.isArray(body?.locations) ? body.locations : []
  const pick = locs.find((l) => l.name === name || l.name3 === name) ?? locs[0]
  const id = text(pick?.id)
  if (!pick || !id || !/^\d+$/.test(id) || !pick.name) throw new ShopSearchError('no_region')
  return { id, name: pick.name, fullName: [pick.name1, pick.name2, pick.name3 ?? pick.name].filter(Boolean).join(' ') }
}

export function daangnSearchUrl(region: DaangnRegion, query: string): string {
  return `https://www.daangn.com/kr/buy-sell/?in=${encodeURIComponent(`${region.name}-${region.id}`)}&search=${encodeURIComponent(query)}&only_on_sale=true`
}

type DaangnRaw = { href?: string; title?: string; price?: string | number; status?: string; createdAt?: string; boostedAt?: string; region?: { name?: string } }

/** 당근 검색 화면의 __remixContext(검색 경로 loaderData의 buySellArticles) → 매물 줄. 판매 중만(only_on_sale) 오고 예약 중은 표시 */
function readDaangn(html: string): ShopItem[] {
  const m = html.match(/window\.__remixContext = (\{[\s\S]*?\});<\/script>/)
  if (!m) throw new ShopSearchError('parse_failed')
  let ctx: { state?: { loaderData?: Record<string, { buySellArticles?: DaangnRaw[] } | null> } }
  try {
    ctx = JSON.parse(m[1])
  } catch {
    throw new ShopSearchError('parse_failed')
  }
  const route = Object.entries(ctx.state?.loaderData ?? {}).find(([k, v]) => k.includes('buy-sell') && Array.isArray(v?.buySellArticles))?.[1]
  if (!route?.buySellArticles) throw new ShopSearchError('parse_failed')
  return route.buySellArticles.flatMap((a) => {
    const href = a.href ?? ''
    const url = href.startsWith('/') ? `https://www.daangn.com${href}` : href
    const id = url.match(/-([0-9a-z]+)\/?$/)?.[1]
    if (!id || !a.title || !/^https:\/\/www\.daangn\.com\/kr\/buy-sell\//.test(url)) return []
    const price = num(a.price)
    return [{
      id,
      name: a.title,
      price: price !== null && price > 0 ? price : null,
      listPrice: null,
      discountRate: null,
      soldOut: a.status === 'Closed',
      url,
      reviews: null,
      rating: null,
      tags: [...(price === 0 ? ['나눔'] : []), ...(a.status === 'Reserved' ? ['예약 중'] : [])],
      place: text(a.region?.name),
      postedAt: text(a.boostedAt) ?? text(a.createdAt),
    }]
  })
}

/** 응답 본문 → 상품 줄. 모양이 다르면 ShopSearchError('parse_failed') */
export function parseShopSearch(source: ShopSource, bodyText: string): ShopItem[] {
  if (source === 'ohou') return readOhou(bodyText)
  if (source === 'daangn') return readDaangn(bodyText)
  let body: unknown
  try {
    body = JSON.parse(bodyText)
  } catch {
    throw new ShopSearchError('parse_failed')
  }
  return source === 'kurly' ? readKurly(body) : source === 'daiso' ? readDaiso(body) : readBunjang(body)
}
