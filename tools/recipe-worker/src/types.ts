// 처리기 안에서 함께 쓰는 낱말·꼴. 서버 쪽 꼴은 supabase/functions/_shared에서 가져온다.
import type { RecipeV2 } from '../../../supabase/functions/_shared/recipeContract.ts'
import type { ExportItem } from '../../../supabase/functions/_shared/recipeStored.ts'

export type { RecipeV2, ExportItem }

/** 처리기가 새로 알게 된 재료 낱말(서버 사전에 덧붙인다) */
export type DictEntry = { id: string; name: string; aliases: string[]; category: string; origin: 'added' }

export type Job = { id: string; url: string; source_key: string }
