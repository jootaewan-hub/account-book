import { describe, expect, it } from 'vitest'
import { SERVINGS_CHOICES, UNIT_ML, scaleAmount, servingsBase, unitMl } from '../../supabase/functions/_shared/recipeUnits.ts'

describe('단위와 인분 계산', () => {
  it('계량스푼일 때만 ml', () => {
    expect(unitMl('큰술', '계량스푼')).toBe(15)
    expect(unitMl('t', '계량스푼')).toBe(5)
    expect(unitMl('큰술', '밥숟가락')).toBeNull()
    expect(unitMl('큰술', '확인 못 함')).toBeNull()
    expect(unitMl('큰술', '섞어 씀')).toBeNull()
    expect(unitMl('컵', '계량스푼')).toBeNull()
    expect(unitMl('g', '계량스푼')).toBeNull()
    expect(unitMl(null, '계량스푼')).toBeNull()
    expect(UNIT_ML).toEqual({ 큰술: 15, T: 15, 작은술: 5, t: 5 })
  })

  it('기준 인분', () => {
    expect(servingsBase({ servings: { value: 2, origin: 'description' } })).toEqual({ base: 2, fromEditor: false })
    expect(servingsBase({ servings: { value: null, origin: null, suggested: 3 } })).toEqual({ base: 3, fromEditor: true })
    expect(servingsBase({ servings: { value: null, origin: null } })).toBeNull()
  })

  it('분량 계산', () => {
    expect(scaleAmount(2, '큰술', 2)).toBe('4')
    expect(scaleAmount(0.5, '개', 1.5)).toBe('¾')
    expect(scaleAmount(500, 'g', 1 / 3)).toBe('167')
    expect(scaleAmount(1, '큰술', 1 / 3)).toBe('¼')
    expect(scaleAmount(1.5, '큰술', 1)).toBe('1½')
    expect(scaleAmount(1, '작은술', 0.1)).toBe('¼')
    expect(scaleAmount(250, 'ml', 2)).toBe('500')
    expect(scaleAmount(1, null, 2)).toBe('2')
  })

  it('인분 선택지', () => {
    expect(SERVINGS_CHOICES).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })
})
