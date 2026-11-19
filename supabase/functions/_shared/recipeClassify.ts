// 난이도와 보관 자리(폴더·파일 이름). 순수 함수.
import type { Difficulty, RecipeV2 } from './recipeContract.ts'

export function difficulty(r: Pick<RecipeV2, 'ingredients' | 'steps' | 'tags'>): {
  level: Difficulty
  score: number
  basis: { required: number; steps: number; heavy: boolean }
} {
  const required = r.ingredients.filter((g) => !g.optional).length
  const steps = r.steps.length
  const heavy = r.tags.methods.some((m) => m === '튀김' || m === '오븐') || r.steps.some((s) => s.body.includes('반죽'))
  const score = (required <= 8 ? 0 : required <= 14 ? 1 : 2) + (steps <= 6 ? 0 : steps <= 11 ? 1 : 2) + (heavy ? 1 : 0)
  const level: Difficulty = score <= 1 ? '쉬움' : score <= 3 ? '보통' : '어려움'
  return { level, score, basis: { required, steps, heavy } }
}

export function folderPath(r: RecipeV2 & { difficulty: Difficulty }): string[] {
  return ['레시피', r.tags.cuisine, r.tags.mains[0] ?? '기타', r.tags.methods[0] ?? '기타', r.difficulty]
}

export function fileTitle(r: RecipeV2): string {
  const clean = (s: string) => s.replace(/[/:\\?*"<>|]/g, '·')
  const channel = r.source.channel
  return channel ? `${clean(r.title)} (${clean(channel)})` : clean(r.title)
}
