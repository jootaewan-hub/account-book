// 레시피 계약 v2. 앱(Vite), Edge Function(Deno), 처리기(Node 25)가 함께 읽는다.
// 규칙의 근거는 docs/recipes/extraction-rules.md. 상대 가져오기에는 .ts를 붙이고 enum·namespace는 쓰지 않는다.
import { z } from 'zod'

export const CUISINES = ['한식', '양식', '일식', '중식', '기타'] as const
export const MAINS = ['돼지고기', '소고기', '닭고기', '기타 육류', '해산물', '달걀', '두부·콩', '채소', '버섯', '면', '밥·곡물', '빵·밀가루', '유제품', '기타'] as const
export const METHODS = ['볶음', '구이', '조림', '찜', '국·탕', '찌개·전골', '튀김', '무침', '부침·전', '비빔', '샐러드', '오븐', '끓이기', '기타'] as const
export const OCCASIONS = ['반찬', '한그릇', '국물', '술안주', '손님상', '도시락', '간식·디저트', '아침', '소스·양념'] as const
export const DIFFICULTIES = ['쉬움', '보통', '어려움'] as const
/** 숫자(분량·인분·시간)의 출처가 될 수 있는 것 */
export const SOURCE_ORIGINS = ['description', 'caption_manual', 'caption_auto', 'asr', 'screen', 'user'] as const
export const MEASURING_TOOLS = ['계량스푼', '밥숟가락', '섞어 씀', '확인 못 함'] as const

export type Origin = (typeof SOURCE_ORIGINS)[number] | 'editor'
export type Difficulty = (typeof DIFFICULTIES)[number]
export type MeasuringTool = (typeof MEASURING_TOOLS)[number]

/** 말·화면에서 가져온 숫자는 영상의 몇 초인지 남겨야 한다 */
const TIMED_ORIGINS: readonly string[] = ['caption_manual', 'caption_auto', 'asr', 'screen']

const sourceOrigin = z.enum(SOURCE_ORIGINS)
const origin = z.enum([...SOURCE_ORIGINS, 'editor'])
const seconds = z.number().int().min(0)

const servings = z
  .strictObject({
    value: z.number().positive().nullable(),
    origin: sourceOrigin.nullable(),
    basis: z.string().max(80).nullable().optional(),
    suggested: z.number().positive().nullable().optional(),
  })
  .superRefine((s, ctx) => {
    if (s.value !== null && s.origin === null) {
      ctx.addIssue({ code: 'custom', path: ['origin'], message: '인분이 있으면 출처가 필요하다' })
    }
    if (s.value === null && s.origin !== null) {
      ctx.addIssue({ code: 'custom', path: ['origin'], message: '인분이 없으면 출처도 null이다' })
    }
    if (s.value !== null && s.suggested != null) {
      ctx.addIssue({ code: 'custom', path: ['suggested'], message: '출처 인분이 있으면 덧붙인 인분을 두지 않는다' })
    }
  })

const ingredient = z
  .strictObject({
    section: z.string().max(20).nullable().optional(),
    name: z.string().min(1).max(60),
    amount: z.number().positive().nullable(),
    unit: z.string().max(12).nullable(),
    amount_text: z.string().max(20).nullable().optional(),
    note: z.string().max(160).nullable().optional(),
    optional: z.boolean().optional(),
    origin,
    at_seconds: seconds.nullable().optional(),
    suggested_amount: z.number().positive().nullable().optional(),
    suggested_unit: z.string().max(12).nullable().optional(),
    ingredient_key: z.string().regex(/^[a-z0-9_]{1,60}$/).nullable().optional(),
    needs_review: z.boolean().optional(),
  })
  .superRefine((g, ctx) => {
    if (g.amount !== null) {
      if (g.origin === 'editor') {
        ctx.addIssue({ code: 'custom', path: ['origin'], message: '숫자 분량의 출처는 editor일 수 없다' })
      }
      if (g.suggested_amount != null || g.suggested_unit != null) {
        ctx.addIssue({ code: 'custom', path: ['suggested_amount'], message: '숫자 분량이 있는 재료에는 덧붙인 분량을 두지 않는다' })
      }
      if (TIMED_ORIGINS.includes(g.origin) && (g.at_seconds === null || g.at_seconds === undefined)) {
        ctx.addIssue({ code: 'custom', path: ['at_seconds'], message: '말·화면에서 가져온 숫자에는 at_seconds가 필요하다' })
      }
    }
  })

const step = z.strictObject({
  title: z.string().min(1).max(30),
  body: z.string().min(1).max(400),
  heat: z.string().max(30).nullable().optional(),
  cue: z.string().max(200).nullable().optional(),
  cue_origin: origin.nullable().optional(),
  editor_tip: z.string().max(200).nullable().optional(),
  timer_seconds: z.number().int().min(1).nullable().optional(),
  video_start_seconds: seconds.nullable().optional(),
  uses: z
    .array(z.strictObject({ name: z.string().max(60), portion: z.string().max(30).nullable().optional() }))
    .max(20)
    .optional(),
  origin,
  needs_review: z.boolean().optional(),
})

