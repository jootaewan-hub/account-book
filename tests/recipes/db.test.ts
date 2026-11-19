// recipe 스키마(20261122000000_recipe_init.sql)를 PGlite에 적용해 가구 단위 RLS, 칸별 권한, 대기함과 일 받기를 검증한다.
// 가계부·장보기 마이그레이션 전부 위에 적용한다(tests/grocery/dbSetup.ts).
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { CUISINES, DIFFICULTIES, MAINS, MEASURING_TOOLS, METHODS, OCCASIONS } from '../../supabase/functions/_shared/recipeContract'
import { normalizeRecipeUrl } from '../../supabase/functions/_shared/recipeSource'
import { freshDb } from '../grocery/dbSetup'

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const C = '00000000-0000-4000-8000-00000000000c'
const D = '00000000-0000-4000-8000-00000000000d' // 가구가 없는 사용자

const STAGES = ['영상 정보 받는 중', '자막 받는 중', '말 받아쓰는 중', '화면 글자 읽는 중', '레시피 정리 중', '다시 읽어 맞춰 보는 중', '저장 중']

let db: PGlite
let hhAB: string
let hhC: string

type Row = Record<string, unknown>

/** 로그인한 사용자(uid) 또는 로그인 안 한 사람(null)으로 */
async function as<T = Row>(uid: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec('reset role')
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? ''])
  await db.exec(uid ? 'set role authenticated' : 'set role anon')
  try {
    return (await db.query<T>(sql, params)).rows
  } finally {
    await db.exec('reset role')
  }
}

/** 서버 함수 recipe-worker처럼 서비스 롤로(로그인 없음) */
async function svc<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec('reset role')
  await db.query(`select set_config('request.jwt.claim.sub', '', false)`)
  await db.exec('set role service_role')
  try {
    return (await db.query<T>(sql, params)).rows
  } finally {
    await db.exec('reset role')
  }
}

/** 시험 준비용: 관리자(postgres)로, 로그인 흔적 없이 */
async function admin<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec('reset role')
  await db.query(`select set_config('request.jwt.claim.sub', '', false)`)
  return (await db.query<T>(sql, params)).rows
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    return String((e as { code?: string }).code ?? (e as Error).message)
  }
  return 'NO_ERROR'
}

async function seedRecipe(household: string, addedBy: string, key = 'youtube:AkX6uA4BaDs'): Promise<string> {
  const [{ id }] = await admin<{ id: string }>(
    `insert into recipe.recipes (household_id, title, source_kind, source_key, cuisine, added_by)
     values ($1, '제육볶음', 'youtube', $2, '한식', $3) returning id`,
    [household, key, addedBy],
  )
  await admin(
    `insert into recipe.ingredients (recipe_id, household_id, position, name, amount, unit, origin, at_seconds)
     values ($1, $2, 1, '돼지 앞다리살', 500, 'g', 'description', null)`,
    [id, household],
  )
  await admin(
    `insert into recipe.steps (recipe_id, household_id, position, title, body, origin)
     values ($1, $2, 1, '고기 볶기', '센 불에 고기를 볶는다.', 'caption_manual')`,
    [id, household],
  )
  return id
}

