// 영양성분 요약 글(P9): 목록 줄의 "232kcal/100g". 숫자는 식품영양성분DB 값 그대로.
import { describe, expect, it } from 'vitest'
import { kcalText } from '../../src/grocery/lib/foodInfo'
import type { Nutrition } from '../../src/grocery/lib/foodInfo'

const n = (p: Partial<Nutrition>): Nutrition => ({
  basis: '100g', kcal: 232, carbs: null, sugars: null, protein: null, fat: null, satFat: null, transFat: null, cholesterol: null, sodium: null,
  weight: null, servingRef: null, source: null, foodName: null, maker: null, updatedOn: null, ...p,
})

describe('kcalText', () => {
  it('열량과 기준량으로, 열량이 없으면 null, 기준량이 없으면 열량만', () => {
    expect(kcalText(n({}))).toBe('232kcal/100g')
    expect(kcalText(n({ kcal: 1234.5 }))).toBe('1,234.5kcal/100g')
    expect(kcalText(n({ kcal: null }))).toBeNull()
    expect(kcalText(n({ basis: null }))).toBe('232kcal')
  })
})
