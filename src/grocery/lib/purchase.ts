// 장 본 것 → 가계부 내역(D-011, 통합 설계 6-1·6-3).
// 금액은 사용자가 적은 값이나 영수증 값만 쓴다. 장보기에서 확인한 가격(다나와 등)을 낸 금액으로 채우지 않는다.
import { suggestCategory } from '../../lib/categorize'
import { platformOf } from '../../lib/platform'
import { productTitle } from '../../lib/smart'
import type { Category as LedgerCategory, Scope } from '../../lib/types'
import type { Category } from './categories'
import type { Item } from './types'

/** 가계부 '장보기'로 넣는 장보기 분류(먹거리) */
const GROCERY_FOOD: ReadonlySet<Category> = new Set(['정육', '수산', '채소', '과일', '유제품', '계란', '가공', '냉동', '음료'])

const usable = (categories: LedgerCategory[]) => categories.filter((c) => c.type === 'expense' && !c.archived)
const byName = (categories: LedgerCategory[], name: string) => usable(categories).find((c) => c.name === name) ?? null

/**
 * 장보기 품목이 가계부 내역이 될 때의 분류(통합 설계 6-3 대응표).
 * 먹거리 9개는 '장보기', 생활용품·기타는 가계부 이름 규칙의 제안(없으면 생활용품은 '생활용품', 기타는 '장보기').
 * 대응한 분류가 없거나 숨겨졌으면 '장보기', 그것도 없으면 null.
 */
export function ledgerCategoryFor(item: Pick<Item, 'name' | 'category'>, categories: LedgerCategory[]): string | null {
  const groceryCat = byName(categories, '장보기')
  if (GROCERY_FOOD.has(item.category)) return groceryCat?.id ?? null
  const suggested = suggestCategory(item.name, usable(categories))
  if (suggested) return suggested.id
  const fallback = byName(categories, item.category === '생활용품' ? '생활용품' : '장보기')
  return fallback?.id ?? groceryCat?.id ?? null
}

/** 가계부 품목 줄 이름: 품목 이름과 용량 */
export const itemLabel = (i: Pick<Item, 'name' | 'spec'>) => (i.spec ? `${i.name} ${i.spec}` : i.name).slice(0, 60)

/** 용량 글자(장보기 spec)에서 가계부 품목의 총량·단위를 읽는다. kg·L는 g·ml로 바꾼다. 못 읽으면 null */
export function parsePack(spec: string | null): { pack_size: number; pack_unit: string } | null {
  const m = (spec ?? '').trim().match(/^(\d+(?:\.\d+)?)\s*(kg|g|ml|l|개|구|롤|매|입|팩)$/i)
  if (!m) return null
  const n = Number(m[1])
  if (!(n > 0)) return null
  const unit = m[2].toLowerCase()
  if (unit === 'kg') return { pack_size: Math.round(n * 1000 * 1000) / 1000, pack_unit: 'g' }
  if (unit === 'l') return { pack_size: Math.round(n * 1000 * 1000) / 1000, pack_unit: 'ml' }
  return { pack_size: n, pack_unit: unit }
}

export type PurchaseInput = {
  /** 산 날 YYYY-MM-DD */
  date: string
  /** 어디서: 가게 이름이나 쇼핑몰 이름(비어 있을 수 있음) */
  place: string
  scope: Scope
  /** 'each': 품목마다 금액, 'total': 총액 하나 */
  mode: 'each' | 'total'
  /** 품목 id → 금액(원). mode 'each'에서 쓴다 */
  amounts: Record<string, number | null | undefined>
  /** mode 'total'에서 쓴다 */
  total: number | null
  /** 품목 id → 가계부 분류 id(화면에서 고른 값) */
  categoryOf: Record<string, string | null | undefined>
}

/** grocery.record_purchase의 항목 하나 */
export type PurchaseEntry = {
  tx: {
    type: 'expense'; occurred_on: string; amount: number; title: string; memo: string | null
    category_id: string | null; payment_method_id: null; scope: Scope; source: 'manual'; platform: string | null
  }
  items: { name: string; quantity: number; unit_price: number | null; amount: number; pack_size: number | null; pack_unit: string | null }[]
  links: { item_id: string; paid: number | null }[]
}

const MAX_AMOUNT = 9_999_999_999
const validAmount = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0 && n <= MAX_AMOUNT

