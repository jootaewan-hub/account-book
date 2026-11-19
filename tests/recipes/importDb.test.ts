// 등록 함수 recipe.import_recipe(20261122010000_recipe_import.sql)를 PGlite에서 검증한다.
// 넣는 가구·사람·출처는 대기 줄(p_job)에서 오고, 같은 출처는 같은 id에 내용을 바꾸며 메모·별점·즐겨찾기는 남긴다.
// db.test.ts의 도우미를 옮겨 적는다(가져오면 그 파일의 describe가 여기서 한 번 더 돈다).
import type { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { difficulty } from '../../supabase/functions/_shared/recipeClassify'
import type { RecipeV2 } from '../../supabase/functions/_shared/recipeContract'
import { freshDb } from '../grocery/dbSetup'

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const C = '00000000-0000-4000-8000-00000000000c'
const D = '00000000-0000-4000-8000-00000000000d' // 가구 C의 두 번째 구성원(지워 보기용)

const KEY = 'youtube:AkX6uA4BaDs'
const gold: RecipeV2 = JSON.parse(readFileSync('docs/recipes/contract/examples/youtube-AkX6uA4BaDs.json', 'utf8'))
const goldDifficulty = difficulty(gold)

let db: PGlite
let hhAB: string
let hhC: string

type Row = Record<string, unknown>
type Json = Record<string, unknown>

/** 로그인한 사용자(uid) 또는 로그인 안 한 사람(null)으로 */
async function as<T = Row>(uid: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec('reset role')
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? ''])
  await db.exec(uid ? 'set role authenticated' : 'set role anon')
  try {
    return (await db.query<T>(sql, params)).rows
  } finally {
    await db.exec('reset role')
  }
}

/** 서버 함수 recipe-worker처럼 서비스 롤로(로그인 없음) */
async function svc<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec('reset role')
  await db.query(`select set_config('request.jwt.claim.sub', '', false)`)
  await db.exec('set role service_role')
  try {
    return (await db.query<T>(sql, params)).rows
  } finally {
    await db.exec('reset role')
  }
}

/** 시험 준비용: 관리자(postgres)로, 로그인 흔적 없이 */
async function admin<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec('reset role')
  await db.query(`select set_config('request.jwt.claim.sub', '', false)`)
  return (await db.query<T>(sql, params)).rows
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    return String((e as { code?: string }).code ?? (e as Error).message)
  }
  return 'NO_ERROR'
}

