// 알아보기 가격 비교의 몰 검색(D-036): 마켓컬리 앱 검색 API와 다이소몰 상품 검색 응답을 같은 모양으로 읽는다.
// 응답 모양은 2026-10-28 실제 호출로 확인했다(tests/explore/fixtures). 칸 이름은 NomaDamas/k-skill(MIT)
// market-kurly-search·daiso-product-search 패키지의 parse.js와 같다. 가격은 응답 값 그대로 쓰고 지어내지 않는다.
// Deno(Edge Function)와 Node(Vitest)가 함께 불러 외부 라이브러리를 쓰지 않는다.
export type ShopSource = 'kurly' | 'daiso'

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
  /** 배송 유형·픽업 여부·광고 같은 짧은 표시 */
  tags: string[]
}

export class ShopSearchError extends Error {
  code: string
  constructor(code: string) {
    super(code)
    this.name = 'ShopSearchError'
    this.code = code
  }
}

export const SHOP_LABEL: Record<ShopSource, string> = { kurly: '마켓컬리', daiso: '다이소' }

export function shopSearchUrl(source: ShopSource, query: string): string {
  const q = encodeURIComponent(query)
  if (source === 'kurly') return `https://api.kurly.com/search/v4/sites/market/normal-search?keyword=${q}&page=1`
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

/** 응답 본문(JSON 글자) → 상품 줄. 모양이 다르면 ShopSearchError('parse_failed') */
export function parseShopSearch(source: ShopSource, bodyText: string): ShopItem[] {
  let body: unknown
  try {
    body = JSON.parse(bodyText)
  } catch {
    throw new ShopSearchError('parse_failed')
  }
  return source === 'kurly' ? readKurly(body) : readDaiso(body)
}
