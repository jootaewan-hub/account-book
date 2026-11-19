// 레시피 탭의 자료 층. 장보기 createWishStore와 같은 꼴(읽기, Realtime, 다시 보일 때 다시 읽기).
import type { SupabaseClient } from '@supabase/supabase-js'
import { readAllPages } from '../../../supabase/functions/_shared/pagination'
import { normalizeRecipeUrl } from '../../../supabase/functions/_shared/recipeSource'
import type { Correction, Origin, ReviewItem } from '../../../supabase/functions/_shared/recipeContract'
import { toStoredRecipe, type StoredRecipe } from '../../../supabase/functions/_shared/recipeStored'
import { groceryCategoryFor, nameKey, type PantryEntry } from './groceryLink'

export type AddUrlResult = { kind: 'added' | 'exists_recipe' | 'exists_job' | 'invalid'; id?: string }
export type RetryResult = 'retried' | 'exists_job' | 'unchanged'
export type ReviewChoice = { value: string; origin: Origin; at_seconds: number | null }
export type PantryState = 'have' | 'always'

export type RecipeSummary = {
  id: string; title: string; summary: string | null; status: 'review' | 'saved' | 'archived'
  source_key: string; source_url: string | null; source_title: string | null; channel: string | null
  cuisine: string; mains: string[]; main_details: string[]; methods: string[]; occasions: string[]
  difficulty: string | null; favorite: boolean; rating: number | null; memo: string | null
  servings: number | null; servings_origin: string | null; review_count: number; added_at: string; updated_at: string
}
export type InboxJob = {
  id: string; url: string; source_key: string; state: 'waiting' | 'processing' | 'done' | 'failed'
  stage: string | null; fail_reason: string | null; recipe_id: string | null; attempts: number; added_at: string
}
export type WorkerStatus = { last_seen_at: string | null; version: string | null }
export type DictEntry = { id: string; name: string; aliases: string[]; category: string }
export type BoughtItem = { name: string; bought_at: string | null }

/** 앱이 고칠 수 있는 칸(DB의 칸 단위 update 권한과 같다) */
export type RecipePatch = Partial<{
  title: string; summary: string | null; memo: string | null; rating: number | null; favorite: boolean
  cuisine: string; mains: string[]; main_details: string[]; methods: string[]; occasions: string[]; difficulty: string | null
}>
const PATCH_KEYS = ['title', 'summary', 'memo', 'rating', 'favorite', 'cuisine', 'mains', 'main_details', 'methods', 'occasions', 'difficulty'] as const

export interface RecipeStore {
  listRecipes(): Promise<RecipeSummary[]>
  getRecipe(id: string): Promise<StoredRecipe | null>
  listInbox(): Promise<InboxJob[]>
  workerStatus(): Promise<WorkerStatus | null>
  listPantry(): Promise<(PantryEntry & { source: string })[]>
  listDict(): Promise<DictEntry[]>
  recentBought(): Promise<BoughtItem[]>
  activeGroceryNames(): Promise<string[]>
  addUrl(input: string): Promise<AddUrlResult>
  retry(jobId: string): Promise<RetryResult>
  resolveReview(recipeId: string, index: number, choice: ReviewChoice): Promise<void>
  revertCorrection(recipeId: string, index: number): Promise<void>
  update(recipeId: string, patch: RecipePatch): Promise<void>
  archive(recipeId: string): Promise<void>
  setPantry(key: string, state: PantryState | null): Promise<void>
  addMissingToGrocery(recipe: { ingredients: readonly { name: string; ingredient_key?: string | null }[] }, keys: string[]): Promise<number>
  subscribe(changed: () => void): () => void
}

type DbError = { code?: string; message: string } | null
function checked<T>({ data, error }: { data: T; error: DbError }): T {
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') throw new Error('레시피 설정이 아직 적용되지 않았어요.')
    throw new Error(error.message)
  }
  return data
}
const GONE = '다른 기기에서 이 레시피를 지웠거나 바꿨어요. 목록을 다시 확인해 주세요.'

