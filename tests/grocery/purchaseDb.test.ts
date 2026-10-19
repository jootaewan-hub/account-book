// 장 본 것 → 가계부 내역 연결(grocery.link_purchase, grocery.record_purchase)을 PGlite에서 검증한다(D-011).
import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { freshDb } from './dbSetup'

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const C = '00000000-0000-4000-8000-00000000000c'

let db: PGlite
let hhAB: string
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

const txJson = (amount: number, title = '이마트') =>
  JSON.stringify({ type: 'expense', occurred_on: '2026-10-18', amount, title, scope: 'shared', source: 'manual' })

/** 가계부 함수로 내역을 하나 만든다(그 사람 권한) */
async function addTx(uid: string, household: string, amount: number): Promise<string> {
  const r = await as<{ id: string }>(uid, `select public.add_transaction_with_items($1, $2::jsonb, '[]'::jsonb) as id`, [household, txJson(amount)])
  return r[0].id
}

async function item(household: string, uid: string, name: string, bought = false): Promise<string> {
  const r = await db.query<{ id: string }>(
    `insert into grocery.items (household_id, name, category, added_by, bought_by, bought_at)
     values ($1, $2, '채소', $3, $4, $5) returning id`,
    [household, name, uid, bought ? uid : null, bought ? '2026-10-18T03:00:00Z' : null],
  )
  return r.rows[0].id
}

const row = async (id: string) =>
  (await db.query<{ transaction_id: string | null; bought_at: string | null; bought_by: string | null; paid: string | null }>(
    `select transaction_id, bought_at, bought_by, paid from grocery.items where id = $1`, [id])).rows[0]

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
})

beforeEach(async () => {
  await db.exec('reset role')
  await db.exec('delete from grocery.items; delete from public.transactions;')
})

describe('link_purchase', () => {
  it('같은 가구 내역에 연결하면 산 것·산 사람·금액이 채워진다', async () => {
    const i = await item(hhAB, A, '대파')
    const tx = await addTx(B, hhAB, 3000)
    const n = await as<{ n: number }>(B, `select grocery.link_purchase($1, $2::jsonb) as n`, [tx, JSON.stringify([{ item_id: i, paid: 3000 }])])
    expect(n[0].n).toBe(1)
    const r = await row(i)
    expect(r.transaction_id).toBe(tx)
    expect(r.bought_by).toBe(B)
    expect(Number(r.paid)).toBe(3000)
    // 내역 날짜(2026-10-18)의 한국 시간 정오 = 03:00 UTC
    expect(new Date(r.bought_at!).toISOString()).toBe('2026-10-18T03:00:00.000Z')
  })

  it('이미 산 품목은 산 사람·산 시각을 그대로 두고 금액만 채운다', async () => {
    const i = await item(hhAB, A, '우유', true)
    const tx = await addTx(B, hhAB, 2500)
    await as(B, `select grocery.link_purchase($1, $2::jsonb)`, [tx, JSON.stringify([{ item_id: i, paid: 2500 }])])
    const r = await row(i)
    expect(r.bought_by).toBe(A)
    expect(new Date(r.bought_at!).toISOString()).toBe('2026-10-18T03:00:00.000Z')
    expect(Number(r.paid)).toBe(2500)
  })

  it('금액 없이도 연결된다', async () => {
    const i = await item(hhAB, A, '두부')
    const tx = await addTx(A, hhAB, 1500)
    await as(A, `select grocery.link_purchase($1, $2::jsonb)`, [tx, JSON.stringify([{ item_id: i, paid: null }])])
    expect((await row(i)).paid).toBeNull()
  })

  it('남의 가구 내역에는 연결되지 않는다', async () => {
    const i = await item(hhAB, A, '대파')
    const other = await addTx(C, hhC, 3000)
    expect(await errorOf(as(A, `select grocery.link_purchase($1, $2::jsonb)`, [other, JSON.stringify([{ item_id: i, paid: 3000 }])])))
      .toContain('tx_not_found')
    expect((await row(i)).transaction_id).toBeNull()
  })

  it('남의 가구 품목은 연결되지 않는다', async () => {
    const i = await item(hhC, C, '대파')
    const tx = await addTx(A, hhAB, 3000)
    expect(await errorOf(as(A, `select grocery.link_purchase($1, $2::jsonb)`, [tx, JSON.stringify([{ item_id: i, paid: 3000 }])])))
      .toContain('item_not_found')
  })

  it('이미 연결된 품목은 다시 연결할 수 없다(두 번 넣기 방지)', async () => {
    const i = await item(hhAB, A, '대파')
    const t1 = await addTx(A, hhAB, 3000)
    const t2 = await addTx(A, hhAB, 3000)
    await as(A, `select grocery.link_purchase($1, $2::jsonb)`, [t1, JSON.stringify([{ item_id: i, paid: 3000 }])])
    expect(await errorOf(as(A, `select grocery.link_purchase($1, $2::jsonb)`, [t2, JSON.stringify([{ item_id: i, paid: 3000 }])])))
      .toContain('already_linked')
    expect((await row(i)).transaction_id).toBe(t1)
  })

  it('0원 이하 금액은 거절한다', async () => {
    const i = await item(hhAB, A, '대파')
    const tx = await addTx(A, hhAB, 3000)
    expect(await errorOf(as(A, `select grocery.link_purchase($1, $2::jsonb)`, [tx, JSON.stringify([{ item_id: i, paid: 0 }])])))
      .toContain('invalid_paid')
  })

  it('로그인하지 않은 사용자는 부를 수 없다', async () => {
    expect(await errorOf(as(null, `select grocery.link_purchase(gen_random_uuid(), '[]'::jsonb)`))).toContain('permission denied')
  })
})

