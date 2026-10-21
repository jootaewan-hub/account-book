// 성분(P7·P9·D-020)의 클라이언트 타입과 문구. 값은 식약처 품목제조보고(C002·C006·C003)·식품영양성분DB에서 온 것 그대로이고, 없으면 "확인 못 함".
import { SOURCE_NAME, type IngredientOrigin, type IngredientRow, type IngredientSource, type Nutrition, type NutritionRow } from '../../../supabase/functions/_shared/foodInfo'
import { koFullDay } from './alerts'

export type { IngredientOrigin, IngredientRow, IngredientSource, Nutrition, NutritionRow }
export { SOURCE_NAME }

/** grocery.item_nutrition 한 줄(P9, D-018): 품목 이름·규격에 기억한 식품영양성분DB 식품 */
export type ItemNutrition = {
  foodCd: string | null
  foodName: string
  maker: string | null
  nutrition: Nutrition
  updatedAt: string
  /** 자동으로 맞춘 것(사람이 고르지 않음) */
  auto: boolean
  /** 자동 맞춤이 무엇으로 맞췄나: 고른 상품의 이름(product) 또는 품목 이름(name). 예전 기록은 null(이름으로 본다) */
  matchedBy: 'product' | 'name' | null
}

/** 목록 줄의 열량: "232kcal/100g". 열량이 없으면 null, 기준량이 없으면 열량만 */
export function kcalText(n: Nutrition): string | null {
  if (n.kcal === null) return null
  const kcal = `${n.kcal.toLocaleString('ko-KR')}kcal`
  return n.basis ? `${kcal}/${n.basis}` : kcal
}

/** grocery.item_ingredients 한 줄(D-020): 품목 이름·규격에 기억한 식약처 품목제조보고 원재료 */
export type ItemIngredients = {
  /** 원재료를 받은 목록: C002 식품, C006 축산물, C003 건강기능식품 */
  origin: IngredientOrigin
  reportNo: string
  name: string
  maker: string | null
  kind: string | null
  rawMaterials: string | null
  changedOn: string | null
  shelfLife: string | null
  health: IngredientRow['health']
  updatedAt: string
  /** 고른 상품의 이름으로 자동으로 맞춘 것(사람이 고르지 않음) */
  auto: boolean
}

/** 원재료 출처 줄 */
export const ORIGIN_LINE: Record<IngredientOrigin, string> = {
  C002: '식품안전나라 식품 품목제조보고 원재료(C002)',
  C006: '식품안전나라 축산물 품목제조보고 원재료(C006)',
  C003: '식품안전나라 건강기능식품 품목제조신고 원재료(C003)',
}

export const INGREDIENT_NOTE = '식약처 품목제조보고의 식품유형·원재료라 포장지 표시와 다를 수 있어요. 같은 품목인지 보고번호·업체로 확인해 주세요.'

export type NutriRow = { label: string; value: string }

/** 영양성분 표 줄: 값이 없으면 "확인 못 함". 숫자는 응답 값 그대로 */
export function nutritionRows(n: Nutrition): NutriRow[] {
  const v = (x: number | null, unit: string) => (x === null ? '확인 못 함' : `${x.toLocaleString('ko-KR')}${unit}`)
  return [
    { label: '열량', value: v(n.kcal, 'kcal') },
    { label: '탄수화물', value: v(n.carbs, 'g') },
    { label: '당류', value: v(n.sugars, 'g') },
    { label: '단백질', value: v(n.protein, 'g') },
    { label: '지방', value: v(n.fat, 'g') },
    { label: '포화지방', value: v(n.satFat, 'g') },
    { label: '트랜스지방', value: v(n.transFat, 'g') },
    { label: '콜레스테롤', value: v(n.cholesterol, 'mg') },
    { label: '나트륨', value: v(n.sodium, 'mg') },
  ]
}

/** 영양성분 출처 줄: 출처·기준량·갱신일 */
export function nutritionSource(n: Nutrition): string {
  const parts = [n.source ?? '식품영양성분DB', n.basis ? `기준 ${n.basis}` : '기준량 확인 못 함']
  if (n.updatedOn) parts.push(`${koFullDay(n.updatedOn)} 갱신`)
  return parts.join(', ')
}

