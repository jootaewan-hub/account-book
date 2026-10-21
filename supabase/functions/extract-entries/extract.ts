// 문자·알림톡·영수증 사진에서 가계부 내역을 뽑기 위한 공용 로직.
// Deno(Edge Function)와 Node(vitest) 양쪽에서 쓰므로 런타임 전용 API를 쓰지 않는다.
import { z } from 'zod'

export const MAX_TEXT_CHARS = 6000
export const MAX_IMAGE_BASE64_CHARS = 8_000_000 // 약 6MB 이미지
export const MAX_TOTAL_IMAGE_CHARS = 14_000_000 // 한 번에 보내는 사진 합계
export const MAX_IMAGES = 5
export const IMAGE_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

export const BoxSchema = z.object({
  image: z.number().describe('몇 번째 이미지인지 (1부터)'),
  left: z.number(),
  top: z.number(),
  right: z.number(),
  bottom: z.number(),
})

export const ItemSchema = z.object({
  name: z.string().describe('상품명 (옵션은 짧게 덧붙임)'),
  is_product: z.boolean().describe('상품이면 true, 배송비·할인·쿠폰·적립금 사용 줄이면 false'),
  quantity: z.number().describe('주문 수량'),
  unit_price: z.number().nullable().describe('상품 1개(수량 1) 가격. 화면에 1개 가격이 따로 없으면 amount ÷ quantity'),
  amount: z.number().describe('이 줄의 금액 (수량을 모두 합친 금액)'),
  pack_size: z.number().nullable().describe('상품 1개(수량 1)에 든 총량. 예: 100매×10팩 → 1000. 모르면 null'),
  pack_unit: z.string().nullable().describe('pack_size의 단위: g, ml, 또는 개·매·구·롤·입·병·캔·봉·장·정·포 같은 셈 단위. 모르면 null'),
  category: z.string().nullable().describe('이 상품의 분류 (주어진 분류 목록 중 하나). 배송비·할인이거나 애매하면 null'),
  image_box: BoxSchema.nullable().describe('이 상품의 사진(썸네일) 위치, 이미지 픽셀 좌표. 상품 사진이 없으면 null'),
})

/** 주유소 영수증에서 읽는 값 (설계 2026-10-21 fuel-and-grocery-compare 3-1). 보이지 않는 값은 null */
export const FuelSchema = z.object({
  liters: z.number().nullable().describe('주유량(리터, 소수 셋째 자리까지). 보이지 않으면 null'),
  price_per_liter: z.number().nullable().describe('리터당 단가(원). 보이지 않으면 null'),
  fuel_type: z.string().nullable().describe('유종: 휘발유·경유·고급휘발유·LPG 등 영수증 표기 그대로. 보이지 않으면 null'),
})

export const EntrySchema = z.object({
  date: z.string().nullable().describe('YYYY-MM-DD. 알 수 없으면 null'),
  time: z.string().nullable().describe('HH:MM 24시간. 알 수 없으면 null'),
  merchant: z.string().describe('가맹점·판매자·가게 이름. 알 수 없으면 빈 문자열'),
  platform: z.string().nullable().describe('주문·결제한 온라인 플랫폼(쇼핑몰·배달앱) 이름. 매장 결제·영수증이면 null'),
  amount: z.number().describe('실제 결제(또는 입금)된 총액, 원 단위 정수'),
  is_income: z.boolean().describe('입금·급여·환급처럼 들어온 돈이면 true, 쓴 돈이면 false'),
  is_cancellation: z.boolean().describe('승인 취소·환불 문자이면 true'),
  card_last4: z.string().nullable().describe('카드·계좌 끝 4자리. 가려진 자리는 *로 (예: 1*3*). 없으면 null'),
  payment_hint: z.string().nullable().describe('카드사·간편결제 이름 등. 없으면 null'),
  installment_months: z.number().nullable().describe('할부 개월 수 (예: "03개월", "3개월 할부" → 3). 일시불이거나 보이지 않으면 null'),
  category: z.string().nullable().describe('주어진 분류 목록 중 하나. 애매하면 null'),
  items: z.array(ItemSchema).describe('영수증·주문내역의 품목. 품목이 없으면 빈 배열'),
  fuel: FuelSchema.nullable().describe('주유소 영수증이면 유종·주유량·리터당 단가. 주유가 아니면 null'),
})

