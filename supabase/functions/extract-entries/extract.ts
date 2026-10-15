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
  name: z.string(),
  quantity: z.number(),
  unit_price: z.number().nullable(),
  amount: z.number(),
  image_box: BoxSchema.nullable().describe('이 상품의 사진(썸네일) 위치, 이미지 픽셀 좌표. 상품 사진이 없으면 null'),
})

export const EntrySchema = z.object({
  date: z.string().nullable().describe('YYYY-MM-DD. 알 수 없으면 null'),
  time: z.string().nullable().describe('HH:MM 24시간. 알 수 없으면 null'),
  merchant: z.string().describe('가맹점 또는 내용. 알 수 없으면 빈 문자열'),
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
- 쇼핑몰(쿠팡, 오늘의집, 마켓컬리, 네이버페이, 네이버 스마트스토어 등) 주문·결제 내역 화면이면:
  · 주문(결제) 한 건이 entries 하나입니다. 주문일·주문번호가 다르면 따로 만듭니다. 여러 이미지가 같은 주문을 이어서 찍은 것이면 하나로 합치고 같은 상품을 두 번 넣지 않습니다.
  · merchant는 쇼핑몰 이름(예: 쿠팡, 오늘의집, 컬리, 네이버페이)입니다. date는 주문일 또는 결제일입니다.
  · items에는 상품마다 이름(옵션은 짧게 덧붙임), 수량, 단가, 금액을 넣습니다. 배송비는 "배송비" 품목, 쿠폰·할인·적립금 사용은 음수 금액 품목으로 넣습니다.
  · 최종 결제 금액이 보이면 amount는 그 값이고, 안 보이면 품목 금액의 합입니다. 취소·반품된 상품은 넣지 않습니다.
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
          quantity: it.quantity > 0 ? it.quantity : 1,
          unit_price: it.unit_price === null ? null : Math.round(it.unit_price),
          amount: Math.round(it.amount),
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
