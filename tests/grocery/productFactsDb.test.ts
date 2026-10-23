// 다나와 상품 정보 칸과 옛 자동 맞춤 지우기(20261103000000_grocery_product_facts, D-026)를 PGlite에서 검증한다.
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { freshDb } from './dbSetup'

const A = '00000000-0000-4000-8000-00000000000a'

let db: PGlite
let hhA: string

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
const item = async (name: string) =>
  (await db.query<{ id: string }>(`insert into grocery.items (household_id, name, category, added_by) values ($1, $2, '가공', $3) returning id`, [hhA, name, A])).rows[0].id
const nut = (itemId: string, json: object, chosenBy: string | null) =>
  db.query(`select grocery.set_item_nutrition($1, 'F1', '식품', null, $2::jsonb, $3)`, [itemId, JSON.stringify(json), chosenBy])
const ing = (itemId: string, details: object, chosenBy: string | null) =>
  db.query(`select grocery.set_item_ingredients($1, 'C002', '1', '품목', null, null, null, null, $2::jsonb, $3)`, [itemId, JSON.stringify(details), chosenBy])
const kept = async () => ({
  nut: (await as<{ item_id: string }>(A, `select item_id from grocery.item_nutrition_rows()`)).map((r) => r.item_id).sort(),
  ing: (await as<{ item_id: string }>(A, `select item_id from grocery.item_ingredients_rows()`)).map((r) => r.item_id).sort(),
})

beforeAll(async () => {
  db = await freshDb([A], async (d) => {
    hhA = (await d.query<{ id: string }>(`insert into public.households default values returning id`)).rows[0].id
    await d.query(`insert into public.members (household_id, user_id, display_name, role, spouse_role) values ($1,$2,'A','owner','husband')`, [hhA, A])
  })
})

describe('products 상품 정보 칸', () => {
  it('서비스 롤이 제조사·상표·원산지·원재료명을 쓰고 로그인 사용자는 읽기만 한다. 길이 한도를 넘으면 거절', async () => {
    const id = (await db.query<{ id: string }>(`insert into grocery.products (source, source_id, name) values ('danawa', '4497661', '청정원 순창 100% 현미 태양초 찰고추장 2kg') returning id`)).rows[0].id
    await db.query(`update grocery.products set maker = '대상', brand = '청정원 순창', origin = '고추양념(중국산), 현미(외국산)', materials = '현미 20.2%, 태양초 11.3%', facts_at = now() where id = $1`, [id])
    const [r] = await as<{ maker: string; origin: string }>(A, `select maker, origin from grocery.products where id = $1`, [id])
    expect(r).toEqual({ maker: '대상', origin: '고추양념(중국산), 현미(외국산)' })
    expect(await errorOf(as(A, `update grocery.products set maker = '다른 회사' where id = $1`, [id]))).toMatch(/permission denied/)
    expect(await errorOf(db.query(`update grocery.products set maker = $2 where id = $1`, [id, 'ㄱ'.repeat(61)]))).toMatch(/check constraint/)
  })
})

describe('clear_item_auto', () => {
  it('버전이 낮은 자동 맞춤만 지운다: 사람이 고른 줄·auto 표시가 없는 줄·새 버전 줄은 그대로', async () => {
    const oldAuto = await item('된장') // v 없음(=1), auto: v6 이전 "취나물_된장"
    const chosen = await item('우유') // 사람이 고름
    const legacy = await item('삼겹살') // auto 표시 없음(첫 P9 때 고른 줄)
    const fresh = await item('참깨') // 새 버전 자동 맞춤
    await nut(oldAuto, { auto: true }, null)
    await ing(oldAuto, { auto: true, matchedBy: 'product' }, null)
    await nut(chosen, { auto: false }, A)
    await nut(legacy, {}, null)
    await nut(fresh, { auto: true, v: 2 }, null)
    await ing(fresh, { auto: true, v: 2 }, null)
    for (const id of [oldAuto, chosen, legacy, fresh]) await db.query(`select grocery.clear_item_auto($1, 2)`, [id])
    expect(await kept()).toEqual({ nut: [chosen, legacy, fresh].sort(), ing: [fresh] })
  })
  it('로그인 사용자는 부를 수 없고, 없는 품목이면 item_not_found', async () => {
    const id = await item('고추장')
    expect(await errorOf(as(A, `select grocery.clear_item_auto($1, 2)`, [id]))).toMatch(/permission denied/)
    expect(await errorOf(db.query(`select grocery.clear_item_auto('00000000-0000-4000-8000-0000000000ff', 2)`))).toMatch(/item_not_found/)
  })
})

describe('저장 함수: 자동 맞춤은 사람이 고른 줄을 덮지 않는다', () => {
  it('있는 줄이 사람이 고른 것이면 자동 저장은 그대로 두고, 있는 줄이 자동이거나 들어오는 줄이 사람이 고른 것이면 덮는다', async () => {
    const id = await item('쌈장')
    await nut(id, { auto: false, pick: 'person' }, A)
    await nut(id, { auto: true, v: 2, pick: 'auto' }, null)
    const pickOf = async () => (await as<{ p: string }>(A, `select nutrition ->> 'pick' as p from grocery.item_nutrition_rows() where item_id = $1`, [id]))[0]?.p
    expect(await pickOf()).toBe('person')
    await nut(id, { auto: false, pick: 'person2' }, A)
    expect(await pickOf()).toBe('person2')
    const id2 = await item('굴소스')
    await nut(id2, { auto: true, pick: 'old' }, null)
    await nut(id2, { auto: true, v: 2, pick: 'new' }, null)
    expect((await as<{ p: string }>(A, `select nutrition ->> 'pick' as p from grocery.item_nutrition_rows() where item_id = $1`, [id2]))[0].p).toBe('new')
    await ing(id, { auto: false, pick: 'person' }, A)
    await ing(id, { auto: true, v: 2, pick: 'auto' }, null)
    expect((await as<{ p: string }>(A, `select details ->> 'pick' as p from grocery.item_ingredients_rows() where item_id = $1`, [id]))[0].p).toBe('person')
  })
})