const principle = z.strictObject({
  title: z.string().min(1).max(40),
  body: z.string().min(1).max(300),
  origin,
  video_start_seconds: seconds.nullable().optional(),
  needs_review: z.boolean().optional(),
})

const conflict = z.strictObject({
  about: z.string().min(1).max(60),
  chosen: z.string().min(1).max(200),
  chosen_origin: origin,
  other: z.string().min(1).max(200),
  other_origin: origin,
  video_start_seconds: seconds.nullable().optional(),
  note: z.string().max(200).nullable().optional(),
})

const glossaryItem = z.strictObject({
  term: z.string().min(1).max(30),
  body: z.string().min(1).max(200),
  origin,
  at_seconds: seconds.nullable(),
})

const correction = z.strictObject({
  target: z.string().min(1).max(80),
  before: z.string().max(80).nullable(),
  after: z.string().max(80).nullable(),
  origin: origin.nullable(),
  at_seconds: seconds.nullable(),
  method: z.enum(['rule', 'compare']),
})

const reviewItem = z.strictObject({
  target: z.string().min(1).max(80),
  reason: z.string().min(1).max(200),
  candidates: z
    .array(z.strictObject({ value: z.string().max(80), origin, at_seconds: seconds.nullable() }))
    .max(6),
})

export const RecipeV2Schema = z
  .strictObject({
    contract_version: z.literal('2'),
    source: z.strictObject({
      kind: z.enum(['youtube', 'youtube_shorts', 'instagram', 'web', 'photo', 'text', 'manual']),
      key: z.string().min(3).max(200).regex(/^[a-z_]+:.+$/),
      url: z.string().regex(/^https:\/\//).nullable().optional(),
      title: z.string().max(200).nullable().optional(),
      channel: z.string().max(80).nullable().optional(),
      published_on: z.iso.date().nullable().optional(),
      duration_seconds: z.number().int().min(1).nullable().optional(),
    }),
    title: z.string().min(1).max(80),
    summary: z.string().max(200).nullable().optional(),
    servings,
    tags: z.strictObject({
      cuisine: z.enum(CUISINES),
      mains: z.array(z.enum(MAINS)).max(3),
      main_details: z.array(z.string().min(1).max(60)).min(1).max(3),
      methods: z.array(z.enum(METHODS)).max(3),
      occasions: z.array(z.enum(OCCASIONS)).max(4),
      difficulty: z.enum(DIFFICULTIES).optional(),
    }),
    ingredients: z.array(ingredient).min(1).max(80),
    measuring_tool: z.enum(MEASURING_TOOLS).optional(),
    measuring_tool_basis: z.array(z.strictObject({ origin, at_seconds: seconds.nullable() })).max(10).optional(),
    steps: z.array(step).min(1).max(40),
    principles: z.array(principle).max(12).optional(),
    conflicts: z.array(conflict).max(20).optional(),
    glossary: z.array(glossaryItem).max(10).optional(),
    corrections: z.array(correction).max(40).optional(),
    review_items: z.array(reviewItem).max(40).optional(),
    extraction: z.strictObject({
      levels: z.array(z.enum(['L0', 'L1', 'L2', 'L3', 'L4'])).min(1),
      transcript_kind: z.enum(['caption_manual', 'caption_auto', 'asr', 'none']),
      tools: z.array(z.string().max(80)).max(12),
      extracted_by: z.string().max(80),
      extracted_at: z.iso.datetime({ offset: true }),
      gaps: z.array(z.string().max(120)).max(20).optional(),
      not_checked: z.array(z.string().max(80)).max(10).optional(),
    }),
  })
  .superRefine((r, ctx) => {
    const names = new Set(r.ingredients.map((g) => g.name))
    r.tags.main_details.forEach((d, i) => {
      if (!names.has(d)) {
        ctx.addIssue({ code: 'custom', path: ['tags', 'main_details', i], message: '세부 재료는 재료 목록의 이름과 같아야 한다' })
      }
    })
    r.steps.forEach((s, i) => {
      s.uses?.forEach((u, j) => {
        if (!names.has(u.name)) {
          ctx.addIssue({ code: 'custom', path: ['steps', i, 'uses', j, 'name'], message: '단계에서 쓰는 재료는 재료 목록의 이름과 같아야 한다' })
        }
      })
    })
  })

export type RecipeV2 = z.infer<typeof RecipeV2Schema>
export type Correction = { target: string; before: string | null; after: string | null; origin: Origin | null; at_seconds: number | null; method: 'rule' | 'compare' }
export type ReviewItem = { target: string; reason: string; candidates: { value: string; origin: Origin; at_seconds: number | null }[] }

export function parseRecipe(json: unknown): { ok: true; value: RecipeV2 } | { ok: false; errors: string[] } {
  const r = RecipeV2Schema.safeParse(json)
  if (r.success) return { ok: true, value: r.data }
  return { ok: false, errors: r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) }
}
