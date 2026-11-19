// 저장된 레시피(DB 줄)를 계약 v2 꼴로 되돌리고, 보관 대상(exports)을 고른다. 순수 함수(환경변수·Deno 없음).
import type { Difficulty, RecipeV2 } from './recipeContract.ts'

/** updated_at은 처리기가 보관을 마친 뒤 exported에 snapshot_updated_at으로 돌려줘야 한다(그 사이 고친 레시피가 다시 대상이 되게) */
export type StoredRecipe = RecipeV2 & {
  id: string
  /** 사람이 "정하지 않음"으로 두면 null(보관 자리는 recipeClassify의 DIFFICULTY_UNSET) */
  difficulty: Difficulty | null
  difficulty_basis: { required: number; steps: number; heavy: boolean } | null
  memo: string | null
  rating: number | null
  favorite: boolean
  saved_at: string
  updated_at: string
}

export type ExportItem = {
  recipe_id: string
  recipe: StoredRecipe | null
  prev: { drive_doc_id: string | null; drive_path: string | null; obsidian_path: string | null } | null
  trash: boolean
}

type Row = Record<string, unknown>

/** 빈 값은 키를 빼서 계약의 optional 칸이 null을 받지 못해도 통과하게 한다 */
function compact<T extends Row>(o: T, keep: readonly string[] = []): T {
  return Object.fromEntries(Object.entries(o).filter(([k, v]) => v !== null && v !== undefined || keep.includes(k))) as T
}

export function toStoredRecipe(r: Row, ingredients: Row[], steps: Row[]): StoredRecipe {
  const byPos = (a: Row, b: Row) => (a.position as number) - (b.position as number)
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))
  const recipe = {
    contract_version: '2',
    source: compact({
      kind: r.source_kind, key: r.source_key, url: r.source_url, title: r.source_title, channel: r.channel,
      published_on: r.published_on, duration_seconds: r.duration_seconds,
    }),
    title: r.title,
    summary: r.summary ?? null,
    servings: compact({
      value: num(r.servings), origin: r.servings_origin ?? null, basis: r.servings_basis ?? null, suggested: num(r.servings_suggested),
    }, ['value', 'origin']),
    tags: {
      cuisine: r.cuisine, mains: r.mains, main_details: r.main_details, methods: r.methods, occasions: r.occasions,
      difficulty: r.difficulty ?? undefined,
    },
    ingredients: [...ingredients].sort(byPos).map((g) => compact({
      section: g.section, name: g.name, amount: num(g.amount), unit: g.unit ?? null, amount_text: g.amount_text, note: g.note,
      optional: g.optional, origin: g.origin, at_seconds: g.at_seconds, suggested_amount: num(g.suggested_amount),
      suggested_unit: g.suggested_unit, ingredient_key: g.ingredient_key, needs_review: g.needs_review,
    }, ['amount', 'unit'])),
    measuring_tool: r.measuring_tool ?? undefined,
    measuring_tool_basis: r.measuring_tool_basis,
    steps: [...steps].sort(byPos).map((s) => compact({
      title: s.title, body: s.body, heat: s.heat, cue: s.cue, cue_origin: s.cue_origin, editor_tip: s.editor_tip,
      timer_seconds: s.timer_seconds, video_start_seconds: s.video_start_seconds, uses: s.uses, origin: s.origin,
      needs_review: s.needs_review,
    })),
    principles: r.principles,
    conflicts: r.conflicts,
    glossary: r.glossary,
    corrections: r.corrections,
    review_items: r.review_items,
    extraction: r.extraction,
    id: r.id,
    difficulty: r.difficulty ?? null,
    difficulty_basis: r.difficulty_basis ?? null,
    memo: r.memo ?? null,
    rating: r.rating ?? null,
    favorite: r.favorite,
    saved_at: r.added_at,
    updated_at: r.updated_at,
  }
  return recipe as unknown as StoredRecipe
}

export type ExportRow = { recipe_id: string; drive_doc_id: string | null; drive_path: string | null; obsidian_path: string | null; exported_at: string }

/**
 * 다음에 보관할 레시피 id를 고른다(최대 limit건).
 * saved: 보관 기록이 없거나 updated_at이 exported_at보다 늦다(오래 기다린 것부터).
 * archived: 보관 기록에 드라이브 문서나 옵시디언 경로가 남아 있다(지울 것).
 */
export function pickExports(
  saved: { id: string; updated_at: string }[],
  archived: { id: string }[],
  exportRows: ExportRow[],
  limit = 10,
  opts: { skip?: readonly string[]; need?: readonly ('drive' | 'obsidian')[] } = {},
): { fill: string[]; trash: string[] } {
  const by = new Map(exportRows.map((e) => [e.recipe_id, e]))
  const skip = new Set(opts.skip ?? [])
  const need = opts.need ?? []
  const fill = saved
    .filter((s) => {
      if (skip.has(s.id)) return false
      const e = by.get(s.id)
      if (!e || Date.parse(s.updated_at) > Date.parse(e.exported_at)) return true
      // 설정된 보관 자리 중 아직 채우지 못한 칸이 있으면(예: 나중에 구글을 연결) 다시 대상이다
      return (need.includes('drive') && e.drive_doc_id === null) || (need.includes('obsidian') && e.obsidian_path === null)
    })
    .sort((a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at))
    .map((s) => s.id)
  const trash = archived
    .filter((a) => {
      if (skip.has(a.id)) return false
      const e = by.get(a.id)
      return !!e && (e.drive_doc_id !== null || e.obsidian_path !== null)
    })
    .map((a) => a.id)
  const f = fill.slice(0, limit)
  return { fill: f, trash: trash.slice(0, limit - f.length) }
}