export const ResultSchema = z.object({
  entries: z.array(EntrySchema),
  note: z.string().nullable().describe('읽기 어려웠던 부분 등 사용자에게 알릴 말. 없으면 null'),
})

export type Entry = z.infer<typeof EntrySchema>
export type ExtractResult = z.infer<typeof ResultSchema>

export const SYSTEM_PROMPT = `당신은 한국 가정의 가계부 입력을 돕습니다. 사용자가 붙여넣은 카드 승인 문자·카카오톡 알림톡·은행 알림, 또는 종이 영수증 사진·쇼핑/배달 주문내역 캡처·카드앱 결제 화면 캡처에서 거래 내역을 뽑아 주어진 JSON 형식으로만 답합니다.

규칙:
- 거래 하나당 entries 항목 하나. 문자가 여러 건이면 각각 따로 만듭니다. 같은 결제가 두 번 보이면 한 번만 넣습니다.
- amount는 실제로 결제(또는 입금)된 총액입니다. 할인·포인트 사용 후 금액을 쓰고, "누적", "잔액", "한도", "포인트 적립" 금액은 쓰지 않습니다. 쉼표와 "원"을 뺀 정수입니다.
- 날짜에 연도가 없으면 기준일(오늘)을 보고 가장 가까운 과거 날짜로 연도를 정합니다. 날짜가 전혀 없으면 null입니다.
- "취소", "승인취소", "환불" 문자는 is_cancellation을 true로 합니다.
- 입금·급여·환급처럼 돈이 들어온 경우 is_income은 true, 나머지는 false입니다.
- card_last4는 카드·계좌 번호의 마지막 4자리입니다. "(1234)"는 1234, "(1*2*)"처럼 가려진 자리는 *로 그대로 둡니다. 4자리가 아니거나 확실하지 않으면 null입니다.
- payment_hint에는 문자·화면에 보이는 카드사·은행·간편결제 이름과 체크/신용 구분을 그대로 적습니다(예: "신한체크", "KB국민카드", "카카오페이").
- installment_months는 카드 결제가 할부일 때 할부 개월 수입니다("할부 3개월", "(03개월)", "3개월 무이자" → 3). "일시불"이거나 할부 표시가 없으면 null입니다. 할부여도 amount는 한 달 치가 아니라 결제(승인)된 총액입니다.
- category는 사용자가 준 분류 목록에 있는 이름만 씁니다. 애매하면 null입니다.
- items는 품목이 적힌 영수증·주문내역일 때만 채웁니다. 각 품목의 amount는 그 줄의 금액(수량을 모두 합친 금액)이고, unit_price는 1개 가격입니다. 할인 줄은 음수 amount 품목으로 넣습니다.
- 보이지 않거나 확실하지 않은 값은 지어내지 말고 null(문자열은 빈 문자열)로 둡니다.
- platform은 주문·결제한 온라인 플랫폼입니다. 화면의 로고·앱 이름·메뉴 문구·주문번호 형식·배송 표시(로켓배송, 샛별배송, 오늘출발 등)로 판단합니다.
  이름은 다음 중 하나로 씁니다: 쿠팡, 쿠팡이츠, 네이버(네이버페이·스마트스토어·네이버쇼핑), 오늘의집, 컬리(마켓컬리), 11번가, G마켓, 옥션, SSG닷컴, 무신사, 29CM, 에이블리, 지그재그, 알리익스프레스, 테무, 배달의민족, 요기요, 카카오 선물하기, 당근.
  목록에 없는 온라인 플랫폼이면 화면에 보이는 이름을 씁니다. 매장에서 결제한 영수증·카드 문자는 null입니다(카드 문자 가맹점이 "쿠팡"처럼 플랫폼이면 그 이름).
  여러 이미지가 서로 다른 플랫폼일 수 있습니다(예: 1번 쿠팡, 2번 네이버, 3번 컬리). 플랫폼은 그 주문이 보이는 이미지마다 따로 판단하고, 플랫폼이 다른 주문은 절대 합치지 않습니다.
- 쇼핑몰·배달앱 주문·결제 내역 화면이면:
  · 주문(결제) 한 건이 entries 하나입니다. 주문일·주문번호가 다르면 따로 만듭니다. 여러 이미지가 같은 주문을 이어서 찍은 것이면 하나로 합치고 같은 상품을 두 번 넣지 않습니다.
  · 한 상품은 entries 전체에서 한 번만 나옵니다. 주문 목록 화면과 주문 상세 화면을 함께 찍었더라도 같은 상품을 다른 entries에 또 넣지 않습니다.
  · merchant는 판매자·가게 이름이고, 보이지 않으면 플랫폼 이름입니다. date는 주문일 또는 결제일입니다.
  · items에는 상품마다 화면에 적힌 상품명(옵션은 짧게 덧붙임), 수량, 단가(1개 가격), 금액, 분류(category, 상품마다 따로)를 넣고 is_product를 true로 합니다. 배송비는 "배송비" 품목, 쿠폰·할인·적립금 사용은 음수 금액 품목으로 넣고 is_product를 false로 합니다.
  · 주문내역에서 수량 옆에 적힌 상품 가격은 그 수량을 모두 합친 금액입니다(예: "2개 71,800원" → amount 71,800, unit_price 35,900). 이 가격에 수량을 다시 곱하지 않습니다. "개당", "1개당", "단가"라고 적힌 가격만 1개 가격으로 봅니다.
  · 상품 금액, 배송비, 할인을 모두 더하면 최종 결제 금액과 같아야 합니다. 다르면 수량 옆 가격을 합계로 읽었는지 다시 확인합니다.
  · pack_size와 pack_unit은 상품명·옵션에 적힌 용량·개수로 상품 1개(수량 1)에 든 총량을 계산해 넣습니다. 여러 개 묶음이면 곱합니다(예: "100매 x 10팩" → 1000, 매 / "2L x 6병" → 12000, ml / "500g x 2개" → 1000, g / "30구" → 30, 구). kg은 g으로, L는 ml로 바꿉니다. 셈 단위는 가장 작은 소비 단위를 씁니다(팩·박스보다 매·개·구). 용량이 적혀 있지 않으면 null입니다.
  · 최종 결제 금액이 보이면 amount는 그 값이고, 안 보이면 품목 금액의 합입니다. 취소·반품된 상품은 넣지 않습니다.
- 영수증 품목도 is_product를 같은 기준으로 넣고, 용량이 품목명에 적혀 있으면 pack_size·pack_unit을 넣습니다.
- 영수증의 원단위 절사(끝전 버림)·끝전 할인·봉투값도 줄로 넣습니다. 절사·할인은 음수 금액이고 is_product는 false, 봉투는 상품(true)입니다. 상품 줄과 이 줄들을 모두 더하면 결제 금액과 같아야 합니다.
- 주유소(주유) 영수증이면 fuel에 유종(휘발유·경유·고급휘발유·LPG 등 영수증 표기 그대로), 주유량(리터, 소수 셋째 자리까지), 리터당 단가(원)를 적습니다. 단가 × 주유량이 결제 금액과 거의 같아야 합니다. 보이지 않는 값은 null이고, 주유 영수증의 items는 빈 배열입니다. 분류 목록에 '차량·주유'가 있으면 category는 그것입니다. 주유가 아니면 fuel은 null입니다.
- image_box는 그 상품의 사진(썸네일)이 있는 이미지 번호와 영역을 픽셀 좌표(왼쪽, 위, 오른쪽, 아래)로 넣습니다. 좌표는 각 이미지의 왼쪽 위가 (0,0)이고 크기는 사용자가 알려 준 값입니다. 상품 사진이 없거나 영수증이면 null입니다.
- 거래 내역이 없으면 entries를 빈 배열로 하고 note에 이유를 적습니다.`

