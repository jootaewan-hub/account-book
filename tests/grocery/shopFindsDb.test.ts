// 몰 주소 자동 찾기(D-024): grocery.shop_finds를 PGlite에서 검증한다. 가구 구성원만 읽고, 쓰기는 서비스 롤(shop-find 함수)만.
import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
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

beforeAll(async () => {
  db = await freshDb([A, C], async (d) => {
    hhA = (await d.query<{ id: string }>(`insert into public.households default values returning id`)).rows[0].id
    hhC = (await d.query<{ id: string }>(`insert into public.households default values returning id`)).rows[0].id
    await d.query(`insert into public.members (household_id, user_id, display_name, role) values ($1,$3,'A','owner'), ($2,$4,'C','owner')`, [hhA, hhC, A, C])
  })
  product = (await db.query<{ id: string }>(`insert into grocery.products (source, source_id, name) values ('danawa', '5643303', '비비고 왕교자 1.05kg') returning id`)).rows[0].id
  // 서비스 롤(함수)이 쓴 결과
  await db.query(
    `insert into grocery.shop_finds (household_id, product_id, status, candidates) values ($1, $2, 'done', $3::jsonb)`,
    [hhA, product, JSON.stringify([{ source: 'kurly', sourceId: '5082274', url: 'https://www.kurly.com/goods/5082274', name: '[비비고] 왕교자 1.05kg', size: null, price: 10980, checkedAt: '2026-10-22T01:00:00Z', grade: 'auto', saved: true }])],
  )
})

describe('shop_finds', () => {
  it('가구 구성원만 읽는다', async () => {
    const rows = await as<{ status: string; candidates: { sourceId: string }[] }>(A, `select status, candidates from grocery.shop_finds`)
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('done')
    expect(rows[0].candidates[0].sourceId).toBe('5082274')
    expect(await as(C, `select 1 from grocery.shop_finds`)).toEqual([])
    expect(await errorOf(as(null, `select 1 from grocery.shop_finds`))).toMatch(/permission denied/)
  })
  it('로그인한 사용자는 쓰지 못한다(함수만 쓴다)', async () => {
    expect(await errorOf(as(A, `insert into grocery.shop_finds (household_id, product_id, status) values ($1, $2, 'searching')`, [hhC, product]))).toMatch(/permission denied/)
    expect(await errorOf(as(A, `update grocery.shop_finds set status = 'failed'`))).toMatch(/permission denied/)
    expect(await errorOf(as(A, `delete from grocery.shop_finds`))).toMatch(/permission denied/)
  })
  it('상태·후보 모양을 지킨다', async () => {
    expect(await errorOf(db.query(`insert into grocery.shop_finds (household_id, product_id, status) values ($1, $2, 'weird')`, [hhC, product]))).toMatch(/check constraint/)
    expect(await errorOf(db.query(`insert into grocery.shop_finds (household_id, product_id, status, candidates) values ($1, $2, 'done', '{}'::jsonb)`, [hhC, product]))).toMatch(/check constraint/)
  })
  it('상품을 지우면 함께 지워진다', async () => {
    const p2 = (await db.query<{ id: string }>(`insert into grocery.products (source, source_id, name) values ('danawa', '1', 'x') returning id`)).rows[0].id
    await db.query(`insert into grocery.shop_finds (household_id, product_id, status) values ($1, $2, 'done')`, [hhC, p2])
    await db.query(`delete from grocery.products where id = $1`, [p2])
    expect((await db.query(`select 1 from grocery.shop_finds where product_id = $1`, [p2])).rows).toEqual([])
  })
})
