// 마이그레이션을 PGlite(브라우저·Node용 Postgres)에 적용해 RLS와 가구 함수를 검증한다.
// Supabase의 auth 스키마, anon/authenticated 역할, realtime publication은 최소한으로 흉내 낸다.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'

const read = (f: string) => readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), 'utf8')
const INIT = read('20261015000000_init.sql')
const ROLES = read('20261015010000_spouse_roles.sql')
const SMART = read('20261015020000_smart_input.sql')

const SUPABASE_STUB = `
create schema auth;
create table auth.users (id uuid primary key, email text, raw_app_meta_data jsonb default '{}'::jsonb);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create role anon nologin;
create role authenticated nologin;
grant usage on schema public to anon, authenticated;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
create role service_role nologin;
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

async function freshDb(migrations: string[]) {
  const d = new PGlite()
  await d.exec(SUPABASE_STUB)
  for (const m of migrations) await d.exec(m)
  await d.query(`insert into auth.users (id, email) values ($1,'a@x'),($2,'b@x'),($3,'c@x')`, [A, B, C])
  return d
}

beforeAll(async () => {
  db = await freshDb([INIT, ROLES, SMART])
})

describe('가구 만들기와 참여', () => {
  it('create_household가 가구, 멤버, 기본 분류·결제수단을 만든다', async () => {
    const [row] = await as<{ id: string }>(A, `select public.create_household('나', 'husband') as id`)
    hhA = row.id
    const [hh] = await as<{ invite_code: string }>(A, `select invite_code from public.households`)
    expect(hh.invite_code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/)
    const cats = await as(A, `select type, name from public.categories order by type, sort`)
    expect(cats.filter((c) => c.type === 'expense')).toHaveLength(15)
    expect(cats.filter((c) => c.type === 'income')).toHaveLength(4)
    const methods = await as<{ name: string; owner: string }>(A, `select name, owner from public.payment_methods order by sort`)
    expect(methods).toEqual([
      { name: '생활비 통장', owner: 'shared' },
      { name: '현금', owner: 'entered_by' },
    ])
    const [me] = await as<{ spouse_role: string }>(A, `select spouse_role from public.members`)
    expect(me.spouse_role).toBe('husband')
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
    const members = await as<{ user_id: string; spouse_role: string }>(B, `select user_id, spouse_role from public.members order by role`)
    expect(members).toEqual([{ user_id: A, spouse_role: 'husband' }, { user_id: B, spouse_role: 'wife' }])
  })

  it('두 사람이 같은 역할을 가질 수 없다', async () => {
    expect(await errorOf(as(B, `update public.members set spouse_role = 'husband' where user_id = $1`, [B]))).toContain('members_household_spouse_role_key')
  })

  it('세 번째 사람은 참여할 수 없다', async () => {
    const [hh] = await as<{ invite_code: string }>(A, `select invite_code from public.households`)
    expect(await errorOf(as(C, `select public.join_household($1, 'C')`, [hh.invite_code]))).toContain('household_full')
  })

  it('이미 가구가 있으면 새로 만들 수 없고, 틀린 코드는 거절된다', async () => {
    expect(await errorOf(as(A, `select public.create_household('또', 'wife')`))).toContain('already_in_household')
    expect(await errorOf(as(C, `select public.create_household('C', 'boss')`))).toContain('invalid_role')
    expect(await errorOf(as(C, `select public.join_household('ZZZZZZZZ', 'C')`))).toContain('invalid_code')
  })

  it('로그인하지 않은 사용자는 함수도 테이블도 못 쓴다', async () => {
    expect(await errorOf(as(null, `select public.create_household('x', 'wife')`))).toContain('permission denied')
    expect(await errorOf(as(null, `select * from public.transactions`))).toContain('permission denied')
  })
})

describe('내역 권한', () => {
  let catId: string
  let methodId: string

  beforeAll(async () => {
    const [c] = await as<{ id: string }>(C, `select public.create_household('C', 'wife') as id`)
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

  it('다른 가구의 결제수단은 연결할 수 없고, 용도는 공동·남편·아내만 된다', async () => {
    const [{ id: cMethod }] = await as<{ id: string }>(C, `select id from public.payment_methods limit 1`)
    expect(await errorOf(as(A,
      `insert into public.transactions (household_id, type, occurred_on, amount, payment_method_id, scope) values ($1, 'expense', '2026-10-15', 1000, $2, 'shared')`,
      [hhA, cMethod]))).toContain('foreign key')
    expect(await errorOf(as(A,
      `insert into public.transactions (household_id, type, occurred_on, amount, scope) values ($1, 'expense', '2026-10-15', 1000, 'member')`,
      [hhA]))).toContain('transactions_scope_check')
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
      `insert into public.payment_methods (household_id, name, kind, last4, owner) values ($1, '아내 카드', 'card', '5678', 'wife') returning id`,
      [hhA])
    await as(A,
      `insert into public.transactions (household_id, type, occurred_on, amount, payment_method_id, scope) values ($1, 'expense', '2026-10-14', 9600, $2, 'wife')`,
      [hhA, card])
    await as(B, `delete from public.payment_methods where id = $1`, [card])
    const rows = await as<{ payment_method_id: string | null }>(A, `select payment_method_id from public.transactions where amount = 9600`)
    expect(rows).toEqual([{ payment_method_id: null }])
  })
})

describe('스마트 입력 저장과 JWT household_id (20261015020000_smart_input)', () => {
  const claimOf = async (uid: string) =>
    (await db.query<{ hh: string | null }>(`select raw_app_meta_data->>'household_id' as hh from auth.users where id = $1`, [uid])).rows[0].hh

  it('가구 구성원의 app_metadata에 household_id가 들어간다', async () => {
    expect(await claimOf(A)).toBe(hhA)
    expect(await claimOf(B)).toBe(hhA)
    expect(await claimOf(C)).toBe(hhC)
  })

  it('내역과 품목을 한 번에 저장하고, 배우자도 품목을 본다', async () => {
    const [{ id }] = await as<{ id: string }>(A, `select public.add_transaction_with_items($1, $2, $3) as id`, [hhA,
      JSON.stringify({ type: 'expense', occurred_on: '2026-10-13', occurred_at: '18:42', amount: 12400, title: '이마트24', scope: 'shared', source: 'photo' }),
      JSON.stringify([{ name: '우유', quantity: 2, unit_price: 2800, amount: 5600 }, { name: '빵', quantity: 1, unit_price: null, amount: 6800 }])])
    const items = await as<{ name: string; amount: string; sort: number }>(B,
      `select name, amount, sort from public.transaction_items where transaction_id = $1 order by sort`, [id])
    expect(items.map((i) => [i.name, Number(i.amount), i.sort])).toEqual([['우유', 5600, 1], ['빵', 6800, 2]])
    const [tx] = await as<{ source: string; created_by: string }>(B, `select source, created_by from public.transactions where id = $1`, [id])
    expect(tx).toEqual({ source: 'photo', created_by: A })
  })

  it('다른 가구에는 저장할 수 없고, 품목이 잘못되면 내역도 남지 않는다', async () => {
    const tx = JSON.stringify({ type: 'expense', occurred_on: '2026-10-12', amount: 777, title: '실패', scope: 'shared', source: 'text' })
    expect(await errorOf(as(C, `select public.add_transaction_with_items($1, $2, '[]')`, [hhA, tx]))).toContain('row-level security')
    expect(await errorOf(as(A, `select public.add_transaction_with_items($1, $2, $3)`, [hhA, tx, JSON.stringify([{ name: '', amount: 777 }])])))
      .toContain('check constraint')
    expect(await as(A, `select * from public.transactions where amount = 777`)).toHaveLength(0)
  })

  it('로그인하지 않으면 저장 함수를 못 쓴다', async () => {
    expect(await errorOf(as(null, `select public.add_transaction_with_items($1, '{}', '[]')`, [hhA]))).toContain('permission denied')
  })
})

describe('기존 데이터 변환 (20261015010000_spouse_roles)', () => {
  it('예전 형식의 내역·결제수단이 역할 기준으로 바뀐다', async () => {
    const old = await freshDb([INIT])
    const run = async (uid: string, sql: string, params: unknown[] = []) => {
      await old.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid])
      await old.exec('set role authenticated')
      try { return (await old.query<Record<string, string>>(sql, params)).rows } finally { await old.exec('reset role') }
    }
    const [{ id: hh }] = await run(A, `select public.create_household('우리가계부') as id`)
    await run(A, `insert into public.payment_methods (household_id, name, kind, owner_type, owner_user_id) values ($1, '내 카드', 'card', 'member', $2)`, [hh, A])
    await run(A, `insert into public.transactions (household_id, type, occurred_on, amount, scope) values ($1, 'expense', '2026-10-15', 1000, 'shared')`, [hh])
    await run(A, `insert into public.transactions (household_id, type, occurred_on, amount, scope, scope_user_id) values ($1, 'expense', '2026-10-15', 2000, 'member', $2)`, [hh, A])

    await old.exec(ROLES)

    const tx = (await old.query<{ amount: string; scope: string }>(`select amount, scope from public.transactions order by amount`)).rows
    expect(tx.map((r) => [Number(r.amount), r.scope])).toEqual([[1000, 'shared'], [2000, 'shared']])
    const pm = (await old.query<{ name: string; owner: string }>(`select name, owner from public.payment_methods order by name`)).rows
    expect(pm).toEqual([{ name: '내 카드', owner: 'entered_by' }, { name: '생활비 통장', owner: 'shared' }, { name: '현금', owner: 'entered_by' }])
    const m = (await old.query<{ spouse_role: string | null }>(`select spouse_role from public.members`)).rows
    expect(m).toEqual([{ spouse_role: null }])

    await old.exec(SMART)
    const [u] = (await old.query<{ hh: string }>(`select raw_app_meta_data->>'household_id' as hh from auth.users where id = $1`, [A])).rows
    expect(u.hh).toBe(hh)
  })
})