export interface ImageSize {
  width: number
  height: number
}

export function buildUserText(opts: {
  kind: 'text' | 'image'
  today: string
  categories: string[]
  text?: string
  images?: ImageSize[]
  shop?: boolean
}): string {
  const lines = [
    `기준일(오늘): ${opts.today}`,
    `분류 목록: ${opts.categories.join(', ') || '(없음)'}`,
  ]
  if (opts.kind === 'text') {
    lines.push('', '아래는 사용자가 붙여넣은 내용입니다.', '<pasted>', opts.text ?? '', '</pasted>')
  } else {
    const imgs = opts.images ?? []
    lines.push('', opts.shop
      ? '위 이미지는 사용자가 올린 쇼핑몰 주문·결제 내역 캡처입니다. 이미지마다 쇼핑몰이 다를 수 있습니다. 상품마다 사진 위치(image_box)도 넣어 주세요.'
      : '위 이미지는 사용자가 올린 영수증·주문내역·결제 화면입니다.')
    imgs.forEach((im, i) => lines.push(`이미지 ${i + 1} 크기: ${im.width}×${im.height} 픽셀`))
  }
  return lines.join('\n')
}

export type Box = z.infer<typeof BoxSchema>

/** 모델이 준 상품 사진 영역을 이미지 안으로 맞추고, 말이 안 되는 영역은 버린다 */
export function checkBox(box: Box | null, images: ImageSize[]): Box | null {
  if (!box) return null
  const im = images[Math.round(box.image) - 1]
  if (!im) return null
  const nums = [box.left, box.top, box.right, box.bottom]
  if (!nums.every(Number.isFinite)) return null
  const left = Math.max(0, Math.min(box.left, box.right))
  const right = Math.min(im.width, Math.max(box.left, box.right))
  const top = Math.max(0, Math.min(box.top, box.bottom))
  const bottom = Math.min(im.height, Math.max(box.top, box.bottom))
  const w = right - left
  const h = bottom - top
  if (w < 16 || h < 16) return null
  if (w * h > im.width * im.height * 0.5) return null // 화면 절반 이상이면 상품 사진이 아니다
  return { image: Math.round(box.image), left: Math.round(left), top: Math.round(top), right: Math.round(right), bottom: Math.round(bottom) }
}

