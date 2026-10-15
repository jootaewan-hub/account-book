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
  unit_price: z.number().nullable().describe('상품 1개(수량 1) 가격'),
  amount: z.number().describe('이 줄의 금액 (수량×단가)'),
  pack_size: z.number().nullable().describe('상품 1개(수량 1)에 든 총량. 예: 100매×10팩 → 1000. 모르면 null'),
  pack_unit: z.string().nullable().describe('pack_size의 단위: g, ml, 또는 개·매·구·롤·입·병·캔·봉·장·정·포 같은 셈 단위. 모르면 null'),
  category: z.string().nullable().describe('이 상품의 분류 (주어진 분류 목록 중 하나). 배송비·할인이거나 애매하면 null'),
  image_box: BoxSchema.nullable().describe('이 상품의 사진(썸네일) 위치, 이미지 픽셀 좌표. 상품 사진이 없으면 null'),
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
  category: z.string().nullable().describe('주어진 분류 목록 중 하나. 애매하면 null'),
  items: z.array(ItemSchema).describe('영수증·주문내역의 품목. 품목이 없으면 빈 배열'),
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
- category는 사용자가 준 분류 목록에 있는 이름만 씁니다. 애매하면 null입니다.
- items는 품목이 적힌 영수증·주문내역일 때만 채웁니다. 각 품목의 amount는 그 줄의 금액(수량×단가)입니다. 할인 줄은 음수 amount 품목으로 넣습니다.
- 보이지 않거나 확실하지 않은 값은 지어내지 말고 null(문자열은 빈 문자열)로 둡니다.
- platform은 주문·결제한 온라인 플랫폼입니다. 화면의 로고·앱 이름·메뉴 문구·주문번호 형식·배송 표시(로켓배송, 샛별배송, 오늘출발 등)로 판단합니다.
  이름은 다음 중 하나로 씁니다: 쿠팡, 쿠팡이츠, 네이버(네이버페이·스마트스토어·네이버쇼핑), 오늘의집, 컬리(마켓컬리), 11번가, G마켓, 옥션, SSG닷컴, 무신사, 29CM, 에이블리, 지그재그, 알리익스프레스, 테무, 배달의민족, 요기요, 카카오 선물하기, 당근.
  목록에 없는 온라인 플랫폼이면 화면에 보이는 이름을 씁니다. 매장에서 결제한 영수증·카드 문자는 null입니다(카드 문자 가맹점이 "쿠팡"처럼 플랫폼이면 그 이름).
- 쇼핑몰·배달앱 주문·결제 내역 화면이면:
  · 주문(결제) 한 건이 entries 하나입니다. 주문일·주문번호가 다르면 따로 만듭니다. 여러 이미지가 같은 주문을 이어서 찍은 것이면 하나로 합치고 같은 상품을 두 번 넣지 않습니다.
  · 한 상품은 entries 전체에서 한 번만 나옵니다. 주문 목록 화면과 주문 상세 화면을 함께 찍었더라도 같은 상품을 다른 entries에 또 넣지 않습니다.
  · merchant는 판매자·가게 이름이고, 보이지 않으면 플랫폼 이름입니다. date는 주문일 또는 결제일입니다.
  · items에는 상품마다 화면에 적힌 상품명(옵션은 짧게 덧붙임), 수량, 단가(1개 가격), 금액, 분류(category, 상품마다 따로)를 넣고 is_product를 true로 합니다. 배송비는 "배송비" 품목, 쿠폰·할인·적립금 사용은 음수 금액 품목으로 넣고 is_product를 false로 합니다.
  · pack_size와 pack_unit은 상품명·옵션에 적힌 용량·개수로 상품 1개(수량 1)에 든 총량을 계산해 넣습니다. 여러 개 묶음이면 곱합니다(예: "100매 x 10팩" → 1000, 매 / "2L x 6병" → 12000, ml / "500g x 2개" → 1000, g / "30구" → 30, 구). kg은 g으로, L는 ml로 바꿉니다. 셈 단위는 가장 작은 소비 단위를 씁니다(팩·박스보다 매·개·구). 용량이 적혀 있지 않으면 null입니다.
  · 최종 결제 금액이 보이면 amount는 그 값이고, 안 보이면 품목 금액의 합입니다. 취소·반품된 상품은 넣지 않습니다.
- 영수증 품목도 is_product를 같은 기준으로 넣고, 용량이 품목명에 적혀 있으면 pack_size·pack_unit을 넣습니다.
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
      ? '위 이미지는 사용자가 올린 쇼핑몰 주문·결제 내역 캡처입니다. 상품마다 사진 위치(image_box)도 넣어 주세요.'
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

export interface CheckedEntry extends Entry {
  type: 'expense' | 'income'
  /** 품목이 있을 때 품목 합계가 결제 금액과 같은지 (품목이 없으면 null) */
  items_match: boolean | null
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^\d{2}:\d{2}$/

/** 모델 출력을 저장 가능한 형태로 정리하고 품목 합계를 검사한다 */
export function checkEntries(result: ExtractResult, images: ImageSize[] = []): CheckedEntry[] {
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
      const sum = items.reduce((s, it) => s + it.amount, 0)
      const date = e.date && DATE_RE.test(e.date) && !Number.isNaN(Date.parse(e.date)) ? e.date : null
      return {
        ...e,
        type: e.is_income ? 'income' as const : 'expense' as const,
        date,
        time: e.time && TIME_RE.test(e.time) ? e.time : null,
        merchant: e.merchant.trim().slice(0, 60),
        platform: e.platform?.trim().slice(0, 30) || null,
        amount,
        card_last4: e.card_last4 && /^[\d*]{4}$/.test(e.card_last4) && /\d.*\d/.test(e.card_last4) ? e.card_last4 : null,
        items,
        items_match: items.length ? sum === amount : null,
      }
    })
    .filter((e) => e.amount > 0)
}

export function hasItemMismatch(entries: CheckedEntry[]): boolean {
  return entries.some((e) => e.items_match === false)
}
