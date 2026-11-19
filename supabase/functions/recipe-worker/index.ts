// 레시피 처리기(맥)용 서버 함수. 서비스 롤로 recipe 스키마를 부른다. 요청 규칙은 handle.ts, 비밀은 환경변수 RECIPE_WORKER_SECRET.
// 비밀이 비어 있으면 모든 요청이 401이다. 브라우저에서 부르지 않으므로 CORS 머리글을 달지 않는다.
import { admin } from '../_shared/edge.ts'
import { pickExports, toStoredRecipe, type ExportItem } from '../_shared/recipeStored.ts'
import { DbError, handle } from './handle.ts'

const db = admin.schema('recipe')
const secret = Deno.env.get('RECIPE_WORKER_SECRET') ?? ''

/** supabase-js 오류는 오류 번호만 남겨 DbError로 바꾼다(SQL·테이블 이름이 응답에 나가지 않게) */
function check(error: { code?: string } | null): void {
  if (error) throw new DbError(error.code ?? 'unknown')
}

Deno.serve((req) => handle(req, {
  secret,
  now: () => new Date(),
  claim: async (now) => {
    const { data, error } = await db.rpc('claim_job', { p_now: now.toISOString() })
    check(error)
    const row = (data as { id: string; source_key: string }[] | null)?.[0]
    return row ? { id: row.id, source_key: row.source_key } : null
  },
  progress: async (job, stage, now) => {
    const { data, error } = await db.rpc('job_progress', { p_job: job, p_stage: stage, p_now: now.toISOString() })
    check(error)
    return data === true
  },
  release: async (job, retryAt) => {
    const { error } = await db.rpc('job_release', { p_job: job, p_retry_at: retryAt })
    check(error)
  },
  fail: async (job, reason) => {
    const { error } = await db.rpc('job_fail', { p_job: job, p_reason: reason })
    check(error)
  },
  importRecipe: async (job, recipe, level, basis) => {
    const { data, error } = await db.rpc('import_recipe', {
      p_job: job, p_recipe: recipe, p_difficulty: level, p_difficulty_basis: basis,
    })
    check(error)
    return data as string
  },
  dictAdd: async (entries) => {
    const { error } = await db.rpc('dict_add', { p_entries: entries })
    check(error)
  },
  listExports: async () => {
    const [saved, archived, exp] = await Promise.all([
      db.from('recipes').select('id, updated_at').eq('status', 'saved'),
      db.from('recipes').select('id').eq('status', 'archived'),
      db.from('exports').select('recipe_id, drive_doc_id, drive_path, obsidian_path, exported_at'),
    ])
    check(saved.error)
    check(archived.error)
    check(exp.error)
    const { fill, trash } = pickExports(saved.data ?? [], archived.data ?? [], exp.data ?? [], 10)
    const items: ExportItem[] = []
    if (fill.length > 0) {
      const [recipes, ingredients, steps] = await Promise.all([
        db.from('recipes').select('*').in('id', fill),
        db.from('ingredients').select('*').in('recipe_id', fill).order('position'),
        db.from('steps').select('*').in('recipe_id', fill).order('position'),
      ])
      check(recipes.error)
      check(ingredients.error)
      check(steps.error)
      const prev = new Map((exp.data ?? []).map((e) => [e.recipe_id as string, e]))
      for (const id of fill) {
        const r = (recipes.data ?? []).find((x) => x.id === id)
        if (!r) continue
        const p = prev.get(id)
        items.push({
          recipe_id: id,
          recipe: toStoredRecipe(r, (ingredients.data ?? []).filter((g) => g.recipe_id === id), (steps.data ?? []).filter((s) => s.recipe_id === id)),
          prev: p ? { drive_doc_id: p.drive_doc_id, drive_path: p.drive_path, obsidian_path: p.obsidian_path } : null,
          trash: false,
        })
      }
    }
    const prev = new Map((exp.data ?? []).map((e) => [e.recipe_id as string, e]))
    for (const id of trash) {
      const p = prev.get(id)!
      items.push({ recipe_id: id, recipe: null, prev: { drive_doc_id: p.drive_doc_id, drive_path: p.drive_path, obsidian_path: p.obsidian_path }, trash: true })
    }
    return items
  },
  exported: async (input, now) => {
    const { data, error } = await db.from('recipes').select('household_id').eq('id', input.recipe_id).maybeSingle()
    check(error)
    if (!data) return false
    const { error: upsertError } = await db.from('exports').upsert({
      recipe_id: input.recipe_id, household_id: data.household_id, drive_doc_id: input.drive_doc_id,
      drive_path: input.drive_path, obsidian_path: input.obsidian_path, exported_at: now.toISOString(),
    })
    check(upsertError)
    return true
  },
  ping: async (version, now) => {
    const { error } = await db.from('worker_status').upsert({ id: 1, last_seen_at: now.toISOString(), version })
    check(error)
  },
  dict: async () => {
    const { data, error } = await db.from('ingredient_dict').select('id, name, aliases, category').order('id')
    check(error)
    return data ?? []
  },
}))
