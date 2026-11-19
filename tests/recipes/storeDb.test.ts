// 저장소가 만드는 갱신을 PGlite의 실제 표(check 제약·칸 권한)에 구성원으로 적용해 본다.
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRecipeStore } from '../../src/recipes/lib/store'
import { freshDb } from '../grocery/dbSetup'
import { fakeClient } from './fakeClient'

const A = '00000000-0000-4000-8000-00000000000a'
let db: PGlite
let hh: string
let rid: string
let iid: string

async function asMember<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec('reset role')
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [A])
  await db.exec('set role authenticated')
  try { return (await db.query<T>(sql, params)).rows } finally { await db.exec('reset role') }
}

const REVIEW = [
  { target: 'servings.value', reason: 'x', candidates: [] },
  { target: 'ingredients[0].amount', reason: 'y', candidates: [] },
]

beforeAll(async () => {
  db = await freshDb([A], async (d) => {
    hh = (await d.query<{ id: string }>(`insert into public.households default values returning id`)).rows[0].id
    await d.query(`insert into public.members (household_id, user_id, display_name, role) values ($1,$2,'A','owner')`, [hh, A])
  })
  // recipe 표는 장보기 마이그레이션 뒤에 생기므로 freshDb 뒤에 심는다
  rid = (await db.query<{ id: string }>(
    `insert into recipe.recipes (household_id, title, status, source_kind, source_key, source_url, cuisine, servings_suggested, review_items)
     values ($1,'요리','review','youtube','youtube:AkX6uA4BaDs','https://www.youtube.com/watch?v=AkX6uA4BaDs','한식',2,$2::jsonb) returning id`,
    [hh, JSON.stringify(REVIEW)])).rows[0].id
  iid = (await db.query<{ id: string }>(
    `insert into recipe.ingredients (recipe_id, household_id, position, name, origin, suggested_amount, suggested_unit, needs_review)
     values ($1,$2,1,'소금','editor',2,'g',true) returning id`, [rid, hh])).rows[0].id
})
afterAll(async () => { await db?.close() })

describe('확인 필요 처리가 실제 표의 제약을 지킨다', () => {
  it('덧붙인 값이 있는 줄의 인분·분량 확인을 구성원으로 적용해도 막히지 않는다', async () => {
    // 가짜 클라이언트에 같은 줄을 심어 저장소를 돌리고, 나온 update를 실제 표에 구성원으로 적용한다
    const f = fakeClient({
      'recipe.recipes': [{ id: rid, household_id: hh, status: 'review', servings: null, servings_origin: null, servings_suggested: 2, review_items: REVIEW }],
      'recipe.ingredients': [{ id: iid, household_id: hh, recipe_id: rid, position: 1 }],
    })
    const store = createRecipeStore(f.client, hh, A)
    await store.resolveReview(rid, 0, { value: '3', origin: 'asr', at_seconds: 1 })
    await store.resolveReview(rid, 0, { value: '7', origin: 'asr', at_seconds: 1 })
    const updates = f.calls.filter((c) => c.op === 'update')
    expect(updates.length).toBeGreaterThan(0)
    for (const c of updates) {
      const payload = c.payload as Record<string, unknown>
      const keys = Object.keys(payload)
      const isJson = (v: unknown) => typeof v === 'object' && v !== null
      const sets = keys.map((k, i) => `${k} = $${i + 3}${isJson(payload[k]) ? '::jsonb' : ''}`).join(', ')
      const vals = keys.map((k) => (isJson(payload[k]) ? JSON.stringify(payload[k]) : payload[k]))
      const id = c.filters.find(([col]) => col === 'id')?.[2]
      const rows = await asMember(`update ${c.table} set ${sets} where household_id = $1 and id = $2 returning id`, [hh, id === 'i0' ? iid : id, ...vals])
      expect(rows).toHaveLength(1)
    }
    const [r] = await asMember<Record<string, unknown>>(`select servings::float as servings, servings_origin, servings_suggested, status from recipe.recipes where id=$1`, [rid])
    expect(r).toMatchObject({ servings: 3, servings_origin: 'user', servings_suggested: null, status: 'saved' })
    const [i] = await asMember<Record<string, unknown>>(`select amount::float as amount, origin, suggested_amount, suggested_unit, needs_review from recipe.ingredients where id=$1`, [iid])
    expect(i).toMatchObject({ amount: 7, origin: 'user', suggested_amount: null, suggested_unit: null, needs_review: false })
  })
})
