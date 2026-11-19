import { describe, expect, it } from 'vitest'
import { CATEGORIES } from '../../src/grocery/lib/categories'
import { boughtSuggestions, groceryCategoryFor, missingIngredients } from '../../src/recipes/lib/groceryLink'

describe('장보기 분류 옮기기', () => {
  it('재료 사전 분류를 정해진 대로 옮기고 나머지는 기타로 둔다', () => {
    const want: Record<string, string> = {
      육류: '정육', 수산물: '수산', 채소: '채소', 버섯: '채소', 과일: '과일', '유제품·난류': '유제품',
      '장·양념·소스': '가공', '곡물·전분': '가공', '콩·두류': '기타', '견과·종실': '기타', '허브·향신료': '기타',
      유지: '기타', 음료: '기타', '가공·기타': '기타', 없는분류: '기타',
    }
    for (const [from, to] of Object.entries(want)) expect(groceryCategoryFor(from)).toBe(to)
    for (const to of Object.values(want)) expect(CATEGORIES).toContain(to)
  })
})

describe('모자란 재료', () => {
  const recipe = {
    ingredients: [
      { name: '돼지고기', ingredient_key: 'pork' },
      { name: '대파', ingredient_key: 'green_onion' },
      { name: '소금', ingredient_key: 'salt' },
      { name: '참깨', ingredient_key: 'sesame', optional: true },
      { name: '집 비법 소스' },
      { name: '대파(흰 부분)', ingredient_key: 'green_onion' },
    ],
  }
  it('가진 것·늘 있는 것·선택 재료는 빼고, 사전에 없는 필수 재료는 따로 센다', () => {
    const out = missingIngredients(recipe, [{ ingredient_key: 'salt', state: 'always' }, { ingredient_key: 'pork', state: 'have' }], ['대파'])
    expect(out.missing).toEqual([{ key: 'green_onion', name: '대파', inGrocery: true }])
    expect(out.unmatched).toEqual([{ name: '집 비법 소스' }])
  })
  it('장보기 목록에 없으면 inGrocery는 거짓이고 공백·대소문자는 무시한다', () => {
    expect(missingIngredients(recipe, [], []).missing.map((m) => [m.key, m.inGrocery])).toEqual([['pork', false], ['green_onion', false], ['salt', false]])
    expect(missingIngredients(recipe, [], [' 돼 지고기 ']).missing[0].inGrocery).toBe(true)
  })
})

describe('산 것으로 가진 재료 제안', () => {
  const now = Date.parse('2026-11-19T00:00:00Z')
  const dict = [
    { id: 'egg', name: '달걀', aliases: ['계란'] },
    { id: 'milk', name: '우유', aliases: [] },
    { id: 'pork', name: '돼지고기', aliases: ['한돈'] },
  ]
  it('14일 안에 산 것 중 이름이 사전과 정확히 같은 것만, 이미 가진 것은 빼고', () => {
    const bought = [
      { name: '계란', bought_at: '2026-11-18T00:00:00Z' },
      { name: '우 유', bought_at: '2026-11-10T00:00:00Z' },
      { name: '한돈 삼겹살', bought_at: '2026-11-18T00:00:00Z' },
      { name: '돼지고기', bought_at: '2026-10-01T00:00:00Z' },
      { name: '달걀', bought_at: null },
    ]
    expect(boughtSuggestions(bought, dict, [], now)).toEqual(['egg', 'milk'])
    expect(boughtSuggestions(bought, dict, [{ ingredient_key: 'milk' }], now)).toEqual(['egg'])
  })
  it('같은 재료를 여러 번 샀어도 한 번만 낸다', () => {
    const b = [{ name: '계란', bought_at: '2026-11-18T00:00:00Z' }, { name: '달걀', bought_at: '2026-11-17T00:00:00Z' }]
    expect(boughtSuggestions(b, dict, [], now)).toEqual(['egg'])
  })
})
