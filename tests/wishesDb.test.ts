import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { freshDb } from './grocery/dbSetup'

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const C = '00000000-0000-4000-8000-00000000000c'
let db: PGlite
let home: string
let other: string
let wish: string

async function as<T = Record<string, unknown>>(user: string | null, sql: string, args: unknown[] = []) {
  await db.exec('reset role')
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user ?? ''])
  await db.exec(user ? 'set role authenticated' : 'set role anon')
  try { return (await db.query<T>(sql, args)).rows } finally { await db.exec('reset role') }
}

beforeAll(async () => {
  db = await freshDb([A, B, C], async (d) => {
    home = (await d.query<{ id: string }>(`insert into public.households default values returning id`)).rows[0].id
    other = (await d.query<{ id: string }>(`insert into public.households default values returning id`)).rows[0].id
    await d.query(`insert into public.members (household_id,user_id,display_name,role) values ($1,$2,'남편','owner'),($1,$3,'아내','partner'),($4,$5,'다른 집','owner')`, [home, A, B, other, C])
  })
})
afterAll(async () => { await db?.close() })

describe('함께 살 물건 보관함 권한', () => {
  it('한 사람이 보관하면 배우자도 보고 목표 가격·메모를 고치며 구입 표시를 되돌린다', async () => {
    const [row] = await as<{ id: string }>(A, `insert into grocery.purchase_wishes (household_id,title,url,target_price,memo,saved_price,price_source,price_checked_at,price_note)
      values ($1,'커피 머신','https://shop.example/coffee',300000,'둘이 고르기',350000,'다나와','2026-10-28T10:00:00Z','1개, 배송비 별도') returning id`, [home])
    wish = row.id
    expect((await as(B, `select title, saved_price::int as price from grocery.purchase_wishes where id=$1`, [wish]))[0]).toEqual({ title: '커피 머신', price: 350000 })
    await as(B, `update grocery.purchase_wishes set target_price=280000,memo='주말에 보기',bought_at=now() where id=$1`, [wish])
    await as(A, `update grocery.purchase_wishes set bought_at=null where id=$1`, [wish])
    expect((await as(A, `select target_price::int as target,memo,bought_at from grocery.purchase_wishes where id=$1`, [wish]))[0]).toEqual({ target: 280000, memo: '주말에 보기', bought_at: null })
  })

  it('다른 가구는 읽기·수정·삭제·다른 집에 추가할 수 없다', async () => {
    expect(await as(C, `select * from grocery.purchase_wishes where id=$1`, [wish])).toEqual([])
    expect(await as(C, `update grocery.purchase_wishes set title='바꿈' where id=$1 returning id`, [wish])).toEqual([])
    expect(await as(C, `delete from grocery.purchase_wishes where id=$1 returning id`, [wish])).toEqual([])
    await expect(as(C, `insert into grocery.purchase_wishes (household_id,title) values ($1,'침입')`, [home])).rejects.toThrow(/row-level security/)
    await expect(as(null, `select * from grocery.purchase_wishes`)).rejects.toThrow(/permission denied/)
  })

  it('작성자·가구·보관 당시 가격은 바꿀 수 없고 다른 사람 이름으로 넣을 수 없다', async () => {
    for (const sql of [
      `update grocery.purchase_wishes set created_by='${B}' where id=$1`,
      `update grocery.purchase_wishes set household_id='${other}' where id=$1`,
      `update grocery.purchase_wishes set saved_price=1 where id=$1`,
    ]) await expect(as(A, sql, [wish])).rejects.toThrow(/permission denied/)
    await expect(as(A, `insert into grocery.purchase_wishes (household_id,title,created_by) values ($1,'가짜',$2)`, [home, B])).rejects.toThrow(/row-level security/)
  })

  it('빈 이름·위험한 링크·잘못된 가격과 출처 없는 가격을 막는다', async () => {
    for (const [title, url, target, price] of [
      ['', null, null, null], ['의자', 'javascript:alert(1)', null, null],
      ['의자', null, 0, null], ['의자', null, -1, null], ['의자', null, null, 1000],
    ]) await expect(as(A, `insert into grocery.purchase_wishes (household_id,title,url,target_price,saved_price) values ($1,$2,$3,$4,$5)`, [home, title, url, target, price])).rejects.toThrow(/check constraint/)
  })

  it('같은 링크는 한 가구에서 중복되지 않고 다른 집에서는 독립적으로 보관한다', async () => {
    await expect(as(B, `insert into grocery.purchase_wishes (household_id,title,url) values ($1,'같은 물건','https://shop.example/coffee')`, [home])).rejects.toThrow(/duplicate key/)
    await as(C, `insert into grocery.purchase_wishes (household_id,title,url) values ($1,'우리 집 것','https://shop.example/coffee')`, [other])
    await as(B, `delete from grocery.purchase_wishes where id=$1`, [wish])
    expect(await as(A, `select * from grocery.purchase_wishes`)).toEqual([])
    expect(await as(C, `select * from grocery.purchase_wishes`)).toHaveLength(1)
  })

  it('상품 링크를 다른 물건으로 바꾸면 이전 상품의 당시 가격을 함께 비운다', async () => {
    const [row] = await as<{ id: string }>(A, `insert into grocery.purchase_wishes (household_id,title,url,saved_price,price_source,price_checked_at,price_note)
      values ($1,'커피 머신','https://shop.example/a',350000,'다나와',now(),'1개') returning id`, [home])
    await as(B, `update grocery.purchase_wishes set title='식탁',url='https://shop.example/b' where id=$1`, [row.id])
    expect((await as(A, `select saved_price,price_source,price_checked_at,price_note from grocery.purchase_wishes where id=$1`, [row.id]))[0])
      .toEqual({ saved_price: null, price_source: null, price_checked_at: null, price_note: null })
  })
})