describe('연결 칸 직접 바꾸기', () => {
  it('연결된 품목을 다른 내역으로 바꾸면 거절한다', async () => {
    const i = await item(hhAB, A, '대파')
    const t1 = await addTx(A, hhAB, 3000)
    const t2 = await addTx(A, hhAB, 3000)
    await as(A, `select grocery.link_purchase($1, $2::jsonb)`, [t1, JSON.stringify([{ item_id: i, paid: 3000 }])])
    expect(await errorOf(as(A, `update grocery.items set transaction_id = $1 where id = $2`, [t2, i]))).toContain('already_linked')
  })

  it('남의 가구 내역 id를 직접 넣을 수 없다(가구가 같은 내역만 참조)', async () => {
    const i = await item(hhAB, A, '대파', true)
    const other = await addTx(C, hhC, 3000)
    expect(await errorOf(as(A, `update grocery.items set transaction_id = $1 where id = $2`, [other, i]))).toContain('foreign key')
  })

  it('가계부에 넣은 품목은 산 것을 풀 수 없다', async () => {
    const i = await item(hhAB, A, '대파')
    const tx = await addTx(A, hhAB, 3000)
    await as(A, `select grocery.link_purchase($1, $2::jsonb)`, [tx, JSON.stringify([{ item_id: i, paid: 3000 }])])
    expect(await errorOf(as(A, `update grocery.items set bought_by = null, bought_at = null, paid = null where id = $1`, [i])))
      .toContain('items_linked_bought')
  })

  it('가계부에서 내역을 지우면 품목은 남고 연결만 풀린다', async () => {
    const i = await item(hhAB, A, '대파')
    const tx = await addTx(A, hhAB, 3000)
    await as(A, `select grocery.link_purchase($1, $2::jsonb)`, [tx, JSON.stringify([{ item_id: i, paid: 3000 }])])
    await as(A, `delete from public.transactions where id = $1`, [tx])
    const r = await row(i)
    expect(r.transaction_id).toBeNull()
    expect(r.bought_at).not.toBeNull()
  })
})

describe('record_purchase', () => {
  const entry = (amount: number, links: { item_id: string; paid: number | null }[], items: unknown[] = []) =>
    ({ tx: JSON.parse(txJson(amount)), items, links })

  it('내역·품목 줄·연결을 한 번에 만든다', async () => {
    const i1 = await item(hhAB, A, '대파')
    const i2 = await item(hhAB, A, '우유')
    const entries = [
      entry(3000, [{ item_id: i1, paid: 3000 }], [{ name: '대파', quantity: 1, unit_price: 3000, amount: 3000 }]),
      entry(2500, [{ item_id: i2, paid: 2500 }], [{ name: '우유', quantity: 1, unit_price: 2500, amount: 2500 }]),
    ]
    const r = await as<{ ids: string[] }>(B, `select grocery.record_purchase($1, $2::jsonb) as ids`, [hhAB, JSON.stringify(entries)])
    expect(r[0].ids).toHaveLength(2)
    expect((await row(i1)).transaction_id).toBe(r[0].ids[0])
    expect((await row(i2)).transaction_id).toBe(r[0].ids[1])
    const lines = await as<{ name: string }>(B, `select name from public.transaction_items order by name`)
    expect(lines.map((l) => l.name)).toEqual(['대파', '우유'])
  })

  it('품목 줄 없이(총액만) 내역 하나에 여러 품목을 연결한다', async () => {
    const i1 = await item(hhAB, A, '대파')
    const i2 = await item(hhAB, A, '우유')
    const r = await as<{ ids: string[] }>(A, `select grocery.record_purchase($1, $2::jsonb) as ids`,
      [hhAB, JSON.stringify([entry(5500, [{ item_id: i1, paid: null }, { item_id: i2, paid: null }])])])
    expect((await row(i1)).transaction_id).toBe(r[0].ids[0])
    expect((await row(i2)).transaction_id).toBe(r[0].ids[0])
  })

  it('두 번째가 실패하면 첫 번째 내역도 남지 않는다', async () => {
    const i1 = await item(hhAB, A, '대파')
    const linked = await item(hhAB, A, '우유')
    const t = await addTx(A, hhAB, 2500)
    await as(A, `select grocery.link_purchase($1, $2::jsonb)`, [t, JSON.stringify([{ item_id: linked, paid: 2500 }])])
    const before = (await as<{ n: number }>(A, `select count(*)::int as n from public.transactions`))[0].n
    const entries = [entry(3000, [{ item_id: i1, paid: 3000 }]), entry(2500, [{ item_id: linked, paid: 2500 }])]
    expect(await errorOf(as(A, `select grocery.record_purchase($1, $2::jsonb)`, [hhAB, JSON.stringify(entries)]))).toContain('already_linked')
    expect((await as<{ n: number }>(A, `select count(*)::int as n from public.transactions`))[0].n).toBe(before)
    expect((await row(i1)).transaction_id).toBeNull()
  })

  it('연결할 품목이 없는 항목은 거절한다', async () => {
    expect(await errorOf(as(A, `select grocery.record_purchase($1, $2::jsonb)`, [hhAB, JSON.stringify([entry(1000, [])])]))).toContain('no_links')
    expect(await errorOf(as(A, `select grocery.record_purchase($1, '[]'::jsonb)`, [hhAB]))).toContain('no_entries')
  })

  it('남의 가구로는 내역을 만들 수 없다', async () => {
    const i = await item(hhC, C, '대파')
    expect(await errorOf(as(A, `select grocery.record_purchase($1, $2::jsonb)`, [hhC, JSON.stringify([entry(3000, [{ item_id: i, paid: 3000 }])])])))
      .not.toBe('NO_ERROR')
    expect((await row(i)).transaction_id).toBeNull()
  })
})
