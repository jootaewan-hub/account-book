import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { exportRefundMemo, type TransactionRefundRow } from '../src/lib/refunds'
import { freshDb } from './grocery/dbSetup'

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const C = '00000000-0000-4000-8000-00000000000c'
let db: PGlite
let household: string

async function as<T = Record<string, unknown>>(user: string | null, sql: string, args: unknown[] = []) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? ''])
  await db.exec(user ? 'set role authenticated' : 'set role anon')
  try { return (await db.query<T>(sql, args)).rows } finally { await db.exec('reset role') }
}

beforeAll(async () => {
  db = await freshDb([A, B, C], async (d) => {
    household = (await d.query<{ id: string }>('insert into public.households default values returning id')).rows[0].id
    const other = (await d.query<{ id: string }>('insert into public.households default values returning id')).rows[0].id
    await d.query(`insert into public.members (household_id,user_id,display_name,role)
      values ($1,$2,'남편','owner'),($1,$3,'아내','partner'),($4,$5,'다른 집','owner')`, [household, A, B, other, C])
  })
})
afterAll(async () => { await db?.close() })

const insertRefund = (user: string, purchase: string, amount: number, requested: string, refunded: string | null) =>
  as<TransactionRefundRow>(user, `insert into public.transaction_refunds
    (transaction_id, household_id, amount, requested_on, refunded_on)
    values ($1,$2,$3,$4,$5) returning id, amount::int, requested_on::text, refunded_on::text`,
  [purchase, household, amount, requested, refunded])

it('배우자가 부분 환불을 따로 완료할 수 있으며 월 합계와 CSV에 반영된다', async () => {
  const [{ id: purchase }] = await as<{ id: string }>(A, `insert into public.transactions
    (household_id, type, occurred_on, amount, title, scope, memo)
    values ($1,'expense','2026-01-28',10000,'부분 환불 결제','shared','결제 메모') returning id`, [household])
  const [{ id: pending }] = await insertRefund(A, purchase, 3000, '2026-02-01', null)
  await insertRefund(B, purchase, 1000, '2026-02-02', '2026-02-10')
  const totals = () => as(B, `select month::text, type, total::int, n
    from public.monthly_totals($1,'2026-01-01','2026-02-28')`, [household])
  expect(await totals()).toEqual([{ month: '2026-01-01', type: 'expense', total: 9000, n: 1 }])

  await as(B, "update public.transaction_refunds set refunded_on='2026-02-08' where id=$1", [pending])
  expect(await totals()).toEqual([{ month: '2026-01-01', type: 'expense', total: 6000, n: 1 }])
  expect(await as(A, 'select amount::int, memo from public.transactions where id=$1', [purchase]))
    .toEqual([{ amount: 10000, memo: '결제 메모' }])

  const [{ token }] = await as<{ token: string }>(A, 'select public.export_token($1) as token', [household])
  const refunds = await as<TransactionRefundRow>(A, `select id, amount::int, requested_on::text, refunded_on::text
    from public.transaction_refunds where transaction_id=$1`, [purchase])
  const { rows } = await db.query('select amount::int, memo from public.export_rows_v2($1)', [token])
  expect(rows).toEqual([{ amount: 10000, memo: exportRefundMemo('결제 메모', 10000, refunds) }])
})

it('다른 가구의 접근과 원결제 금액·날짜를 벗어나는 기록을 막는다', async () => {
  const [{ id: purchase }] = await as<{ id: string }>(A, `insert into public.transactions
    (household_id,type,occurred_on,amount,scope) values ($1,'expense','2026-03-01',10000,'shared') returning id`, [household])
  const [{ id: pending }] = await insertRefund(A, purchase, 3000, '2026-03-05', null)

  expect(await as(C, 'select * from public.transaction_refunds where id=$1', [pending])).toEqual([])
  expect(await as(C, 'delete from public.transaction_refunds where id=$1 returning id', [pending])).toEqual([])
  await expect(as(null, 'select * from public.transaction_refunds')).rejects.toThrow(/permission denied/)
  await expect(insertRefund(C, purchase, 1000, '2026-03-05', null)).rejects.toThrow('지출을 찾을 수 없어요')
  await expect(insertRefund(B, purchase, 8000, '2026-03-05', null)).rejects.toThrow('결제 금액을 넘길 수 없어요')
  await expect(as(B, `insert into public.transaction_refunds (transaction_id,household_id,amount,requested_on)
    values ($1,$2,4000,'2026-03-05'),($1,$2,4000,'2026-03-05')`, [purchase, household]))
    .rejects.toThrow('결제 금액을 넘길 수 없어요')
  expect(await as(A, 'select amount::int from public.transaction_refunds where transaction_id=$1', [purchase]))
    .toEqual([{ amount: 3000 }])
  await expect(insertRefund(B, purchase, 5000, '2026-02-25', null)).rejects.toThrow('환불 날짜는 결제일에서 오늘 사이')
  await expect(insertRefund(B, purchase, 5000, '2026-03-05', '2026-03-04')).rejects.toThrow(/check constraint/)
  await expect(as(A, 'update public.transactions set amount=1000 where id=$1', [purchase])).rejects.toThrow('환불 금액의 합계')
  await expect(as(A, "update public.transactions set type='income' where id=$1", [purchase])).rejects.toThrow('수입으로 바꿀 수 없어요')
  await expect(as(A, "update public.transactions set occurred_on='2026-03-06' where id=$1", [purchase])).rejects.toThrow('첫 환불 요청일')

  await as(B, 'delete from public.transactions where id=$1', [purchase])
  expect(await as(A, 'select * from public.transaction_refunds where id=$1', [pending])).toEqual([])
})
