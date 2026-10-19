// P8: 식약처 확인 상태는 서비스별 "마지막 성공 실행"이어야 한다. 전에는 최근 30건만 보고 골라서 한 서비스가 오래 실패하면 범위에서 빠졌다.
// grocery.last_synced()는 서비스마다 ok=true인 가장 늦은 ran_at을 돌려준다(로그인한 사용자 누구나, sync_runs 읽기 권한과 같음).
import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { freshDb } from './dbSetup'

const A = '00000000-0000-4000-8000-00000000000a'
let db: PGlite

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
const run = (source: string, ok: boolean, at: string) =>
  db.query(`insert into grocery.sync_runs (source, ok, rows, ran_at) values ($1, $2, 0, $3)`, [source, ok, at])

beforeAll(async () => {
  db = await freshDb([A], async (d) => {
    const hh = (await d.query<{ id: string }>(`insert into public.households default values returning id`)).rows[0].id
    await d.query(`insert into public.members (household_id, user_id, display_name, role, spouse_role) values ($1, $2, 'A', 'owner', 'husband')`, [hh, A])
  })
})

beforeEach(async () => {
  await db.exec('reset role; delete from grocery.sync_runs;')
})

describe('last_synced', () => {
  it('서비스마다 성공한 실행 중 가장 늦은 시각. 실패만 있는 서비스는 나오지 않는다', async () => {
    await run('I0490', true, '2026-10-01T00:00:00Z')
    await run('I0490', true, '2026-10-19T00:00:00Z')
    await run('I0490', false, '2026-10-20T00:00:00Z')
    await run('I2620', false, '2026-10-19T00:00:00Z')
    await run('I2715', true, '2026-09-01T00:00:00Z')
    await run('kamis', true, '2026-10-19T00:00:00Z')
    const rows = await as<{ source: string; ran_at: Date | string }>(A, `select source, ran_at from grocery.last_synced() order by source`)
    expect(rows.map((r) => [r.source, new Date(r.ran_at).toISOString()])).toEqual([
      ['I0490', '2026-10-19T00:00:00.000Z'],
      ['I2715', '2026-09-01T00:00:00.000Z'],
      ['kamis', '2026-10-19T00:00:00.000Z'],
    ])
  })

  it('한 서비스가 오래 실패해도(최근 30건 밖) 마지막 성공이 나온다', async () => {
    await run('I2715', true, '2026-08-01T00:00:00Z')
    for (let i = 0; i < 40; i++) await run('I0490', true, `2026-09-${String(1 + (i % 28)).padStart(2, '0')}T0${i % 10}:00:00Z`)
    const rows = await as<{ source: string }>(A, `select source from grocery.last_synced() order by source`)
    expect(rows.map((r) => r.source)).toEqual(['I0490', 'I2715'])
  })

  it('로그인하지 않으면 못 부른다', async () => {
    expect(await errorOf(as(null, `select * from grocery.last_synced()`))).toMatch(/permission denied/)
  })
})
