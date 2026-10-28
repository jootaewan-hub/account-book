import { expect, it } from 'vitest'
import { freshDb } from './grocery/dbSetup'

it('시트 내보내기는 같은 날짜·시각의 1,003건을 ID 순으로 정렬해 페이지 경계를 고정한다', async () => {
  const user = '00000000-0000-4000-8000-00000000000a'
  const db = await freshDb([user])
  try {
    const hh = (await db.query<{ id: string }>(`insert into public.households default values returning id`)).rows[0].id
    await db.query(`insert into public.members (household_id,user_id,display_name,role) values ($1,$2,'나','owner')`, [hh, user])
    await db.query(`insert into public.transactions (id,household_id,type,occurred_on,amount,title,scope,created_by)
      select ('10000000-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid,$1,'expense','2026-10-01',10,'항목 ' || i,'shared',$2
      from generate_series(1003,1,-1) i`, [hh, user])
    await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [user])
    await db.exec('set role authenticated')
    const tok = (await db.query<{ token: string }>(`select public.export_token($1) as token`, [hh])).rows[0].token
    await db.exec('reset role; set role service_role')
    const first = (await db.query<{ title: string }>(`select title from public.export_rows_v2($1) limit 1000`, [tok])).rows
    const next = (await db.query<{ title: string }>(`select title from public.export_rows_v2($1) limit 1000 offset 1000`, [tok])).rows
    expect(first[0].title).toBe('항목 1')
    expect(first.at(-1)?.title).toBe('항목 1000')
    expect(next.map((r) => r.title)).toEqual(['항목 1001', '항목 1002', '항목 1003'])
  } finally { await db.close() }
})
