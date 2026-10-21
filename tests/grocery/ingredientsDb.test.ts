// 품목 원재료 기억 표(grocery.item_ingredients, 20261030000000, D-020)를 PGlite에서 검증한다.
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
  (await db.query<{ id: string }>(`insert into grocery.items (household_id, name, spec, category, added_by) values ($1, $2, $3, '가공', $4) returning id`, [household, name, spec, user])).rows[0].id
const SET = `select grocery.set_item_ingredients($1, $2, $3, $4, $5, $6, $7, $8::date, $9::jsonb, $10)`

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

describe('item_ingredients', () => {
  it('서비스 롤 함수로 저장하면 같은 이름·규격의 내 가구 품목마다 보이고, 남의 가구는 못 본다. 로그인 사용자는 저장 함수를 못 부른다', async () => {
    const a1 = await item(hhA, A, '된장', '900g')
    const a2 = await item(hhA, A, '된장', '900g')
    const other = await item(hhA, A, '된장', '500g')
    await item(hhC, C, '된장', '900g')
    const details = { shelfLife: null, health: null, auto: true, matchedBy: 'product' }
    await db.query(SET, [a1, 'C002', '2019001234', '국산콩 백일된장', '샘표식품주식회사', '된장', '대두(국산), 천일염', '2024-03-02', JSON.stringify(details), null])
    const rows = await as<{ item_id: string; origin: string; name: string; raw_materials: string; changed_on: string; details: { auto: boolean } }>(
      A, `select item_id, origin, name, raw_materials, changed_on::text as changed_on, details from grocery.item_ingredients_rows() order by item_id`,
    )
    expect(rows.map((r) => r.item_id).sort()).toEqual([a1, a2].sort())
    expect(rows[0]).toMatchObject({ origin: 'C002', name: '국산콩 백일된장', raw_materials: '대두(국산), 천일염', details: { auto: true, matchedBy: 'product' } })
    expect(String(rows[0].changed_on)).toMatch(/^2024-03-02/)
    expect(rows.find((r) => r.item_id === other)).toBeUndefined()
    expect(await as(C, `select * from grocery.item_ingredients_rows()`)).toEqual([])
    expect(await errorOf(as(A, SET, [a1, 'C002', 'x', 'x', null, null, null, null, '{}', A]))).toMatch(/permission denied/)
    // 다시 고르면 덮어쓴다(고른 사람 기록)
    await db.query(SET, [a1, 'C006', '199900307705', '닭꼬치', '노벨유통', '포장육', '닭고기', null, JSON.stringify({ shelfLife: '제조일로부터 7일', auto: false, matchedBy: null }), A])
    const again = await as<{ origin: string; name: string; details: { shelfLife: string } }>(A, `select origin, name, details from grocery.item_ingredients_rows() where item_id = $1`, [a1])
    expect(again).toEqual([{ origin: 'C006', name: '닭꼬치', details: { shelfLife: '제조일로부터 7일', auto: false, matchedBy: null } }])
    expect(await errorOf(db.query(SET, ['00000000-0000-4000-8000-00000000ffff', 'C002', 'x', 'x', null, null, null, null, '{}', null]))).toContain('item_not_found')
    // 찾는 목록 이름(I1310)은 origin이 아니다
    expect(await errorOf(db.query(SET, [a1, 'I1310', 'x', 'x', null, null, null, null, '{}', null]))).toMatch(/origin/)
  })
})
