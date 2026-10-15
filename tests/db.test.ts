// 마이그레이션을 PGlite(브라우저·Node용 Postgres)에 적용해 RLS와 가구 함수를 검증한다.
// Supabase의 auth 스키마, anon/authenticated 역할, realtime publication은 최소한으로 흉내 낸다.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../supabase/migrations/20261015000000_init.sql', import.meta.url),
  'utf8',
)

const SUPABASE_STUB = `
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create role anon nologin;
create role authenticated nologin;
grant usage on schema public to anon, authenticated;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
create publication supabase_realtime;
`

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const C = '00000000-0000-4000-8000-00000000000c'

let db: PGlite

async function as<T = Record<string, unknown>>(
  uid: string | null,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  await db.exec('reset role')
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? ''])
  await db.exec(uid ? 'set role authenticated' : 'set role anon')
  try {
    const res = await db.query<T>(sql, params)
    return res.rows
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

let hhA: string
let hhC: string

beforeAll(async () => {
  db = new PGlite()
  await db.exec(SUPABASE_STUB)
  await db.exec(migration)
  await db.query(`insert into auth.users (id, email) values ($1,'a@x'),($2,'b@x'),($3,'c@x')`, [A, B, C])
})

describe('가구 만들기와 참여', () => {
  it('create_household가 가구, 멤버, 기본 분류·결제수단을 만든다', async () => {
    const [row] = await as<{ id: string }>(A, `select public.create_household('나') as id`)
    hhA = row.id
    const [hh] = await as<{ invite_code: string }>(A, `select invite_code from public.households`)
    expect(hh.invite_code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/)
    const cats = await as(A, `select type, name from public.categories order by type, sort`)
    expect(cats.filter((c) => c.type === 'expense')).toHaveLength(15)
    expect(cats.filter((c) => c.type === 'income')).toHaveLength(4)
    const methods = await as<{ name: string; owner_type: string }>(A, `select name, owner_type from public.payment_methods order by sort`)
    expect(methods).toEqual([
      { name: '생활비 통장', owner_type: 'shared' },
      { name: '현금', owner_type: 'entered_by' },
    ])
  })

  it('가구에 속하지 않은 사람은 가구를 볼 수 없다', async () => {
    expect(await as(B, `select * from public.households`)).toHaveLength(0)
    expect(await as(B, `select * from public.categories`)).toHaveLength(0)
  })

  it('초대 코드는 대소문자·구분자와 상관없이 참여된다', async () => {
    const [hh] = await as<{ invite_code: string }>(A, `select invite_code from public.households`)
    const messy = `${hh.invite_code.slice(0, 4).toLowerCase()}-${hh.invite_code.slice(4)}`
    const [row] = await as<{ id: string }>(B, `select public.join_household($1, '와이프') as id`, [messy])
    expect(row.id).toBe(hhA)
    expect(await as(B, `select * from public.members`)).toHaveLength(2)
  })

  it('세 번째 사람은 참여할 수 없다', async () => {
    const [hh] = await as<{ invite_code: string }>(A, `select invite_code from public.households`)
    expect(await errorOf(as(C, `select public.join_household($1, 'C')`, [hh.invite_code]))).toContain('household_full')
  })

  it('이미 가구가 있으면 새로 만들 수 없고, 틀린 코드는 거절된다', async () => {
    expect(await errorOf(as(A, `select public.create_household('또')`))).toContain('already_in_household')
    expect(await errorOf(as(C, `select public.join_household('ZZZZZZZZ', 'C')`))).toContain('invalid_code')
  })

  it('로그인하지 않은 사용자는 함수도 테이블도 못 쓴다', async () => {
    expect(await errorOf(as(null, `select public.create_household('x')`))).toContain('permission denied')
    expect(await errorOf(as(null, `select * from public.transactions`))).toContain('permission denied')
  })
})

describe('내역 권한', () => {
  let catId: string
  let methodId: string

  beforeAll(async () => {
    const [c] = await as<{ id: string }>(C, `select public.create_household('C') as id`)
    hhC = c.id
    ;[{ id: catId }] = await as<{ id: string }>(A, `select id from public.categories where name = '식비'`)
    ;[{ id: methodId }] = await as<{ id: string }>(A, `select id from public.payment_methods where name = '생활비 통장'`)
  })

  it('A가 쓴 내역을 B는 보고, C는 못 본다', async () => {
    await as(A,
      `insert into public.transactions (household_id, type, occurred_on, amount, title, category_id, payment_method_id, scope)
       values ($1, 'expense', '2026-10-15', 23000, '동네치킨', $2, $3, 'shared')`, [hhA, catId, methodId])
    const seenByB = await as<{ title: string; created_by: string }>(B, `select title, created_by from public.transactions`)
    expect(seenByB).toEqual([{ title: '동네치킨', created_by: A }])
    expect(await as(C, `select * from public.transactions`)).toHaveLength(0)
  })

  it('다른 가구에는 내역을 쓸 수 없다', async () => {
    expect(hhC).not.toBe(hhA)
    const msg = await errorOf(as(C,
      `insert into public.transactions (household_id, type, occurred_on, amount, scope) values ($1, 'expense', '2026-10-15', 1000, 'shared')`, [hhA]))
    expect(msg).toContain('row-level security')
  })

  it('다른 가구의 결제수단·분류·멤버는 연결할 수 없다', async () => {
    const [{ id: cMethod }] = await as<{ id: string }>(C, `select id from public.payment_methods limit 1`)
    expect(await errorOf(as(A,
      `insert into public.transactions (household_id, type, occurred_on, amount, payment_method_id, scope) values ($1, 'expense', '2026-10-15', 1000, $2, 'shared')`,
      [hhA, cMethod]))).toContain('foreign key')
    expect(await errorOf(as(A,
      `insert into public.transactions (household_id, type, occurred_on, amount, scope, scope_user_id) values ($1, 'expense', '2026-10-15', 1000, 'member', $2)`,
      [hhA, C]))).toContain('foreign key')
  })

  it('작성자와 초대 코드는 바꿀 수 없고, 분담 비율은 바꿀 수 있다', async () => {
    expect(await errorOf(as(B, `update public.transactions set created_by = $1`, [B]))).toContain('permission denied')
    expect(await errorOf(as(B, `update public.households set invite_code = 'AAAAAAAA'`))).toContain('permission denied')
    await as(B, `update public.households set share_ratio = 0.6 where id = $1`, [hhA])
    const [hh] = await as<{ share_ratio: string }>(A, `select share_ratio from public.households`)
    expect(Number(hh.share_ratio)).toBe(0.6)
  })

  it('상대의 표시 이름은 바꿀 수 없다', async () => {
    await as(B, `update public.members set display_name = '해킹' where user_id = $1`, [A])
    const [m] = await as<{ display_name: string }>(A, `select display_name from public.members where user_id = $1`, [A])
    expect(m.display_name).toBe('나')
  })

  it('결제수단을 지우면 내역은 남고 결제수단만 비워진다', async () => {
    const [{ id: card }] = await as<{ id: string }>(A,
      `insert into public.payment_methods (household_id, name, kind, last4, owner_type, owner_user_id) values ($1, '내 카드', 'card', '1234', 'member', $2) returning id`,
      [hhA, A])
    await as(A,
      `insert into public.transactions (household_id, type, occurred_on, amount, payment_method_id, scope, scope_user_id) values ($1, 'expense', '2026-10-14', 9600, $2, 'member', $3)`,
      [hhA, card, A])
    await as(B, `delete from public.payment_methods where id = $1`, [card])
    const rows = await as<{ payment_method_id: string | null }>(A, `select payment_method_id from public.transactions where amount = 9600`)
    expect(rows).toEqual([{ payment_method_id: null }])
  })
})
