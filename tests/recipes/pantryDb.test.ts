// 재료 사전·가진 재료·cookable(20261122020000_recipe_pantry.sql)을 PGlite에서 검증한다.
// import_recipe가 사전에 없는 ingredient_key를 비우는지도 본다. 도우미는 db.test.ts·importDb.test.ts와 같은 꼴.
import type { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { difficulty } from '../../supabase/functions/_shared/recipeClassify'
import type { RecipeV2 } from '../../supabase/functions/_shared/recipeContract'
import { freshDb } from '../grocery/dbSetup'

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const C = '00000000-0000-4000-8000-00000000000c'
const D = '00000000-0000-4000-8000-00000000000d'

let db: PGlite
let hhAB: string
let hhC: string

type Row = Record<string, unknown>

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

const dictAdd = (entries: unknown) => svc<{ n: number }>(`select recipe.dict_add($1::jsonb) as n`, [JSON.stringify(entries)])
const dictRow = async (id: string) => (await admin<Row>(`select * from recipe.ingredient_dict where id = $1`, [id]))[0]

async function seedDict(): Promise<void> {
  await dictAdd([
    { id: 'tofu', name: '두부', aliases: ['순두부'], category: '콩·두류' },
    { id: 'egg', name: '달걀', aliases: ['계란'], category: '유제품·난류' },
    { id: 'scallion', name: '대파', aliases: ['파'], category: '채소' },
    { id: 'salt', name: '소금', aliases: [], category: '장·양념·소스' },
    { id: 'sesame', name: '통깨', aliases: [], category: '견과·종실' },
    { id: 'kimchi', name: '김치', aliases: [], category: '채소' },
  ])
}

/** 레시피 한 줄과 재료들. ings: [이름, 사전 id 또는 null, optional] */
async function seedRecipe(household: string, key: string, status: string, ings: [string, string | null, boolean?][]): Promise<string> {
  const [r] = await admin<{ id: string }>(
    `insert into recipe.recipes (household_id, title, status, source_kind, source_key, source_url, cuisine, added_by)
     values ($1, $2, $3, 'youtube', $4, $5, '한식', null) returning id`,
    [household, `요리 ${key}`, status, `youtube:${key}`, `https://www.youtube.com/watch?v=${key}`],
  )
  let pos = 1
  for (const [name, k, opt] of ings) {
    await admin(
      `insert into recipe.ingredients (recipe_id, household_id, position, name, origin, ingredient_key, optional)
       values ($1, $2, $3, $4, 'user', $5, $6)`,
      [r.id, household, pos++, name, k, opt ?? false],
    )
  }
  return r.id
}

const pantryPut = (household: string, key: string, state = 'have') =>
  admin(`insert into recipe.pantry (household_id, ingredient_key, state) values ($1, $2, $3)`, [household, key, state])

const cookableAs = (uid: string, household: string, max?: number) =>
  as<{ recipe_id: string; have: number; need: number; missing: string[] }>(
    uid,
    max === undefined ? `select * from recipe.cookable($1)` : `select * from recipe.cookable($1, $2)`,
    max === undefined ? [household] : [household, max],
  )

beforeAll(async () => {
  db = await freshDb([A, B, C, D], async (d) => {
    hhAB = (await d.query<{ id: string }>(`insert into public.households default values returning id`)).rows[0].id
    hhC = (await d.query<{ id: string }>(`insert into public.households default values returning id`)).rows[0].id
    await d.query(
      `insert into public.members (household_id, user_id, display_name, role, spouse_role) values
       ($1,$3,'A','owner','husband'), ($1,$4,'B','partner','wife'), ($2,$5,'C','owner','husband')`,
      [hhAB, hhC, A, B, C],
    )
  })
})
afterAll(async () => {
  await db?.close()
})
beforeEach(async () => {
  await admin('delete from recipe.inbox')
  await admin('delete from recipe.recipes')
  await admin('delete from recipe.pantry')
  await admin('delete from recipe.ingredient_dict')
  await seedDict()
})

describe('재료 사전', () => {
  it('앱 사용자는 읽기만 한다(쓰기는 42501), 로그인 안 한 사람은 못 읽는다', async () => {
    expect((await as(A, `select id from recipe.ingredient_dict`)).length).toBe(6)
    expect((await as(C, `select id from recipe.ingredient_dict`)).length).toBe(6)
    expect(await codeOf(as(A, `insert into recipe.ingredient_dict (id, name, category) values ('x', 'x', '채소')`))).toBe('42501')
    expect(await codeOf(as(A, `update recipe.ingredient_dict set name = 'x'`))).toBe('42501')
    expect(await codeOf(as(A, `delete from recipe.ingredient_dict`))).toBe('42501')
    expect(await codeOf(as(null, `select * from recipe.ingredient_dict`))).toBe('42501')
  })

  it('dict_add: 새 id는 added로 넣고, 같은 id는 동의어만 합친다(두 번 불러도)', async () => {
    const [{ n }] = await dictAdd([{ id: 'pork_belly', name: '삼겹살', aliases: ['오겹살'], category: '육류', broader: 'pork' }])
    expect(n).toBe(1)
    expect(await dictRow('pork_belly')).toMatchObject({ name: '삼겹살', aliases: ['오겹살'], category: '육류', broader: 'pork', origin: 'added' })
    // 같은 id: 이름·분류는 그대로, 동의어만 합침(중복 없이)
    const [{ n: n2 }] = await dictAdd([
      { id: 'pork_belly', name: '바뀌면 안 됨', aliases: ['오겹살', '생삼겹'], category: '채소' },
      { id: 'pork_belly', name: '또', aliases: ['돼지삼겹'], category: '채소' },
    ])
    expect(n2).toBe(2)
    const row = await dictRow('pork_belly')
    expect(row).toMatchObject({ name: '삼겹살', category: '육류', broader: 'pork', origin: 'added' })
    expect([...(row.aliases as string[])].sort()).toEqual(['생삼겹', '오겹살', '돼지삼겹'].sort())
    // 바뀐 것이 없으면 센 줄 0
    expect((await dictAdd([{ id: 'pork_belly', name: 'x', aliases: ['오겹살'], category: '육류' }]))[0].n).toBe(0)
    // 원래 있던(mise 출처) 줄의 origin은 그대로
    await admin(`update recipe.ingredient_dict set origin = 'mise' where id = 'tofu'`)
    await dictAdd([{ id: 'tofu', name: '두부', aliases: ['연두부'], category: '콩·두류' }])
    expect(await dictRow('tofu')).toMatchObject({ origin: 'mise' })
    expect(((await dictRow('tofu')).aliases as string[]).sort()).toEqual(['순두부', '연두부'])
  })

  it('dict_add: 나쁜 id·분류·꼴은 거절하고 아무것도 쓰지 않으며, 서비스 롤만 부른다', async () => {
    const before = (await admin<{ n: number }>(`select count(*)::int as n from recipe.ingredient_dict`))[0].n
    const good = { id: 'new_ok', name: '새것', aliases: [], category: '채소' }
    for (const bad of [
      { id: 'Bad-ID', name: 'x', aliases: [], category: '채소' },
      { id: 'ok_id', name: 'x', aliases: [], category: '없는분류' },
      { id: 'ok_id', name: '', aliases: [], category: '채소' },
      { id: 'ok_id', name: 'x', aliases: 'not-array', category: '채소' },
      { id: 'ok_id', name: 'x', aliases: [1], category: '채소' },
    ]) {
      expect(await codeOf(dictAdd([good, bad])), JSON.stringify(bad)).toBe('22023')
    }
    expect(await codeOf(dictAdd({ id: 'x' }))).toBe('22023') // 배열 아님
    expect((await admin<{ n: number }>(`select count(*)::int as n from recipe.ingredient_dict`))[0].n).toBe(before)
    expect(await codeOf(as(A, `select recipe.dict_add('[]'::jsonb)`))).toBe('42501')
    expect(await codeOf(as(null, `select recipe.dict_add('[]'::jsonb)`))).toBe('42501')
    expect((await dictAdd([]))[0].n).toBe(0)
  })
})

describe('가진 재료(pantry)', () => {
  it('구성원은 자기 가구 것을 읽고 넣고 고치고 지운다, 다른 가구는 0줄', async () => {
    await as(A, `insert into recipe.pantry (household_id, ingredient_key, state, source, added_by) values ($1, 'tofu', 'have', 'manual', $2)`, [hhAB, A])
    await as(B, `insert into recipe.pantry (household_id, ingredient_key, state, source, added_by) values ($1, 'salt', 'always', 'grocery', $2)`, [hhAB, B])
    expect((await as(B, `select * from recipe.pantry`)).length).toBe(2)
    expect(await as(C, `select * from recipe.pantry`)).toEqual([])
    expect(await as(C, `update recipe.pantry set state = 'always' returning ingredient_key`)).toEqual([])
    expect(await as(C, `delete from recipe.pantry returning ingredient_key`)).toEqual([])
    expect(await as(B, `update recipe.pantry set state = 'always' where ingredient_key = 'tofu' returning state`)).toEqual([{ state: 'always' }])
    expect(await as(A, `delete from recipe.pantry where ingredient_key = 'tofu' returning ingredient_key`)).toEqual([{ ingredient_key: 'tofu' }])
  })

  it('넣기 검사: 남의 가구·남의 이름·나쁜 값·사전에 없는 키·중복은 거절', async () => {
    const ins = (uid: string, hh: string, key: string, by: string | null, state = 'have', source = 'manual') =>
      as(uid, `insert into recipe.pantry (household_id, ingredient_key, state, source, added_by) values ($1, $2, $3, $4, $5)`, [hh, key, state, source, by])
    expect(await codeOf(ins(C, hhAB, 'tofu', C))).toBe('42501')
    expect(await codeOf(ins(A, hhAB, 'tofu', B))).toBe('42501') // 남의 이름
    expect(await codeOf(ins(A, hhAB, 'tofu', null))).toBe('42501')
    expect(await codeOf(ins(A, hhAB, 'tofu', A, 'maybe'))).toBe('23514')
    expect(await codeOf(ins(A, hhAB, 'tofu', A, 'have', 'photo'))).toBe('23514')
    expect(await codeOf(ins(A, hhAB, 'nope', A))).toBe('23503')
    await ins(A, hhAB, 'tofu', A)
    expect(await codeOf(ins(B, hhAB, 'tofu', B))).toBe('23505') // 한 가구에 한 줄
    await ins(A, hhAB, 'egg', A, 'have', 'receipt') // receipt도 허용
    // 바꿀 수 없는 칸
    expect(await codeOf(as(A, `update recipe.pantry set household_id = $1`, [hhC]))).toBe('42501')
    expect(await codeOf(as(A, `update recipe.pantry set added_by = $1`, [B]))).toBe('42501')
    expect(await codeOf(as(null, `select * from recipe.pantry`))).toBe('42501')
  })

  it('사전 id를 바꾸면 따라 바뀌고(cascade), 사전 줄을 지우면 가진 재료도 지워진다', async () => {
    await pantryPut(hhAB, 'tofu')
    await admin(`update recipe.ingredient_dict set id = 'tofu2' where id = 'tofu'`)
    expect((await admin(`select ingredient_key from recipe.pantry`))[0]).toEqual({ ingredient_key: 'tofu2' })
    await admin(`delete from recipe.ingredient_dict where id = 'tofu2'`)
    expect(await admin(`select * from recipe.pantry`)).toEqual([])
  })
})

describe('ingredients.ingredient_key → 사전', () => {
  it('사전에 없는 키는 외래 키가 막고, 사전 줄을 지우면 재료의 키가 비고, id 변경은 따라간다', async () => {
    const r = await seedRecipe(hhAB, 'aaaaaaaaaaa', 'saved', [['두부', 'tofu']])
    expect(await codeOf(seedRecipe(hhAB, 'bbbbbbbbbbb', 'saved', [['없는것', 'nope']]))).toBe('23503')
    await admin(`update recipe.ingredient_dict set id = 'tofu2' where id = 'tofu'`)
    expect((await admin(`select ingredient_key from recipe.ingredients where recipe_id = $1`, [r]))[0]).toEqual({ ingredient_key: 'tofu2' })
    await admin(`delete from recipe.ingredient_dict where id = 'tofu2'`)
    expect((await admin(`select ingredient_key from recipe.ingredients where recipe_id = $1`, [r]))[0]).toEqual({ ingredient_key: null })
  })
})

describe('cookable', () => {
  it('필수 4개 중 3개를 가지면 모자란 이름 1개를 돌려준다', async () => {
    const r = await seedRecipe(hhAB, 'aaaaaaaaaaa', 'saved', [['두부', 'tofu'], ['달걀', 'egg'], ['대파', 'scallion'], ['소금', 'salt']])
    for (const k of ['tofu', 'egg', 'salt']) await pantryPut(hhAB, k)
    expect(await cookableAs(A, hhAB)).toEqual([{ recipe_id: r, have: 3, need: 4, missing: ['대파'] }])
  })

  it('optional과 키 없는 재료는 need에 안 세고, always는 가진 것으로 센다', async () => {
    const r = await seedRecipe(hhAB, 'aaaaaaaaaaa', 'saved', [['두부', 'tofu'], ['소금', 'salt'], ['통깨', 'sesame', true], ['사전 밖', null], ['달걀', 'egg']])
    await pantryPut(hhAB, 'tofu')
    await pantryPut(hhAB, 'salt', 'always')
    expect(await cookableAs(B, hhAB)).toEqual([{ recipe_id: r, have: 2, need: 3, missing: ['달걀'] }])
    // 세지 않는 재료만 있는 레시피는 나오지 않는다
    await seedRecipe(hhAB, 'ccccccccccc', 'saved', [['통깨', 'sesame', true], ['사전 밖', null]])
    expect((await cookableAs(B, hhAB)).map((x) => x.recipe_id)).toEqual([r])
  })

  it('saved만 센다(review·archived는 빠진다)', async () => {
    const s = await seedRecipe(hhAB, 'aaaaaaaaaaa', 'saved', [['두부', 'tofu']])
    await seedRecipe(hhAB, 'bbbbbbbbbbb', 'review', [['두부', 'tofu']])
    await seedRecipe(hhAB, 'ccccccccccc', 'archived', [['두부', 'tofu']])
    await pantryPut(hhAB, 'tofu')
    expect((await cookableAs(A, hhAB)).map((x) => x.recipe_id)).toEqual([s])
  })

  it('모자란 수 ≤ p_max_missing만, 모자란 수 적은 순 → 가진 수 많은 순', async () => {
    const miss0 = await seedRecipe(hhAB, 'aaaaaaaaaaa', 'saved', [['두부', 'tofu']])
    const miss1small = await seedRecipe(hhAB, 'bbbbbbbbbbb', 'saved', [['두부', 'tofu'], ['달걀', 'egg']])
    const miss1big = await seedRecipe(hhAB, 'ccccccccccc', 'saved', [['두부', 'tofu'], ['소금', 'salt'], ['대파', 'scallion']])
    const miss2 = await seedRecipe(hhAB, 'ddddddddddd', 'saved', [['대파', 'scallion'], ['달걀', 'egg'], ['두부', 'tofu']]) // have tofu 1, miss 2
    const miss3 = await seedRecipe(hhAB, 'eeeeeeeeeee', 'saved', [['대파', 'scallion'], ['달걀', 'egg'], ['김치', 'kimchi'], ['두부', 'tofu']])
    await pantryPut(hhAB, 'tofu')
    await pantryPut(hhAB, 'salt')
    // miss0: 모자람 0 / miss1small: 달걀 1 (have 1) / miss1big: 대파 1 (have 2) / miss2: 2 / miss3: 3
    expect((await cookableAs(A, hhAB)).map((x) => x.recipe_id)).toEqual([miss0, miss1big, miss1small, miss2])
    expect((await cookableAs(A, hhAB, 0)).map((x) => x.recipe_id)).toEqual([miss0])
    expect((await cookableAs(A, hhAB, 3)).map((x) => x.recipe_id)).toEqual([miss0, miss1big, miss1small, miss2, miss3])
  })

  it('다른 가구(비구성원)는 0줄이고 오류가 아니며, 다른 가구의 가진 재료는 세지 않는다', async () => {
    await seedRecipe(hhAB, 'aaaaaaaaaaa', 'saved', [['두부', 'tofu']])
    await pantryPut(hhAB, 'tofu')
    expect(await cookableAs(C, hhAB)).toEqual([])
    expect(await cookableAs(C, hhC)).toEqual([])
    await pantryPut(hhC, 'tofu')
    // 가구 C의 가진 재료는 AB의 결과를 바꾸지 않는다
    await admin(`delete from recipe.pantry where household_id = $1`, [hhAB])
    expect((await cookableAs(A, hhAB))[0]).toMatchObject({ have: 0, need: 1, missing: ['두부'] })
    expect(await as(null, `select 1`)).toBeTruthy()
    expect(await codeOf(as(null, `select * from recipe.cookable($1)`, [hhAB]))).toBe('42501')
  })
})

describe('import_recipe의 ingredient_key', () => {
  const gold: RecipeV2 = JSON.parse(readFileSync('docs/recipes/contract/examples/youtube-AkX6uA4BaDs.json', 'utf8'))
  const KEY = 'youtube:AkX6uA4BaDs'

  async function importWith(known: string | null, unknown_: string | null): Promise<Row[]> {
    await admin('delete from recipe.inbox')
    await admin('delete from recipe.recipes')
    const [job] = await admin<{ id: string }>(
      `insert into recipe.inbox (household_id, url, source_key, added_by, state) values ($1, 'https://www.youtube.com/watch?v=AkX6uA4BaDs', $2, $3, 'processing') returning id`,
      [hhAB, KEY, A],
    )
    const r = structuredClone(gold) as unknown as { ingredients: Row[] }
    r.ingredients[0].ingredient_key = known
    r.ingredients[1].ingredient_key = unknown_
    const d = difficulty(gold)
    const [{ id }] = await svc<{ id: string }>(`select recipe.import_recipe($1, $2::jsonb, $3, $4::jsonb) as id`, [job.id, JSON.stringify(r), d.level, JSON.stringify(d.basis)])
    return admin(`select position, ingredient_key from recipe.ingredients where recipe_id = $1 order by position`, [id])
  }

  it('사전에 있는 키는 그대로, 없는 키는 23503 없이 null로 저장한다', async () => {
    const rows = await importWith('tofu', 'not_in_dict')
    expect(rows[0]).toMatchObject({ position: 1, ingredient_key: 'tofu' })
    expect(rows[1]).toMatchObject({ position: 2, ingredient_key: null })
  })
})