// ── 고침·확인 대상 해석 ─────────────────────────────────────────────
type Target =
  | { kind: 'servings'; field: string }
  | { kind: 'ingredients' | 'steps' | 'glossary'; index: number; field: string }
  | { kind: 'conflicts'; index: number }

export function parseTarget(target: string): Target | null {
  const s = /^servings\.(value|origin|basis)$/.exec(target)
  if (s) return { kind: 'servings', field: s[1] }
  const c = /^conflicts\[(\d+)\]/.exec(target)
  if (c) return { kind: 'conflicts', index: Number(c[1]) }
  const m = /^(ingredients|steps|glossary)\[(\d+)\]\.([a-z_]+)$/.exec(target)
  if (m) return { kind: m[1] as 'ingredients' | 'steps' | 'glossary', index: Number(m[2]), field: m[3] }
  return null
}
const baseOf = (t: Target) => (t.kind === 'servings' ? 'servings' : `${t.kind}[${(t as { index: number }).index}]`)
const NUMERIC = new Set(['amount', 'at_seconds', 'timer_seconds', 'video_start_seconds', 'suggested_amount', 'value', 'position'])

function toValue(field: string, v: string | number | null): string | number | null {
  if (v === null || v === 'null' || v === '') return null
  if (NUMERIC.has(field)) {
    const n = Number(v)
    if (!Number.isFinite(n)) throw new Error('숫자로 읽을 수 없는 값이에요.')
    return n
  }
  return v
}

type RowPatch = Record<string, unknown>
class Edits {
  recipe: RowPatch = {}
  rows = new Map<string, RowPatch>() // `${kind}:${index}`
  glossary = new Map<number, RowPatch>()
  set(t: Target, field: string, value: unknown) {
    if (t.kind === 'servings') {
      if (field === 'value') this.recipe.servings = value
      else if (field === 'origin') this.recipe.servings_origin = value
      else if (field === 'basis') this.recipe.servings_basis = value
    } else if (t.kind === 'glossary') {
      this.glossary.set(t.index, { ...this.glossary.get(t.index), [field]: value })
    } else if (t.kind !== 'conflicts') {
      const k = `${t.kind}:${t.index}`
      this.rows.set(k, { ...this.rows.get(k), [field]: value })
    }
  }
}

