// 알아보기 탭(D-035): 날씨·미세먼지와 다나와 가격 비교를 서버 함수(explore-weather·explore-price)로 받는다.
// 숫자는 응답 값 그대로 쓰고 출처·기준 시각을 함께 보인다. 위치는 기기마다 고르고(localPrefs) 소수 둘째 자리(약 1km)로 줄여 보낸다.
// (앱에 다른 뜻의 lib/lookup.ts가 있어 이 기능의 이름은 explore로 쓴다)
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AirPart, WeatherPart } from '../../supabase/functions/explore-weather/handle'
import type { ExploreItem, Quote, ShopItem, ShopSource } from '../../supabase/functions/explore-price/handle'
import { lsGet, lsSet } from './localPrefs'

export type { AirPart, ExploreItem, Quote, ShopItem, ShopSource, WeatherPart }

export type Place = { lat: number; lng: number; kind: 'default' | 'here' }
/** 기본 위치: 성남시청 근처(장보기의 참가격·시세 지역과 같은 성남) */
export const DEFAULT_PLACE: Place = { lat: 37.42, lng: 127.13, kind: 'default' }
const PLACE_KEY = 'ab:explorePlace'

export const round2 = (v: number) => Math.round(v * 100) / 100

export function loadPlace(): Place {
  try {
    const v = JSON.parse(lsGet(PLACE_KEY) ?? 'null') as Partial<Place> | null
    if (v && typeof v.lat === 'number' && typeof v.lng === 'number' && v.kind === 'here') return { lat: round2(v.lat), lng: round2(v.lng), kind: 'here' }
  } catch { /* 깨진 값이면 기본 위치 */ }
  return DEFAULT_PLACE
}

export function savePlace(p: Place) {
  lsSet(PLACE_KEY, JSON.stringify({ lat: round2(p.lat), lng: round2(p.lng), kind: p.kind }))
}

export type WeatherResult = { lat: number; lng: number; weather: WeatherPart; air: AirPart }

export async function fetchWeather(client: SupabaseClient, place: Place): Promise<WeatherResult> {
  const { data, error } = await client.functions.invoke<WeatherResult>('explore-weather', { body: { lat: round2(place.lat), lng: round2(place.lng) } })
  if (error || !data) throw error ?? new Error('no_data')
  return data
}

export type SearchResult =
  | { status: 'done' | 'cached' | 'none'; query: string; foundAt: string; items: ExploreItem[] }
  | { status: 'busy' }

export async function searchPrices(client: SupabaseClient, query: string): Promise<SearchResult> {
  const { data, error } = await client.functions.invoke<SearchResult>('explore-price', { body: { query } })
  if (error || !data) throw error ?? new Error('no_data')
  return data
}

export type ShopResult =
  | { status: 'done' | 'cached' | 'none'; source: ShopSource; query: string; foundAt: string; items: ShopItem[] }
  | { status: 'busy'; source: ShopSource }

/** 마켓컬리·다이소 검색(D-036). 다나와와 같은 함수에 출처를 붙여 부른다 */
export async function searchShop(client: SupabaseClient, source: ShopSource, query: string): Promise<ShopResult> {
  const { data, error } = await client.functions.invoke<ShopResult>('explore-price', { body: { query, source } })
  if (error || !data) throw error ?? new Error('no_data')
  return data
}

export type ProductPrices = {
  status: 'done' | 'cached'
  product: { pcode: string; name: string; rating: number | null; reviewCount: number | null; ratedAt: string | null }
  checkedAt: string
  pageQty: number | null
  variants: Quote[]
  offers: Quote[]
}

/** 검색 결과에서 고른 상품의 쇼핑몰별 가격. 이름은 서버가 저장한 검색 결과에서 가져온다(앱이 보내지 않는다) */
export async function productPrices(client: SupabaseClient, pcode: string): Promise<ProductPrices> {
  const { data, error } = await client.functions.invoke<ProductPrices>('explore-price', { body: { pcode } })
  if (error || !data) throw error ?? new Error('no_data')
  return data
}

// ---- 글자 만들기 ----

const kst = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600_000)
const kstDay = (d: Date) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10)
const hm = (k: Date) => `${String(k.getUTCHours()).padStart(2, '0')}:${String(k.getUTCMinutes()).padStart(2, '0')}`

/** "오늘 11:40", 다른 날이면 "10월 27일 11:40"(한국 시각) */
export function whenText(iso: string, now: Date = new Date()): string {
  const k = kst(iso)
  return kstDay(new Date(iso)) === kstDay(now) ? `오늘 ${hm(k)}` : `${k.getUTCMonth() + 1}월 ${k.getUTCDate()}일 ${hm(k)}`
}

/** 예보 날짜 이름: 오늘·내일, 그 밖은 "10월 30일" */
export function dayName(date: string, now: Date = new Date()): string {
  const today = kstDay(now)
  const tomorrow = kstDay(new Date(now.getTime() + 24 * 3600_000))
  if (date === today) return '오늘'
  if (date === tomorrow) return '내일'
  return `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일`
}

export const won = (n: number) => `${n.toLocaleString('ko-KR')}원`
export const degree = (n: number | null) => (n === null ? '확인 못 함' : `${Number.isInteger(n) ? n : n.toFixed(1)}°`)

/** 실패 상태 → 사람이 읽는 말(무엇을 받지 못했는지 그대로) */
export function failText(part: 'weather' | 'air', status: string): string {
  const what = part === 'weather' ? '기상청 예보' : '에어코리아 미세먼지'
  if (status === 'not_registered') return `${what}는 공공데이터포털 활용신청 뒤에 보여요`
  if (status === 'not_configured') return `${what}를 받을 키가 서버에 없어요`
  return `${what}를 받지 못했어요`
}

/** 배송비까지 더한 합계. 배송비를 모르면(null) 합계도 모른다 */
export const offerTotal = (q: Quote) => (q.delivery === null ? null : q.price + q.delivery)

/** 합계(모르면 상품가) 오름차순 */
export function sortOffers(offers: Quote[]): Quote[] {
  return [...offers].sort((a, b) => (offerTotal(a) ?? a.price) - (offerTotal(b) ?? b.price) || a.price - b.price)
}

/** 상품 줄의 가격 요약: "1개 10,380원 · 100g당 989원 · 판매처 33곳" */
export function variantText(v: { qty: number; price: number; unitPrice: number | null; unitLabel: string | null; mallCount: number | null }): string {
  const parts = [`${v.qty}개 ${won(v.price)}`]
  if (v.unitPrice !== null && v.unitLabel) parts.push(`${v.unitLabel}당 ${won(v.unitPrice)}`)
  if (v.mallCount !== null) parts.push(`판매처 ${v.mallCount}곳`)
  return parts.join(' · ')
}
