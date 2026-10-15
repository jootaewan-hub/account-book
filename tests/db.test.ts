// 마이그레이션을 PGlite(브라우저·Node용 Postgres)에 적용해 RLS와 가구 함수를 검증한다.
// Supabase의 auth 스키마, anon/authenticated 역할, realtime publication은 최소한으로 흉내 낸다.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'

const read = (f: string) => readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), 'utf8')
const INIT = read('20261015000000_init.sql')
const ROLES = read('20261015010000_spouse_roles.sql')
const SMART = read('20261015020000_smart_input.sql')
const HOOK = read('20261015030000_wif_audience_hook.sql')
const RECUR = read('20261015040000_recurring_stats_export.sql')
const EXPORT_SVC = read('20261015050000_export_rows_service_only.sql')
const ITEMS_IMG = read('20261015060000_items_images_no_shared.sql')
const CHILD = read('20261015070000_child.sql')

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
grant usage on schema public to service_role;
create role supabase_auth_admin nologin;
create publication supabase_realtime;
create schema storage;
create table storage.buckets (id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id),
  name text not null, owner uuid default auth.uid(), created_at timestamptz default now());
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
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
  db = await freshDb([INIT, ROLES, SMART, HOOK, RECUR, EXPORT_SVC, ITEMS_IMG, CHILD])
})