/**
 * 고른 품목과 입력으로 가계부에 넣을 내역을 만든다.
 * - 품목마다 금액: 품목마다 내역 하나(이름 = 품목, 품목 줄 하나). 매장에서 산 것이면 메모에 가게 이름
 * - 총액: 내역 하나. 이름은 온라인이면 상품명(길면 '첫 상품 외 N건'), 매장이면 가게 이름. 품목 이름은 메모에.
 *   가계부 품목 줄은 금액이 꼭 있어야 해서 넣지 않는다
 *   분류는 품목들의 분류가 하나면 그 분류, 섞이면 가계부 '장보기'
 * 문제가 있으면 { error }를 돌려준다.
 */
export function buildEntries(items: Item[], input: PurchaseInput, categories: LedgerCategory[]): { entries: PurchaseEntry[] } | { error: string } {
  if (items.length === 0) return { error: '넣을 품목을 골라 주세요.' }
  if (items.some((i) => i.transactionId)) return { error: '이미 가계부에 넣은 품목이 섞여 있어요.' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return { error: '날짜를 확인해 주세요.' }
  const place = input.place.trim().slice(0, 30)
  const platform = platformOf(place)
  const base = { type: 'expense' as const, occurred_on: input.date, payment_method_id: null, scope: input.scope, source: 'manual' as const, platform }

  if (input.mode === 'each') {
    const missing = items.filter((i) => !validAmount(input.amounts[i.id]))
    if (missing.length) return { error: `${missing[0].name} 금액을 적어 주세요.` }
    return {
      entries: items.map((i) => {
        const amount = input.amounts[i.id] as number
        const pack = parsePack(i.spec)
        return {
          tx: {
            ...base, amount, title: itemLabel(i),
            memo: !platform && place ? `산 곳: ${place}` : null,
            category_id: input.categoryOf[i.id] ?? null,
          },
          items: [{
            name: itemLabel(i), quantity: i.count, unit_price: i.count === 1 ? amount : null, amount,
            pack_size: pack?.pack_size ?? null, pack_unit: pack?.pack_unit ?? null,
          }],
          links: [{ item_id: i.id, paid: amount }],
        }
      }),
    }
  }

  if (!validAmount(input.total)) return { error: '낸 금액을 적어 주세요.' }
  const labels = items.map(itemLabel)
  const named = productTitle(labels.map((name) => ({ name, amount: 1 }))) ?? labels[0]
  const cats = [...new Set(items.map((i) => input.categoryOf[i.id] ?? null))]
  return {
    entries: [{
      tx: {
        ...base, amount: input.total,
        title: (platform || !place ? named : place).slice(0, 60),
        memo: labels.join(', ').slice(0, 500),
        category_id: cats.length === 1 ? cats[0] : byName(categories, '장보기')?.id ?? null,
      },
      items: [],
      links: items.map((i) => ({ item_id: i.id, paid: null })),
    }],
  }
}

const norm = (s: string) => s.replace(/[\s\-_/()[\]·.,]+/g, '').toLowerCase()

/**
 * 영수증·주문의 상품 줄과 장보기 품목을 이름으로 맞춘다(제안일 뿐, 화면에서 사람이 고른다).
 * 장보기 품목 이름(공백·기호 뺌)이 상품명에 들어 있거나 그 반대면 맞는다. 한 글자 품목('파', '무')은 상품명의 한 단어와 같을 때만.
 * 긴 이름부터 맞추고, 상품 줄 하나에는 품목 하나만 붙인다. 돌려주는 것: 품목 id → 상품 줄 key
 */
export function matchReceipt(
  lines: { key: string; name: string }[],
  groceryItems: Pick<Item, 'id' | 'name'>[],
): Map<string, string> {
  const out = new Map<string, string>()
  const used = new Set<string>()
  const sorted = [...groceryItems].sort((a, b) => norm(b.name).length - norm(a.name).length)
  for (const g of sorted) {
    const gn = norm(g.name)
    if (!gn) continue
    const hit = lines.find((l) => {
      if (used.has(l.key)) return false
      const ln = norm(l.name)
      if (!ln) return false
      if (gn.length === 1) return l.name.split(/[\s,()[\]/]+/).some((w) => w === g.name.trim())
      return ln.includes(gn) || (ln.length >= 2 && gn.includes(ln))
    })
    if (hit) {
      out.set(g.id, hit.key)
      used.add(hit.key)
    }
  }
  return out
}
