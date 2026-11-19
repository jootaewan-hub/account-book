// 레시피 탭의 자료 층. 장보기 createWishStore와 같은 꼴(읽기, Realtime, 다시 보일 때 다시 읽기).
import type { SupabaseClient } from '@supabase/supabase-js'
import { readAllPages } from '../../../supabase/functions/_shared/pagination'
import { normalizeRecipeUrl } from '../../../supabase/functions/_shared/recipeSource'
import { MEASURING_TOOLS, type Correction, type Origin, type ReviewItem } from '../../../supabase/functions/_shared/recipeContract'
import { toStoredRecipe, type StoredRecipe } from '../../../supabase/functions/_shared/recipeStored'
import { parseAmountValue, parseSecondsValue, parseServingsValue, sameUnit } from '../../../supabase/functions/_shared/recipeValue'
import type { ExportIssue } from '../../../supabase/functions/_shared/recipeWorkerStatus'
import { groceryCategoryFor, nameKey, type PantryEntry } from './groceryLink'

export type AddUrlResult = { kind: 'added' | 'exists_recipe' | 'exists_job' | 'invalid'; id?: string }
/** exists_recipe: 그 사이 같은 글이 레시피북에 들어와 있어 다시 돌리지 않았다(그 레시피를 연다) */
export type RetryResult = 'retried' | 'exists_job' | 'unchanged' | { kind: 'exists_recipe'; id: string }
export type ReviewChoice = { value: string; origin: Origin; at_seconds: number | null }
export type PantryState = 'have' | 'always'
export type PantrySource = 'manual' | 'grocery'

export type RecipeSummary = {
  id: string; title: string; summary: string | null; status: 'review' | 'saved' | 'archived'
  source_key: string; source_url: string | null; source_title: string | null; channel: string | null
  cuisine: string; mains: string[]; main_details: string[]; methods: string[]; occasions: string[]
  difficulty: string | null; favorite: boolean; rating: number | null; memo: string | null
  servings: number | null; servings_origin: string | null; review_count: number; added_at: string; updated_at: string
  /** 찾기(이름·재료)에 쓰는 재료 이름들 */
  ingredient_names?: string[]
}
export type InboxJob = {
  id: string; url: string; source_key: string; state: 'waiting' | 'processing' | 'done' | 'failed'
  stage: string | null; fail_reason: string | null; recipe_id: string | null; attempts: number; added_at: string
}
/** 처리기 상태. export_issue는 사본(드라이브·옵시디언)을 쓰지 못한 까닭(정해 둔 말), export_checked_at은 마지막으로 써 본 시각 */
export type WorkerStatus = { last_seen_at: string | null; version: string | null; export_issue?: ExportIssue | null; export_checked_at?: string | null }
export type DictEntry = { id: string; name: string; aliases: string[]; category: string }
export type BoughtItem = { name: string; bought_at: string | null }
/** recipe.cookable 한 줄: 사전에 있는 필수 재료 need개 중 가진 것 have개. 사전에 없는 재료는 세지 않는다 */
export type CookableRow = { recipe_id: string; have: number; need: number; missing: string[] }

/** 앱이 고칠 수 있는 칸(DB의 칸 단위 update 권한과 같다) */
export type RecipePatch = Partial<{
  title: string; summary: string | null; memo: string | null; rating: number | null; favorite: boolean
  cuisine: string; mains: string[]; main_details: string[]; methods: string[]; occasions: string[]; difficulty: string | null
}>
const PATCH_KEYS = ['title', 'summary', 'memo', 'rating', 'favorite', 'cuisine', 'mains', 'main_details', 'methods', 'occasions', 'difficulty'] as const

/** 재료 한 줄에서 고칠 수 있는 칸. 고치면 출처는 user가 된다 */
export type IngredientPatch = Partial<{ name: string; amount: number | null; unit: string | null; amount_text: string | null; note: string | null }>
/** 단계 한 줄에서 고칠 수 있는 칸 */
export type StepPatch = Partial<{ title: string; body: string }>

