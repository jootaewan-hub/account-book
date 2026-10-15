// 문자·알림톡·영수증 사진에서 가계부 내역을 뽑기 위한 공용 로직.
// Deno(Edge Function)와 Node(vitest) 양쪽에서 쓰므로 런타임 전용 API를 쓰지 않는다.
import { z } from 'zod'

export const MAX_TEXT_CHARS = 6000
export const MAX_IMAGE_BASE64_CHARS = 8_000_000 // 약 6MB 이미지
export const IMAGE_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

export const ItemSchema = z.object({
  name: z.string(),
  quantity: z.number(),
  unit_price: z.number().nullable(),
  amount: z.number(),
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
- 거래 내역이 없으면 entries를 빈 배열로 하고 note에 이유를 적습니다.`

export function buildUserText(opts: { kind: 'text' | 'image'; today: string; categories: string[]; text?: string }): string {
  const lines = [
    `기준일(오늘): ${opts.today}`,
    `분류 목록: ${opts.categories.join(', ') || '(없음)'}`,
  ]
  if (opts.kind === 'text') {
    lines.push('', '아래는 사용자가 붙여넣은 내용입니다.', '<pasted>', opts.text ?? '', '</pasted>')
  } else {
    lines.push('', '위 이미지는 사용자가 올린 영수증·주문내역·결제 화면입니다.')
  }
  return lines.join('\n')
}

export interface CheckedEntry extends Entry {
  type: 'expense' | 'income'
  /** 품목이 있을 때 품목 합계가 결제 금액과 같은지 (품목이 없으면 null) */
  items_match: boolean | null
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^\d{2}:\d{2}$/

/** 모델 출력을 저장 가능한 형태로 정리하고 품목 합계를 검사한다 */
export function checkEntries(result: ExtractResult): CheckedEntry[] {
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
