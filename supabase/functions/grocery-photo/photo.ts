// 사진으로 상품 찾기·캡처로 가격 넣기(P4, D-009)의 공용 부분: 요청 검사, 프롬프트, 응답 다듬기.
// Deno(Edge Function)와 Node(vitest) 양쪽에서 쓰므로 런타임 전용 API를 쓰지 않는다. 읽은 값은 화면에서 사람이 확인·고친 뒤에만 쓴다.
import { z } from 'zod'

export const MAX_IMAGE_BASE64_CHARS = 8_000_000 // 약 6MB
export const IMAGE_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export type MediaType = (typeof IMAGE_MEDIA_TYPES)[number]
export type PhotoJob = 'product' | 'price' | 'list'
export type PhotoImage = { media_type: MediaType; data: string; width: number; height: number }
export type PhotoInput = { job: PhotoJob; image: PhotoImage }

const MAX_TEXT = 60
const MAX_WON = 10_000_000_000

export function parsePhotoInput(body: unknown): PhotoInput | string {
  if (!body || typeof body !== 'object') return '요청 형식이 잘못됐어요.'
  const b = body as Record<string, unknown>
  if (b.job !== 'product' && b.job !== 'price' && b.job !== 'list') return '무엇을 읽을지(job)가 잘못됐어요.'
  const img = b.image as Record<string, unknown> | undefined
  if (!img || typeof img !== 'object') return '사진이 없어요.'
  if (typeof img.data !== 'string' || !IMAGE_MEDIA_TYPES.includes(img.media_type as MediaType)) return '사진 형식이 잘못됐어요.'
  if (img.data.length > MAX_IMAGE_BASE64_CHARS) return '사진이 너무 커요.'
  return {
    job: b.job,
    image: { media_type: img.media_type as MediaType, data: img.data, width: Number(img.width) || 0, height: Number(img.height) || 0 },
  }
}

export const ProductSchema = z.object({
  name: z.string().nullable().describe('포장에 적힌 상품 이름(브랜드 제외). 보이지 않으면 null'),
  brand: z.string().nullable().describe('브랜드·제조사 이름. 보이지 않으면 null'),
  size: z.string().nullable().describe('용량·개수 표기 그대로(예: "1.05kg", "120g×5"). 보이지 않으면 null'),
  note: z.string().nullable().describe('읽기 어려웠던 부분 등 사용자에게 알릴 말. 없으면 null'),
})
export type ProductRead = z.infer<typeof ProductSchema>

export const PriceSchema = z.object({
  seller: z.string().nullable().describe('판매처(쇼핑몰·앱·매장) 이름. 화면의 로고·앱 이름·배송 표시로 판단. 모르면 null'),
  name: z.string().nullable().describe('상품명(옵션은 짧게 덧붙임). 보이지 않으면 null'),
  price: z.number().nullable().describe('화면에 적힌 판매 가격(원, 정수). 할인 뒤 실제 판매가. 보이지 않으면 null'),
  qty: z.number().nullable().describe('그 가격이 몇 개 묶음인지(1개·2개…). 표시가 없으면 1'),
  size: z.string().nullable().describe('용량·개수 표기 그대로. 보이지 않으면 null'),
  delivery: z.number().nullable().describe('배송비(원, 정수). 무료배송·로켓배송·새벽배송 등 무료면 0. 표시가 없으면 null'),
  note: z.string().nullable().describe('읽기 어려웠던 부분 등 사용자에게 알릴 말. 없으면 null'),
})
export type PriceRead = z.infer<typeof PriceSchema>

export const PRODUCT_PROMPT = `당신은 식료품 포장 사진을 읽어 상품을 찾는 일을 돕습니다. 사진은 상품 포장의 앞면(또는 한 면)입니다.
주어진 JSON 형식으로만 답합니다.

규칙:
- 포장에 실제로 적힌 글자만 씁니다. 읽히지 않거나 가려진 글자는 추측하지 말고 null로 둡니다.
- name은 상품 이름(브랜드는 brand에 따로), size는 용량·개수 표기를 적힌 그대로 씁니다(예: "1.05kg", "120g×5").
- 여러 상품이 보이면 가장 크게·가운데에 보이는 하나만 읽고 note에 다른 상품이 있다고 적습니다.
- 사진이 포장이 아니거나(사람, 풍경 등) 상품을 알 수 없으면 모두 null로 두고 note에 이유를 적습니다.`

export const PRICE_PROMPT = `당신은 쇼핑몰 화면 캡처나 매장 가격표 사진에서 가격을 읽어 가격 비교를 돕습니다. 주어진 JSON 형식으로만 답합니다.

규칙:
- 화면·가격표에 실제로 적힌 값만 씁니다. 읽히지 않거나 가려진 값은 추측하지 말고 null로 둡니다. 숫자는 쉼표와 "원"을 뺀 정수입니다.
- seller는 판매처(쇼핑몰·앱·매장) 이름입니다. 로고·앱 이름·메뉴 문구·배송 표시(로켓배송, 샛별배송 등)로 판단하고, 모르면 null입니다.
  이름은 다음 중 하나로 씁니다: 쿠팡, 네이버, 컬리, 홈플러스, 이마트, SSG닷컴, 롯데ON, 롯데마트, G마켓, 옥션, 11번가, 오늘의집, 알리익스프레스, 테무, 당근. 목록에 없으면 보이는 이름 그대로.
- price는 그 상품의 판매 가격(할인 뒤 실제 판매가)입니다. "정가", "적립", "최대 할인" 같은 다른 숫자는 쓰지 않습니다. 여러 상품이 보이면 가장 크게·가운데에 보이는 하나만 읽고 note에 적습니다.
- qty는 그 가격이 몇 개 묶음인지입니다("2개", "×3" 같은 표시). 표시가 없으면 1입니다.
- delivery는 배송비입니다. 무료배송·로켓배송·새벽배송처럼 무료면 0, 표시가 없으면 null입니다.
- size는 상품명·옵션에 적힌 용량·개수 표기를 그대로 씁니다.`