/** 용량을 g·ml·셈 단위로 맞춘다 (kg→g, L→ml). 말이 안 되면 둘 다 null */
export function checkPack(size: number | null, unit: string | null): { pack_size: number | null; pack_unit: string | null } {
  const none = { pack_size: null, pack_unit: null }
  if (size === null || unit === null || !Number.isFinite(size) || size <= 0) return none
  const u = unit.trim().replace(/\s+/g, '')
  const lower = u.toLowerCase()
  const metric: Record<string, [string, number]> = {
    g: ['g', 1], 그램: ['g', 1], kg: ['g', 1000], '㎏': ['g', 1000], 킬로그램: ['g', 1000],
    ml: ['ml', 1], '㎖': ['ml', 1], 밀리리터: ['ml', 1], l: ['ml', 1000], 'ℓ': ['ml', 1000], 리터: ['ml', 1000],
  }
  const m = metric[lower]
  if (m) return { pack_size: Math.round(size * m[1] * 1000) / 1000, pack_unit: m[0] }
  if (lower === 'ea' || lower === 'pcs') return { pack_size: size, pack_unit: '개' }
  if (/^[가-힣]{1,3}$/.test(u)) return { pack_size: size, pack_unit: u }
  return none
}

export type Fuel = z.infer<typeof FuelSchema>

/** 정리한 주유 값. 셋 다 영수증에 적힌 값만 쓰고, 빠진 값은 계산해 채우지 않는다(화면에서 적는다) */
export interface CheckedFuel {
  liters: number | null
  price_per_liter: number | null
  fuel_type: string | null
}