/** 처리기가 가져간(processing) 대기 줄. url은 source_key로 만든 정규 주소 */
async function seedJob(household: string, addedBy: string | null, key = KEY, extra: Row = {}): Promise<string> {
  const fields: Row = {
    household_id: household,
    url: `https://www.youtube.com/watch?v=${key.split(':')[1]}`,
    source_key: key,
    added_by: addedBy,
    state: 'processing',
    ...extra,
  }
  const cols = Object.keys(fields)
  const vals = Object.values(fields)
  const [row] = await admin<{ id: string }>(
    `insert into recipe.inbox (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
    vals,
  )
  return row.id
}

const importAs = (uid: string | null, job: string, recipe: unknown, level: string | null = goldDifficulty.level, basis: unknown = goldDifficulty.basis) =>
  as<{ id: string }>(uid, `select recipe.import_recipe($1, $2::jsonb, $3, $4::jsonb) as id`, [job, JSON.stringify(recipe), level, basis === null ? null : JSON.stringify(basis)])

async function importRecipe(job: string, recipe: unknown, level: string | null = goldDifficulty.level, basis: unknown = goldDifficulty.basis): Promise<string> {
  const [row] = await svc<{ id: string }>(`select recipe.import_recipe($1, $2::jsonb, $3, $4::jsonb) as id`, [
    job,
    JSON.stringify(recipe),
    level,
    basis === null ? null : JSON.stringify(basis),
  ])
  return row.id
}

const recipeRow = async (id: string) => (await admin<Row>(`select * from recipe.recipes where id = $1`, [id]))[0]
const jobRow = async (id: string) => (await admin<Row>(`select state, stage, recipe_id, attempts, fail_reason from recipe.inbox where id = $1`, [id]))[0]
const count = async (table: string, where = 'true', params: unknown[] = []) =>
  Number((await admin<{ n: number }>(`select count(*)::int as n from recipe.${table} where ${where}`, params))[0].n)

/** 기준 답안을 깊이 복사해 고친다 */
const withGold = (edit: (r: Json) => void): Json => {
  const r = structuredClone(gold) as unknown as Json
  edit(r)
  return r
}

/** 처음 담은 시각을 과거로 돌려 놓고, 다시 등록 뒤 남았는지·바뀌었는지 본다 */
const OLD_ADDED_AT = '2026-01-01T00:00:00.000Z'

const REVIEW_ITEM = {
  target: '통깨',
  reason: '재료 소개에서만 들리고 설명란에는 없다',
  candidates: [{ value: '통깨 약간', origin: 'caption_auto', at_seconds: 54 }],
}

beforeAll(async () => {
  db = await freshDb([A, B, C, D], async (d) => {
    hhAB = (await d.query<{ id: string }>(`insert into public.households default values returning id`)).rows[0].id
    hhC = (await d.query<{ id: string }>(`insert into public.households default values returning id`)).rows[0].id
    await d.query(
      `insert into public.members (household_id, user_id, display_name, role, spouse_role) values
       ($1,$3,'A','owner','husband'), ($1,$4,'B','partner','wife'), ($2,$5,'C','owner','husband'), ($2,$6,'D','partner','wife')`,
      [hhAB, hhC, A, B, C, D],
    )
  })
})

afterAll(async () => {
  await db?.close()
})

beforeEach(async () => {
  await admin('delete from recipe.inbox')
  await admin('delete from recipe.recipes')
})

describe('기준 답안 등록', () => {
  it('재료 17줄, 단계 12줄, 확인할 것이 없어 saved, 일은 done과 레시피 id', async () => {
    const job = await seedJob(hhAB, B)
    const id = await importRecipe(job, gold)

    const r = await recipeRow(id)
    expect(r).toMatchObject({
      household_id: hhAB,
      added_by: B,
      status: 'saved',
      review_count: 0,
      title: gold.title,
      source_kind: 'youtube',
      source_key: KEY,
      source_url: 'https://www.youtube.com/watch?v=AkX6uA4BaDs',
      source_title: gold.source.title,
      channel: gold.source.channel,
      duration_seconds: 793,
      servings: null,
      servings_origin: null,
      servings_basis: gold.servings.basis,
      cuisine: '한식',
      mains: ['돼지고기'],
      main_details: ['돼지 앞다리살'],
      methods: ['볶음'],
      occasions: ['한그릇', '반찬', '술안주'],
      difficulty: goldDifficulty.level,
      difficulty_basis: goldDifficulty.basis,
      measuring_tool: '확인 못 함',
      measuring_tool_basis: [],
      principles: gold.principles,
      conflicts: gold.conflicts,
      glossary: [],
      corrections: gold.corrections,
      review_items: [],
      extraction: gold.extraction,
      memo: null,
      rating: null,
      favorite: false,
    })
    expect(Number(r.servings_suggested)).toBe(2)
    expect((await admin(`select published_on::text as d from recipe.recipes where id = $1`, [id]))[0].d).toBe('2025-06-03')

    expect(await count('ingredients', 'recipe_id = $1', [id])).toBe(17)
    expect(await count('steps', 'recipe_id = $1', [id])).toBe(12)
    expect(await jobRow(job)).toMatchObject({ state: 'done', stage: null, recipe_id: id })
  })

  it('재료·단계는 순서대로, 칸마다 계약 값 그대로', async () => {
    const id = await importRecipe(await seedJob(hhAB, A), gold)
    const ings = await admin<Row>(`select * from recipe.ingredients where recipe_id = $1 order by position`, [id])
    expect(ings.map((g) => g.position)).toEqual(Array.from({ length: 17 }, (_, i) => i + 1))
    expect(ings.map((g) => g.name)).toEqual(gold.ingredients.map((g) => g.name))
    expect(ings.every((g) => g.household_id === hhAB)).toBe(true)
    expect(ings[0]).toMatchObject({ section: '고기', unit: 'g', origin: 'description', optional: false, needs_review: false, suggested_amount: null })
    expect(Number(ings[0].amount)).toBe(500)
    expect(Number(ings[11].amount)).toBe(0.5)
    // 숫자가 없는 재료의 덧붙인 분량은 덧붙임 칸에만
    expect(ings[13]).toMatchObject({ name: '깻잎', amount: null, amount_text: '약간', suggested_unit: '장' })
    expect(Number(ings[13].suggested_amount)).toBe(8)
    expect(ings[15]).toMatchObject({ name: '통깨', origin: 'caption_auto', at_seconds: 54, needs_review: true, optional: true })

    const steps = await admin<Row>(`select * from recipe.steps where recipe_id = $1 order by position`, [id])
    expect(steps.map((s) => s.title)).toEqual(gold.steps.map((s) => s.title))
    expect(steps[0]).toMatchObject({ video_start_seconds: 192, origin: 'description', uses: [{ name: '돼지 앞다리살', portion: '전부' }] })
  })

  it('다른 가구 사용자는 등록된 레시피를 못 보고, 같은 가구는 본다', async () => {
    await importRecipe(await seedJob(hhAB, A), gold)
    expect(await as(C, `select id from recipe.recipes`)).toEqual([])
    expect(await as(C, `select id from recipe.ingredients`)).toEqual([])
    expect(await as(B, `select id from recipe.recipes`)).toHaveLength(1)
  })

  it('쇼츠 주소로 담은 일은 출처 종류 youtube_shorts, 주소는 대기 줄의 정규 주소', async () => {
    const job = await seedJob(hhAB, A, 'youtube:FgKy9Xq4LKY')
    await admin(`update recipe.inbox set url = 'https://www.youtube.com/shorts/FgKy9Xq4LKY' where id = $1`, [job])
    const id = await importRecipe(job, withGold((r) => { delete r.source }))
    expect(await recipeRow(id)).toMatchObject({
      source_kind: 'youtube_shorts',
      source_key: 'youtube:FgKy9Xq4LKY',
      source_url: 'https://www.youtube.com/shorts/FgKy9Xq4LKY',
      source_title: null,
      channel: null,
    })
  })

  it('없는 칸과 null은 기본값으로(빈 목록·빈 기록·false)', async () => {
    const r = withGold((x) => {
      for (const k of ['summary', 'measuring_tool', 'measuring_tool_basis', 'principles', 'glossary', 'corrections', 'review_items']) delete x[k]
      x.conflicts = null
      x.extraction = null
      const ings = x.ingredients as Json[]
      delete ings[0].optional
      ings[1].needs_review = null
      ings[2].optional = null
      const steps = x.steps as Json[]
      delete steps[0].uses
      steps[1].uses = null
    })
    const id = await importRecipe(await seedJob(hhAB, A), r, null, null)
    expect(await recipeRow(id)).toMatchObject({
      status: 'saved',
      summary: null,
      measuring_tool: null,
      measuring_tool_basis: [],
      principles: [],
      conflicts: [],
      glossary: [],
      corrections: [],
      review_items: [],
      review_count: 0,
      extraction: {},
      difficulty: null,
      difficulty_basis: null,
    })
    const [g1, g2, g3] = await admin<Row>(`select optional, needs_review from recipe.ingredients where recipe_id = $1 order by position limit 3`, [id])
    expect([g1, g2, g3]).toEqual([
      { optional: false, needs_review: false },
      { optional: false, needs_review: false },
      { optional: false, needs_review: false },
    ])
    const steps = await admin<Row>(`select uses from recipe.steps where recipe_id = $1 order by position limit 2`, [id])
    expect(steps).toEqual([{ uses: [] }, { uses: [] }])
  })
})

describe('확인할 것', () => {
  it('review_items가 하나면 review, review_count 1', async () => {
    const id = await importRecipe(await seedJob(hhAB, A), withGold((r) => { r.review_items = [REVIEW_ITEM] }))
    expect(await recipeRow(id)).toMatchObject({ status: 'review', review_count: 1, review_items: [REVIEW_ITEM] })
  })
})

describe('다시 등록(같은 가구·같은 출처)', () => {
  it('같은 id에 내용을 바꾸고 메모·별점·즐겨찾기는 남긴다', async () => {
    const job1 = await seedJob(hhAB, A)
    const id = await importRecipe(job1, gold)
    await admin(`update recipe.recipes set added_at = $2 where id = $1`, [id, OLD_ADDED_AT])
    const before = await recipeRow(id)
    // 앱에서 구성원이 남긴 것
    await as(B, `update recipe.recipes set memo = '우리 집은 설탕 1큰술', rating = 5, favorite = true where id = $1`, [id])

    // 다시 담아서 다시 정리한 결과: 제목이 바뀌고 요약이 빠지고 재료가 둘, 확인할 것 하나
    const job2 = await seedJob(hhAB, B)
    const next = withGold((r) => {
      r.title = '기사식당 제육볶음'
      delete r.summary
      r.ingredients = (r.ingredients as Json[]).slice(0, 2)
      r.tags = { ...(r.tags as Json), main_details: ['돼지 앞다리살'] }
      r.steps = (r.steps as Json[]).slice(0, 1)
      r.review_items = [REVIEW_ITEM]
    })
    expect(await importRecipe(job2, next, '쉬움', { required: 2, steps: 1, heavy: false })).toBe(id)

    expect(await count('recipes')).toBe(1)
    const after = await recipeRow(id)
    expect(after).toMatchObject({
      title: '기사식당 제육볶음',
      summary: null,
      status: 'review',
      review_count: 1,
      difficulty: '쉬움',
      difficulty_basis: { required: 2, steps: 1, heavy: false },
      memo: '우리 집은 설탕 1큰술',
      rating: 5,
      favorite: true,
      // 보관한 레시피가 아니면 처음 담은 사람과 시각은 그대로
      added_by: A,
      added_at: before.added_at,
    })
    expect((after.added_at as Date).toISOString()).toBe(OLD_ADDED_AT)
    expect(await count('ingredients', 'recipe_id = $1', [id])).toBe(2)
    expect(await count('steps', 'recipe_id = $1', [id])).toBe(1)
    expect(await jobRow(job2)).toMatchObject({ state: 'done', recipe_id: id })
    expect(await jobRow(job1)).toMatchObject({ state: 'done', recipe_id: id })
  })

  it('확인 중(review)인 레시피도 처음 담은 사람과 시각을 남긴다', async () => {
    const id = await importRecipe(await seedJob(hhAB, A), withGold((r) => { r.review_items = [REVIEW_ITEM] }))
    await admin(`update recipe.recipes set added_at = $2 where id = $1`, [id, OLD_ADDED_AT])
    expect(await importRecipe(await seedJob(hhAB, B), gold)).toBe(id)
    const after = await recipeRow(id)
    expect(after).toMatchObject({ status: 'saved', added_by: A })
    expect((after.added_at as Date).toISOString()).toBe(OLD_ADDED_AT)
  })

  it('보관(archived)한 레시피는 같은 id로 돌아오고, 새로 담은 사람·시각이 된다(목록에서 새것으로)', async () => {
    const id = await importRecipe(await seedJob(hhAB, A), gold)
    await as(A, `update recipe.recipes set status = 'archived', memo = '보관 전 메모', rating = 4, favorite = true where id = $1`, [id])
    await admin(`update recipe.recipes set added_at = $2 where id = $1`, [id, OLD_ADDED_AT])
    expect(await importRecipe(await seedJob(hhAB, B), gold)).toBe(id)
    const after = await recipeRow(id)
    expect(after).toMatchObject({ status: 'saved', memo: '보관 전 메모', rating: 4, favorite: true, added_by: B })
    expect((after.added_at as Date).getTime()).toBeGreaterThan(Date.parse(OLD_ADDED_AT))
    expect(await count('ingredients', 'recipe_id = $1', [id])).toBe(17)
  })

  it('보관한 레시피를 가구에서 빠진 사람의 일로 다시 담으면 added_by는 비어 있다', async () => {
    const id = await importRecipe(await seedJob(hhC, C), gold)
    await admin(`update recipe.recipes set status = 'archived' where id = $1`, [id])
    const job = await seedJob(hhC, null)
    expect(await importRecipe(job, gold)).toBe(id)
    expect(await recipeRow(id)).toMatchObject({ status: 'saved', added_by: null })
  })

  it('다른 가구의 같은 출처는 따로 등록된다', async () => {
    const ab = await importRecipe(await seedJob(hhAB, A), gold)
    const c = await importRecipe(await seedJob(hhC, C), gold)
    expect(c).not.toBe(ab)
    expect((await recipeRow(c)).household_id).toBe(hhC)
    expect(await count('ingredients', 'recipe_id = $1', [ab])).toBe(17)
  })
})

describe('담은 사람이 가구에서 빠진 일', () => {
  it('구성원에서 지워져 added_by가 빈 일도 등록되고 레시피의 added_by도 비어 있다', async () => {
    const job = await seedJob(hhC, D)
    await admin(`delete from public.members where user_id = $1`, [D])
    expect((await admin(`select added_by from recipe.inbox where id = $1`, [job]))[0].added_by).toBeNull()

    const id = await importRecipe(job, gold)
    expect(await recipeRow(id)).toMatchObject({ household_id: hhC, added_by: null, status: 'saved' })
    expect(await jobRow(job)).toMatchObject({ state: 'done', recipe_id: id })
  })
})

describe('부를 수 있는 사람', () => {
  it('앱 사용자(구성원 포함)와 로그인 안 한 사람이 부르면 42501, 일은 그대로', async () => {
    const job = await seedJob(hhAB, A)
    expect(await codeOf(importAs(A, job, gold))).toBe('42501')
    expect(await codeOf(importAs(C, job, gold))).toBe('42501')
    expect(await codeOf(importAs(null, job, gold))).toBe('42501')
    expect(await count('recipes')).toBe(0)
    expect(await jobRow(job)).toMatchObject({ state: 'processing', recipe_id: null })
  })
})

describe('거절하면 아무것도 안 들어간다', () => {
  /** 실패 뒤: 레시피·재료·단계 0줄, 일은 처리 중 그대로 */
  async function expectNothingWritten(job: string) {
    expect(await count('recipes')).toBe(0)
    expect(await count('ingredients')).toBe(0)
    expect(await count('steps')).toBe(0)
    expect(await jobRow(job)).toMatchObject({ state: 'processing', recipe_id: null })
  }

  it('숫자 분량이 있는 재료에 덧붙인 분량이 있으면 23514', async () => {
    const job = await seedJob(hhAB, A)
    const bad = withGold((r) => {
      const ings = r.ingredients as Json[]
      ings[16] = { ...ings[16], amount: 1, unit: '큰술', amount_text: null, suggested_amount: 1, suggested_unit: '큰술' }
    })
    expect(await codeOf(importRecipe(job, bad))).toBe('23514')
    await expectNothingWritten(job)
  })

  it('숫자 분량의 출처가 덧붙임(editor)이면 23514', async () => {
    const job = await seedJob(hhAB, A)
    const bad = withGold((r) => { (r.ingredients as Json[])[0].origin = 'editor' })
    expect(await codeOf(importRecipe(job, bad))).toBe('23514')
    await expectNothingWritten(job)
  })

  it('출처 인분이 있는데 덧붙인 인분도 있으면 23514', async () => {
    const job = await seedJob(hhAB, A)
    const bad = withGold((r) => { r.servings = { value: 2, origin: 'description', suggested: 2 } })
    expect(await codeOf(importRecipe(job, bad))).toBe('23514')
    await expectNothingWritten(job)
  })

  it('레시피의 출처 열쇠가 대기 줄과 다르면 22023', async () => {
    const job = await seedJob(hhAB, A, 'youtube:FgKy9Xq4LKY')
    expect(await codeOf(importRecipe(job, gold))).toBe('22023')
    await expectNothingWritten(job)
  })

  it('계약 판이 2가 아니거나 재료·단계가 비었으면 22023', async () => {
    const job = await seedJob(hhAB, A)
    for (const bad of [
      withGold((r) => { r.contract_version = '1' }),
      withGold((r) => { delete r.contract_version }),
      withGold((r) => { r.ingredients = [] }),
      withGold((r) => { delete r.steps }),
      withGold((r) => { r.steps = { title: 'x' } }),
    ]) {
      expect(await codeOf(importRecipe(job, bad))).toBe('22023')
    }
    await expectNothingWritten(job)
  })

  it('처리 중이 아닌 일(대기·끝남·실패)은 55000, 없는 일은 P0002', async () => {
    for (const state of ['waiting', 'done', 'failed']) {
      await admin('delete from recipe.inbox')
      const job = await seedJob(hhAB, A, KEY, { state })
      expect(await codeOf(importRecipe(job, gold)), state).toBe('55000')
      expect(await count('recipes')).toBe(0)
      expect((await jobRow(job)).state).toBe(state)
    }
    expect(await codeOf(importRecipe('00000000-0000-4000-8000-000000000999', gold))).toBe('P0002')
  })

  it('같은 일을 두 번 넣을 수 없다(첫 번째로 done)', async () => {
    const job = await seedJob(hhAB, A)
    await importRecipe(job, gold)
    expect(await codeOf(importRecipe(job, gold))).toBe('55000')
  })

  it('다시 등록하다 거절되면 이전 내용이 그대로 남는다', async () => {
    const id = await importRecipe(await seedJob(hhAB, A), gold)
    await as(A, `update recipe.recipes set memo = '메모' where id = $1`, [id])
    const before = await recipeRow(id)
    const job2 = await seedJob(hhAB, B)
    const bad = withGold((r) => {
      r.title = '바뀐 제목'
      const ings = r.ingredients as Json[]
      ings[0] = { ...ings[0], suggested_amount: 600, suggested_unit: 'g' }
    })
    expect(await codeOf(importRecipe(job2, bad))).toBe('23514')
    expect(await recipeRow(id)).toEqual(before)
    expect(await count('ingredients', 'recipe_id = $1', [id])).toBe(17)
    expect(await count('steps', 'recipe_id = $1', [id])).toBe(12)
    expect(await jobRow(job2)).toMatchObject({ state: 'processing', recipe_id: null })
  })
})
