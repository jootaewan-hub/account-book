// 마이그레이션을 PGlite(브라우저·Node용 Postgres)에 적용해 RLS와 가구 함수를 검증한다.
// Supabase의 auth 스키마, anon/authenticated 역할, realtime publication은 최소한으로 흉내 낸다.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { EXPORT_ITEMS } from './fixtures'
import { isGrocery, MIGRATION_FILES, readMigration } from './grocery/dbSetup'
import { SUPABASE_STUB } from './supabaseStub'

const read = (f: string) => readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), 'utf8')
const INIT = read('20261015000000_init.sql')
const ROLES = read('20261015010000_spouse_roles.sql')
// 가계부(public) 마이그레이션 전부, 이름 순. 손으로 나열하지 않아 새 파일이 빠지지 않는다(장보기 파일은 tests/grocery/가 전부 적용한다)
const LEDGER = MIGRATION_FILES.filter((f) => !isGrocery(f)).map(readMigration)


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
  // 실제처럼 사용자가 먼저 있고 마이그레이션이 뒤에 온다 (20261015170000부터는 새 사용자 행이 막힌다)
  await d.query(`insert into auth.users (id, email) values ($1,'a@x'),($2,'b@x'),($3,'c@x')`, [A, B, C])
  for (const m of migrations) await d.exec(m)
  return d
}

beforeAll(async () => {
  db = await freshDb(LEDGER)
})

