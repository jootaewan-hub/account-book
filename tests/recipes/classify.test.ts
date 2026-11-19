import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { RecipeV2 } from '../../supabase/functions/_shared/recipeContract.ts'
import { difficulty, fileTitle, folderPath } from '../../supabase/functions/_shared/recipeClassify.ts'

const gold = JSON.parse(readFileSync('docs/recipes/contract/examples/youtube-AkX6uA4BaDs.json', 'utf8')) as RecipeV2

type In = Parameters<typeof difficulty>[0]
function make(required: number, steps: number, opts: { methods?: string[]; body?: string } = {}): In {
  return {
    ingredients: Array.from({ length: required }, (_, i) => ({ name: `재료${i}`, optional: false })),
    steps: Array.from({ length: steps }, (_, i) => ({ title: `단계${i}`, body: opts.body ?? '볶는다' })),
    tags: { methods: opts.methods ?? ['볶음'] },
  } as unknown as In
}

describe('난이도', () => {
  it('기준 답안은 보통 3점', () => {
    expect(difficulty(gold)).toEqual({ level: '보통', score: 3, basis: { required: 14, steps: 12, heavy: false } })
  })
  it('재료 15, 단계 12는 어려움', () => {
    const d = difficulty(make(15, 12))
    expect(d.level).toBe('어려움')
    expect(d.score).toBe(4)
  })
  it('재료 5, 단계 4, 튀김은 쉬움 1점', () => {
    const d = difficulty(make(5, 4, { methods: ['튀김'] }))
    expect(d).toEqual({ level: '쉬움', score: 1, basis: { required: 5, steps: 4, heavy: true } })
  })
  it('재료 10, 단계 8은 보통 2점', () => {
    expect(difficulty(make(10, 8))).toMatchObject({ level: '보통', score: 2 })
  })
  it('단계에 반죽이 있으면 손 많이 감', () => {
    expect(difficulty(make(5, 4, { body: '반죽을 치댄다' })).basis.heavy).toBe(true)
  })
})

describe('폴더와 파일 이름', () => {
  it('폴더 자리', () => {
    expect(folderPath({ ...gold, difficulty: '보통' })).toEqual(['레시피', '한식', '돼지고기', '볶음', '보통'])
  })
  it('주재료·조리법이 비면 기타', () => {
    const r = { ...gold, tags: { ...gold.tags, mains: [], methods: [] }, difficulty: '쉬움' as const }
    expect(folderPath(r)).toEqual(['레시피', '한식', '기타', '기타', '쉬움'])
  })
  it('파일 이름', () => {
    expect(fileTitle(gold)).toBe('기사식당 바싹 제육볶음 (셰프호윤 Chef Hoyoon)')
    const bad = { ...gold, title: 'a/b:c\\d?e*f"g<h>i|j' }
    expect(fileTitle(bad)).toBe('a·b·c·d·e·f·g·h·i·j (셰프호윤 Chef Hoyoon)')
    expect(fileTitle({ ...gold, source: { ...gold.source, channel: '' } })).toBe('기사식당 바싹 제육볶음')
    expect(fileTitle({ ...gold, source: { ...gold.source, channel: null } })).toBe('기사식당 바싹 제육볶음')
  })
})
