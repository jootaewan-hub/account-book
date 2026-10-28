// 알아보기 가격 비교 캐시(D-035): grocery.explore_searches는 서비스 롤(explore-price 함수)만 읽고 쓴다.
import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { freshDb } from '../grocery/dbSetup'

const A = '00000000-0000-4000-8000-00000000000a'
let db: PGlite

async function as<T = Record<string, unknown>>(role: 'authenticated' | 'anon' | 'service_role', sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec('reset role')
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [role === 'authenticated' ? A : ''])
  await db.exec(`set role ${role}`)
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

beforeAll(async () => {
  db = await freshDb([A], async (d) => {
    const hh = (await d.query<{ id: string }>(`insert into public.households default values returning id`)).rows[0].id
    await d.query(`insert into public.members (household_id, user_id, display_name, role) values ($1,$2,'A','owner')`, [hh, A])
  })
})

describe('grocery.explore_searches', () => {
  it('서비스 롤은 넣고 읽는다(검색어·한국 날짜마다 하나)', async () => {
    await as('service_role', `insert into grocery.explore_searches (query_key, searched_on, query, items) values ('비비고 왕교자', '2026-10-28', '비비고 왕교자', '[{"pcode":"5643303"}]')`)
    const rows = await as<{ n: number }>('service_role', `select count(*)::int as n from grocery.explore_searches`)
    expect(rows[0].n).toBe(1)
    expect(await errorOf(as('service_role', `insert into grocery.explore_searches (query_key, searched_on, query) values ('비비고 왕교자', '2026-10-28', 'x')`))).toMatch(/duplicate key/)
  })

  it('상품 번호로 그 상품이 든 검색 결과를 찾는다(explore-price searchedName의 items @> 조건)', async () => {
    const hit = await as<{ n: number }>('service_role', `select count(*)::int as n from grocery.explore_searches where items @> '[{"pcode":"5643303"}]'::jsonb`)
    const miss = await as<{ n: number }>('service_role', `select count(*)::int as n from grocery.explore_searches where items @> '[{"pcode":"99999"}]'::jsonb`)
    expect([hit[0].n, miss[0].n]).toEqual([1, 0])
  })

  it('로그인 사용자·익명은 읽지도 쓰지도 못한다', async () => {
    expect(await errorOf(as('authenticated', `select * from grocery.explore_searches`))).toMatch(/permission denied/)
    expect(await errorOf(as('anon', `select * from grocery.explore_searches`))).toMatch(/permission denied/)
    expect(await errorOf(as('authenticated', `insert into grocery.explore_searches (query_key, searched_on, query) values ('ab', '2026-10-28', 'ab')`))).toMatch(/permission denied/)
  })

  it('검색어 키는 2~60자, items는 배열', async () => {
    expect(await errorOf(as('service_role', `insert into grocery.explore_searches (query_key, searched_on, query) values ('a', '2026-10-28', 'a')`))).toMatch(/check/)
    expect(await errorOf(as('service_role', `insert into grocery.explore_searches (query_key, searched_on, query, items) values ('ab', '2026-10-28', 'ab', '{}')`))).toMatch(/check/)
  })
})

describe('grocery.explore_shop_searches(D-036)', () => {
  it('서비스 롤만 쓰고, 출처는 kurly·daiso만, 출처별 전역 간격 자리가 있다', async () => {
    await as('service_role', `insert into grocery.explore_shop_searches (source, query_key, searched_on, query) values ('kurly', '우유', '2026-10-28', '우유'), ('daiso', '우유', '2026-10-28', '우유')`)
    expect(await errorOf(as('service_role', `insert into grocery.explore_shop_searches (source, query_key, searched_on, query) values ('coupang', '우유', '2026-10-28', '우유')`))).toMatch(/check/)
    expect(await errorOf(as('authenticated', `select * from grocery.explore_shop_searches`))).toMatch(/permission denied/)
    const gates = await as<{ key: string }>('service_role', `select key from grocery.fetch_gate order by key`)
    expect(gates.map((g) => g.key)).toEqual(['bunjang-search', 'daangn-search', 'daiso-search', 'danawa-search', 'kurly-search', 'ohou-search'])
    const wait = await as<{ w: number }>('service_role', `select grocery.reserve_fetch('kurly-search', 1000, 30000) as w`)
    expect(wait[0].w).toBe(0)
  })
})

describe('grocery.explore_finds(D-036 보충)', () => {
  it('출처는 ohou·bunjang·daangn, 범위(당근 동네)마다 따로, 서비스 롤만', async () => {
    await as('service_role', `insert into grocery.explore_finds (source, scope, query_key, searched_on, query, region) values ('daangn', '여수동', '아이패드', '2026-10-28', '아이패드', '경기도 성남시 중원구 여수동'), ('daangn', '정자동', '아이패드', '2026-10-28', '아이패드', null), ('bunjang', '', '아이패드', '2026-10-28', '아이패드', null)`)
    expect(await errorOf(as('service_role', `insert into grocery.explore_finds (source, query_key, searched_on, query) values ('kurly', '우유', '2026-10-28', '우유')`))).toMatch(/check/)
    expect(await errorOf(as('authenticated', `select * from grocery.explore_finds`))).toMatch(/permission denied/)
    const rows = await as<{ n: number }>('service_role', `select count(*)::int as n from grocery.explore_finds`)
    expect(rows[0].n).toBe(3)
  })
})

