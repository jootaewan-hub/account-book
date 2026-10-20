// 품목 영양성분 기억 표(grocery.item_nutrition, 20261029000000, P9 D-018)를 PGlite에서 검증한다.
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { freshDb } from './dbSetup'

const A = '00000000-0000-4000-8000-00000000000a'
const C = '00000000-0000-4000-8000-00000000000c'

let db: PGlite
let hhA: string
let hhC: string

async function as<T = Record<string, unknown>>(uid: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec('reset role')
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? ''])
  await db.exec(uid ? 'set role authenticated' : 'set role anon')
  try {
    return (await db.query<T>(sql, params)).rows
  } finally {
    await db.exec('reset role')
  }
}
async function errorOf(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    return (e as Error).message
  }
  return 'NO_ERROR'
}
const item = async (household: string, user: string, name: string, spec: string | null = null) =>
  (await db.query<{ id: string }>(`insert into grocery.items (household_id, name, spec, category, added_by) values ($1, $2, $3, '채소', $4) returning id`, [household, name, spec, user])).rows[0].id
const NUT = { basis: '100g', kcal: 30, carbs: 6.5, protein: 1.5, fat: 0.2, source: '식품의약품안전처(식품영양성분DB)', foodName: '파, 대파, 생것' }

beforeAll(async () => {
  db = await freshDb([A, C], async (d) => {
    hhA = (await d.query<{ id: string }>(`insert into public.households default values returning id`)).rows[0].id
    hhC = (await d.query<{ id: string }>(`insert into public.households default values returning id`)).rows[0].id
    await d.query(
      `insert into public.members (household_id, user_id, display_name, role, spouse_role) values ($1,$3,'A','owner','husband'), ($2,$4,'C','owner','husband')`,
      [hhA, hhC, A, C],
    )
  })
})

describe('item_nutrition', () => {
  it('서비스 롤 함수로 저장하면 같은 이름·규격의 내 가구 품목마다 보이고, 남의 가구는 못 본다. 로그인 사용자는 저장 함수를 못 부른다', async () => {
    const a1 = await item(hhA, A, '대파')
    const a2 = await item(hhA, A, '대파')
    const other = await item(hhA, A, '쪽파')
    const c1 = await item(hhC, C, '대파')
    await db.query(`select grocery.set_item_nutrition($1, 'D000000123', '파, 대파, 생것', null, $2::jsonb, $3)`, [a1, JSON.stringify(NUT), A])
    const rows = await as<{ item_id: string; food_name: string; nutrition: { kcal: number } }>(A, `select item_id, food_name, nutrition from grocery.item_nutrition_rows() order by item_id`)
    expect(rows.map((r) => r.item_id).sort()).toEqual([a1, a2].sort())
    expect(rows[0]).toMatchObject({ food_name: '파, 대파, 생것', nutrition: { kcal: 30 } })
    expect(rows.find((r) => r.item_id === other)).toBeUndefined()
    expect(await as(C, `select * from grocery.item_nutrition_rows()`)).toEqual([])
    void c1
    expect(await errorOf(as(A, `select grocery.set_item_nutrition($1, 'x', 'x', null, '{}'::jsonb, $2)`, [a1, A]))).toMatch(/permission denied/)
    // 다시 고르면 덮어쓴다
    await db.query(`select grocery.set_item_nutrition($1, 'D000000999', '파, 쪽파, 생것', null, $2::jsonb, $3)`, [a1, JSON.stringify({ ...NUT, kcal: 25 }), A])
    const again = await as<{ food_name: string }>(A, `select food_name from grocery.item_nutrition_rows() where item_id = $1`, [a1])
    expect(again).toEqual([{ food_name: '파, 쪽파, 생것' }])
    expect(await errorOf(db.query(`select grocery.set_item_nutrition('00000000-0000-4000-8000-00000000ffff', 'x', 'x', null, '{}'::jsonb, null)`))).toContain('item_not_found')
  })
})
