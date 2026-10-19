// 성분(P7): grocery.product_info(가구가 상품에 고른 식약처 품목제조보고·원재료·영양성분)를 PGlite에서 검증한다. 가구 구성원만 읽고, 쓰기는 서비스 롤(함수)만.
import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { freshDb } from './dbSetup'

const A = '00000000-0000-4000-8000-00000000000a'
const C = '00000000-0000-4000-8000-00000000000c'
let db: PGlite
let hhA: string
let hhC: string
let product: string

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
const scalar = async <T>(sql: string, params: unknown[] = []): Promise<T> =>
  Object.values((await db.query<Record<string, T>>(sql, params)).rows[0])[0]

beforeAll(async () => {
  db = await freshDb([A, C], async (d) => {
    hhA = (await d.query<{ id: string }>(`insert into public.households default values returning id`)).rows[0].id
    hhC = (await d.query<{ id: string }>(`insert into public.households default values returning id`)).rows[0].id
    await d.query(
      `insert into public.members (household_id, user_id, display_name, role, spouse_role) values ($1, $3, 'A', 'owner', 'husband'), ($2, $4, 'C', 'owner', 'husband')`,
      [hhA, hhC, A, C],
    )
  })
})

beforeEach(async () => {
  await db.exec('reset role; delete from grocery.product_info; delete from grocery.products;')
  product = await scalar<string>(`insert into grocery.products (source, source_id, name) values ('danawa', '5643303', '비비고 왕교자 1.05kg') returning id`)
})

describe('product_info', () => {
  it('서비스 롤(함수)이 넣고 바꾼다. 가구 구성원은 읽기만, 다른 가구는 못 본다', async () => {
    await db.query(
      `insert into grocery.product_info (household_id, product_id, report_no, name, maker, kind, raw_materials, changed_on, nutrition, chosen_by)
       values ($4, $1, '1997040105528', '비비고 왕교자', '씨제이제일제당(주)', '만두', '돼지고기, 밀가루', '2025-03-01', $2, $3)`,
      [product, JSON.stringify({ basis: '100g', kcal: 232, sodium: 540 }), A, hhA],
    )
    const rows = await as(A, `select report_no, name, maker, kind, raw_materials, nutrition, nutrition_error from grocery.product_info`)
    expect(rows[0]).toMatchObject({ report_no: '1997040105528', name: '비비고 왕교자', maker: '씨제이제일제당(주)', raw_materials: '돼지고기, 밀가루', nutrition_error: null })
    expect((rows[0].nutrition as { kcal: number }).kcal).toBe(232)
    expect(await errorOf(as(A, `update grocery.product_info set name = 'x'`))).toMatch(/permission denied/)
    expect(await errorOf(as(A, `insert into grocery.product_info (household_id, product_id, report_no, name) values ($2, $1, '1', 'x')`, [product, hhA]))).toMatch(/permission denied/)
    // 다른 가구는 보지 못한다
    expect(await as(C, `select 1 from grocery.product_info`)).toEqual([])
    expect(await errorOf(as(null, `select 1 from grocery.product_info`))).toMatch(/permission denied/)
    // 다시 고르면 덮어쓴다(상품마다 하나)
    await db.query(
      `insert into grocery.product_info (household_id, product_id, report_no, name, nutrition, nutrition_error) values ($2, $1, '2', '다른 품목', null, 'http_500')
       on conflict (household_id, product_id) do update set report_no = excluded.report_no, name = excluded.name, nutrition = excluded.nutrition, nutrition_error = excluded.nutrition_error, updated_at = now()`,
      [product, hhA],
    )
    expect(await as(A, `select report_no, nutrition, nutrition_error from grocery.product_info`)).toEqual([{ report_no: '2', nutrition: null, nutrition_error: 'http_500' }])
  })

  it('상품을 지우면 함께 지워지고, 보고번호·이름은 꼭 있어야 한다', async () => {
    expect(await errorOf(db.query(`insert into grocery.product_info (household_id, product_id, report_no, name) values ($2, $1, '', 'x')`, [product, hhA]))).toMatch(/check constraint/)
    await db.query(`insert into grocery.product_info (household_id, product_id, report_no, name) values ($2, $1, '1', 'x')`, [product, hhA])
    // 다른 가구도 같은 상품에 각자 고른다
    await db.query(`insert into grocery.product_info (household_id, product_id, report_no, name) values ($2, $1, '9', 'y')`, [product, hhC])
    expect(await scalar<number>(`select count(*)::int from grocery.product_info`)).toBe(2)
    await db.query(`delete from grocery.products where id = $1`, [product])
    expect(await scalar<number>(`select count(*)::int from grocery.product_info`)).toBe(0)
  })
})