const MAX_LITERS = 500
const MAX_PRICE_PER_LITER = 100_000

/**
 * 모델이 읽은 주유 값을 정리한다. 리터는 0 초과 500 미만(소수 셋째 자리), 단가는 100 초과 10만 원 미만 정수, 유종은 20자.
 * 리터와 단가가 둘 다 있는데 곱이 결제 금액과 1% 넘게 다르면 확인 문장을 돌려준다. 셋 다 없으면 fuel은 null.
 */
export function checkFuel(fuel: Fuel | null | undefined, amount: number): { fuel: CheckedFuel | null; note: string | null } {
  if (!fuel) return { fuel: null, note: null }
  const liters = Number.isFinite(fuel.liters) && fuel.liters! > 0 && fuel.liters! < MAX_LITERS ? Math.round(fuel.liters! * 1000) / 1000 : null
  const ppl = Number.isFinite(fuel.price_per_liter) ? Math.round(fuel.price_per_liter!) : null
  const price = ppl !== null && ppl > 100 && ppl < MAX_PRICE_PER_LITER ? ppl : null
  const type = fuel.fuel_type?.trim().slice(0, 20) || null
  if (liters === null && price === null && type === null) return { fuel: null, note: null }
  let note: string | null = null
  if (liters !== null && price !== null) {
    const product = Math.round(liters * price)
    const gap = Math.abs(product - amount)
    if (gap > amount * 0.01) note = `단가 × 주유량이 ${won(product)}원이라 결제 금액 ${won(amount)}원과 ${won(gap)}원 달라요. 영수증을 확인해 주세요.`
  }
  return { fuel: { liters, price_per_liter: price, fuel_type: type }, note }
}

export interface CheckedEntry extends Entry {
  type: 'expense' | 'income'
  /** 품목이 있을 때 품목 합계가 결제 금액과 같은지 (품목이 없으면 null) */
  items_match: boolean | null
  /** 결제 금액에 맞춰 상품 줄 금액을 고친 경우 사용자에게 보일 안내 */
  price_fixes?: string[]
  /** 주유소 영수증이면 정리한 주유 값, 아니면 null */
  fuel: CheckedFuel | null
  /** 단가 × 주유량이 결제 금액과 다를 때의 확인 문장 */
  fuel_note?: string
}

/** 품목 합계가 안 맞아 더 큰 모델로 다시 읽었을 때: 다시 읽은 결과가 비어 있지 않으면 그것을 쓴다(둘 다 안 맞아도 큰 모델이 이름을 덜 틀린다) */
export function preferRetry(first: CheckedEntry[], second: CheckedEntry[]): CheckedEntry[] {
  return second.length ? second : first
}

type Item = Entry['items'][number]

const MAX_FIX_LINES = 8 // 고쳐 볼 줄 수 상한 (경우의 수 3^8)
const won = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',') // 런타임 로캘과 상관없이 1,234

/**
 * 품목 합계가 결제 금액과 다를 때, 수량 2개 이상인 상품 줄의 금액을 결제 금액에 맞춰 고친다.
 * 모델이 "2개 71,800원"의 합계를 1개 가격으로 보고 수량을 곱했거나(÷수량), 1개 가격을 합계로 넣은(×수량) 경우다.
 * 결제 금액과 정확히 맞는 조합 중 고치는 줄이 가장 적은 것이 하나뿐일 때만 고치고, 아니면 그대로 둔다.
 */
