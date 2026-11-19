// 서버 함수 요청 횟수 한도(20261122030000_recipe_rate.sql)를 PGlite에서 검증한다.
import type { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { freshDb } from '../grocery/dbSetup'

const A = '00000000-0000-4000-8000-00000000000a'
let db: PGlite

type Row = Record<string, unknown>
async function as<T = Row>(role: 'service_role' | 'authenticated' | 'anon', sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec('reset role')
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [role === 'authenticated' ? A : ''])
  await db.exec(`set role ${role}`)
  try {
    return (await db.query<T>(sql, params)).rows
  } finally {
    await db.exec('reset role')
  }
}
async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    return String((e as { code?: string }).code ?? (e as Error).message)
  }
  return 'NO_ERROR'
}
const hit = async (at: string, limit = 120) =>
  (await as<{ ok: boolean }>('service_role', `select recipe.worker_rate_hit($1::timestamptz, $2) as ok`, [at, limit]))[0]!.ok

beforeAll(async () => {
  db = await freshDb([A], async () => {})
})
afterAll(async () => {
  await db?.close()
})
beforeEach(async () => {
  await db.exec(`reset role`)
  await db.exec(`update recipe.worker_calls set window_start = '-infinity', calls = 0`)
})

describe('worker_rate_hit', () => {
  it('한 분에 120번까지 true, 121번째부터 false', async () => {
    for (let i = 1; i <= 120; i++) {
      expect(await hit(`2026-11-22T03:00:${String(i % 60).padStart(2, '0')}Z`)).toBe(true)
    }
    expect(await hit('2026-11-22T03:00:59Z')).toBe(false)
    expect(await hit('2026-11-22T03:00:59Z')).toBe(false)
  })

  it('다음 분이 되면 1부터 다시 센다', async () => {
    for (let i = 0; i < 125; i++) await hit('2026-11-22T03:00:10Z')
    expect(await hit('2026-11-22T03:01:00Z')).toBe(true)
    const [row] = await as<{ calls: number }>('service_role', `select calls from recipe.worker_calls`)
    expect(row!.calls).toBe(1)
  })

  it('한도는 인자로 받는다', async () => {
    expect(await hit('2026-11-22T03:00:00Z', 2)).toBe(true)
    expect(await hit('2026-11-22T03:00:01Z', 2)).toBe(true)
    expect(await hit('2026-11-22T03:00:02Z', 2)).toBe(false)
  })

  it('줄은 하나뿐이다(id = 1)', async () => {
    expect((await as('service_role', `select * from recipe.worker_calls`)).length).toBe(1)
    expect(await codeOf(db.exec(`insert into recipe.worker_calls (id, window_start, calls) values (2, now(), 0)`))).toBe('23514')
  })

  it('로그인한 사용자·익명은 함수도 표도 못 쓴다(42501)', async () => {
    for (const role of ['authenticated', 'anon'] as const) {
      expect(await codeOf(as(role, `select recipe.worker_rate_hit(now(), 120)`))).toBe('42501')
      expect(await codeOf(as(role, `select * from recipe.worker_calls`))).toBe('42501')
      expect(await codeOf(as(role, `update recipe.worker_calls set calls = 0`))).toBe('42501')
    }
  })

  it('마이그레이션 파일에 delete 문장이 없다(MCP apply_migration이 거절함)', () => {
    const sql = readFileSync('supabase/migrations/20261122030000_recipe_rate.sql', 'utf8')
    expect(sql.toLowerCase()).not.toMatch(/delete/)
  })
})
