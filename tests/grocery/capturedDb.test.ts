// 화면 캡처로 넣은 가격(P4): grocery.captured_quotes(가구 RLS)와, 오늘 캡처한 값이 item_prices()의 "가장 싼 값" 후보가 되는지 PGlite에서 검증한다.
import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { freshDb } from './dbSetup'

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const C = '00000000-0000-4000-8000-00000000000c'
let db: PGlite
let hhAB: string
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

async function item(hh: string, uid: string, qty = 1) {
  return scalar<string>(
    `insert into grocery.items (household_id, name, category, added_by, product_id, product_qty) values ($1, '비비고 왕교자', '냉동', $2, $3, $4) returning id`,
    [hh, uid, product, qty],
  )
}
async function capture(uid: string, hh: string, price: number, qty = 1, at = 'now()', seller = '쿠팡') {
  return as(uid, `insert into grocery.captured_quotes (household_id, product_id, seller, price, qty, delivery, captured_at) values ($1, $2, $3, $4, $5, 0, ${at}) returning id`, [hh, product, seller, price, qty])
}
async function danawa(price: number, at = 'now()') {
  const id = await scalar<string>(`insert into grocery.price_checks (product_id, source, checked_at, ok, page_qty) values ($1, 'danawa', ${at}, true, 1) returning id`, [product])
  await db.query(`insert into grocery.price_quotes (check_id, product_id, qty, seller, price, delivery) values ($1, $2, 1, '11번가', $3, 3000)`, [id, product, price])
}

beforeAll(async () => {
  db = await freshDb([A, B, C], async (d) => {
    hhAB = (await d.query<{ id: string }>(`insert into public.households default values returning id`)).rows[0].id
    hhC = (await d.query<{ id: string }>(`insert into public.households default values returning id`)).rows[0].id
    await d.query(
      `insert into public.members (household_id, user_id, display_name, role, spouse_role) values
       ($1,$3,'A','owner','husband'), ($1,$4,'B','partner','wife'), ($2,$5,'C','owner','husband')`,
      [hhAB, hhC, A, B, C],
    )
  })
  product = await scalar<string>(`insert into grocery.products (source, source_id, name) values ('danawa', '5643303', '비비고 왕교자 1.05kg') returning id`)
})

beforeEach(async () => {
  await db.exec('reset role')
  await db.exec(`delete from grocery.captured_quotes; delete from grocery.price_quotes; delete from grocery.price_checks; delete from grocery.items;`)
})

describe('captured_quotes', () => {
  it('가구 구성원이 넣고 보고 지운다. 다른 가구와 로그인 안 한 사용자는 못 본다', async () => {
    await capture(A, hhAB, 9900)
    expect(await as(B, `select seller, price, qty, delivery, captured_by from grocery.captured_quotes`)).toEqual([{ seller: '쿠팡', price: 9900, qty: 1, delivery: 0, captured_by: A }])
    expect(await as(C, `select 1 from grocery.captured_quotes`)).toEqual([])
    expect(await errorOf(as(null, `select 1 from grocery.captured_quotes`))).toMatch(/permission denied/)
    expect(await errorOf(capture(C, hhAB, 100))).toMatch(/row-level security/)
    await as(B, `delete from grocery.captured_quotes`)
    expect(await as(A, `select 1 from grocery.captured_quotes`)).toEqual([])
  })

  it('값 검사: 0원·수량 0·판매처 빈 글자는 거절, 올린 사람은 본인', async () => {
    expect(await errorOf(capture(A, hhAB, 0))).toMatch(/check constraint/)
    expect(await errorOf(capture(A, hhAB, 100, 0))).toMatch(/check constraint/)
    expect(await errorOf(capture(A, hhAB, 100, 1, 'now()', ''))).toMatch(/check constraint/)
    expect(await errorOf(as(B, `insert into grocery.captured_quotes (household_id, product_id, seller, price, qty, captured_by) values ($1, $2, 'x', 1, 1, $3)`, [hhAB, product, A]))).toMatch(/row-level security/)
  })
})

describe('item_prices()에 오늘 캡처한 값', () => {
  it('오늘 캡처한 같은 수량의 값이 더 싸면 그 값이 가장 싼 값(source capture)', async () => {
    const it1 = await item(hhAB, A)
    await danawa(10380)
    await capture(B, hhAB, 9900)
    expect(await as(A, `select item_id, price, seller, source, qty, delivery from grocery.item_prices()`)).toEqual([
      { item_id: it1, price: 9900, seller: '쿠팡', source: 'capture', qty: 1, delivery: 0 },
    ])
  })

  it('다나와가 더 싸면 다나와, 캡처 수량이 다르면 쓰지 않는다', async () => {
    await item(hhAB, A)
    await danawa(9000)
    await capture(A, hhAB, 9900)
    expect((await as(A, `select source from grocery.item_prices()`))[0].source).toBe('danawa')
    await db.exec(`delete from grocery.price_quotes; delete from grocery.price_checks; delete from grocery.captured_quotes;`)
    await capture(A, hhAB, 5000, 2)
    expect(await as(A, `select * from grocery.item_prices()`)).toEqual([])
  })

  it('어제 캡처·다른 가구의 캡처는 쓰지 않는다', async () => {
    const it1 = await item(hhAB, A)
    await capture(A, hhAB, 9900, 1, `(date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul') - interval '1 minute'`)
    await capture(C, hhC, 100)
    expect(await as(A, `select * from grocery.item_prices()`)).toEqual([])
    await capture(A, hhAB, 9500)
    expect((await as(A, `select item_id, price from grocery.item_prices()`))).toEqual([{ item_id: it1, price: 9500 }])
  })
})
