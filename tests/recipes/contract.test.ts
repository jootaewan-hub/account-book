import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { RecipeV2Schema, parseRecipe } from '../../supabase/functions/_shared/recipeContract.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Gold = any
const gold: Gold = JSON.parse(readFileSync('docs/recipes/contract/examples/youtube-AkX6uA4BaDs.json', 'utf8'))

describe('레시피 계약 v2', () => {
  it('기준 답안(v2)이 통과하고 길이는 793초', () => {
    const r = parseRecipe(gold)
    if (!r.ok) throw new Error(r.errors.join('\n'))
    expect(r.value.source.duration_seconds).toBe(793)
  })

  it.each<[string, (g: Gold) => void]>([
    ['숫자 분량의 출처가 editor', (g) => { g.ingredients[0].origin = 'editor' }],
    ['숫자 분량이 있는 재료에 덧붙인 분량', (g) => { g.ingredients[0].suggested_amount = 1; g.ingredients[0].suggested_unit = '큰술' }],
    ['말 출처 숫자에 at_seconds 없음', (g) => { g.ingredients[1].origin = 'caption_auto'; delete g.ingredients[1].at_seconds }],
    ['요리 종류가 다섯 밖', (g) => { g.tags.cuisine = '이탈리안' }],
    ['세부 재료가 재료 목록 밖', (g) => { g.tags.main_details = ['삼겹살'] }],
    ['용어 풀이 11개', (g) => { g.glossary = Array.from({ length: 11 }, (_, i) => ({ term: `말${i}`, body: '풀이', origin: 'editor', at_seconds: null })) }],
    ['출처 secondary', (g) => { g.steps[0].origin = 'secondary' }],
    ['https 아닌 주소', (g) => { g.source.url = 'http://youtube.com/watch?v=AkX6uA4BaDs' }],
  ])('%s 은 거절', (_, mutate) => {
    const g = structuredClone(gold)
    mutate(g)
    expect(parseRecipe(g).ok).toBe(false)
  })

  it('docs의 JSON 스키마가 zod와 같다', () => {
    const doc = JSON.parse(readFileSync('docs/recipes/contract/recipe.schema.json', 'utf8'))
    expect(doc).toEqual(JSON.parse(JSON.stringify(z.toJSONSchema(RecipeV2Schema))))
  })
})