describe('가구 만들기와 참여', () => {
  it('create_household가 가구, 멤버, 기본 분류·결제수단을 만든다', async () => {
    const [row] = await as<{ id: string }>(A, `select public.create_household('나', 'husband') as id`)
    hhA = row.id
    const [hh] = await as<{ invite_code: string }>(A, `select invite_code from public.households`)
    expect(hh.invite_code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/)
    const cats = await as(A, `select type, name from public.categories order by type, sort`)
    expect(cats.filter((c) => c.type === 'expense')).toHaveLength(33)
    expect(cats.some((c) => c.name === '자녀')).toBe(true)
    expect(cats.some((c) => c.name === '욕실·청소')).toBe(true)
    expect(cats.filter((c) => c.type === 'income')).toHaveLength(6)
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

  it('작성자와 초대 코드는 바꿀 수 없고, 가계부 이름은 바꿀 수 있다', async () => {
    expect(await errorOf(as(B, `update public.transactions set created_by = $1`, [B]))).toContain('permission denied')
    expect(await errorOf(as(B, `update public.households set invite_code = 'AAAAAAAA'`))).toContain('permission denied')
    await as(B, `update public.households set name = '우리집' where id = $1`, [hhA])
    expect(await as<{ name: string }>(A, `select name from public.households`)).toEqual([{ name: '우리집' }])
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
  const hook = async (aud: unknown, user = A) => {
    await db.exec('set role supabase_auth_admin')
    try {
      const { rows } = await db.query<{ aud: unknown; sub: string }>(
        `select r->'claims'->'aud' as aud, r->'claims'->>'sub' as sub from public.custom_access_token_hook($1::jsonb) r`,
        [JSON.stringify({ user_id: user, claims: { sub: user, aud, role: 'authenticated' }, authentication_method: 'password' })])
      return rows[0]
    } finally { await db.exec('reset role') }
  }

  it('AI 허용 가구가 아니면 Anthropic 주소를 붙이지 않고, 있던 것도 뺀다 (20261015160000_ai_allowlist)', async () => {
    // 테스트 DB는 마이그레이션 때 가구가 없어서 허용 목록이 비어 있다
    expect(await hook('authenticated')).toEqual({ aud: ['authenticated'], sub: A })
    expect((await hook(['authenticated', 'https://api.anthropic.com'])).aud).toEqual(['authenticated'])
    await db.query('insert into private.ai_households (household_id) values ($1)', [hhA])
    expect((await hook('authenticated', C)).aud).toEqual(['authenticated']) // 다른 가구(C)는 여전히 안 붙는다
    // 로그인 사용자는 허용 목록을 보거나 바꿀 수 없다
    expect(await errorOf(as(C, `select * from private.ai_households`))).toContain('permission denied')
    expect(await errorOf(as(C, `insert into private.ai_households (household_id) values ($1)`, [hhC]))).toContain('permission denied')
  })

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

  it('정산 표와 분담 비율 칸은 정리돼 없다 (20261015190000_drop_unused)', async () => {
    expect(await errorOf(as(A, `select * from public.settlements`))).toContain('does not exist')
    expect(await errorOf(as(A, `select share_ratio from public.households`))).toContain('does not exist')
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
    expect(await errorOf(as(null, `select * from public.export_rows_v2($1)`, [tok]))).toContain('permission denied')
    expect(await errorOf(as(A, `select * from public.export_rows_v2($1)`, [tok]))).toContain('permission denied')
    const rows = await asService<{ title: string; entered_by: string; items: string | null }>(
      `select title, entered_by, items from public.export_rows_v2($1)`, [tok])
    expect(rows.find((r) => r.title === '이마트24')).toMatchObject({ entered_by: '남편', items: '우유 x2 5600 (개당 2800), 빵 6800' })
    expect(rows.length).toBeGreaterThanOrEqual(5)

    const [{ tok: tok2 }] = await as<{ tok: string }>(A, `select public.export_token($1, true) as tok`, [hhA])
    expect(tok2).not.toBe(tok)
    expect(await asService(`select * from public.export_rows_v2($1)`, [tok])).toHaveLength(0)
    expect(await asService(`select * from public.export_rows_v2($1)`, ['short'])).toHaveLength(0)
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
    for (const m of LEDGER.slice(2)) await old.exec(m) // INIT·ROLES 뒤의 가계부 마이그레이션 전부
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

    await old.exec(LEDGER[2]) // 20261015020000_smart_input.sql
    const [u] = (await old.query<{ hh: string }>(`select raw_app_meta_data->>'household_id' as hh from auth.users where id = $1`, [A])).rows
    expect(u.hh).toBe(hh)
  })
})

describe('플랫폼·용량 (20261015080000_platform_units)', () => {
  it('플랫폼과 품목 용량을 저장하고, 내보내기에 개당·단위당 가격이 들어간다', async () => {
    const tx = JSON.stringify({ type: 'expense', occurred_on: '2026-10-12', amount: 31600, title: '물티슈 100매, 생수 2L', scope: 'shared', source: 'photo', platform: ' 쿠팡 ' })
    const [{ id }] = await as<{ id: string }>(A, `select public.add_transaction_with_items($1, $2, $3) as id`, [hhA, tx, JSON.stringify([
      { name: '물티슈 100매 x 10팩', quantity: 2, unit_price: 9800, amount: 19600, pack_size: 1000, pack_unit: '매' },
      { name: '생수 2L x 6병', quantity: 10, unit_price: 1200, amount: 12000, pack_size: 12000, pack_unit: 'ml' },
      { name: '쌀 10kg', quantity: 1, unit_price: 32900, amount: 32900, pack_size: 10000, pack_unit: 'g' },
      { name: '배송비', quantity: 1, amount: 0, pack_size: 0, pack_unit: '개' },
      { name: '단위만', quantity: 1, amount: 100, pack_unit: '개' },
    ])])
    expect(await as(B, `select platform from public.transactions where id = $1`, [id])).toEqual([{ platform: '쿠팡' }])
    const items = await as<{ name: string; pack_size: string | null; pack_unit: string | null }>(B,
      `select name, pack_size, pack_unit from public.transaction_items where transaction_id = $1 order by sort`, [id])
    expect(items.map((i) => [i.name, i.pack_size === null ? null : Number(i.pack_size), i.pack_unit])).toEqual([
      ['물티슈 100매 x 10팩', 1000, '매'], ['생수 2L x 6병', 12000, 'ml'], ['쌀 10kg', 10000, 'g'], ['배송비', null, null], ['단위만', null, null],
    ])
    expect(await errorOf(as(A, `insert into public.transactions (household_id, type, occurred_on, amount, scope, platform) values ($1, 'expense', '2026-10-12', 1, 'shared', '')`, [hhA])))
      .toContain('check')

    const [{ tok }] = await as<{ tok: string }>(A, `select public.export_token($1) as tok`, [hhA])
    await db.exec('set role service_role')
    try {
      const rows = (await db.query<{ platform: string | null; items: string | null }>(
        `select platform, items from public.export_rows_v2($1) where title = '물티슈 100매, 생수 2L'`, [tok])).rows
      expect(rows).toEqual([{
        platform: '쿠팡',
        items: EXPORT_ITEMS,
      }])
    } finally {
      await db.exec('reset role')
    }
  })
})

describe('관리비 고지서 (20261015110000_utility_bills)', () => {
  it('같은 가구만 보고 쓰며, 한 달에 하나, 다른 가구 내역은 연결할 수 없고, 내역을 지우면 연결만 풀린다', async () => {
    const [{ id: txA }] = await as<{ id: string }>(A,
      `insert into public.transactions (household_id, type, occurred_on, amount, title, scope) values ($1, 'expense', '2026-10-25', 254000, '관리비 (9월분)', 'shared') returning id`, [hhA])
    const charges = JSON.stringify([{ name: '일반관리비', amount: 54000, prev_month: 53000, last_year: null }])
    const usages = JSON.stringify([{ name: '전기', amount: 312, unit: 'kWh', prev_month: 280, last_year: 350 }])
    await as(A, `insert into public.utility_bills (household_id, bill_month, total, charges, usages, transaction_id) values ($1, '2026-09-01', 254000, $2, $3, $4)`,
      [hhA, charges, usages, txA])
    const rows = await as<{ total: string; usages: { name: string; amount: number }[] }>(B, `select total, usages from public.utility_bills`)
    expect(rows.map((r) => [Number(r.total), r.usages[0].name, r.usages[0].amount])).toEqual([[254000, '전기', 312]])
    expect(await as(C, `select * from public.utility_bills`)).toHaveLength(0)
    expect(await errorOf(as(null, `select * from public.utility_bills`))).toContain('permission denied')
    expect(await errorOf(as(C, `insert into public.utility_bills (household_id, bill_month, total) values ($1, '2026-08-01', 1)`, [hhA])))
      .toContain('row-level security')
    expect(await errorOf(as(B, `insert into public.utility_bills (household_id, bill_month, total) values ($1, '2026-09-01', 1)`, [hhA])))
      .toContain('duplicate key')
    expect(await errorOf(as(A, `insert into public.utility_bills (household_id, bill_month, total) values ($1, '2026-08-15', 1)`, [hhA])))
      .toContain('check')
    // 다른 가구의 내역 id로는 연결할 수 없다
    const [{ id: txC }] = await as<{ id: string }>(C,
      `insert into public.transactions (household_id, type, occurred_on, amount, scope) values ($1, 'expense', '2026-10-25', 1000, 'shared') returning id`, [hhC])
    expect(await errorOf(as(A, `insert into public.utility_bills (household_id, bill_month, total, transaction_id) values ($1, '2026-07-01', 1, $2)`, [hhA, txC])))
      .toContain('foreign key')
    await as(A, `delete from public.transactions where id = $1`, [txA])
    expect(await as(B, `select transaction_id from public.utility_bills where bill_month = '2026-09-01'`)).toEqual([{ transaction_id: null }])
  })
})

describe('기념일 (20261015130000_anniversaries)', () => {
  it('같은 가구만 보고 쓰며, 음력은 30일까지, 양력은 그 달에 있는 날만 받는다', async () => {
    await as(A, `insert into public.anniversaries (household_id, name, kind, lunar, month, day) values ($1, '어머니 생신', 'birthday', true, 8, 22)`, [hhA])
    await as(B, `insert into public.anniversaries (household_id, name, kind, month, day) values ($1, '결혼기념일', 'couple', 9, 13)`, [hhA])
    const rows = await as<{ name: string; lunar: boolean }>(A, `select name, lunar from public.anniversaries order by month`)
    expect(rows).toEqual([{ name: '어머니 생신', lunar: true }, { name: '결혼기념일', lunar: false }])
    expect(await as(C, `select * from public.anniversaries`)).toHaveLength(0)
    expect(await errorOf(as(null, `select * from public.anniversaries`))).toContain('permission denied')
    expect(await errorOf(as(C, `insert into public.anniversaries (household_id, name, month, day) values ($1, 'x', 1, 1)`, [hhA])))
      .toContain('row-level security')
    // 양력 2월 29일은 되고 30일은 안 된다, 음력 30일은 되고 31일은 안 된다
    await as(A, `insert into public.anniversaries (household_id, name, month, day) values ($1, '윤일 생일', 2, 29)`, [hhA])
    expect(await errorOf(as(A, `insert into public.anniversaries (household_id, name, month, day) values ($1, 'x', 2, 30)`, [hhA]))).toContain('check')
    expect(await errorOf(as(A, `insert into public.anniversaries (household_id, name, month, day) values ($1, 'x', 4, 31)`, [hhA]))).toContain('check')
    await as(A, `insert into public.anniversaries (household_id, name, lunar, month, day) values ($1, '그믐 생일', true, 12, 30)`, [hhA])
    expect(await errorOf(as(A, `insert into public.anniversaries (household_id, name, lunar, month, day) values ($1, 'x', true, 1, 31)`, [hhA]))).toContain('check')
    expect(await errorOf(as(A, `insert into public.anniversaries (household_id, name, kind, month, day) values ($1, 'x', 'party', 1, 1)`, [hhA]))).toContain('check')
    expect(await errorOf(as(A, `insert into public.anniversaries (household_id, name, month, day) values ($1, '  ', 1, 1)`, [hhA]))).toContain('check')
    // 배우자가 수정·삭제할 수 있다
    await as(B, `update public.anniversaries set day = 14 where name = '결혼기념일'`)
    await as(B, `delete from public.anniversaries where name = '윤일 생일'`)
    expect((await as<{ name: string; day: number }>(A, `select name, day from public.anniversaries where not lunar`)).map((r) => [r.name, r.day])).toEqual([['결혼기념일', 14]])
  })
})

describe('할부 (20261015140000_installments)', () => {
  it('남은 회차를 달마다 넣고 메모에 회차를 적으며, 할부는 개월 수와 마지막 달이 꼭 있어야 한다', async () => {
    // 10월 15일에 3개월 할부로 산 물건: 1회차는 산 날 따로 넣고, 2·3회차가 반복 항목
    const [{ id }] = await as<{ id: string }>(C,
      `insert into public.recurring (household_id, kind, title, amount, day_of_month, start_month, end_month, installment_months)
       values ($1, 'installment', '냉장고', 300000, 15, '2026-11-01', '2026-12-01', 3) returning id`, [hhC])
    await as(C, `select public.generate_recurring($1, '2027-02-20')`, [hhC])
    const rows = await as<{ d: string; amount: string; memo: string }>(C,
      `select to_char(occurred_on, 'YYYY-MM-DD') as d, amount, memo from public.transactions where recurring_id = $1 order by occurred_on`, [id])
    expect(rows.map((r) => [r.d, Number(r.amount), r.memo])).toEqual([['2026-11-15', 300000, '할부 2/3회'], ['2026-12-15', 300000, '할부 3/3회']])
    // 할부가 아닌 항목은 메모를 붙이지 않는다
    const [{ id: fixed }] = await as<{ id: string }>(C,
      `insert into public.recurring (household_id, kind, title, amount, day_of_month, start_month) values ($1, 'fixed', '보험', 50000, 1, '2027-01-01') returning id`, [hhC])
    await as(C, `select public.generate_recurring($1, '2027-01-02')`, [hhC])
    expect(await as(C, `select memo from public.transactions where recurring_id = $1`, [fixed])).toEqual([{ memo: null }])
    expect(await errorOf(as(C, `insert into public.recurring (household_id, kind, title, amount, day_of_month, start_month) values ($1, 'installment', 'x', 1, 1, '2027-01-01')`, [hhC])))
      .toContain('recurring_installment_check')
    expect(await errorOf(as(C, `insert into public.recurring (household_id, kind, title, amount, day_of_month, start_month, end_month, installment_months) values ($1, 'fixed', 'x', 1, 1, '2027-01-01', '2027-03-01', 3)`, [hhC])))
      .toContain('recurring_installment_check')
  })

  it('할부가 아닌 항목도 끝나는 달을 둘 수 있고(구독 기간 제한), 그 달까지만 넣고 메모는 붙이지 않는다', async () => {
    const [{ id }] = await as<{ id: string }>(C,
      `insert into public.recurring (household_id, kind, title, amount, day_of_month, start_month, end_month)
       values ($1, 'fixed', '취득세 할부', 120000, 10, '2026-11-01', '2027-01-01') returning id`, [hhC])
    await as(C, `select public.generate_recurring($1, '2027-04-20')`, [hhC])
    const rows = await as<{ d: string; memo: string | null }>(C,
      `select to_char(occurred_on, 'YYYY-MM-DD') as d, memo from public.transactions where recurring_id = $1 order by occurred_on`, [id])
    expect(rows).toEqual([{ d: '2026-11-10', memo: null }, { d: '2026-12-10', memo: null }, { d: '2027-01-10', memo: null }])
  })
})

describe('일정 (20261015150000_events)', () => {
  it('같은 가구만 보고 쓰며, 시간은 없어도 되고, 제목은 1~40자', async () => {
    await as(A, `insert into public.events (household_id, date, time, title) values ($1, '2026-10-20', '14:30', '치과 예약')`, [hhA])
    await as(B, `insert into public.events (household_id, date, title, memo) values ($1, '2026-10-24', '친구 결혼식', '축의금')`, [hhA])
    const rows = await as<{ d: string; t: string | null; title: string }>(B,
      `select to_char(date, 'YYYY-MM-DD') as d, to_char(time, 'HH24:MI') as t, title from public.events order by date`)
    expect(rows).toEqual([{ d: '2026-10-20', t: '14:30', title: '치과 예약' }, { d: '2026-10-24', t: null, title: '친구 결혼식' }])
    expect(await as(C, `select * from public.events`)).toHaveLength(0)
    expect(await errorOf(as(null, `select * from public.events`))).toContain('permission denied')
    expect(await errorOf(as(C, `insert into public.events (household_id, date, title) values ($1, '2026-10-20', 'x')`, [hhA]))).toContain('row-level security')
    expect(await errorOf(as(A, `insert into public.events (household_id, date, title) values ($1, '2026-10-20', ' ')`, [hhA]))).toContain('check')
    await as(B, `update public.events set time = null where title = '치과 예약'`)
    await as(A, `delete from public.events where title = '친구 결혼식'`)
    expect((await as<{ title: string; time: string | null }>(A, `select title, time from public.events`))).toEqual([{ title: '치과 예약', time: null }])
  })
})

describe('새 가입 막기 (20261015170000_close_signups)', () => {
  const D = '00000000-0000-4000-8000-00000000000d'
  const E = '00000000-0000-4000-8000-00000000000e'

  it('새 사용자 행은 거절하고, 기존 사용자 행을 고치는 것(로그인 기록 등)은 된다', async () => {
    expect(await errorOf(db.query(`insert into auth.users (id, email) values ($1, 'd@x')`, [D]))).toContain('signups_closed')
    await db.query(`update auth.users set raw_app_meta_data = raw_app_meta_data where id = $1`, [A])
    expect((await db.query(`select 1 from auth.users where id = $1`, [D])).rows).toHaveLength(0)
  })

  it('가입 문은 로그인한 사용자도 익명도 보거나 열 수 없다', async () => {
    expect(await errorOf(as(A, `update private.signup_gate set open = true`))).toContain('permission denied')
    expect(await errorOf(as(A, `select * from private.signup_gate`))).toContain('permission denied')
    expect(await errorOf(as(null, `select * from private.signup_gate`))).toContain('permission denied')
  })

  it('관리자가 문을 열면 가입되고, 닫으면 다시 막힌다', async () => {
    await db.exec(`update private.signup_gate set open = true`)
    await db.query(`insert into auth.users (id, email) values ($1, 'd@x')`, [D])
    await db.exec(`update private.signup_gate set open = false`)
    expect(await errorOf(db.query(`insert into auth.users (id, email) values ($1, 'e@x')`, [E]))).toContain('signups_closed')
    await db.query(`delete from auth.users where id = $1`, [D])
  })
})

describe('내역 고치기 (20261015180000_tx_update_grants)', () => {
  const addTx = (uid: string, hh: string, title: string) =>
    as<{ id: string }>(uid,
      `insert into public.transactions (household_id, type, occurred_on, amount, title, scope) values ($1, 'expense', '2026-10-15', 1000, $2, 'shared') returning id`,
      [hh, title]).then((r) => r[0].id)
  const addRecurring = (uid: string, hh: string) =>
    as<{ id: string }>(uid,
      `insert into public.recurring (household_id, kind, title, amount, day_of_month, start_month) values ($1, 'fixed', '관리비', 200000, 25, '2026-10-01') returning id`,
      [hh]).then((r) => r[0].id)

  it('앱이 보내는 칸(플랫폼 포함)을 한 번에 고친다 — 배우자도', async () => {
    const id = await addTx(A, hhA, '고칠 내역')
    await as(B,
      `update public.transactions set type = 'expense', occurred_on = '2026-10-16', amount = 2000, title = '고친 내역',
         category_id = null, payment_method_id = null, scope = 'wife', platform = '쿠팡' where id = $1`, [id])
    expect(await as(A,
      `select to_char(occurred_on, 'YYYY-MM-DD') as d, amount::int as amount, title, scope, platform from public.transactions where id = $1`, [id]))
      .toEqual([{ d: '2026-10-16', amount: 2000, title: '고친 내역', scope: 'wife', platform: '쿠팡' }])
  })

  it('관리비 고지서를 다시 저장하면 기존 내역을 같은 가구의 고정지출에 잇는다', async () => {
    const rec = await addRecurring(A, hhA)
    const tx = await addTx(A, hhA, '관리비')
    await as(A, `update public.transactions set recurring_id = $1, recurring_month = '2026-10-01', memo = '관리비 고지서 10월분' where id = $2`, [rec, tx])
    expect(await as(B, `select recurring_id, to_char(recurring_month, 'YYYY-MM-DD') as m from public.transactions where id = $1`, [tx]))
      .toEqual([{ recurring_id: rec, m: '2026-10-01' }])
  })

  it('그래도 다른 가구의 고정지출에 잇거나, 다른 가구 내역을 고치거나, 작성자를 바꿀 수는 없다', async () => {
    const cRec = await addRecurring(C, hhC)
    const tx = await addTx(A, hhA, '남의 고정지출')
    expect(await errorOf(as(A, `update public.transactions set recurring_id = $1, recurring_month = '2026-11-01' where id = $2`, [cRec, tx])))
      .toContain('foreign key')
    await as(C, `update public.transactions set platform = '다른 가구' where id = $1`, [tx])  // RLS로 0행
    expect(await as(A, `select platform from public.transactions where id = $1`, [tx])).toEqual([{ platform: null }])
    expect(await errorOf(as(A, `update public.transactions set created_by = $1 where id = $2`, [B, tx]))).toContain('permission denied')
  })
})

describe('주유 기록 (20261031000000_fuel_fills)', () => {
  it('같은 가구만 보고 쓰며, 내역 하나에 하나, 다른 가구 내역에는 못 붙이고, 내역을 지우면 함께 지워진다', async () => {
    const [{ id: txA }] = await as<{ id: string }>(A,
      `insert into public.transactions (household_id, type, occurred_on, amount, title, scope) values ($1, 'expense', '2026-10-18', 58150, 'GS칼텍스 분당주유소', 'shared') returning id`, [hhA])
    await as(A, `insert into public.fuel_fills (household_id, transaction_id, liters, price_per_liter, fuel_type) values ($1, $2, 35.2, 1652, '휘발유')`, [hhA, txA])
    const rows = await as<{ liters: string; price_per_liter: number; fuel_type: string }>(B, `select liters, price_per_liter, fuel_type from public.fuel_fills`)
    expect(rows.map((r) => [Number(r.liters), r.price_per_liter, r.fuel_type])).toEqual([[35.2, 1652, '휘발유']])
    expect(await as(C, `select * from public.fuel_fills`)).toHaveLength(0)
    expect(await errorOf(as(null, `select * from public.fuel_fills`))).toContain('permission denied')
    expect(await errorOf(as(C, `insert into public.fuel_fills (household_id, transaction_id, liters, price_per_liter) values ($1, $2, 1, 1000)`, [hhA, txA])))
      .toContain('row-level security')
    expect(await errorOf(as(B, `insert into public.fuel_fills (household_id, transaction_id, liters, price_per_liter) values ($1, $2, 1, 1000)`, [hhA, txA])))
      .toContain('duplicate key')
    expect(await errorOf(as(A, `insert into public.fuel_fills (household_id, transaction_id, liters, price_per_liter) values ($1, gen_random_uuid(), 0, 1000)`, [hhA])))
      .toContain('check')
    // 다른 가구의 내역에는 붙일 수 없다
    const [{ id: txC }] = await as<{ id: string }>(C,
      `insert into public.transactions (household_id, type, occurred_on, amount, scope) values ($1, 'expense', '2026-10-18', 1000, 'shared') returning id`, [hhC])
    expect(await errorOf(as(A, `insert into public.fuel_fills (household_id, transaction_id, liters, price_per_liter) values ($1, $2, 1, 1000)`, [hhA, txC])))
      .toContain('foreign key')
    await as(A, `delete from public.transactions where id = $1`, [txA])
    expect(await as(B, `select * from public.fuel_fills`)).toHaveLength(0)
  })
})