export interface RecipeStore {
  listRecipes(): Promise<RecipeSummary[]>
  getRecipe(id: string): Promise<StoredRecipe | null>
  listInbox(): Promise<InboxJob[]>
  workerStatus(): Promise<WorkerStatus | null>
  listPantry(): Promise<(PantryEntry & { source: string })[]>
  listDict(): Promise<DictEntry[]>
  recentBought(): Promise<BoughtItem[]>
  /** 모자란 재료가 maxMissing개 이하인 레시피(저장된 것만) */
  cookable(maxMissing: number): Promise<CookableRow[]>
  activeGroceryNames(): Promise<string[]>
  addUrl(input: string): Promise<AddUrlResult>
  retry(jobId: string): Promise<RetryResult>
  /** 실패한 일을 목록에서 치운다(지우지 않는다) */
  dismiss(jobId: string): Promise<void>
  resolveReview(recipeId: string, index: number, choice: ReviewChoice): Promise<void>
  revertCorrection(recipeId: string, index: number): Promise<void>
  update(recipeId: string, patch: RecipePatch): Promise<void>
  /** index는 재료 목록 안의 순서(0부터). 값을 고친 줄의 출처는 user, 영상 시각은 비운다 */
  editIngredient(recipeId: string, index: number, patch: IngredientPatch): Promise<void>
  editStep(recipeId: string, index: number, patch: StepPatch): Promise<void>
  archive(recipeId: string): Promise<void>
  /** source는 가진 재료에 넣은 길: 직접(manual) 또는 장보기에서 산 것(grocery). state가 null이면 끈다 */
  setPantry(key: string, state: PantryState | null, source?: PantrySource): Promise<void>
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

const ROW = /^(ingredients|steps|principles)\[(\d+)\]/
/** 확인 항목·고친 곳이 가리키는 줄("ingredients[6]"). 줄 전체("ingredients[6]")와 칸("ingredients[6].amount") 모두. 줄이 아니면 null */
export function rowOf(target: string): { kind: 'ingredients' | 'steps' | 'principles'; index: number; key: string } | null {
  const m = ROW.exec(target)
  return m ? { kind: m[1] as 'ingredients' | 'steps' | 'principles', index: Number(m[2]), key: `${m[1]}[${m[2]}]` } : null
}
/** 그 줄을 가리키는가("ingredients[1]"은 "ingredients[10]"을 가리키지 않는다) */
const onRow = (target: string, key: string) => target === key || target.startsWith(`${key}.`)

/** 되돌리면 DB 제약과 맞지 않거나(숫자 분량 옆의 덧붙임) 영상 밖 시각으로 돌아가는 고침 */
export const NOT_REVERTABLE = new Set(['suggested_amount', 'suggested_unit', 'video_start_seconds'])
const UNREADABLE = '숫자로 읽을 수 없는 값이에요.'
const blank = (v: string | null | undefined) => v === null || v === undefined || v === '' || v === 'null'

/**
 * 확인 후보·고친 곳의 값 글(_shared/recipeValue.ts 꼴)을 칸에 쓴다.
 * 분량은 "2큰술"처럼 단위가 붙어 와도 읽고, 단위가 그 줄과 다르면 단위도 함께 쓴다(단위를 말없이 버리지 않는다).
 * rowUnit은 그 줄의 지금 단위(분량 칸일 때만 필요).
 */
function setValue(edits: Edits, t: Exclude<Target, { kind: 'conflicts' }>, field: string, raw: string | null, rowUnit: string | null = null) {
  if (t.kind === 'servings' && field === 'value') {
    if (blank(raw)) { edits.set(t, 'value', null); return }
    const n = parseServingsValue(raw!)
    if (n === null) throw new Error(UNREADABLE)
    edits.set(t, 'value', n)
    return
  }
  if (field === 'amount' || field === 'suggested_amount') {
    if (blank(raw)) { edits.set(t, field, null); return }
    let p = parseAmountValue(raw!)
    if (!p && rowUnit && raw!.endsWith(rowUnit)) {
      // "1봉지(100g)"처럼 줄의 단위가 통째로 붙은 값(formatAmountValue가 쓴 꼴)은 단위를 떼고 수만 읽고 줄 단위는 그대로 둔다
      const n = parseAmountValue(raw!.slice(0, raw!.length - rowUnit.length))
      if (n && n.unit === null) p = { amount: n.amount, unit: rowUnit }
    }
    if (!p) throw new Error(UNREADABLE)
    edits.set(t, field, p.amount)
    const unitField = field === 'amount' ? 'unit' : 'suggested_unit'
    if (p.unit !== null && !sameUnit(p.unit, rowUnit)) edits.set(t, unitField, p.unit)
    return
  }
  if (field === 'timer_seconds' || field === 'at_seconds') {
    if (blank(raw)) { edits.set(t, field, null); return }
    const n = parseSecondsValue(raw!)
    if (n === null) throw new Error(UNREADABLE)
    edits.set(t, field, n)
    return
  }
  if (field === 'video_start_seconds' || field === 'position') {
    if (blank(raw)) { edits.set(t, field, null); return }
    if (!/^\d+$/.test(raw!.trim())) throw new Error(UNREADABLE)
    edits.set(t, field, Number(raw))
    return
  }
  edits.set(t, field, blank(raw) ? null : raw)
}

/** 사람이 고른 값의 출처: user, 영상 시각 없음(되돌리기도 사람의 고름이다). 인분은 값이 비면 출처도 비운다 */
function markUser(edits: Edits, t: Exclude<Target, { kind: 'conflicts' }>, field: string) {
  if (t.kind === 'servings') {
    const v = edits.recipe.servings
    edits.set(t, 'origin', v === undefined ? 'user' : v === null ? null : 'user')
  } else if (t.kind === 'glossary') {
    edits.set(t, 'origin', 'user'); edits.set(t, 'at_seconds', null)
  } else if (t.kind === 'steps' && field === 'cue') {
    edits.set(t, 'cue_origin', 'user')
  } else {
    edits.set(t, 'origin', 'user')
    if (t.kind === 'ingredients') edits.set(t, 'at_seconds', null)
  }
}

type RowPatch = Record<string, unknown>
class Edits {
  recipe: RowPatch = {}
  rows = new Map<string, RowPatch>() // `${kind}:${index}`
  glossary = new Map<number, RowPatch>()
  /** recipes.principles(JSON) 줄의 needs_review */
  principles = new Map<number, RowPatch>()
  /** 줄의 확인 표시를 끈다(재료·단계는 줄, 원리는 레시피의 JSON) */
  unflag(row: { kind: 'ingredients' | 'steps' | 'principles'; index: number }) {
    if (row.kind === 'principles') this.principles.set(row.index, { ...this.principles.get(row.index), needs_review: false })
    else this.set({ kind: row.kind, index: row.index, field: '' }, 'needs_review', false)
  }
  set(t: Target, field: string, value: unknown) {
    if (t.kind === 'servings') {
      // check (servings is null or servings_suggested is null): 출처 인분을 쓰면 덧붙인 인분은 비운다
      if (field === 'value') { this.recipe.servings = value; if (value !== null) this.recipe.servings_suggested = null }
      else if (field === 'origin') this.recipe.servings_origin = value
      else if (field === 'basis') this.recipe.servings_basis = value
    } else if (t.kind === 'glossary') {
      this.glossary.set(t.index, { ...this.glossary.get(t.index), [field]: value })
    } else if (t.kind !== 'conflicts') {
      const k = `${t.kind}:${t.index}`
      // check (amount is null or (suggested_amount is null and suggested_unit is null))
      const extra = t.kind === 'ingredients' && field === 'amount' && value !== null ? { suggested_amount: null, suggested_unit: null } : {}
      this.rows.set(k, { ...this.rows.get(k), [field]: value, ...extra })
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
    // 레시피 JSON 칸(용어 풀이·원리)의 줄을 지금 값에 합친다
    const json = ([['glossary', edits.glossary], ['principles', edits.principles]] as const).filter(([, m]) => m.size > 0)
    if (json.length) {
      const cur = await recipeRow(recipeId, json.map(([c]) => c).join(','))
      for (const [col, m] of json) recipePatch[col] = ((cur[col] ?? []) as RowPatch[]).map((x, i) => (m.has(i) ? { ...x, ...m.get(i) } : x))
    }
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
    if (!Object.keys(recipePatch).length) return // 재료·단계만 고칠 때는 DB 트리거가 레시피의 updated_at을 바꾼다
    const done = checked(await recipes().update(recipePatch).eq('household_id', householdId).eq('id', recipeId).select('id')) as { id: string }[] | null
    if (!done?.length) throw new Error(GONE)
  }

  /** 그 줄(줄 전체 항목 포함)의 확인 항목을 지운 review_items(남은 것이 없고 확인 중이었으면 saved). 지울 것이 없으면 빈 패치 */
  async function dropReview(recipeId: string, row: string): Promise<RowPatch> {
    const cur = await recipeRow(recipeId, 'status,review_items')
    const items = (cur.review_items ?? []) as ReviewItem[]
    const rest = items.filter((x) => !onRow(x.target, row))
    if (rest.length === items.length) return {}
    return rest.length === 0 && cur.status === 'review' ? { review_items: rest, status: 'saved' } : { review_items: rest }
  }
  /** 재료 줄의 지금 단위(분량 값을 쓸 때 단위가 바뀌는지 보려고) */
  async function ingredientUnits(recipeId: string, index: number): Promise<{ unit: string | null; suggested_unit: string | null }> {
    const rows = checked(await r().from('ingredients').select('id,position,unit,suggested_unit').eq('household_id', householdId).eq('recipe_id', recipeId).order('position', { ascending: true })) as unknown as { unit: string | null; suggested_unit: string | null }[]
    const row = rows[index]
    if (!row) throw new Error('그 줄이 이미 바뀌었어요. 목록을 다시 확인해 주세요.')
    return { unit: row.unit ?? null, suggested_unit: row.suggested_unit ?? null }
  }
  const unitFor = async (recipeId: string, t: Exclude<Target, { kind: 'conflicts' }>, field: string) => {
    if (t.kind !== 'ingredients' || (field !== 'amount' && field !== 'suggested_amount')) return null
    const u = await ingredientUnits(recipeId, t.index)
    return field === 'amount' ? u.unit : u.suggested_unit
  }

  return {
    async listRecipes() {
      const cols = 'id,title,summary,status,source_key,source_url,source_title,channel,cuisine,mains,main_details,methods,occasions,difficulty,favorite,rating,memo,servings,servings_origin,review_count,added_at,updated_at'
      const rows = await readAllPages<RecipeSummary>((from, to) => recipes().select(cols, { count: from === 0 ? 'exact' : undefined })
        .eq('household_id', householdId).order('added_at', { ascending: false }).order('id', { ascending: false }).range(from, to))
      // 찾기(이름·재료)에 쓰려고 재료 이름을 함께 읽는다
      const ings = await readAllPages<{ recipe_id: string; name: string }>((from, to) => r().from('ingredients').select('recipe_id,name', { count: from === 0 ? 'exact' : undefined })
        .eq('household_id', householdId).order('recipe_id', { ascending: true }).order('position', { ascending: true }).range(from, to))
      const names = new Map<string, string[]>()
      for (const g of ings) names.set(g.recipe_id, [...(names.get(g.recipe_id) ?? []), g.name])
      return rows.map((x) => ({ ...x, servings: x.servings == null ? null : Number(x.servings), ingredient_names: names.get(x.id) ?? [] }))
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
      // 치운 실패 일은 빼고 읽는다
      return checked(await r().from('inbox').select('id,url,source_key,state,stage,fail_reason,recipe_id,attempts,added_at')
        .eq('household_id', householdId).is('dismissed_at', null).order('added_at', { ascending: false }).limit(100)) as InboxJob[]
    },
    async workerStatus() {
      const row = checked(await r().from('worker_status').select('last_seen_at,version,export_issue,export_checked_at').maybeSingle()) as WorkerStatus | null
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
    async cookable(maxMissing) {
      const { data, error } = await r().rpc('cookable', { p_household: householdId, p_max_missing: maxMissing })
      return (checked({ data, error }) ?? []) as CookableRow[]
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
      // 그 사이 같은 글이 레시피로 들어와 있으면 다시 돌리지 않고 그 레시피를 연다(addUrl과 같다)
      const job = checked(await r().from('inbox').select('source_key').eq('household_id', householdId).eq('id', jobId)) as { source_key: string }[]
      const key = job[0]?.source_key
      if (key) {
        const found = checked(await recipes().select('id,status').eq('household_id', householdId).eq('source_key', key)) as { id: string; status: string }[]
        const live = found.find((x) => x.status !== 'archived')
        if (live) return { kind: 'exists_recipe', id: live.id }
      }
      const { data, error } = await r().rpc('retry_job', { p_job: jobId })
      if (error) {
        if (error.code === '23505') return 'exists_job'
        checked({ data: null, error })
      }
      return data ? 'retried' : 'unchanged'
    },
    async dismiss(jobId) {
      const { data, error } = await r().rpc('dismiss_job', { p_job: jobId })
      checked({ data, error })
    },

    async resolveReview(recipeId, index, choice) {
      const cur = await recipeRow(recipeId, 'status,review_items,measuring_tool_basis')
      const items = (cur.review_items ?? []) as ReviewItem[]
      const item = items[index]
      if (!item) throw new Error('이미 처리된 확인 항목이에요.')
      const rest = items.filter((_, i) => i !== index)
      const t = parseTarget(item.target)
      const edits = new Edits()
      if (t && t.kind !== 'conflicts') {
        // 사용자가 고른 값은 출처 user, 영상 시각은 없다. 분량은 단위가 붙어 오면 단위도 쓴다
        const field = t.field
        if (field !== 'origin' && field !== 'at_seconds') setValue(edits, t, field, choice.value, await unitFor(recipeId, t, field))
        markUser(edits, t, field)
      }
      // 그 줄(재료·단계·원리)에 남은 확인 항목이 없으면 줄의 확인 표시를 끈다. 줄 전체를 가리키는 항목("ingredients[6]")도 같다
      const row = rowOf(item.target)
      if (row && !rest.some((x) => onRow(x.target, row.key))) edits.unflag(row)
      const patch: RowPatch = { ...edits.recipe, review_items: rest }
      if (item.target === 'measuring_tool') {
        // 계량 도구는 사람이 네 가지 중에서 고른다. 고른 근거는 user로 덧붙인다
        if (!(MEASURING_TOOLS as readonly string[]).includes(choice.value)) throw new Error('계량 도구를 목록에서 골라 주세요.')
        patch.measuring_tool = choice.value
        patch.measuring_tool_basis = [...((cur.measuring_tool_basis ?? []) as unknown[]), { origin: 'user', at_seconds: null }]
      }
      if (rest.length === 0 && cur.status === 'review') patch.status = 'saved'
      await applyEdits(recipeId, edits, patch)
    },

    async revertCorrection(recipeId, index) {
      const cur = await recipeRow(recipeId, 'status,corrections,review_items')
      const list = (cur.corrections ?? []) as Correction[]
      const c = list[index]
      if (!c) throw new Error('이미 되돌린 고침이에요.')
      const t = parseTarget(c.target)
      if (!t || t.kind === 'conflicts' || NOT_REVERTABLE.has(t.field)) throw new Error('이 고침은 되돌릴 수 없어요.')
      const base = baseOf(t)
      const siblings = (field: string) => list.flatMap((x, i) => { const o = parseTarget(x.target); return o && o.kind !== 'conflicts' && baseOf(o) === base && o.field === field ? [i] : [] })
      const group = new Set<number>([index])
      if (t.field === 'origin') siblings('at_seconds').forEach((i) => group.add(i))
      else if (t.field === 'at_seconds') siblings('origin').forEach((i) => group.add(i))
      else { siblings('origin').forEach((i) => group.add(i)); siblings('at_seconds').forEach((i) => group.add(i)) }

      // 되돌리기는 사람의 고름이다: 값은 고치기 전 값으로, 출처는 user, 영상 시각은 비운다(모델이 단 출처·시각으로 돌아가지 않는다)
      const edits = new Edits()
      const valueTargets = new Set<string>()
      for (const i of [...group].sort((a, b) => a - b)) {
        const ci = list[i]
        const ti = parseTarget(ci.target) as Exclude<Target, { kind: 'conflicts' }>
        if (ti.field === 'origin' || ti.field === 'at_seconds' || NOT_REVERTABLE.has(ti.field)) continue
        setValue(edits, ti, ti.field, ci.before, await unitFor(recipeId, ti, ti.field))
        valueTargets.add(ci.target)
      }
      if (t.kind === 'steps' && t.field === 'timer_seconds') {
        // 타이머만 되돌린다. 단계 자체의 출처는 건드리지 않는다(모델의 덧붙임 단계 글이 "직접 고침"이 되지 않게).
        // 덧붙임 단계에는 타이머를 둘 수 없다(DB 제약)
        const st = checked(await r().from('steps').select('position,origin').eq('household_id', householdId).eq('recipe_id', recipeId).order('position', { ascending: true })) as unknown as { origin: string }[]
        if (st[t.index]?.origin === 'editor') throw new Error('덧붙인 단계에는 타이머를 둘 수 없어서 되돌릴 수 없어요.')
      } else markUser(edits, t, t.field)
      const patch: RowPatch = { ...edits.recipe, corrections: list.filter((_, i) => !group.has(i)) }
      // 되돌린 값을 가리키던 확인 항목("출처에서 숫자를 찾지 못함" 따위)은 사람이 정했으니 지우고, 그 줄에 남은 것이 없으면 표시도 끈다
      const items = (cur.review_items ?? []) as ReviewItem[]
      const rest = items.filter((x) => !valueTargets.has(x.target))
      if (rest.length !== items.length) {
        patch.review_items = rest
        if (rest.length === 0 && cur.status === 'review') patch.status = 'saved'
        const row = rowOf(c.target)
        if (row && !rest.some((x) => onRow(x.target, row.key))) edits.unflag(row)
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
      // 난이도를 사람이 고르면 셈한 근거(재료·단계 수)는 더 이상 그 까닭이 아니다. 근거가 비면 화면은 "직접 고침"으로 보인다
      if ('difficulty' in clean) clean.difficulty_basis = null
      await applyEdits(recipeId, new Edits(), clean)
    },

    async editIngredient(recipeId, index, patch) {
      const edits = new Edits()
      const t: Target = { kind: 'ingredients', index, field: '' }
      const text = (v: string | null | undefined, max: number, label: string) => {
        const x = typeof v === 'string' ? v.trim() : ''
        if (x.length > max) throw new Error(`${label}은 ${max}자 안에서 적어 주세요.`)
        return x || null
      }
      const rows = checked(await r().from('ingredients').select('*').eq('household_id', householdId).eq('recipe_id', recipeId).order('position', { ascending: true })) as unknown as Record<string, unknown>[]
      const cur = rows[index]
      if (!cur) throw new Error('그 줄이 이미 바뀌었어요. 목록을 다시 확인해 주세요.')
      const was = (k: string) => (cur[k] === undefined || cur[k] === '' ? null : cur[k])
      let valueChanged = false
      if ('name' in patch) {
        const name = text(patch.name, 60, '재료 이름')
        if (!name) throw new Error('재료 이름을 적어 주세요.')
        if (name !== was('name')) {
          valueChanged = true
          edits.set(t, 'name', name)
          edits.set(t, 'ingredient_key', null) // 이름을 바꾸면 사전과의 연결은 끊는다(가진 재료로 세지 않음)
        }
      }
      if ('amount' in patch) {
        if (patch.amount !== null && patch.amount !== undefined && !(Number.isFinite(patch.amount) && patch.amount > 0)) throw new Error('분량은 0보다 큰 숫자예요.')
        const amount = patch.amount ?? null
        const before = was('amount') === null ? null : Number(was('amount'))
        if (amount !== before) {
          valueChanged = true
          edits.set(t, 'amount', amount)
          if (amount !== null && !('amount_text' in patch)) edits.set(t, 'amount_text', null) // 숫자를 적으면 "약간" 같은 글은 비운다
        }
      }
      if ('unit' in patch) { const u = text(patch.unit, 12, '단위'); if (u !== was('unit')) { valueChanged = true; edits.set(t, 'unit', u) } }
      if ('amount_text' in patch) { const x = text(patch.amount_text, 20, '분량 글'); if (x !== was('amount_text')) { valueChanged = true; edits.set(t, 'amount_text', x) } }
      if ('note' in patch) { const n = text(patch.note, 160, '메모'); if (n !== was('note')) edits.set(t, 'note', n) }
      if (!edits.rows.size) return
      const recipePatch: RowPatch = {}
      if (valueChanged) {
        // 값이 실제로 바뀐 줄만 user 출처로 두고 확인 표시를 지운다. 같은 줄의 확인 항목도 함께 지워 needs_review와 맞춘다
        edits.set(t, 'origin', 'user'); edits.set(t, 'at_seconds', null); edits.set(t, 'needs_review', false)
        Object.assign(recipePatch, await dropReview(recipeId, `ingredients[${index}]`))
      }
      await applyEdits(recipeId, edits, recipePatch)
    },
    async editStep(recipeId, index, patch) {
      const edits = new Edits()
      const t: Target = { kind: 'steps', index, field: '' }
      const rows = checked(await r().from('steps').select('*').eq('household_id', householdId).eq('recipe_id', recipeId).order('position', { ascending: true })) as unknown as Record<string, unknown>[]
      const cur = rows[index]
      if (!cur) throw new Error('그 줄이 이미 바뀌었어요. 목록을 다시 확인해 주세요.')
      if ('title' in patch) {
        const title = (patch.title ?? '').trim()
        if (!title || title.length > 30) throw new Error('단계 이름을 30자 안에서 적어 주세요.')
        if (title !== cur.title) edits.set(t, 'title', title)
      }
      if ('body' in patch) {
        const body = (patch.body ?? '').trim()
        if (!body || body.length > 400) throw new Error('단계 내용을 400자 안에서 적어 주세요.')
        if (body !== cur.body) edits.set(t, 'body', body)
      }
      if (!edits.rows.size) return
      edits.set(t, 'origin', 'user'); edits.set(t, 'needs_review', false)
      await applyEdits(recipeId, edits, await dropReview(recipeId, `steps[${index}]`))
    },

    async archive(recipeId) {
      await applyEdits(recipeId, new Edits(), { status: 'archived' })
    },

    async setPantry(key, state, source = 'manual') {
      const pantry = () => r().from('pantry')
      if (state === null) {
        checked(await pantry().delete().eq('household_id', householdId).eq('ingredient_key', key))
        return
      }
      // upsert는 on conflict 때 가구·재료·담은 사람 칸까지 고치려 해서 칸 단위 권한에 막힌다. 고치고, 없으면 넣는다.
      const change = async () => checked(await pantry().update({ state, source, noted_at: new Date().toISOString() })
        .eq('household_id', householdId).eq('ingredient_key', key).select('ingredient_key')) as unknown[] | null
      if ((await change())?.length) return
      const { error } = await pantry().insert({ household_id: householdId, ingredient_key: key, state, source, added_by: userId })
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