export const ListSchema = z.object({
  items: z.array(
    z.object({
      name: z.string().describe('살 것의 이름(브랜드·용량은 빼고). 읽히지 않으면 넣지 않는다'),
      spec: z.string().nullable().describe('용량·규격 표기 그대로(예: "600g", "1L"). 없으면 null'),
      count: z.number().nullable().describe('개수. 적혀 있지 않으면 null'),
    }),
  ),
  note: z.string().nullable().describe('읽기 어려웠던 부분 등 사용자에게 알릴 말. 없으면 null'),
})
export type ListRead = z.infer<typeof ListSchema>
export type ListItem = { name: string; spec: string | null; count: number }

export const LIST_PROMPT = `당신은 장보기 메모·냉장고 사진·영수증에서 살 것 목록을 뽑는 일을 돕습니다. 주어진 JSON 형식으로만 답합니다.

규칙:
- 사진에 실제로 적혀 있거나 보이는 것만 씁니다. 읽히지 않거나 가려진 글자는 추측하지 말고 빼고, note에 적습니다.
- 메모라면 적힌 줄마다 하나, 영수증이라면 상품 줄마다 하나입니다. 가격·합계·할인 줄은 넣지 않습니다.
- 냉장고 사진이라면 보이는 식재료 이름만 씁니다(상표가 보이면 그 이름). 확실하지 않은 것은 넣지 않습니다.
- name은 짧은 이름(브랜드·용량은 빼고), spec은 용량 표기 그대로, count는 적힌 개수(없으면 null)입니다.
- 같은 것이 두 번 보이면 한 번만 넣습니다.`

const text = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const t = v.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT)
  return t === '' ? null : t
}
const posInt = (v: unknown): number | null => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  const n = Math.round(v)
  return n > 0 && n < MAX_WON ? n : null
}
const nonNegInt = (v: unknown): number | null => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  const n = Math.round(v)
  return n >= 0 && n < MAX_WON ? n : null
}

/** 모델이 읽은 포장 정보를 다듬는다: 앞뒤 공백·60자, 빈 글자는 null */
export function checkProduct(r: ProductRead): ProductRead {
  return { name: text(r.name), brand: text(r.brand), size: text(r.size), note: text(r.note) }
}

/** 다나와 검색어: 브랜드 + 이름 + 용량. 이름에 이미 든 말은 다시 붙이지 않는다. */
export function productQuery(r: ProductRead): string {
  const parts: string[] = []
  const has = (s: string) => parts.some((p) => p.includes(s)) || (r.name ?? '').includes(s)
  if (r.brand && !has(r.brand)) parts.push(r.brand)
  if (r.name) parts.push(r.name)
  if (r.size && !has(r.size)) parts.push(r.size)
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

/** 모델이 읽은 가격 정보를 다듬는다: 가격·배송비는 정수(0·음수·터무니없는 값은 null), 수량은 1~99(아니면 1) */
export function checkPrice(r: PriceRead): PriceRead & { qty: number } {
  const qty = typeof r.qty === 'number' && Number.isInteger(r.qty) && r.qty >= 1 && r.qty <= 99 ? r.qty : 1
  return { seller: text(r.seller), name: text(r.name), price: posInt(r.price), qty, size: text(r.size), delivery: nonNegInt(r.delivery), note: text(r.note) }
}

const MAX_LIST = 40

/** 모델이 읽은 목록을 다듬는다: 빈 이름·같은 이름은 빼고, 수량은 1~99(없거나 틀리면 1), 40개까지 */
export function checkList(r: ListRead): { items: ListItem[]; note: string | null } {
  const seen = new Set<string>()
  const items: ListItem[] = []
  for (const it of r.items ?? []) {
    const name = text(it.name)
    if (!name) continue
    const key = name.toLowerCase().replace(/\s+/g, '')
    if (seen.has(key)) continue
    seen.add(key)
    const count = typeof it.count === 'number' && Number.isInteger(it.count) && it.count >= 1 && it.count <= 99 ? it.count : 1
    items.push({ name, spec: text(it.spec), count })
    if (items.length >= MAX_LIST) break
  }
  return { items, note: text(r.note) }
}

/** 담기 시트의 글로: 한 줄에 하나, "이름 규격 N개"(담기 시트의 나누기 규칙과 맞춤) */
export function listText(items: ListItem[]): string {
  return items.map((it) => [it.name, it.spec, it.count > 1 ? `${it.count}개` : null].filter(Boolean).join(' ')).join('\n')
}

export function buildUserText(job: PhotoJob, image: PhotoImage): string {
  const size = image.width && image.height ? ` (${image.width}×${image.height} 픽셀)` : ''
  if (job === 'product') return `위 이미지는 사용자가 찍은 식료품 포장 사진입니다${size}. 상품 이름·브랜드·용량을 읽어 주세요.`
  if (job === 'list') return `위 이미지는 사용자가 올린 장보기 메모·냉장고·영수증 사진입니다${size}. 살 것 목록을 뽑아 주세요.`
  return `위 이미지는 사용자가 올린 쇼핑몰 화면 캡처 또는 매장 가격표 사진입니다${size}. 판매처·상품명·가격·수량·용량·배송비를 읽어 주세요.`
}