export function fixLineTotals(items: Item[], total: number): { items: Item[]; fixes: string[] } {
  const sum = items.reduce((s, it) => s + it.amount, 0)
  const none = { items, fixes: [] }
  if (!items.length || sum === total) return none
  const lines = items.flatMap((it, i) => {
    const q = it.quantity
    if (!it.is_product || it.amount <= 0 || !Number.isInteger(q) || q < 2) return []
    const opts: number[] = []
    if (it.amount % q === 0) opts.push(it.amount / q)
    if (it.unit_price === null || it.unit_price === it.amount) opts.push(it.amount * q)
    return opts.length ? [{ i, opts }] : []
  })
  if (!lines.length || lines.length > MAX_FIX_LINES) return none

  let best: number[][] = []
  let fewest = Infinity
  const pick: number[] = lines.map(() => -1) // -1이면 그대로
  const walk = (k: number, s: number, changes: number) => {
    if (changes > fewest) return
    if (k === lines.length) {
      if (s !== total) return
      if (changes < fewest) { fewest = changes; best = [] }
      best.push([...pick])
      return
    }
    walk(k + 1, s, changes)
    const { i, opts } = lines[k]
    opts.forEach((a, o) => { pick[k] = o; walk(k + 1, s - items[i].amount + a, changes + 1); pick[k] = -1 })
  }
  walk(0, sum, 0)
  if (best.length !== 1) return none

  const out = items.map((it) => ({ ...it }))
  const fixes: string[] = []
  best[0].forEach((o, k) => {
    if (o < 0) return
    const it = out[lines[k].i]
    const before = it.amount
    it.amount = lines[k].opts[o]
    it.unit_price = Math.round(it.amount / it.quantity)
    const name = it.name.length > 20 ? `${it.name.slice(0, 20)}…` : it.name
    fixes.push(`${name}: ${it.quantity}개 금액을 ${won(before)}원에서 ${won(it.amount)}원으로 고쳤어요(1개 ${won(it.unit_price)}원). 결제 금액에 맞췄으니 화면과 다르면 고쳐 주세요.`)
  })
  return { items: out, fixes }
}