async function seedJob(household: string, addedBy: string, key: string, addedAt: string, extra: Row = {}): Promise<string> {
  const cols = ['household_id', 'url', 'source_key', 'added_by', 'added_at', ...Object.keys(extra)]
  const vals = [household, `https://www.youtube.com/watch?v=${key.split(':')[1]}`, key, addedBy, addedAt, ...Object.values(extra)]
  const [{ id }] = await admin<{ id: string }>(
    `insert into recipe.inbox (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
    vals,
  )
  return id
}

const job = async (id: string) =>
  (await admin<Row>(`select state, stage, attempts, retry_at, fail_reason, claimed_at, heartbeat_at from recipe.inbox where id = $1`, [id]))[0]

const claim = (now: string) => svc<{ id: string; state: string; attempts: number }>(`select id, state, attempts from recipe.claim_job($1)`, [now])

const T0 = '2026-11-22T10:00:00Z'
const at = (min: number, sec = 0) => new Date(Date.parse(T0) + min * 60_000 + sec * 1000).toISOString()

beforeAll(async () => {
  db = await freshDb([A, B, C, D], async (d) => {
    hhAB = (await d.query<{ id: string }>(`insert into public.households default values returning id`)).rows[0].id
    hhC = (await d.query<{ id: string }>(`insert into public.households default values returning id`)).rows[0].id
    await d.query(
      `insert into public.members (household_id, user_id, display_name, role, spouse_role) values
       ($1,$3,'A','owner','husband'), ($1,$4,'B','partner','wife'), ($2,$5,'C','owner','husband')`,
      [hhAB, hhC, A, B, C],
    )
  })
})

afterAll(async () => {
  await db?.close()
})

beforeEach(async () => {
  await admin('delete from recipe.inbox')
  await admin('delete from recipe.recipes')
})

describe('다른 가구와 로그인 안 한 사람', () => {
  it('다른 가구 사용자는 recipes·ingredients·steps·inbox·exports를 한 줄도 못 본다', async () => {
    const r = await seedRecipe(hhAB, A)
    await seedJob(hhAB, A, 'youtube:AkX6uA4BaDs', T0)
    await svc(`insert into recipe.exports (recipe_id, household_id, drive_doc_id, exported_at) values ($1, $2, 'doc1', now())`, [r, hhAB])
    for (const t of ['recipes', 'ingredients', 'steps', 'inbox', 'exports']) {
      expect(await as(C, `select * from recipe.${t}`), t).toEqual([])
      expect((await as(B, `select * from recipe.${t}`)).length, t).toBe(1)
    }
  })
  it('다른 가구 사용자는 고치지도 지우지도 못한다', async () => {
    const r = await seedRecipe(hhAB, A)
    const j = await seedJob(hhAB, A, 'youtube:AkX6uA4BaDs', T0)
    expect(await as(C, `update recipe.recipes set memo = 'x' returning id`)).toEqual([])
    expect(await as(C, `update recipe.ingredients set name = 'x' returning id`)).toEqual([])
    expect(await as(C, `delete from recipe.steps returning id`)).toEqual([])
    expect(await as(C, `delete from recipe.inbox returning id`)).toEqual([])
    expect((await admin(`select memo from recipe.recipes where id = $1`, [r]))[0].memo).toBeNull()
    expect(await job(j)).toBeTruthy()
  })
  it('다른 가구의 레시피에 재료를 끼워 넣을 수 없다', async () => {
    const r = await seedRecipe(hhAB, A)
    // 남의 가구 id로는 RLS가, 자기 가구 id로 남의 레시피를 가리키면 외래 키가 막는다
    expect(await codeOf(as(C, `insert into recipe.ingredients (recipe_id, household_id, position, name, origin) values ($1, $2, 9, 'x', 'user')`, [r, hhAB]))).toBe('42501')
    expect(await codeOf(as(C, `insert into recipe.ingredients (recipe_id, household_id, position, name, origin) values ($1, $2, 9, 'x', 'user')`, [r, hhC]))).toBe('23503')
  })
  it('로그인 안 하면 아무것도 못 한다', async () => {
    await seedRecipe(hhAB, A)
    for (const t of ['recipes', 'ingredients', 'steps', 'inbox', 'exports', 'worker_status']) {
      expect(await codeOf(as(null, `select * from recipe.${t}`)), t).toBe('42501')
    }
    expect(await codeOf(as(null, `insert into recipe.inbox (household_id, url, source_key) values ($1, 'https://www.youtube.com/watch?v=x__________', 'youtube:x__________')`, [hhAB]))).toBe('42501')
  })
})

describe('대기함 담기', () => {
  it('구성원은 자기 가구에 added_by = 본인으로만 넣는다', async () => {
    const [row] = await as<{ added_by: string; state: string; attempts: number }>(
      A,
      `insert into recipe.inbox (household_id, url, source_key) values ($1, 'https://www.youtube.com/watch?v=AkX6uA4BaDs', 'youtube:AkX6uA4BaDs')
       returning added_by, state, attempts`,
      [hhAB],
    )
    expect(row).toEqual({ added_by: A, state: 'waiting', attempts: 0 })
    expect(await as(B, `select source_key from recipe.inbox`)).toEqual([{ source_key: 'youtube:AkX6uA4BaDs' }])
    expect(await codeOf(as(A, `insert into recipe.inbox (household_id, url, source_key, added_by) values ($1, 'https://www.youtube.com/watch?v=a1_________', 'youtube:a1_________', $2)`, [hhAB, B]))).toBe('42501')
    expect(await codeOf(as(C, `insert into recipe.inbox (household_id, url, source_key) values ($1, 'https://www.youtube.com/watch?v=a2_________', 'youtube:a2_________')`, [hhAB]))).toBe('42501')
  })
  it('상태·시도 횟수·만든 레시피는 넣을 때 정할 수 없다', async () => {
    const ins = (col: string, val: unknown) =>
      as(A, `insert into recipe.inbox (household_id, url, source_key, ${col}) values ($1, 'https://www.youtube.com/watch?v=b1_________', 'youtube:b1_________', $2)`, [hhAB, val])
    expect(await codeOf(ins('state', 'processing'))).toBe('42501')
    expect(await codeOf(ins('attempts', 99))).toBe('42501')
    expect(await codeOf(ins('fail_reason', 'x'))).toBe('42501')
    expect(await codeOf(ins('stage', '저장 중'))).toBe('42501')
  })
  it('같은 가구·같은 출처의 대기 줄은 하나만(23505), 다른 가구나 끝난 줄은 상관없다', async () => {
    const ins = (uid: string, hh: string) =>
      as(uid, `insert into recipe.inbox (household_id, url, source_key) values ($1, 'https://www.youtube.com/watch?v=AkX6uA4BaDs', 'youtube:AkX6uA4BaDs')`, [hh])
    await ins(A, hhAB)
    expect(await codeOf(ins(B, hhAB))).toBe('23505')
    await ins(C, hhC)
    // 처리 중인 동안에도 막히고, 끝나면 다시 담을 수 있다
    await admin(`update recipe.inbox set state = 'processing' where household_id = $1`, [hhAB])
    expect(await codeOf(ins(B, hhAB))).toBe('23505')
    await admin(`update recipe.inbox set state = 'done' where household_id = $1`, [hhAB])
    await ins(B, hhAB)
  })
  it('주소는 source_key로 만든 정규 주소(watch·shorts)와 같아야 하고, 열쇠는 youtube:영상 id 11자(23514)', async () => {
    const ins = (url: string, key: string) =>
      as(A, `insert into recipe.inbox (household_id, url, source_key) values ($1, $2, $3) returning id`, [hhAB, url, key])
    const K = 'youtube:AkX6uA4BaDs'
    for (const [url, key] of [
      ['https://www.youtube.com/watch?v=AkX6uA4BaDs', 'web:x'],
      ['https://www.youtube.com/watch?v=AkX6uA4BaDs', 'youtube:short'],
      ['https://youtu.be/AkX6uA4BaDs', K],
      ['https://www.youtube.com/redirect?q=https://evil.com&v=AkX6uA4BaDs', K],
      ['https://youtu.be/BkX6uA4BaDs?x=AkX6uA4BaDs', K],
      ['https://www.youtube.com/watch?v=BkX6uA4BaDs', K],
      ['http://www.youtube.com/watch?v=AkX6uA4BaDs', K],
      ['https://www.youtube.com/watch?v=AkX6uA4BaDs&t=30s', K],
      ['https://m.youtube.com/watch?v=AkX6uA4BaDs', K],
      ['https://www.youtube.com/shorts/AkX6uA4BaDs/', K],
      ['https://192.168.0.10/x', K],
      ['https://evil.com/watch?v=AkX6uA4BaDs', K],
    ]) expect(await codeOf(ins(url, key)), `${url} ${key}`).toBe('23514')
    for (const url of ['https://www.youtube.com/watch?v=AkX6uA4BaDs', 'https://www.youtube.com/shorts/AkX6uA4BaDs']) {
      expect(await ins(url, K), url).toHaveLength(1)
      await admin(`delete from recipe.inbox`)
    }
  })
  it('앱의 normalizeRecipeUrl이 만든 주소·열쇠는 그대로 들어간다', async () => {
    for (const input of ['https://youtu.be/AkX6uA4BaDs?si=abc', 'https://m.youtube.com/watch?v=AkX6uA4BaDs&t=30s', 'youtube.com/shorts/FgKy9Xq4LKY/']) {
      const n = normalizeRecipeUrl(input)!
      expect(await as(A, `insert into recipe.inbox (household_id, url, source_key) values ($1, $2, $3) returning id`, [hhAB, n.url, n.key]), input).toHaveLength(1)
      await admin(`delete from recipe.inbox`)
    }
  })
  it('레시피의 출처 열쇠는 유튜브만, 출처 주소는 비었거나 정규 주소(23514)', async () => {
    const ins = (key: string, url: string | null) =>
      admin(`insert into recipe.recipes (household_id, title, source_kind, source_key, source_url, cuisine)
        values ($1, 't', 'youtube', $2, $3, '한식') returning id`, [hhAB, key, url])
    const K = 'youtube:AkX6uA4BaDs'
    expect(await codeOf(ins('web:x', null))).toBe('23514')
    expect(await codeOf(ins('youtube:short', null))).toBe('23514')
    for (const url of ['https://youtu.be/AkX6uA4BaDs', 'https://www.youtube.com/redirect?q=https://evil.com&v=AkX6uA4BaDs',
      'https://www.youtube.com/watch?v=BkX6uA4BaDs', 'http://www.youtube.com/watch?v=AkX6uA4BaDs',
      'https://www.youtube.com/watch?v=AkX6uA4BaDs&t=30s', 'https://evil.com/watch?v=AkX6uA4BaDs']) {
      expect(await codeOf(ins(K, url)), url).toBe('23514')
    }
    expect(await ins(K, 'https://www.youtube.com/watch?v=AkX6uA4BaDs')).toHaveLength(1)
    expect(await ins('youtube:FgKy9Xq4LKY', 'https://www.youtube.com/shorts/FgKy9Xq4LKY')).toHaveLength(1)
    expect(await ins('youtube:shorts00001', null)).toHaveLength(1)
  })
  it('http 주소와 꼴이 틀린 출처 열쇠는 거절', async () => {
    expect(await codeOf(as(A, `insert into recipe.inbox (household_id, url, source_key) values ($1, 'http://www.youtube.com/watch?v=x1_________', 'youtube:x1_________')`, [hhAB]))).toBe('23514')
    expect(await codeOf(as(A, `insert into recipe.inbox (household_id, url, source_key) values ($1, 'https://www.youtube.com/watch?v=x1_________', 'x1')`, [hhAB]))).toBe('23514')
  })
  it('앱 사용자는 대기 줄의 상태를 바꿀 수 없고, 지울 수는 있다', async () => {
    const j = await seedJob(hhAB, A, 'youtube:c1_________', T0)
    expect(await codeOf(as(A, `update recipe.inbox set state = 'done' where id = $1`, [j]))).toBe('42501')
    expect(await codeOf(as(A, `update recipe.inbox set attempts = 0, retry_at = null where id = $1`, [j]))).toBe('42501')
    expect(await as(B, `delete from recipe.inbox where id = $1 returning id`, [j])).toEqual([{ id: j }])
  })
})

describe('일 받기 (서비스 롤만)', () => {
  it('앱 사용자는 처리기 함수를 부를 수 없다(42501)', async () => {
    const j = await seedJob(hhAB, A, 'youtube:d1_________', T0)
    expect(await codeOf(as(A, `select * from recipe.claim_job(now())`))).toBe('42501')
    expect(await codeOf(as(A, `select recipe.job_progress($1, '저장 중', now())`, [j]))).toBe('42501')
    expect(await codeOf(as(A, `select recipe.job_release($1, now())`, [j]))).toBe('42501')
    expect(await codeOf(as(A, `select recipe.job_fail($1, 'x')`, [j]))).toBe('42501')
    expect(await codeOf(as(null, `select * from recipe.claim_job(now())`))).toBe('42501')
    expect((await job(j)).state).toBe('waiting')
  })
  it('가장 오래된 대기 줄 하나를 processing으로 바꾸고 attempts를 1 올린다', async () => {
    const late = await seedJob(hhAB, A, 'youtube:e2_________', at(-1))
    const early = await seedJob(hhC, C, 'youtube:e1_________', at(-5))
    const [first] = await claim(T0)
    expect(first).toEqual({ id: early, state: 'processing', attempts: 1 })
    const j = await job(early)
    expect(new Date(j.claimed_at as string).toISOString()).toBe(new Date(T0).toISOString())
    expect(new Date(j.heartbeat_at as string).toISOString()).toBe(new Date(T0).toISOString())
    expect((await job(late)).state).toBe('waiting')
    expect((await claim(T0)).map((r) => r.id)).toEqual([late])
    expect(await claim(T0)).toEqual([])
  })
  it('진행 알림이 3분 넘게 끊긴 processing 줄은 다시 내준다', async () => {
    const j = await seedJob(hhAB, A, 'youtube:f1_________', at(-10))
    expect((await claim(T0)).map((r) => r.id)).toEqual([j])
    expect(await claim(at(2))).toEqual([])
    expect(await svc(`select recipe.job_progress($1, '자막 받는 중', $2) as ok`, [j, at(2)])).toEqual([{ ok: true }])
    expect((await job(j)).stage).toBe('자막 받는 중')
    expect(await claim(at(4))).toEqual([]) // 마지막 알림(2분)에서 2분
    expect(await claim(at(5))).toEqual([]) // 딱 3분은 아직
    expect(await claim(at(5, 1))).toEqual([{ id: j, state: 'processing', attempts: 2 }])
    expect((await job(j)).stage).toBeNull()
  })
  it('attempts = 3인 줄은 내주지 않고 failed로 바꾼다', async () => {
    const stale = await seedJob(hhAB, A, 'youtube:g1_________', at(-30), { state: 'processing', attempts: 3, claimed_at: at(-20), heartbeat_at: at(-10) })
    const waiting = await seedJob(hhAB, A, 'youtube:g2_________', at(-30), { attempts: 3 })
    const busy = await seedJob(hhAB, A, 'youtube:g3_________', at(-30), { state: 'processing', attempts: 3, claimed_at: at(-1), heartbeat_at: at(-1) })
    expect(await claim(T0)).toEqual([])
    for (const id of [stale, waiting]) {
      const r = await job(id)
      expect(r.state).toBe('failed')
      expect(r.fail_reason).toBeTruthy()
    }
    expect((await job(busy)).state).toBe('processing') // 아직 진행 알림이 오는 줄은 그대로
  })
  it('세 번 끊기면 네 번째에는 failed', async () => {
    const j = await seedJob(hhAB, A, 'youtube:h1_________', at(-1))
    expect((await claim(at(0))).map((r) => r.attempts)).toEqual([1])
    expect((await claim(at(4))).map((r) => r.attempts)).toEqual([2])
    expect((await claim(at(8))).map((r) => r.attempts)).toEqual([3])
    expect(await claim(at(12))).toEqual([])
    expect((await job(j)).state).toBe('failed')
  })
  it('job_release는 waiting·retry_at = t로 돌리고 attempts를 1 줄인다(0 밑으로는 안 감)', async () => {
    const j = await seedJob(hhAB, A, 'youtube:i1_________', at(-1))
    await claim(T0)
    expect(await svc(`select recipe.job_release($1, $2) as ok`, [j, at(30)])).toEqual([{ ok: true }])
    const r = await job(j)
    expect(r.state).toBe('waiting')
    expect(r.attempts).toBe(0)
    expect(new Date(r.retry_at as string).toISOString()).toBe(at(30))
    // 끝난 줄을 다시 놓으면 아무것도 안 바뀐다
    await admin(`update recipe.inbox set state = 'done' where id = $1`, [j])
    expect(await svc(`select recipe.job_release($1, $2) as ok`, [j, at(30)])).toEqual([{ ok: false }])
    expect((await job(j)).state).toBe('done')
  })
  it('retry_at이 미래인 줄은 내주지 않고, 그 시각이 되면 내준다', async () => {
    const j = await seedJob(hhAB, A, 'youtube:j1_________', at(-10))
    await claim(T0)
    await svc(`select recipe.job_release($1, $2)`, [j, at(30)])
    expect(await claim(at(29))).toEqual([])
    expect(await claim(at(30))).toEqual([{ id: j, state: 'processing', attempts: 1 }])
    expect((await job(j)).retry_at).toBeNull()
  })
  it('진행 단계는 정한 일곱 글만 받는다', async () => {
    const j = await seedJob(hhAB, A, 'youtube:k1_________', at(-1))
    await claim(T0)
    for (const s of STAGES) expect(await svc(`select recipe.job_progress($1, $2, $3) as ok`, [j, s, T0]), s).toEqual([{ ok: true }])
    expect(await codeOf(svc(`select recipe.job_progress($1, '분석 중', $2)`, [j, T0]))).toBe('23514')
  })
  it('job_progress는 처리 중인 줄에만 먹는다', async () => {
    const j = await seedJob(hhAB, A, 'youtube:k2_________', at(-1))
    expect(await svc(`select recipe.job_progress($1, '저장 중', $2) as ok`, [j, T0])).toEqual([{ ok: false }])
    expect((await job(j)).stage).toBeNull()
  })
  it('job_fail은 failed와 까닭(200자까지)을 남긴다', async () => {
    const j = await seedJob(hhAB, A, 'youtube:l1_________', at(-1))
    await claim(T0)
    await svc(`select recipe.job_progress($1, '자막 받는 중', $2)`, [j, T0])
    expect(await svc(`select recipe.job_fail($1, $2) as ok`, [j, '가'.repeat(300)])).toEqual([{ ok: true }])
    const r = await job(j)
    expect(r.state).toBe('failed')
    expect(r.stage).toBeNull()
    expect((r.fail_reason as string).length).toBe(200)
  })
  it('시각을 비우고 부르면 오류(22004)이고 아무것도 바뀌지 않는다', async () => {
    const j = await seedJob(hhAB, A, 'youtube:nul1_______', at(-1))
    expect(await codeOf(svc(`select * from recipe.claim_job(null)`))).toBe('22004')
    expect((await job(j)).state).toBe('waiting')
    await claim(T0)
    expect(await codeOf(svc(`select recipe.job_progress($1, '자막 받는 중', null)`, [j]))).toBe('22004')
    expect(await codeOf(svc(`select recipe.job_release($1, null)`, [j]))).toBe('22004')
    expect(await job(j)).toMatchObject({ state: 'processing', stage: null, attempts: 1 })
    expect(new Date((await job(j)).heartbeat_at as string).toISOString()).toBe(new Date(T0).toISOString())
  })
  it('진행 알림 시각이 빈 processing 줄은 가져간 시각으로 끊김을 잰다', async () => {
    const old = await seedJob(hhAB, A, 'youtube:nul2_______', at(-30), { state: 'processing', attempts: 1, claimed_at: at(-4), heartbeat_at: null })
    const fresh = await seedJob(hhAB, A, 'youtube:nul3_______', at(-30), { state: 'processing', attempts: 1, claimed_at: at(-2), heartbeat_at: null })
    expect(await claim(T0)).toEqual([{ id: old, state: 'processing', attempts: 2 }])
    expect(await claim(T0)).toEqual([])
    expect((await job(fresh)).state).toBe('processing')
    // 둘 다 빈 줄은 영영 멈추지 않게 바로 다시 내준다
    await admin(`update recipe.inbox set claimed_at = null where id = $1`, [fresh])
    expect(await claim(T0)).toEqual([{ id: fresh, state: 'processing', attempts: 2 }])
  })
  it('처리기 함수는 security definer, search_path 비움, claim_job은 skip locked', async () => {
    // PGlite는 연결이 하나라 두 처리기의 동시 실행은 시험하지 못한다. 대신 정의를 고정한다.
    const rows = await admin<{ proname: string; prosecdef: boolean; proconfig: string[]; def: string }>(
      `select p.proname, p.prosecdef, p.proconfig, pg_get_functiondef(p.oid) as def
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'recipe' and p.proname in ('claim_job', 'job_progress', 'job_release', 'job_fail', 'retry_job')
        order by p.proname`,
    )
    expect(rows.map((r) => r.proname)).toEqual(['claim_job', 'job_fail', 'job_progress', 'job_release', 'retry_job'])
    for (const r of rows) {
      expect(r.prosecdef, r.proname).toBe(true)
      expect(r.proconfig, r.proname).toEqual(['search_path=""'])
    }
    expect(rows.find((r) => r.proname === 'claim_job')!.def).toMatch(/for update skip locked/i)
  })
})

describe('다시 하기 (구성원)', () => {
  it('구성원은 실패한 일을 다시 대기로 돌리고, 그 뒤 claim_job이 내준다', async () => {
    const j = await seedJob(hhAB, A, 'youtube:m1_________', at(-1))
    await claim(T0)
    await svc(`select recipe.job_fail($1, '영상이 너무 길어요')`, [j])
    expect(await as(B, `select recipe.retry_job($1) as ok`, [j])).toEqual([{ ok: true }])
    const r = await job(j)
    expect(r).toMatchObject({ state: 'waiting', attempts: 0, retry_at: null, fail_reason: null, stage: null })
    expect(await claim(at(1))).toEqual([{ id: j, state: 'processing', attempts: 1 }])
  })
  it('미래로 미룬 대기 줄도 바로 다시 할 수 있다', async () => {
    const j = await seedJob(hhAB, A, 'youtube:m2_________', at(-1), { retry_at: new Date(Date.now() + 3_600_000).toISOString(), attempts: 1 })
    expect(await as(A, `select recipe.retry_job($1) as ok`, [j])).toEqual([{ ok: true }])
    expect(await job(j)).toMatchObject({ state: 'waiting', attempts: 0, retry_at: null })
  })
  it('다른 가구 사용자는 다시 할 수 없다', async () => {
    const j = await seedJob(hhAB, A, 'youtube:m3_________', at(-1), { state: 'failed', fail_reason: 'x' })
    expect(await codeOf(as(C, `select recipe.retry_job($1)`, [j]))).toBe('P0002')
    expect(await codeOf(as(D, `select recipe.retry_job($1)`, [j]))).toBe('P0002')
    expect(await codeOf(as(null, `select recipe.retry_job($1)`, [j]))).toBe('42501')
    expect((await job(j)).state).toBe('failed')
  })
  it('처리 중이거나 끝난 일은 건드리지 않는다', async () => {
    const p = await seedJob(hhAB, A, 'youtube:m4_________', at(-1), { state: 'processing', attempts: 1, claimed_at: T0, heartbeat_at: T0 })
    const d = await seedJob(hhAB, A, 'youtube:m5_________', at(-1), { state: 'done' })
    expect(await as(A, `select recipe.retry_job($1) as ok`, [p])).toEqual([{ ok: false }])
    expect(await as(A, `select recipe.retry_job($1) as ok`, [d])).toEqual([{ ok: false }])
    expect((await job(p)).state).toBe('processing')
    expect((await job(d)).state).toBe('done')
  })
})

describe('레시피 칸과 권한', () => {
  it('review_items에 둘 넣으면 review_count 2, 고치면 다시 센다', async () => {
    const r = await seedRecipe(hhAB, A)
    const item = { target: 'ingredients.1.amount', reason: '설명란과 말이 다름', candidates: [] }
    await as(A, `update recipe.recipes set review_items = $2 where id = $1`, [r, JSON.stringify([item, item])])
    expect(await as(B, `select review_count from recipe.recipes`)).toEqual([{ review_count: 2 }])
    await as(B, `update recipe.recipes set review_items = $2 where id = $1`, [r, JSON.stringify([item])])
    expect(await as(A, `select review_count from recipe.recipes`)).toEqual([{ review_count: 1 }])
    // 넣을 때도 센다
    const [{ review_count }] = await admin<{ review_count: number }>(
      `insert into recipe.recipes (household_id, title, source_kind, source_key, cuisine, review_items)
       values ($1, 't', 'youtube', 'youtube:n2_________', '기타', $2) returning review_count`,
      [hhAB, JSON.stringify([item, item, item])],
    )
    expect(review_count).toBe(3)
    expect(await codeOf(as(A, `update recipe.recipes set review_count = 0 where id = $1`, [r]))).toBe('42501')
    expect(await codeOf(as(A, `update recipe.recipes set review_items = '{}' where id = $1`, [r]))).toBe('23514')
  })
  it('숫자 분량이 있는 재료는 출처가 editor일 수 없고, 덧붙인 분량을 같이 둘 수 없다(23514)', async () => {
    const r = await seedRecipe(hhAB, A)
    const ins = (pos: number, cols: string, vals: string) =>
      as(A, `insert into recipe.ingredients (recipe_id, household_id, position, name, ${cols}) values ($1, $2, ${pos}, '소금', ${vals})`, [r, hhAB])
    expect(await codeOf(ins(2, 'amount, unit, origin', `1, '큰술', 'editor'`))).toBe('23514')
    expect(await codeOf(ins(2, 'amount, unit, origin, suggested_amount', `1, '큰술', 'description', 2`))).toBe('23514')
    expect(await codeOf(ins(2, 'amount, unit, origin, suggested_unit', `1, '큰술', 'description', '작은술'`))).toBe('23514')
    expect(await codeOf(ins(2, 'origin', `'secondary'`))).toBe('23514') // 첫 판에서 안 쓰는 출처
    await ins(2, 'amount_text, origin, suggested_amount, suggested_unit', `'약간', 'editor', 0.5, '작은술'`)
    await ins(3, 'amount, unit, origin, at_seconds', `1, '큰술', 'asr', 242`)
    expect(await codeOf(as(A, `update recipe.ingredients set origin = 'editor' where position = 3`))).toBe('23514')
    expect(await codeOf(as(A, `update recipe.ingredients set suggested_amount = 2 where position = 3`))).toBe('23514')
  })
  it('출처 인분에는 출처가 있어야 하고 editor일 수 없으며, 덧붙인 인분과 같이 둘 수 없다', async () => {
    const r = await seedRecipe(hhAB, A)
    const set = (cols: string) => admin(`update recipe.recipes set ${cols} where id = $1`, [r])
    expect(await codeOf(set(`servings = 2`))).toBe('23514')
    expect(await codeOf(set(`servings = 2, servings_origin = 'editor'`))).toBe('23514')
    expect(await codeOf(set(`servings_origin = 'description'`))).toBe('23514')
    expect(await codeOf(set(`servings = 2, servings_origin = 'description', servings_suggested = 3`))).toBe('23514')
    await set(`servings = 2, servings_origin = 'description'`)
    await set(`servings = null, servings_origin = null, servings_suggested = 2`)
  })
  it('editor 단계에는 타이머(출처 숫자)를 둘 수 없다', async () => {
    const r = await seedRecipe(hhAB, A)
    const ins = (timer: number | null) =>
      as(A, `insert into recipe.steps (recipe_id, household_id, position, title, body, origin, timer_seconds) values ($1, $2, 2, '뜸', '뜸 들인다', 'editor', $3)`, [r, hhAB, timer])
    expect(await codeOf(ins(60))).toBe('23514')
    await ins(null)
  })
  it('분류 낱말은 계약 v2와 같다', async () => {
    const r = await seedRecipe(hhAB, A)
    const upd = (sql: string, v: unknown) => as(A, `update recipe.recipes set ${sql} where id = $1`, [r, v])
    for (const v of CUISINES) await upd('cuisine = $2', v)
    for (const v of DIFFICULTIES) await upd('difficulty = $2', v)
    for (const v of MEASURING_TOOLS) await upd('measuring_tool = $2', v)
    for (const v of MAINS) await upd('mains = $2', [v])
    for (const v of METHODS) await upd('methods = $2', [v])
    for (const v of OCCASIONS) await upd('occasions = $2', [v])
    expect(await codeOf(upd('cuisine = $2', '퓨전'))).toBe('23514')
    expect(await codeOf(upd('difficulty = $2', '매우 쉬움'))).toBe('23514')
    expect(await codeOf(upd('measuring_tool = $2', '저울'))).toBe('23514')
    expect(await codeOf(upd('mains = $2', ['돼지고기', '라면']))).toBe('23514')
    expect(await codeOf(upd('methods = $2', ['볶음', '구이', '조림', '찜']))).toBe('23514') // 계약은 셋까지
  })
  it('status는 review·saved·archived, 새 레시피는 review', async () => {
    const r = await seedRecipe(hhAB, A)
    expect((await admin(`select status from recipe.recipes where id = $1`, [r]))[0].status).toBe('review')
    await as(A, `update recipe.recipes set status = 'saved' where id = $1`, [r])
    await as(A, `update recipe.recipes set status = 'archived' where id = $1`, [r])
    expect(await codeOf(as(A, `update recipe.recipes set status = 'draft' where id = $1`, [r]))).toBe('23514')
  })
  it('앱이 고치는 칸만 고칠 수 있고, 레시피를 넣거나 지우지는 못한다', async () => {
    const r = await seedRecipe(hhAB, A)
    await as(A, `update recipe.recipes set status = 'saved', title = '바싹 제육', summary = '센 불 제육', servings = null,
      servings_origin = null, servings_basis = '돼지고기 500g', servings_suggested = 2, cuisine = '한식',
      mains = '{돼지고기}', main_details = '{돼지 앞다리살}', methods = '{볶음}', occasions = '{반찬}', principles = '[]',
      conflicts = '[]', difficulty = '보통', difficulty_basis = '{"required": 14, "steps": 12, "heavy": false}',
      measuring_tool = '계량스푼', measuring_tool_basis = '[]', glossary = '[]', corrections = '[]', review_items = '[]',
      memo = '맛있음', rating = 5, favorite = true, updated_at = now() where id = $1`, [r])
    for (const col of [`household_id = '${hhC}'`, `source_key = 'youtube:zz_________'`, `source_url = 'https://www.youtube.com/watch?v=zz_________'`,
      `source_kind = 'web'`, `source_title = 'x'`, `channel = 'x'`, `extraction = '{}'`, `added_by = '${B}'`, `added_at = now()`,
      `review_count = 0`]) {
      expect(await codeOf(as(A, `update recipe.recipes set ${col} where id = $1`, [r])), col).toBe('42501')
    }
    expect(await codeOf(as(A, `insert into recipe.recipes (household_id, title, source_kind, source_key, cuisine) values ($1, 'x', 'manual', 'youtube:manual1____', '기타')`, [hhAB]))).toBe('42501')
    expect(await codeOf(as(A, `delete from recipe.recipes where id = $1`, [r]))).toBe('42501')
  })
  it('구성원은 인분·인분 출처·다른 곳을 고치고, 다른 가구는 0줄', async () => {
    const r = await seedRecipe(hhAB, A)
    const conflicts = [{ about: '고춧가루', chosen: '2큰술', chosen_origin: 'user', other: '1큰술', other_origin: 'description' }]
    expect(await as(C, `update recipe.recipes set servings = 2, servings_origin = 'user', conflicts = $2 where id = $1 returning id`, [r, JSON.stringify(conflicts)])).toEqual([])
    expect(await as(B, `update recipe.recipes set servings = 2, servings_origin = 'user', servings_basis = '영상 0:30', conflicts = $2
      where id = $1 returning servings::float as servings, servings_origin, conflicts`, [r, JSON.stringify(conflicts)]))
      .toEqual([{ servings: 2, servings_origin: 'user', conflicts }])
    expect(await as(A, `select servings::float as servings from recipe.recipes`)).toEqual([{ servings: 2 }])
  })
  it('재료·단계는 내용 칸을 고치고 넣고 지우지만, 소속은 못 바꾼다', async () => {
    const r = await seedRecipe(hhAB, A)
    const other = await seedRecipe(hhAB, A, 'youtube:other1_____')
    // ingredient_key는 사전(recipe.ingredient_dict)에 있는 열쇠여야 한다(20261122020000_recipe_pantry.sql)
    await admin(`insert into recipe.ingredient_dict (id, name, category) values ('pork_shoulder', '앞다리살', '육류') on conflict do nothing`)
    await as(B, `update recipe.ingredients set position = 2, section = '양념', name = '앞다리살', amount = 600, unit = 'g', amount_text = '600g',
      note = '한 근', optional = false, origin = 'user', at_seconds = null, suggested_amount = null, suggested_unit = null,
      ingredient_key = 'pork_shoulder', needs_review = true where recipe_id = $1`, [r])
    await as(B, `update recipe.steps set position = 2, title = '볶기', body = '볶는다', heat = '센 불', cue = '노릇해지면', cue_origin = 'user',
      editor_tip = '팬을 달군다', timer_seconds = 60, video_start_seconds = 10, uses = '[]', origin = 'user', needs_review = false where recipe_id = $1`, [r])
    for (const t of ['ingredients', 'steps']) {
      expect(await codeOf(as(B, `update recipe.${t} set recipe_id = $2 where recipe_id = $1`, [r, other])), t).toBe('42501')
      expect(await codeOf(as(B, `update recipe.${t} set household_id = $2 where recipe_id = $1`, [r, hhC])), t).toBe('42501')
      expect(await as(B, `delete from recipe.${t} where recipe_id = $1 returning position`, [r]), t).toEqual([{ position: 2 }])
    }
  })
})

describe('updated_at', () => {
  // 트리거가 updated_at을 덮어쓰므로, 시험 준비로 옛 시각을 넣을 때는 트리거를 끄고 넣는다
  const backdate = async (r: string) => {
    await admin(`set session_replication_role = replica`)
    await admin(`update recipe.recipes set updated_at = '2000-01-01T00:00:00Z' where id = $1`, [r])
    await admin(`set session_replication_role = origin`)
  }
  const touched = async (r: string) =>
    (await admin<{ ok: boolean }>(`select updated_at > '2000-01-02'::timestamptz as ok from recipe.recipes where id = $1`, [r]))[0].ok

  it('레시피를 고치면 updated_at이 지금으로 바뀐다(보낸 값이 옛 시각이어도)', async () => {
    const r = await seedRecipe(hhAB, A)
    await backdate(r)
    expect(await touched(r)).toBe(false)
    await as(A, `update recipe.recipes set memo = '맛있음' where id = $1`, [r])
    expect(await touched(r)).toBe(true)
    await backdate(r)
    await as(A, `update recipe.recipes set favorite = true, updated_at = '2000-01-01' where id = $1`, [r])
    expect(await touched(r)).toBe(true)
  })
  it('재료·단계를 넣고 고치고 지우면 그 레시피의 updated_at이 바뀐다', async () => {
    const r = await seedRecipe(hhAB, A)
    const other = await seedRecipe(hhAB, A, 'youtube:other2_____')
    const steps: Array<[string, string]> = [
      ['재료 고치기', `update recipe.ingredients set name = '앞다리살' where recipe_id = $1`],
      ['재료 넣기', `insert into recipe.ingredients (recipe_id, household_id, position, name, origin) values ($1, '${hhAB}', 5, '깻잎', 'user')`],
      ['재료 지우기', `delete from recipe.ingredients where recipe_id = $1 and position = 5`],
      ['단계 고치기', `update recipe.steps set body = '볶는다.' where recipe_id = $1`],
      ['단계 넣기', `insert into recipe.steps (recipe_id, household_id, position, title, body, origin) values ($1, '${hhAB}', 5, '담기', '접시에 담는다', 'user')`],
      ['단계 지우기', `delete from recipe.steps where recipe_id = $1 and position = 5`],
    ]
    for (const [name, sql] of steps) {
      await backdate(r)
      await backdate(other)
      await as(A, sql, [r])
      expect(await touched(r), name).toBe(true)
      expect(await touched(other), name).toBe(false) // 다른 레시피는 그대로
    }
  })
  it('레시피를 지우면 재료·단계·보관 기록도 함께 지워진다', async () => {
    const r = await seedRecipe(hhAB, A)
    await svc(`insert into recipe.exports (recipe_id, household_id, drive_doc_id, exported_at) values ($1, $2, 'doc1', now())`, [r, hhAB])
    await admin(`delete from recipe.recipes where id = $1`, [r])
    for (const t of ['ingredients', 'steps', 'exports']) expect(await admin(`select 1 from recipe.${t}`), t).toEqual([])
  })
})

describe('처리기 상태와 보관 기록', () => {
  it('처리기 상태는 한 줄이고, 가구 구성원은 읽기만, 서비스 롤이 쓴다', async () => {
    await svc(`update recipe.worker_status set last_seen_at = $1, version = 'abc123'`, [T0])
    expect(await as(A, `select id, version from recipe.worker_status`)).toEqual([{ id: 1, version: 'abc123' }])
    expect(await as(C, `select id from recipe.worker_status`)).toEqual([{ id: 1 }])
    expect(await as(D, `select id from recipe.worker_status`)).toEqual([]) // 가구가 없는 사용자
    expect(await codeOf(as(A, `update recipe.worker_status set version = 'x'`))).toBe('42501')
    expect(await codeOf(svc(`insert into recipe.worker_status (id) values (2)`))).toBe('23514')
  })
  it('보관 기록은 자기 가구만 읽고, 앱은 쓰지 못한다', async () => {
    const r = await seedRecipe(hhAB, A)
    await svc(`insert into recipe.exports (recipe_id, household_id, drive_doc_id, drive_path, obsidian_path, exported_at)
      values ($1, $2, 'doc1', '레시피/한식/돼지고기/볶음/보통/제육.md', '레시피/한식/제육.md', now())`, [r, hhAB])
    expect(await as(B, `select drive_doc_id from recipe.exports`)).toEqual([{ drive_doc_id: 'doc1' }])
    expect(await as(C, `select * from recipe.exports`)).toEqual([])
    expect(await codeOf(as(A, `update recipe.exports set drive_doc_id = 'x'`))).toBe('42501')
    expect(await codeOf(as(A, `delete from recipe.exports`))).toBe('42501')
    // 다른 가구의 레시피를 가리킬 수 없다
    const rc = await seedRecipe(hhC, C, 'youtube:cc1________')
    expect(await codeOf(svc(`insert into recipe.exports (recipe_id, household_id, exported_at) values ($1, $2, now())`, [rc, hhAB]))).toBe('23503')
  })
  it('대기 줄의 recipe_id는 같은 가구의 레시피만', async () => {
    const rc = await seedRecipe(hhC, C, 'youtube:cc2________')
    const j = await seedJob(hhAB, A, 'youtube:cc2________', T0)
    expect(await codeOf(svc(`update recipe.inbox set recipe_id = $2 where id = $1`, [j, rc]))).toBe('23503')
  })
  it('inbox·recipes·worker_status가 실시간 publication에 들어 있다', async () => {
    const rows = await admin<{ tablename: string }>(
      `select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'recipe' order by tablename`,
    )
    expect(rows.map((r) => r.tablename)).toEqual(expect.arrayContaining(['inbox', 'recipes', 'worker_status']))
  })
})

describe('가계부 삭제를 막지 않는다', () => {
  const TABLES = ['recipes', 'ingredients', 'steps', 'inbox', 'exports']
  it('구성원을 지우면 담은 레시피·대기 줄은 남고 이름만 빠지며, 가구를 지우면 모두 지워진다', async () => {
    const [{ id: hh }] = await admin<{ id: string }>(`insert into public.households default values returning id`)
    await admin(`insert into public.members (household_id, user_id, display_name, role) values ($1, $2, 'D', 'owner')`, [hh, D])
    const r = await seedRecipe(hh, D, 'youtube:dd1________')
    await svc(`insert into recipe.exports (recipe_id, household_id, drive_doc_id) values ($1, $2, 'doc1')`, [r, hh])
    await seedJob(hh, D, 'youtube:dd1________', at(-2), { state: 'done', recipe_id: r })
    await seedJob(hh, D, 'youtube:dd2________', at(-1))

    await admin(`delete from public.members where household_id = $1 and user_id = $2`, [hh, D])
    expect(await admin(`select added_by from recipe.recipes where household_id = $1`, [hh])).toEqual([{ added_by: null }])
    expect(await admin(`select added_by, recipe_id from recipe.inbox where household_id = $1 order by added_at`, [hh]))
      .toEqual([{ added_by: null, recipe_id: r }, { added_by: null, recipe_id: null }])

    // 대기 줄은 가구 삭제(cascade)와 레시피 삭제(recipe_id set null) 두 길로 닿는다
    await admin(`delete from public.households where id = $1`, [hh])
    for (const t of TABLES) expect(await admin(`select 1 from recipe.${t} where household_id = $1`, [hh]), t).toEqual([])
  })
  it('레시피를 지우면 그 레시피를 만든 대기 줄은 남고 recipe_id만 빠진다', async () => {
    const r = await seedRecipe(hhAB, A, 'youtube:dd3________')
    const j = await seedJob(hhAB, A, 'youtube:dd3________', T0, { state: 'done', recipe_id: r })
    await admin(`delete from recipe.recipes where id = $1`, [r])
    expect(await admin(`select state, recipe_id from recipe.inbox where id = $1`, [j])).toEqual([{ state: 'done', recipe_id: null }])
  })
})