export function createRecipeStore(client: SupabaseClient, householdId: string, userId: string): RecipeStore {
  const r = () => client.schema('recipe')
  const recipes = () => r().from('recipes')
  const g = () => client.schema('grocery')

  async function recipeRow(id: string, columns: string) {
    const row = checked(await recipes().select(columns).eq('household_id', householdId).eq('id', id).maybeSingle()) as unknown as Record<string, unknown> | null
    if (!row) throw new Error(GONE)
    return row
  }
  async function rowsOf(kind: 'ingredients' | 'steps', recipeId: string) {
    return checked(await r().from(kind).select('id,position').eq('household_id', householdId).eq('recipe_id', recipeId).order('position', { ascending: true })) as unknown as { id: string; position: number }[]
  }
  async function applyEdits(recipeId: string, edits: Edits, recipePatch: RowPatch) {
    for (const kind of ['ingredients', 'steps'] as const) {
      const wanted = [...edits.rows].filter(([k]) => k.startsWith(`${kind}:`))
      if (!wanted.length) continue
      const rows = await rowsOf(kind, recipeId)
      for (const [k, patch] of wanted) {
        const row = rows[Number(k.split(':')[1])]
        if (!row) throw new Error('그 줄이 이미 바뀌었어요. 목록을 다시 확인해 주세요.')
        checked(await r().from(kind).update(patch).eq('household_id', householdId).eq('id', row.id).select('id'))
      }
    }
    const done = checked(await recipes().update(recipePatch).eq('household_id', householdId).eq('id', recipeId).select('id')) as { id: string }[] | null
    if (!done?.length) throw new Error(GONE)
  }

  return {
    async listRecipes() {
      const cols = 'id,title,summary,status,source_key,source_url,source_title,channel,cuisine,mains,main_details,methods,occasions,difficulty,favorite,rating,memo,servings,servings_origin,review_count,added_at,updated_at'
      const rows = await readAllPages<RecipeSummary>((from, to) => recipes().select(cols, { count: from === 0 ? 'exact' : undefined })
        .eq('household_id', householdId).order('added_at', { ascending: false }).order('id', { ascending: false }).range(from, to))
      return rows.map((x) => ({ ...x, servings: x.servings == null ? null : Number(x.servings) }))
    },
    async getRecipe(id) {
      const row = checked(await recipes().select('*').eq('household_id', householdId).eq('id', id).maybeSingle()) as Record<string, unknown> | null
      if (!row) return null
      const [ing, steps] = await Promise.all([
        r().from('ingredients').select('*').eq('household_id', householdId).eq('recipe_id', id).order('position', { ascending: true }),
        r().from('steps').select('*').eq('household_id', householdId).eq('recipe_id', id).order('position', { ascending: true }),
      ])
      return toStoredRecipe(row, checked(ing) as Record<string, unknown>[], checked(steps) as Record<string, unknown>[])
    },
    async listInbox() {
      return checked(await r().from('inbox').select('id,url,source_key,state,stage,fail_reason,recipe_id,attempts,added_at')
        .eq('household_id', householdId).order('added_at', { ascending: false }).limit(100)) as InboxJob[]
    },
    async workerStatus() {
      const row = checked(await r().from('worker_status').select('last_seen_at,version').maybeSingle()) as WorkerStatus | null
      return row ?? null
    },
    async listPantry() {
      return checked(await r().from('pantry').select('ingredient_key,state,source').eq('household_id', householdId)) as (PantryEntry & { source: string })[]
    },
    async listDict() {
      return readAllPages<DictEntry>((from, to) => r().from('ingredient_dict').select('id,name,aliases,category', { count: from === 0 ? 'exact' : undefined })
        .order('id', { ascending: true }).range(from, to))
    },
    async recentBought() {
      const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
      return checked(await g().from('items').select('name,bought_at').eq('household_id', householdId).gte('bought_at', since)) as BoughtItem[]
    },
    async activeGroceryNames() {
      const rows = checked(await g().from('items').select('name').eq('household_id', householdId).is('bought_at', null)) as { name: string }[]
      return rows.map((x) => x.name)
    },

    async addUrl(input) {
      const n = normalizeRecipeUrl(input)
      if (!n) return { kind: 'invalid' }
      const found = checked(await recipes().select('id,status').eq('household_id', householdId).eq('source_key', n.key)) as { id: string; status: string }[]
      const live = found.find((x) => x.status !== 'archived')
      if (live) return { kind: 'exists_recipe', id: live.id }
      const { data, error } = await r().from('inbox')
        .insert({ household_id: householdId, url: n.url, source_key: n.key, added_by: userId }).select('id').single()
      if (error) {
        if (error.code === '23505') return { kind: 'exists_job' }
        checked({ data: null, error })
      }
      return { kind: 'added', id: (data as { id: string } | null)?.id }
    },
    async retry(jobId) {
      const { data, error } = await r().rpc('retry_job', { p_job: jobId })
      if (error) {
        if (error.code === '23505') return 'exists_job'
        checked({ data: null, error })
      }
      return data ? 'retried' : 'unchanged'
    },

    async resolveReview(recipeId, index, choice) {
      const row = await recipeRow(recipeId, 'status,review_items')
      const items = (row.review_items ?? []) as ReviewItem[]
      const item = items[index]
      if (!item) throw new Error('이미 처리된 확인 항목이에요.')
      const rest = items.filter((_, i) => i !== index)
      const t = parseTarget(item.target)
      const edits = new Edits()
      if (t && t.kind !== 'conflicts') {
        // 사용자가 고른 값은 출처 user, 영상 시각은 없다
        const field = t.field
        if (field !== 'origin' && field !== 'at_seconds') edits.set(t, field, toValue(field, choice.value))
        if (t.kind === 'servings') {
          edits.set(t, 'origin', 'user')
        } else if (t.kind === 'glossary') {
          edits.set(t, 'origin', 'user'); edits.set(t, 'at_seconds', null)
        } else if (t.kind === 'steps' && field === 'cue') {
          edits.set(t, 'cue_origin', 'user')
        } else {
          edits.set(t, 'origin', 'user')
          if (t.kind === 'ingredients') edits.set(t, 'at_seconds', null)
        }
        const base = baseOf(t)
        const stillFlagged = rest.some((x) => { const o = parseTarget(x.target); return o && o.kind !== 'conflicts' && baseOf(o) === base })
        if (!stillFlagged && (t.kind === 'ingredients' || t.kind === 'steps')) edits.set(t, 'needs_review', false)
      }
      const patch: RowPatch = { ...edits.recipe, review_items: rest }
      if (edits.glossary.size) {
        const cur = ((await recipeRow(recipeId, 'glossary')).glossary ?? []) as RowPatch[]
        patch.glossary = cur.map((x, i) => (edits.glossary.has(i) ? { ...x, ...edits.glossary.get(i) } : x))
      }
      if (rest.length === 0 && row.status === 'review') patch.status = 'saved'
      await applyEdits(recipeId, edits, patch)
    },

    async revertCorrection(recipeId, index) {
      const row = await recipeRow(recipeId, 'corrections,glossary')
      const list = (row.corrections ?? []) as Correction[]
      const c = list[index]
      if (!c) throw new Error('이미 되돌린 고침이에요.')
      const t = parseTarget(c.target)
      if (!t || t.kind === 'conflicts') throw new Error('이 고침은 되돌릴 수 없어요.')
      const base = baseOf(t)
      const siblings = (field: string) => list.flatMap((x, i) => { const o = parseTarget(x.target); return o && o.kind !== 'conflicts' && baseOf(o) === base && o.field === field ? [i] : [] })
      const group = new Set<number>([index])
      if (t.field === 'origin') siblings('at_seconds').forEach((i) => group.add(i))
      else if (t.field === 'at_seconds') siblings('origin').forEach((i) => group.add(i))
      else { siblings('origin').forEach((i) => group.add(i)); siblings('at_seconds').forEach((i) => group.add(i)) }

      const edits = new Edits()
      for (const i of [...group].sort((a, b) => a - b)) {
        const ci = list[i]
        const ti = parseTarget(ci.target) as Exclude<Target, { kind: 'conflicts' }>
        const value = toValue(ti.field, ci.before)
        if (ti.field === 'origin' && value === null && ti.kind !== 'servings') continue // 출처 칸은 비울 수 없다
        edits.set(ti, ti.field, value)
        if (ti.kind === 'servings' && ti.field === 'value' && value === null) edits.set(ti, 'origin', null)
      }
      const patch: RowPatch = { ...edits.recipe, corrections: list.filter((_, i) => !group.has(i)) }
      if (edits.glossary.size) {
        const cur = (row.glossary ?? []) as RowPatch[]
        patch.glossary = cur.map((x, i) => (edits.glossary.has(i) ? { ...x, ...edits.glossary.get(i) } : x))
      }
      await applyEdits(recipeId, edits, patch)
    },

    async update(recipeId, patch) {
      const clean: RowPatch = {}
      for (const k of PATCH_KEYS) if (k in patch) clean[k] = patch[k]
      if ('title' in clean) {
        const title = String(clean.title ?? '').trim()
        if (!title || title.length > 80) throw new Error('이름을 80자 안에서 적어 주세요.')
        clean.title = title
      }
      if ('memo' in clean) {
        const memo = typeof clean.memo === 'string' ? clean.memo.trim() : null
        if (memo && memo.length > 2000) throw new Error('메모는 2000자 안에서 적어 주세요.')
        clean.memo = memo || null
      }
      if ('rating' in clean && clean.rating !== null && !(Number.isInteger(clean.rating) && (clean.rating as number) >= 1 && (clean.rating as number) <= 5)) {
        throw new Error('별점은 1~5 사이 정수예요.')
      }
      if (!Object.keys(clean).length) return
      await applyEdits(recipeId, new Edits(), clean)
    },

    async archive(recipeId) {
      await applyEdits(recipeId, new Edits(), { status: 'archived' })
    },

    async setPantry(key, state) {
      const pantry = () => r().from('pantry')
      if (state === null) {
        checked(await pantry().delete().eq('household_id', householdId).eq('ingredient_key', key))
        return
      }
      // upsert는 on conflict 때 가구·재료·담은 사람 칸까지 고치려 해서 칸 단위 권한에 막힌다. 고치고, 없으면 넣는다.
      const change = async () => checked(await pantry().update({ state, source: 'manual', noted_at: new Date().toISOString() })
        .eq('household_id', householdId).eq('ingredient_key', key).select('ingredient_key')) as unknown[] | null
      if ((await change())?.length) return
      const { error } = await pantry().insert({ household_id: householdId, ingredient_key: key, state, source: 'manual', added_by: userId })
      if (error?.code === '23505') { await change(); return }
      checked({ data: null, error })
    },

    async addMissingToGrocery(recipe, keys) {
      const wanted = new Map<string, string>() // 키 → 재료 이름
      for (const g of recipe.ingredients) {
        if (g.ingredient_key && keys.includes(g.ingredient_key) && !wanted.has(g.ingredient_key)) wanted.set(g.ingredient_key, g.name)
      }
      if (!wanted.size) return 0
      const dict = checked(await r().from('ingredient_dict').select('id,category').in('id', [...wanted.keys()])) as { id: string; category: string }[]
      const categoryOf = new Map(dict.map((d) => [d.id, d.category]))
      const present = new Set((checked(await g().from('items').select('name').eq('household_id', householdId).is('bought_at', null)) as { name: string }[]).map((x) => nameKey(x.name)))
      const rows: { household_id: string; name: string; category: string; spec: null; count: number; added_by: string }[] = []
      for (const [key, name] of wanted) {
        const clipped = name.trim().slice(0, 60)
        if (!clipped || present.has(nameKey(clipped))) continue
        present.add(nameKey(clipped))
        rows.push({ household_id: householdId, name: clipped, category: groceryCategoryFor(categoryOf.get(key) ?? ''), spec: null, count: 1, added_by: userId })
      }
      if (!rows.length) return 0
      checked(await g().from('items').insert(rows))
      return rows.length
    },

    subscribe(changed) {
      let timer: ReturnType<typeof setTimeout> | undefined
      const update = () => { clearTimeout(timer); timer = setTimeout(changed, 250) }
      const filter = `household_id=eq.${householdId}`
      let channel = client.channel(`recipes-${householdId}-${crypto.randomUUID()}`)
      for (const table of ['inbox', 'recipes', 'pantry']) {
        for (const event of ['INSERT', 'UPDATE'] as const) channel = channel.on('postgres_changes', { event, schema: 'recipe', table, filter }, update)
        // DELETE 이벤트는 기본키 말고는 거를 수 없다
        channel = channel.on('postgres_changes', { event: 'DELETE', schema: 'recipe', table }, update)
      }
      // 처리기 상태 줄에는 가구 칸이 없어 거르지 않고, 바뀌면 다시 읽는다
      channel = channel.on('postgres_changes', { event: '*', schema: 'recipe', table: 'worker_status' }, update)
      channel.subscribe()
      const visible = () => { if (typeof document !== 'undefined' && document.visibilityState === 'visible') update() }
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', visible)
      return () => {
        clearTimeout(timer)
        if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', visible)
        void client.removeChannel(channel)
      }
    },
  }
}