/** 품목 합계가 결제 금액과 맞으면 줄 금액을 믿고, 1개 가격이 줄 금액과 같게 적힌 상품은 1개 가격을 다시 계산한다 */
function fixUnitPrices(items: Item[]): Item[] {
  return items.map((it) => it.is_product && it.quantity > 1 && it.amount > 0 && it.unit_price === it.amount
    ? { ...it, unit_price: Math.round(it.amount / it.quantity) }
    : it)
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^\d{2}:\d{2}$/

/** 모델 출력을 저장 가능한 형태로 정리하고 품목 합계를 검사한다. withFuel이 false(문자 입력)면 주유 값은 버린다(주유는 영수증 사진에서만 읽는다) */
export function checkEntries(result: ExtractResult, images: ImageSize[] = [], withFuel = true): CheckedEntry[] {
  return result.entries
    .map((e) => {
      const amount = Math.round(Math.abs(e.amount))
      const items = e.items
        .filter((it) => it.name.trim() && Number.isFinite(it.amount))
        .map((it) => ({
          name: it.name.trim().slice(0, 60),
          is_product: it.is_product,
          quantity: it.quantity > 0 ? it.quantity : 1,
          unit_price: it.unit_price === null ? null : Math.round(it.unit_price),
          amount: Math.round(it.amount),
          ...checkPack(it.pack_size, it.pack_unit),
          category: it.category?.trim() || null,
          image_box: checkBox(it.image_box ?? null, images),
        }))
      const fixed = fixLineTotals(items, amount)
      const sum = fixed.items.reduce((s, it) => s + it.amount, 0)
      const date = e.date && DATE_RE.test(e.date) && !Number.isNaN(Date.parse(e.date)) ? e.date : null
      const fuel = withFuel ? checkFuel(e.fuel, amount) : { fuel: null, note: null }
      return {
        ...e,
        type: e.is_income ? 'income' as const : 'expense' as const,
        date,
        time: e.time && TIME_RE.test(e.time) ? e.time : null,
        merchant: e.merchant.trim().slice(0, 60),
        platform: e.platform?.trim().slice(0, 30) || null,
        amount,
        card_last4: e.card_last4 && /^[\d*]{4}$/.test(e.card_last4) && /\d.*\d/.test(e.card_last4) ? e.card_last4 : null,
        // 2~60개월만 할부로 본다 (1개월은 일시불)
        installment_months: Number.isInteger(e.installment_months) && e.installment_months! >= 2 && e.installment_months! <= 60 ? e.installment_months : null,
        items: sum === amount ? fixUnitPrices(fixed.items) : fixed.items,
        items_match: items.length ? sum === amount : null,
        ...(fixed.fixes.length ? { price_fixes: fixed.fixes } : {}),
        fuel: fuel.fuel,
        ...(fuel.note ? { fuel_note: fuel.note } : {}),
      }
    })
    .filter((e) => e.amount > 0)
}

export function hasItemMismatch(entries: CheckedEntry[]): boolean {
  return entries.some((e) => e.items_match === false)
}

// ---------------------------------------------------------------------------
// 관리비 고지서
// ---------------------------------------------------------------------------

export const BillChargeSchema = z.object({
  name: z.string().describe('고지서에 적힌 항목 이름 그대로 (예: 일반관리비, 세대전기료, 수도료, 난방비)'),
  amount: z.number().describe('이번 달 금액(원). 감면·할인은 음수'),
  prev_month: z.number().nullable().describe('고지서에 적힌 전월 금액. 없으면 null'),
  last_year: z.number().nullable().describe('고지서에 적힌 전년 같은 달 금액. 없으면 null'),
})

export const BillUsageSchema = z.object({
  name: z.string().describe('전기, 수도, 온수, 난방, 가스 중 하나. 그 밖은 고지서 표기'),
  amount: z.number().describe('이번 달 사용량 (계량기 지침이 아니라 사용량)'),
  unit: z.string().nullable().describe('kWh, m³, Gcal, MWh 등 고지서 표기'),
  prev_month: z.number().nullable().describe('고지서에 적힌 전월 사용량. 없으면 null'),
  last_year: z.number().nullable().describe('고지서에 적힌 전년 같은 달 사용량. 없으면 null'),
})

export const BillSchema = z.object({
  is_bill: z.boolean().describe('관리비 고지서·내역서이면 true'),
  bill_month: z.string().nullable().describe('YYYY-MM. 몇 월분 관리비인지 (예: 9월분 → 2026-09)'),
  due_date: z.string().nullable().describe('납부 마감일 YYYY-MM-DD. 없으면 null'),
  total: z.number().nullable().describe('이번 달 부과 금액 합계(원, 납기 내 금액). 없으면 null'),
  charges: z.array(BillChargeSchema),
  usages: z.array(BillUsageSchema),
  note: z.string().nullable().describe('읽기 어려웠던 부분 등 사용자에게 알릴 말. 없으면 null'),
})

export type Bill = z.infer<typeof BillSchema>

export const BILL_PROMPT = `당신은 한국 아파트 관리비 고지서(관리비 내역서)를 읽어 가계부에 넣을 값을 주어진 JSON 형식으로만 답합니다.

규칙:
- bill_month는 몇 월분 관리비인지입니다("2026년 9월분" → 2026-09). 청구·납부하는 달이 아니라 부과 대상 달입니다. 연도가 없으면 기준일(오늘)을 보고 가장 가까운 과거 달로 정합니다.
- total은 이번 달에 내야 할 금액(당월 부과액, 납기 내 금액)입니다. 미납액·연체료를 더한 금액이 아닙니다.
- charges에는 항목별 이번 달 금액을 고지서 표기 그대로 넣습니다(일반관리비, 청소비, 경비비, 승강기유지비, 장기수선충당금, 세대전기료, 공동전기료, 수도료, 난방비, 급탕비 등). 소계·합계·"계" 줄은 넣지 않습니다. 감면·할인·절사는 음수입니다.
- 고지서에 전월 금액·전년 같은 달 금액 칸이 있으면 prev_month·last_year에 넣고, 없으면 null입니다.
- usages에는 우리 집(세대) 사용량을 넣습니다: 전기(kWh), 수도(m³), 온수(m³), 난방(Gcal·MWh 등), 가스(m³). 계량기 지침(당월 지침·전월 지침)이 아니라 사용량입니다. 전월·전년 같은 달 사용량이 적혀 있으면 함께 넣습니다. 단지 전체·평균 사용량은 넣지 않습니다.
- 숫자는 쉼표와 단위를 뺀 값입니다. 보이지 않거나 확실하지 않은 값은 지어내지 말고 null로 둡니다.
- 관리비 고지서가 아니면 is_bill을 false로 하고 note에 이유를 적습니다.`

export function buildBillText(today: string, imageCount: number): string {
  return [
    `기준일(오늘): ${today}`,
    '',
    imageCount > 1
      ? `위 이미지 ${imageCount}장은 관리비 고지서 한 장의 여러 부분(앞뒤·위아래)입니다. 같은 항목을 두 번 넣지 마세요.`
      : '위 이미지는 관리비 고지서입니다.',
  ].join('\n')
}

const USAGE_NAMES: [RegExp, string][] = [
  [/온수|급탕/, '온수'], [/난방/, '난방'], [/가스/, '가스'], [/전기|전력/, '전기'], [/수도|상수/, '수도'],
]
const UNIT_NAMES: [RegExp, string][] = [
  [/^(m3|㎥|m\^3|m³|입방미터|톤|ton)$/i, 'm³'], [/^kwh$/i, 'kWh'], [/^mwh$/i, 'MWh'], [/^gcal$/i, 'Gcal'], [/^mcal$/i, 'Mcal'],
]

export interface CheckedBill {
  is_bill: boolean
  bill_month: string | null
  due_date: string | null
  total: number | null
  charges: { name: string; amount: number; prev_month: number | null; last_year: number | null }[]
  usages: { name: string; amount: number; unit: string | null; prev_month: number | null; last_year: number | null }[]
  /** 항목 합계가 부과 금액과 같은지 (항목이 없거나 합계를 모르면 null) */
  sum_match: boolean | null
  note: string | null
}

const finiteOrNull = (v: number | null, digits = 0) =>
  v === null || !Number.isFinite(v) ? null : Math.round(v * 10 ** digits) / 10 ** digits

/** 모델이 읽은 고지서를 저장할 수 있는 모양으로 정리한다 */
export function checkBill(b: Bill): CheckedBill {
  const charges = b.charges
    .filter((c) => c.name.trim() && Number.isFinite(c.amount))
    .map((c) => ({ name: c.name.trim().slice(0, 30), amount: Math.round(c.amount), prev_month: finiteOrNull(c.prev_month), last_year: finiteOrNull(c.last_year) }))
  const usages = b.usages
    .filter((u) => u.name.trim() && Number.isFinite(u.amount) && u.amount >= 0)
    .map((u) => {
      const raw = u.name.trim()
      const unit = u.unit?.trim().replace(/\s+/g, '') || null
      return {
        name: USAGE_NAMES.find(([re]) => re.test(raw))?.[1] ?? raw.slice(0, 20),
        amount: finiteOrNull(u.amount, 3) ?? 0,
        unit: unit ? UNIT_NAMES.find(([re]) => re.test(unit))?.[1] ?? unit.slice(0, 10) : null,
        prev_month: finiteOrNull(u.prev_month, 3),
        last_year: finiteOrNull(u.last_year, 3),
      }
    })
  const total = finiteOrNull(b.total)
  const sum = charges.reduce((s, c) => s + c.amount, 0)
  return {
    is_bill: b.is_bill,
    bill_month: b.bill_month && /^\d{4}-(0[1-9]|1[0-2])$/.test(b.bill_month) ? b.bill_month : null,
    due_date: b.due_date && /^\d{4}-\d{2}-\d{2}$/.test(b.due_date) && !Number.isNaN(Date.parse(b.due_date)) ? b.due_date : null,
    total: total !== null && total >= 0 ? total : charges.length ? sum : null,
    charges,
    usages,
    sum_match: charges.length && total !== null ? sum === total : null,
    note: b.note,
  }
}
