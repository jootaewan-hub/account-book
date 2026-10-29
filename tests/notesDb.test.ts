import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { freshDb } from './grocery/dbSetup'

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const C = '00000000-0000-4000-8000-00000000000c'
let db: PGlite
let home: string
let other: string
let note: string

async function as<T = Record<string, unknown>>(user: string | null, sql: string, args: unknown[] = []) {
  await db.exec('reset role')
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user ?? ''])
  await db.exec(user ? 'set role authenticated' : 'set role anon')
  try { return (await db.query<T>(sql, args)).rows } finally { await db.exec('reset role') }
}

beforeAll(async () => {
  db = await freshDb([A, B, C], async (d) => {
    home = (await d.query<{ id: string }>(`insert into public.households default values returning id`)).rows[0].id
    other = (await d.query<{ id: string }>(`insert into public.households default values returning id`)).rows[0].id
    await d.query(`insert into public.members (household_id,user_id,display_name,role) values ($1,$2,'남편','owner'),($1,$3,'아내','partner'),($4,$5,'다른 집','owner')`, [home, A, B, other, C])
  })
})
afterAll(async () => { await db?.close() })

describe('함께 기억할 것 권한', () => {
  it('한 사람이 적으면 배우자도 보고 고치며, 고친 사람이 남는다', async () => {
    const [row] = await as<{ id: string; updated_by: string }>(A, `insert into public.notes (household_id,title,body) values ($1,'관리사무소','031-000-0000') returning id, updated_by`, [home])
    note = row.id
    expect(row.updated_by).toBe(A)
    await as(B, `update public.notes set body='031-000-0000 (평일 9~6시)' where id=$1`, [note])
    expect((await as(A, `select title, body, created_by, updated_by from public.notes where id=$1`, [note]))[0])
      .toEqual({ title: '관리사무소', body: '031-000-0000 (평일 9~6시)', created_by: A, updated_by: B })
  })

  it('고정만 바꾸면 고친 사람·때는 그대로다', async () => {
    const [before] = await as<{ updated_at: string }>(A, `select updated_at from public.notes where id=$1`, [note])
    await as(A, `update public.notes set pinned=true where id=$1`, [note])
    expect((await as(B, `select pinned, updated_by, updated_at from public.notes where id=$1`, [note]))[0])
      .toEqual({ pinned: true, updated_by: B, updated_at: before.updated_at })
  })

  it('다른 가구와 로그인하지 않은 사람은 읽기·수정·삭제·추가를 못 한다', async () => {
    expect(await as(C, `select * from public.notes where id=$1`, [note])).toEqual([])
    expect(await as(C, `update public.notes set title='바꿈' where id=$1 returning id`, [note])).toEqual([])
    expect(await as(C, `delete from public.notes where id=$1 returning id`, [note])).toEqual([])
    await expect(as(C, `insert into public.notes (household_id,title) values ($1,'침입')`, [home])).rejects.toThrow(/row-level security/)
    await expect(as(null, `select * from public.notes`)).rejects.toThrow(/permission denied/)
  })

  it('가구·작성자·고친 사람은 바꿀 수 없고, 다른 사람 이름으로 넣어도 고친 사람은 넣은 사람이다', async () => {
    for (const sql of [
      `update public.notes set created_by='${B}' where id=$1`,
      `update public.notes set updated_by='${A}' where id=$1`,
      `update public.notes set household_id='${other}' where id=$1`,
    ]) await expect(as(A, sql, [note])).rejects.toThrow(/permission denied/)
    await expect(as(A, `insert into public.notes (household_id,title,created_by) values ($1,'가짜',$2)`, [home, B])).rejects.toThrow(/row-level security/)
    const [row] = await as<{ updated_by: string }>(A, `insert into public.notes (household_id,title,updated_by) values ($1,'정수기 필터',$2) returning updated_by`, [home, B])
    expect(row.updated_by).toBe(A)
  })

  it('빈 제목·너무 긴 제목·너무 긴 내용을 막는다', async () => {
    for (const [title, body] of [['', null], ['   ', null], ['가'.repeat(61), null], ['필터', '가'.repeat(2001)]]) {
      await expect(as(A, `insert into public.notes (household_id,title,body) values ($1,$2,$3)`, [home, title, body])).rejects.toThrow(/check constraint/)
    }
  })

  it('배우자가 지우면 둘 다 안 보이고 다른 집 메모는 남는다', async () => {
    await as(C, `insert into public.notes (household_id,title) values ($1,'우리 집 것')`, [other])
    await as(B, `delete from public.notes where household_id=$1`, [home])
    expect(await as(A, `select * from public.notes`)).toEqual([])
    expect(await as(C, `select * from public.notes`)).toHaveLength(1)
  })
})
