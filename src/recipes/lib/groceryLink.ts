// 레시피 재료 ↔ 장보기·가진 재료를 잇는 순수 함수. 서버 호출은 store.ts가 한다.
import { CATEGORIES, type Category } from '../../grocery/lib/categories'

export type GroceryCategory = (typeof CATEGORIES)[number]

/** 공백을 없애고 소문자로 맞춘 이름. 장보기 목록·사전 이름 비교에 쓴다. */
export function nameKey(name: string): string {
  return name.replace(/\s+/g, '').toLowerCase()
}

/** 재료 사전 분류 → 장보기 분류. 목록에 없는 분류는 기타. */
export function groceryCategoryFor(dictCategory: string): GroceryCategory {
  switch (dictCategory) {
    case '육류': return '정육'
    case '수산물': return '수산'
    case '채소': case '버섯': return '채소'
    case '과일': return '과일'
    case '유제품·난류': return '유제품'
    case '장·양념·소스': case '곡물·전분': return '가공'
    default: return '기타'
  }
}

export type PantryEntry = { ingredient_key: string; state: 'have' | 'always' }
type RecipeIngredient = { name: string; optional?: boolean; ingredient_key?: string | null }
export type MissingIngredient = { key: string; name: string; inGrocery: boolean }
export type MissingResult = {
  /** 필수 재료 중 사전에 있고 가진 재료에 없는 것 */
  missing: MissingIngredient[]
  /** 필수 재료 중 사전에 없어 세지 못한 것 */
  unmatched: { name: string }[]
}

export function missingIngredients(
  recipe: { ingredients: readonly RecipeIngredient[] },
  pantry: readonly PantryEntry[],
  groceryNames: readonly string[],
): MissingResult {
  const have = new Set(pantry.map((p) => p.ingredient_key))
  const inList = new Set(groceryNames.map(nameKey))
  const seen = new Set<string>()
  const missing: MissingIngredient[] = []
  const unmatched: { name: string }[] = []
  for (const g of recipe.ingredients) {
    if (g.optional) continue
    const key = g.ingredient_key
    if (!key) { unmatched.push({ name: g.name }); continue }
    if (have.has(key) || seen.has(key)) continue
    seen.add(key)
    missing.push({ key, name: g.name, inGrocery: inList.has(nameKey(g.name)) })
  }
  return { missing, unmatched }
}

export const BOUGHT_WINDOW_DAYS = 14

/** 최근 14일 안에 산 장보기 품목 중 사전 이름·동의어와 정확히 같은 것의 사전 키(이미 가진 재료는 뺀다). */
export function boughtSuggestions(
  boughtItems: readonly { name: string; bought_at: string | null }[],
  dict: readonly { id: string; name: string; aliases: readonly string[] }[],
  pantry: readonly { ingredient_key: string }[],
  now: number = Date.now(),
): string[] {
  const byName = new Map<string, string>()
  for (const d of dict) {
    for (const n of [d.name, ...d.aliases]) {
      const k = nameKey(n)
      if (k && !byName.has(k)) byName.set(k, d.id)
    }
  }
  const have = new Set(pantry.map((p) => p.ingredient_key))
  const since = now - BOUGHT_WINDOW_DAYS * 24 * 60 * 60 * 1000
  const out: string[] = []
  for (const item of boughtItems) {
    if (!item.bought_at) continue
    const at = Date.parse(item.bought_at)
    if (!Number.isFinite(at) || at < since) continue
    const key = byName.get(nameKey(item.name))
    if (key && !have.has(key) && !out.includes(key)) out.push(key)
  }
  return out
}

export type { Category }
