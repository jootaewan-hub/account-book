import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { freshDb } from './grocery/dbSetup'

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const C = '00000000-0000-4000-8000-00000000000c'
const aEndpoint = 'https://fcm.googleapis.com/fcm/send/browser-a'
const bEndpoint = 'https://web.push.apple.com/browser-b'
const cEndpoint = 'https://updates.push.services.mozilla.com/wpush/v2/browser-c'
let db: PGlite
let home: string
let eventId: string

async function as<T = Record<string, unknown>>(role: 'authenticated' | 'anon' | 'service_role', user: string, sql: string, args: unknown[] = []) {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user])
  await db.exec(`set role ${role}`)
  try { return (await db.query<T>(sql, args)).rows } finally { await db.exec('reset role') }
}

const device = (user: string, endpoint: string) => as('authenticated', user,
  `insert into public.event_push_subscriptions (user_id, endpoint, p256dh, auth_key)
    values ($1, $2, $3, $4) on conflict (endpoint) do update set p256dh=excluded.p256dh, auth_key=excluded.auth_key`,
  [user, endpoint, 'a'.repeat(87), 'b'.repeat(22)])

function claim(now: string, anniv = '[]') {
  return as<{ id: string; endpoint: string; occurrence_date: string; is_anniversary: boolean }>('service_role', '',
    'select id, endpoint, occurrence_date::text, is_anniversary from public.claim_event_push_deliveries($1, $2) order by endpoint', [now, anniv])
}

beforeAll(async () => {
  db = await freshDb([A, B, C], async (d) => {
    home = (await d.query<{ id: string }>(`insert into public.households default values returning id`)).rows[0].id
    const other = (await d.query<{ id: string }>(`insert into public.households default values returning id`)).rows[0].id
    await d.query(`insert into public.members (household_id,user_id,display_name,role)
      values ($1,$2,'나','owner'),($1,$3,'배우자','partner'),($4,$5,'다른 집','owner')`, [home, A, B, other, C])
  })
  await device(A, aEndpoint)
  await device(B, bEndpoint)
  await device(C, cEndpoint)
})
afterAll(async () => { await db?.close() })

describe('일정·기념일 푸시', () => {
  it('자기 기기만 읽고 갱신하며 외부 주소로 등록할 수 없다', async () => {
    expect(await as('authenticated', A, 'select endpoint from public.event_push_subscriptions')).toEqual([{ endpoint: aEndpoint }])
    await device(A, aEndpoint)
    await expect(device(C, aEndpoint)).rejects.toThrow(/row-level security/)
    await expect(device(A, 'https://fcm.googleapis.com.example.com/fcm/send/bad')).rejects.toThrow(/check constraint/)
    await expect(as('anon', '', 'select endpoint from public.event_push_subscriptions')).rejects.toThrow(/permission denied/)
    await expect(as('authenticated', A, `select * from public.claim_event_push_deliveries(now(), '[]')`)).rejects.toThrow(/permission denied/)
    await expect(as('authenticated', A, 'select * from public.event_push_deliveries')).rejects.toThrow(/permission denied/)
  })

  it('기본으로 꺼지며 다른 가구 사람을 수신자로 설정할 수 없다', async () => {
    const [normal] = await as('authenticated', A,
      `insert into public.events (household_id, date, title) values ($1, '2099-01-05', '기본 일정')
        returning reminder_offset_minutes, reminder_recipient`, [home])
    expect(normal).toEqual({ reminder_offset_minutes: null, reminder_recipient: null })
    await expect(as('authenticated', A,
      `insert into public.events (household_id, date, title, priority, reminder_offset_minutes, reminder_recipient)
        values ($1, '2099-01-05', '중요 일정', 'high', 60, $2)`, [home, C])).rejects.toThrow('참여한 사람만')
  })

  it('한국 시각으로 반복 회차를 찾아 지정한 두 사람의 기기에 발송하고 잠금·완료를 구분한다', async () => {
    const [event] = await as<{ id: string }>('authenticated', A,
      `insert into public.events
        (household_id, date, time, title, priority, repeat_weeks, repeat_until, reminder_offset_minutes, reminder_recipient)
        values ($1, '2099-01-05', '15:00', '중요 일정', 'high', 2, '2099-02-05', 60, 'both') returning id`, [home])
    eventId = event.id
    expect(await claim('2099-01-19T04:59:59Z')).toEqual([])
    expect(await claim('2099-01-12T05:00:00Z')).toEqual([])
    const first = await claim('2099-01-19T05:00:00Z')
    expect(first).toHaveLength(2)
    expect(first.map((d) => d.endpoint)).toEqual([aEndpoint, bEndpoint])
    expect(first.map((d) => d.occurrence_date)).toEqual(['2099-01-19', '2099-01-19'])
    expect(await claim('2099-01-19T05:01:00Z')).toEqual([])
    await as('service_role', '', 'update public.event_push_deliveries set done_at = $2 where id = $1', [first[0].id, '2099-01-19T05:01:00Z'])
    expect((await claim('2099-01-19T05:02:00Z')).map((d) => d.id)).toEqual([first[1].id])
    expect(await claim('2099-01-19T05:11:00Z')).toEqual([])
    expect(await claim('2099-02-16T05:00:00Z')).toEqual([])
  })

  it('건너뛴 회차, 중요도를 낮춘 일정, 삭제된 기기는 보내지 않는다', async () => {
    await as('authenticated', B, `select public.skip_event_occurrence($1, '2099-02-02')`, [eventId])
    expect(await claim('2099-02-02T05:00:00Z')).toEqual([])
    expect(await as('authenticated', A,
      `update public.events set priority='normal' where id=$1 returning reminder_offset_minutes, reminder_recipient`, [eventId]))
      .toEqual([{ reminder_offset_minutes: null, reminder_recipient: null }])
    await as('authenticated', B, 'delete from public.event_push_subscriptions where endpoint=$1', [bEndpoint])
    const rows = await as('service_role', '', 'select * from public.event_push_deliveries where event_id=$1', [eventId])
    expect(rows).toHaveLength(1)
  })

  it('시간 없는 일정과 일주일 전 기념일을 오전 9시 기준으로 정한 사람에게만 보낸다', async () => {
    await as('authenticated', A, `insert into public.events
      (household_id, date, title, priority, reminder_offset_minutes, reminder_recipient)
      values ($1, '2099-03-02', '하루 종일', 'must', 1440, $2)`, [home, A])
    const [anniv] = await as<{ id: string; active_since: string }>('authenticated', A, `insert into public.anniversaries
      (household_id, name, month, day, kind, reminder_offset_minutes, reminder_recipient)
      values ($1, '생일', 3, 8, 'birthday', 10080, $2) returning id, reminder_active_since::text as active_since`, [home, A])
    const days = JSON.stringify([{ ...anniv, occurs_on: '2099-03-08' }])
    expect(await claim('2099-03-01T00:00:00Z', JSON.stringify([{ ...anniv, occurs_on: '2099-03-08', active_since: '2000-01-01' }])))
      .toMatchObject([{ occurrence_date: '2099-03-02', is_anniversary: false, endpoint: aEndpoint }])
    expect(await claim('2099-03-01T00:00:01Z', days))
      .toMatchObject([{ occurrence_date: '2099-03-08', is_anniversary: true, endpoint: aEndpoint }])
  })
})
