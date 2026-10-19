// 가계부 기록 → "우리가 산 값"(P2, 통합 설계 6-2): grocery.our_purchases(p_item)와 판정 표 purchase_verdicts를 PGlite에서 검증한다.
// 가계부 public 표는 RLS 아래에서 읽기만 한다(D-003).
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
const scalar = async <T>(sql: string, params: unknown[] = []): Promise<T> =>
  Object.values((await db.query<Record<string, T>>(sql, params)).rows[0])[0]
const ymd = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : (v as string | null))
const today = new Date(Date.now() + 9 * 3600_000)
const day = (n: number) => new Date(today.getTime() - n * 86400_000).toISOString().slice(0, 10)

async function tx(hh: string, by: string, on: string, amount: number, title: string, platform: string | null = null) {
  return scalar<string>(
    `insert into public.transactions (household_id, type, occurred_on, amount, title, scope, created_by, platform) values ($1, 'expense', $2, $3, $4, 'shared', $5, $6) returning id`,
    [hh, on, amount, title, by, platform],
  )
}
async function line(txId: string, hh: string, name: string, amount: number, qty = 1, unitPrice: number | null = null, pack: [number, string] | null = null, sort = 0) {
  return scalar<string>(
    `insert into public.transaction_items (transaction_id, household_id, name, quantity, unit_price, amount, sort, pack_size, pack_unit) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
    [txId, hh, name, qty, unitPrice, amount, sort, pack?.[0] ?? null, pack?.[1] ?? null],
  )
}
async function item(hh: string, uid: string, name: string, spec: string | null, txId: string | null = null) {
  return scalar<string>(
    `insert into grocery.items (household_id, name, spec, category, added_by, transaction_id, bought_at, bought_by) values ($1, $2, $3, '냉동', $4, $5, case when $5::uuid is null then null else now() end, case when $5::uuid is null then null else $4::uuid end) returning id`,
    [hh, name, spec, uid, txId],
  )
}
type Row = { kind: string; transaction_id: string; transaction_item_id: string | null; occurred_on: unknown; platform: string | null; place: string; created_by: string; name: string; quantity: unknown; unit_price: unknown; amount: unknown; pack_size: unknown; pack_unit: string | null }
// PGlite는 bigint·numeric을 숫자(또는 글자)로 돌려준다 → 숫자 칸은 Number로 맞춘다
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))
const ours = async (uid: string, it: string) =>
  (await as<Row>(uid, `select * from grocery.our_purchases($1)`, [it])).map((r) => ({
    ...r, quantity: num(r.quantity), unit_price: num(r.unit_price), amount: num(r.amount), pack_size: num(r.pack_size),
  }))

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
  await db.exec(`delete from grocery.purchase_verdicts; delete from grocery.items; delete from public.transaction_items; delete from public.transactions;`)
})

describe('our_purchases: 연결된 기록(linked)', () => {
  it('연결된 내역의 품목 줄 중 이름이 가장 잘 맞는 줄 하나, 날짜·곳·산 사람·개당 가격·용량', async () => {
    const t = await tx(hhAB, B, day(3), 15980, '이마트 분당점', null)
    await line(t, hhAB, '서울우유 1L', 2700, 1, 2700, [1000, 'ml'], 0)
    const want = await line(t, hhAB, '비비고 왕교자 1.05kg', 10980, 1, 10980, [1050, 'g'], 1)
    const it1 = await item(hhAB, A, '비비고 왕교자', '1.05kg', t)
    const rows = await ours(A, it1)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'linked', transaction_id: t, transaction_item_id: want, place: '이마트 분당점', created_by: B, name: '비비고 왕교자 1.05kg', unit_price: 10980, amount: 10980, pack_unit: 'g' })
    expect(ymd(rows[0].occurred_on)).toBe(day(3))
    expect(rows[0].pack_size).toBe(1050)
  })

  it('품목 줄이 없는 내역(총액만)은 단위 가격을 비운 한 줄', async () => {
    const t = await tx(hhAB, A, day(1), 23000, '시장', null)
    const it1 = await item(hhAB, A, '대파', null, t)
    const rows = await ours(A, it1)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'linked', transaction_id: t, transaction_item_id: null, name: '시장', unit_price: null, quantity: null, amount: 23000, pack_size: null })
  })
})

describe('our_purchases: 비슷한 기록(similar)과 판정', () => {
  it('최근 365일의 같은 가구 품목 줄 중 이름 단어가 맞는 것만, 남의 가구·오래된 것은 뺀다', async () => {
    const t1 = await tx(hhAB, A, day(10), 21960, '쿠팡', '쿠팡')
    const l1 = await line(t1, hhAB, '비비고 왕교자 1.05kg x2', 21960, 2, 10980, [1050, 'g'])
    await line(t1, hhAB, '햇반 210g', 1200, 1, 1200)
    const t2 = await tx(hhAB, B, day(400), 9900, '이마트', null)
    await line(t2, hhAB, '비비고 왕교자 1.05kg', 9900, 1, 9900)
    const t3 = await tx(hhC, C, day(2), 9900, '이마트', null)
    await line(t3, hhC, '비비고 왕교자 1.05kg', 9900, 1, 9900)
    const it1 = await item(hhAB, A, '비비고 왕교자', '1.05kg')
    const rows = await ours(B, it1)
    expect(rows.map((r) => [r.kind, r.transaction_item_id])).toEqual([['similar', l1]])
    expect(rows[0]).toMatchObject({ platform: '쿠팡', place: '쿠팡', quantity: 2, unit_price: 10980 })
    expect(await ours(C, it1)).toEqual([])
  })

  it('"아니에요"는 다시 나오지 않고, "맞아요"는 confirmed로 올라온다. 같은 이름의 다른 품목도 같은 판정을 본다', async () => {
    const t1 = await tx(hhAB, A, day(10), 21960, '쿠팡', '쿠팡')
    const l1 = await line(t1, hhAB, '비비고 왕교자 1.05kg x2', 21960, 2, 10980)
    const t2 = await tx(hhAB, A, day(20), 10980, '컬리', '컬리')
    const l2 = await line(t2, hhAB, '[비비고] 왕교자 만두 1.05kg', 10980, 1, 10980)
    const it1 = await item(hhAB, A, '비비고 왕교자', '1.05kg')
    const it2 = await item(hhAB, B, '비비고 왕교자', '1.05kg')
    expect((await ours(A, it1)).map((r) => r.kind)).toEqual(['similar', 'similar'])
    await as(A, `select grocery.decide_purchase($1, $2, false)`, [it1, l1])
    await as(B, `select grocery.decide_purchase($1, $2, true)`, [it2, l2])
    expect((await ours(A, it1)).map((r) => [r.kind, r.transaction_item_id])).toEqual([['confirmed', l2]])
    expect((await ours(B, it2)).map((r) => [r.kind, r.transaction_item_id])).toEqual([['confirmed', l2]])
    expect(await as(A, `select name_key, same, decided_by from grocery.purchase_verdicts order by same`)).toEqual([
      { name_key: '비비고왕교자|1.05kg', same: false, decided_by: A },
      { name_key: '비비고왕교자|1.05kg', same: true, decided_by: B },
    ])
    // 판정을 바꿀 수 있다
    await as(A, `select grocery.decide_purchase($1, $2, true)`, [it1, l1])
    expect((await ours(A, it1)).map((r) => r.kind)).toEqual(['confirmed', 'confirmed'])
  })

  it('연결된 줄은 similar·confirmed에 다시 나오지 않는다', async () => {
    const t1 = await tx(hhAB, A, day(10), 10980, '쿠팡', '쿠팡')
    const l1 = await line(t1, hhAB, '비비고 왕교자 1.05kg', 10980, 1, 10980)
    const it1 = await item(hhAB, A, '비비고 왕교자', '1.05kg', t1)
    await as(A, `select grocery.decide_purchase($1, $2, true)`, [it1, l1])
    expect((await ours(A, it1)).map((r) => [r.kind, r.transaction_item_id])).toEqual([['linked', l1]])
  })

  it('남의 품목에 판정하면 item_not_found, 남의 가구 판정 표는 보이지 않고 넣을 수 없다, 가계부 품목을 지우면 판정도 지워진다', async () => {
    const t1 = await tx(hhAB, A, day(10), 10980, '쿠팡', '쿠팡')
    const l1 = await line(t1, hhAB, '비비고 왕교자 1.05kg', 10980, 1, 10980)
    const it1 = await item(hhAB, A, '비비고 왕교자', '1.05kg')
    expect(await errorOf(as(C, `select grocery.decide_purchase($1, $2, true)`, [it1, l1]))).toMatch(/item_not_found/)
    await as(A, `select grocery.decide_purchase($1, $2, true)`, [it1, l1])
    expect(await as(C, `select 1 from grocery.purchase_verdicts`)).toEqual([])
    expect(await errorOf(as(C, `insert into grocery.purchase_verdicts (household_id, name_key, transaction_item_id, same) values ($1, 'x|', $2, true)`, [hhAB, l1]))).toMatch(/row-level security/)
    expect(await errorOf(as(null, `select 1 from grocery.purchase_verdicts`))).toMatch(/permission denied/)
    await db.query(`delete from public.transaction_items where id = $1`, [l1])
    expect(await scalar<number>(`select count(*)::int from grocery.purchase_verdicts`)).toBe(0)
  })

  it('비슷한 기록은 최근 순 20줄까지', async () => {
    for (let i = 0; i < 25; i++) {
      const t = await tx(hhAB, A, day(i + 1), 1000, '쿠팡', '쿠팡')
      await line(t, hhAB, `비비고 왕교자 ${i}`, 1000, 1, 1000)
    }
    const it1 = await item(hhAB, A, '비비고 왕교자', null)
    const rows = await ours(A, it1)
    expect(rows).toHaveLength(20)
    expect(ymd(rows[0].occurred_on)).toBe(day(1))
  })
})