describe('가구 만들기와 참여', () => {
  it('create_household가 가구, 멤버, 기본 분류·결제수단을 만든다', async () => {
    const [row] = await as<{ id: string }>(A, `select public.create_household('나', 'husband') as id`)
    hhA = row.id
    const [hh] = await as<{ invite_code: string }>(A, `select invite_code from public.households`)
    expect(hh.invite_code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/)
    const cats = await as(A, `select type, name from public.categories order by type, sort`)
    expect(cats.filter((c) => c.type === 'expense')).toHaveLength(16)
    expect(cats.some((c) => c.name === '자녀')).toBe(true)
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

describe('WIF용 aud 훅 (20261015030000_wif_audience_hook)', () => {
  const hook = async (aud: unknown) => {
    await db.exec('set role supabase_auth_admin')
    try {
      const { rows } = await db.query<{ aud: unknown; sub: string }>(
        `select r->'claims'->'aud' as aud, r->'claims'->>'sub' as sub from public.custom_access_token_hook($1::jsonb) r`,
        [JSON.stringify({ user_id: A, claims: { sub: A, aud, role: 'authenticated' }, authentication_method: 'password' })])
      return rows[0]
    } finally { await db.exec('reset role') }
  }

  it('기존 aud를 유지하고 Anthropic 주소를 한 번만 덧붙인다', async () => {
    expect(await hook('authenticated')).toEqual({ aud: ['authenticated', 'https://api.anthropic.com'], sub: A })
    expect((await hook(['authenticated', 'https://api.anthropic.com'])).aud).toEqual(['authenticated', 'https://api.anthropic.com'])
    expect((await hook(null)).aud).toEqual(['https://api.anthropic.com'])
  })

  it('로그인 사용자는 훅 함수를 직접 부를 수 없다', async () => {
    expect(await errorOf(as(A, `select public.custom_access_token_hook('{}'::jsonb)`))).toContain('permission denied')
  })
})

describe('고정지출·통계·정산·내보내기 (20261015040000_recurring_stats_export)', () => {
  const addRecurring = async (fields: Record<string, unknown>) => {
    const cols = Object.keys(fields)
    const [{ id }] = await as<{ id: string }>(A,
      `insert into public.recurring (household_id, ${cols.join(', ')}) values ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')}) returning id`,
      [hhA, ...Object.values(fields)])
    return id
  }
  const gen = (uid: string, today: string) =>
    as<{ n: number }>(uid, `select public.generate_recurring($1, $2) as n`, [hhA, today]).then((r) => r[0].n)
  const recurringTx = (id: string) =>
    as<{ occurred_on: string; source: string }>(A,
      `select to_char(occurred_on, 'YYYY-MM-DD') as occurred_on, source from public.transactions where recurring_id = $1 order by occurred_on`, [id])

  it('월별 합계는 가구 구성원에게만 나온다', async () => {
    const rows = await as<{ type: string; total: string; n: number }>(A,
      `select type, total, n from public.monthly_totals($1, '2026-10-01', '2026-10-31')`, [hhA])
    expect(rows.map((r) => [r.type, Number(r.total), r.n])).toEqual([['expense', 45000, 3]])
    expect(await as(C, `select * from public.monthly_totals($1, '2026-10-01', '2026-10-31')`, [hhA])).toHaveLength(0)
  })

  it('날짜가 지난 달만 자동으로 넣고, 다시 불러도 중복되지 않으며, 지운 달은 되살리지 않는다', async () => {
    const id = await addRecurring({ kind: 'fixed', title: '월세', amount: 500000, day_of_month: 25, start_month: '2026-08-01' })
    expect(await gen(A, '2026-10-15')).toBe(2)
    expect(await gen(B, '2026-10-15')).toBe(0)
    expect((await recurringTx(id)).map((t) => t.occurred_on)).toEqual(['2026-08-25', '2026-09-25'])
    await as(A, `delete from public.transactions where recurring_id = $1 and occurred_on = '2026-09-25'`, [id])
    expect(await gen(A, '2026-10-26')).toBe(1)
    expect(await recurringTx(id)).toEqual([{ occurred_on: '2026-08-25', source: 'recurring' }, { occurred_on: '2026-10-25', source: 'recurring' }])
  })

  it('31일은 짧은 달의 마지막 날로, 연간 구독은 12개월마다, 금액 미정(관리비)은 넣지 않는다', async () => {
    const monthEnd = await addRecurring({ kind: 'fixed', title: '적금', amount: 100000, day_of_month: 31, start_month: '2026-09-01' })
    const yearly = await addRecurring({ kind: 'subscription', title: '연간 구독', amount: 39000, day_of_month: 3, every_months: 12, start_month: '2026-01-01' })
    const utility = await addRecurring({ kind: 'utility', title: '관리비', day_of_month: 25, start_month: '2026-01-01' })
    await gen(A, '2026-10-26')
    expect((await recurringTx(monthEnd)).map((t) => t.occurred_on)).toEqual(['2026-09-30'])
    expect((await recurringTx(yearly)).map((t) => t.occurred_on)).toEqual(['2026-01-03'])
    expect(await recurringTx(utility)).toHaveLength(0)
  })

  it('다른 가구는 반복 내역을 보거나 대신 실행할 수 없다', async () => {
    expect(await as(C, `select * from public.recurring`)).toHaveLength(0)
    expect(await gen(C, '2026-12-31')).toBe(0)
  })

  it('정산 기록은 같은 가구만 보고 쓴다', async () => {
    await as(A, `insert into public.settlements (household_id, month, from_role, to_role, amount) values ($1, '2026-10-01', 'wife', 'husband', 19850)`, [hhA])
    expect((await as<{ amount: string }>(B, `select amount from public.settlements`)).map((r) => Number(r.amount))).toEqual([19850])
    expect(await as(C, `select * from public.settlements`)).toHaveLength(0)
    expect(await errorOf(as(C, `insert into public.settlements (household_id, month, amount) values ($1, '2026-11-01', 1)`, [hhA])))
      .toContain('row-level security')
  })

  it('내보내기 주소: 구성원만 만들고, 바꾸면 이전 주소는 끊기며, 내역은 서버 함수(service role)만 읽는다', async () => {
    const [{ tok }] = await as<{ tok: string }>(A, `select public.export_token($1) as tok`, [hhA])
    expect(tok).toMatch(/^[0-9a-f]{64}$/)
    expect((await as<{ tok: string }>(B, `select public.export_token($1) as tok`, [hhA]))[0].tok).toBe(tok)
    expect(await errorOf(as(C, `select public.export_token($1)`, [hhA]))).toContain('not_member')

    const asService = async <T,>(sql: string, params: unknown[]) => {
      await db.exec('set role service_role')
      try { return (await db.query<T>(sql, params)).rows } finally { await db.exec('reset role') }
    }
    expect(await errorOf(as(null, `select * from public.export_rows($1)`, [tok]))).toContain('permission denied')
    expect(await errorOf(as(A, `select * from public.export_rows($1)`, [tok]))).toContain('permission denied')
    const rows = await asService<{ title: string; entered_by: string; items: string | null; method_owner: string | null }>(
      `select title, entered_by, items, method_owner from public.export_rows($1)`, [tok])
    expect(rows.find((r) => r.title === '이마트24')).toMatchObject({ entered_by: '남편', items: '우유 x2 5600, 빵 6800' })
    expect(rows.length).toBeGreaterThanOrEqual(5)

    const [{ tok: tok2 }] = await as<{ tok: string }>(A, `select public.export_token($1, true) as tok`, [hhA])
    expect(tok2).not.toBe(tok)
    expect(await asService(`select * from public.export_rows($1)`, [tok])).toHaveLength(0)
    expect(await asService(`select * from public.export_rows($1)`, ['short'])).toHaveLength(0)
    expect(await errorOf(as(null, `select * from private.export_tokens`))).toContain('permission denied')
  })
})

describe('품목 사진 (20261015060000_items_images_no_shared)', () => {
  it('품목 사진 경로는 자기 가구 폴더만 저장된다', async () => {
    const tx = JSON.stringify({ type: 'expense', occurred_on: '2026-10-11', amount: 15800, title: '쿠팡', scope: 'husband', source: 'photo' })
    const [{ id }] = await as<{ id: string }>(A, `select public.add_transaction_with_items($1, $2, $3) as id`, [hhA, tx, JSON.stringify([
      { name: '물티슈', quantity: 2, amount: 9800, image_path: `${hhA}/a.jpg` },
      { name: '수세미', quantity: 1, amount: 6000, image_path: `${hhC}/stolen.jpg` },
    ])])
    const items = await as<{ name: string; image_path: string | null }>(B,
      `select name, image_path from public.transaction_items where transaction_id = $1 order by sort`, [id])
    expect(items).toEqual([{ name: '물티슈', image_path: `${hhA}/a.jpg` }, { name: '수세미', image_path: null }])
  })

  it('사진 저장소: 자기 가구 폴더에만 올리고, 다른 가구 사진은 보이지도 않는다', async () => {
    await as(A, `insert into storage.objects (bucket_id, name) values ('item-images', $1)`, [`${hhA}/p1.jpg`])
    expect(await as(B, `select name from storage.objects`)).toEqual([{ name: `${hhA}/p1.jpg` }])
    expect(await as(C, `select name from storage.objects`)).toHaveLength(0)
    expect(await errorOf(as(C, `insert into storage.objects (bucket_id, name) values ('item-images', $1)`, [`${hhA}/x.jpg`])))
      .toContain('row-level security')
    expect(await errorOf(as(A, `insert into storage.objects (bucket_id, name) values ('item-images', 'not-a-uuid/x.jpg')`)))
      .toContain('row-level security')
    expect(await errorOf(as(A, `insert into storage.objects (bucket_id, name) values ('other', $1)`, [`${hhA}/x.jpg`])))
      .toContain('row-level security')
    await as(C, `delete from storage.objects`)
    expect(await as(A, `select name from storage.objects`)).toHaveLength(1)
  })
})

describe('자녀 (20261015070000_child)', () => {
  it('용도에 자녀를 쓸 수 있고, 그 밖의 값은 막힌다', async () => {
    await as(A, `insert into public.transactions (household_id, type, occurred_on, amount, title, scope) values ($1, 'expense', '2026-10-09', 32000, '학원 교재', 'child')`, [hhA])
    expect(await as(B, `select scope from public.transactions where title = '학원 교재'`)).toEqual([{ scope: 'child' }])
    expect(await errorOf(as(A, `insert into public.transactions (household_id, type, occurred_on, amount, scope) values ($1, 'expense', '2026-10-09', 1, 'dog')`, [hhA])))
      .toContain('transactions_scope_check')
    await as(A, `insert into public.recurring (household_id, kind, title, amount, day_of_month, start_month, scope) values ($1, 'fixed', '태권도', 150000, 5, '2026-11-01', 'child')`, [hhA])
  })

  it('이미 있던 가구에도 자녀 분류가 하나만 생긴다', async () => {
    const old = await freshDb([INIT, ROLES])
    await old.query(`select set_config('request.jwt.claim.sub', $1, false)`, [A])
    await old.exec('set role authenticated')
    await old.query(`select public.create_household('나', 'husband')`)
    await old.exec('reset role')
    for (const m of [SMART, HOOK, RECUR, EXPORT_SVC, ITEMS_IMG, CHILD]) await old.exec(m)
    const rows = (await old.query<{ n: number }>(`select count(*)::int as n from public.categories where name = '자녀'`)).rows
    expect(rows).toEqual([{ n: 1 }])
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
