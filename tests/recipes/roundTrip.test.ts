// 처리기가 만든 확인 후보·고친 곳을 앱이 그대로 처리할 수 있는지 끝에서 끝까지 본다(검토 C1·I1).
// 실제 파이프라인(V1 checkRecipe, V2·V3 resolveDiffs, V4)을 가짜 모델로 돌리고 → PGlite의 import_recipe로 넣고 →
// 앱 저장소로 확인 항목을 모두 처리하고 고친 곳을 모두 되돌린다. 저장소가 낸 갱신은 실제 표에 구성원으로 적용해
// check 제약과 칸 권한을 지키는지도 본다. 근거·레시피는 모두 만든 자료다(공개 저장소라 실제 자막을 넣지 않는다).
import type { PGlite } from '@electric-sql/pglite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { difficulty } from '../../supabase/functions/_shared/recipeClassify'
import type { ReviewItem } from '../../supabase/functions/_shared/recipeContract'
import { parseAmountValue, parseSecondsValue, parseServingsValue } from '../../supabase/functions/_shared/recipeValue'
import { correctionRows } from '../../src/recipes/lib/detail'
import { createRecipeStore, parseTarget } from '../../src/recipes/lib/store'
import type { WorkerConfig } from '../../tools/recipe-worker/src/config'
import type { Evidence } from '../../tools/recipe-worker/src/evidence'
import { processJob } from '../../tools/recipe-worker/src/pipeline'
import { freshDb } from '../grocery/dbSetup'
import { fakeClient, type Call } from './fakeClient'

const A = '00000000-0000-4000-8000-00000000000a'
const KEY = 'youtube:AkX6uA4BaDs'
const URL_ = 'https://www.youtube.com/watch?v=AkX6uA4BaDs'
type Row = Record<string, unknown>
let db: PGlite
let hh: string
let cacheDir = ''

async function asRole<T = Row>(role: 'authenticated' | 'service_role', sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec('reset role')
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [role === 'authenticated' ? A : ''])
  await db.exec(`set role ${role}`)
  try { return (await db.query<T>(sql, params)).rows } finally { await db.exec('reset role') }
}
const admin = async <T = Row>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows

const evidence = (): Evidence => ({
  meta: {
    id: 'AkX6uA4BaDs', title: '시험 영상', channel: '시험 채널', uploadDate: null, duration: 300,
    description: '[재료] 2인분\n돼지고기 500g\n간장 2큰술\n설탕 2T\n참기름 1스푼', chapters: [],
  },
  transcript: {
    kind: 'caption_auto',
    segments: [
      { start: 40, text: '양파 하나를 썰어요' },
      { start: 60, text: '고춧가루 1큰술 넣고' },
      { start: 120, text: '센 불에서 3분 볶다가 노릇해질 때까지 볶아요' },
    ],
  },
  ocr: [{ t: 80, text: '고춧가루 2큰술' }],
  frames: [{ t: 80, path: '/x/job/f1.jpg' }],
})

// 정리(첫 읽기)가 낸 것: 틀린 숫자(간장 3큰술·4인분·타이머 5분), 근거 없는 계량 도구·용어 출처, 모델의 확인 후보
const organized = {
  contract_version: '2',
  source: { kind: 'youtube', key: KEY, url: URL_, title: '시험 영상', channel: '시험 채널', duration_seconds: 300 },
  title: '고기 볶음',
  servings: { value: 4, origin: 'description' },
  tags: { cuisine: '한식', mains: ['돼지고기'], main_details: ['돼지고기'], methods: ['볶음'], occasions: ['반찬'] },
  ingredients: [
    { name: '돼지고기', amount: 500, unit: 'g', origin: 'description' },
    { name: '간장', amount: 3, unit: '큰술', origin: 'description' },
    { name: '설탕', amount: 2, unit: '큰술', origin: 'description' },
    { name: '고춧가루', amount: 1, unit: '큰술', origin: 'caption_auto', at_seconds: 60 },
    { name: '참기름', amount: 1, unit: '스푼', origin: 'description' },
    { name: '양파', amount: 1, unit: '개', origin: 'caption_auto', at_seconds: 40 },
  ],
  measuring_tool: '밥숟가락',
  measuring_tool_basis: [{ origin: 'screen', at_seconds: 80 }],
  steps: [
    { title: '썰기', body: '양파를 썬다.', origin: 'caption_auto', video_start_seconds: 40, uses: [{ name: '양파' }] },
    {
      title: '볶기', body: '고기와 양념을 넣고 센 불에서 볶는다.', origin: 'caption_auto', video_start_seconds: 120, timer_seconds: 300,
      cue: '색이 변할 때까지', cue_origin: 'caption_auto', needs_review: true,
      uses: [{ name: '돼지고기' }, { name: '간장' }, { name: '설탕' }, { name: '고춧가루' }, { name: '참기름' }],
    },
  ],
  glossary: [{ term: '한소끔', body: '한 번 끓어오를 만큼.', origin: 'caption_auto', at_seconds: 120 }],
  review_items: [
    { target: 'steps[1].cue', reason: '흐리게 들림', candidates: [{ value: '노릇해질 때까지', origin: 'asr', at_seconds: 121 }] },
    { target: 'steps[1].timer_seconds', reason: '흐리게 들림', candidates: [{ value: '3분', origin: 'caption_auto', at_seconds: 120 }, { value: '9분', origin: 'caption_auto', at_seconds: 120 }] },
  ],
  extraction: { levels: ['L0', 'L1', 'L3'], transcript_kind: 'caption_auto', tools: [], extracted_by: 'x', extracted_at: '2026-11-22T00:00:00+09:00' },
}

const fakeRun = vi.fn(async (prompt: string) => {
  if (prompt.includes('재료와 분량만 따로 읽는다')) return JSON.stringify({ ingredients: [{ name: '고춧가루', amount: 2, unit: '큰술', at_seconds: 80 }] })
  if (prompt.includes('어느 쪽이 근거와 맞는지만 고른다')) return '{"choice":"b"}'
  return JSON.stringify({ recipe: organized, dict: [] })
})

beforeAll(async () => {
  cacheDir = mkdtempSync(join(tmpdir(), 'rw-roundtrip-'))
  db = await freshDb([A], async (d) => {
    hh = (await d.query<{ id: string }>(`insert into public.households default values returning id`)).rows[0].id
    await d.query(`insert into public.members (household_id, user_id, display_name, role) values ($1,$2,'A','owner')`, [hh, A])
  })
})
afterAll(async () => {
  await db?.close()
  rmSync(cacheDir, { recursive: true, force: true })
})

/** 저장소가 가짜 클라이언트에 낸 갱신을 실제 표에 구성원으로 적용한다(한 줄씩 먹어야 한다) */
async function applyToDb(calls: Call[], recipeId: string) {
  for (const c of calls.filter((x) => x.op === 'update')) {
    const payload = c.payload as Row
    const keys = Object.keys(payload)
    const isJson = (v: unknown) => typeof v === 'object' && v !== null
    const sets = keys.map((k, i) => `${k} = $${i + 3}${isJson(payload[k]) ? '::jsonb' : ''}`).join(', ')
    const vals = keys.map((k) => (isJson(payload[k]) ? JSON.stringify(payload[k]) : payload[k]))
    const id = c.filters.find(([col]) => col === 'id')?.[2] ?? recipeId
    const rows = await asRole('authenticated', `update ${c.table} set ${sets} where household_id = $1 and id = $2 returning id`, [hh, id, ...vals])
    expect(rows, `${c.table} ${JSON.stringify(payload)}`).toHaveLength(1)
  }
}

describe('처리기 출력 → 등록 → 앱의 확인·되돌리기', () => {
  it('모든 확인 항목을 처리하고 모든 고친 곳을 되돌려도 막히지 않고, 숫자의 출처는 사람이 고른 것으로 남는다', async () => {
    const out = await processJob({ id: 'job1', url: URL_ }, {
      cfg: { cacheDir } as WorkerConfig, run: fakeRun, dict: [], onStage: async () => {}, collect: async () => evidence(),
    })
    const r = out.recipe
    // 처리기가 쓴 값은 모두 한 꼴로 읽힌다
    for (const item of r.review_items ?? []) {
      const t = parseTarget(item.target)
      for (const c of item.candidates) {
        if (t?.kind === 'ingredients' && t.field === 'amount') expect(parseAmountValue(c.value), c.value).not.toBeNull()
        if (t?.kind === 'servings') expect(parseServingsValue(c.value), c.value).not.toBeNull()
        if (t?.kind === 'steps' && t.field === 'timer_seconds') expect(parseSecondsValue(c.value), c.value).not.toBeNull()
      }
    }
    expect((r.corrections ?? []).map((c) => [c.target, c.method])).toEqual(expect.arrayContaining([
      ['ingredients[1].amount', 'rule'], ['servings.value', 'rule'], ['steps[1].timer_seconds', 'rule'], ['glossary[0].origin', 'rule'],
      ['measuring_tool', 'rule'], ['ingredients[3].amount', 'compare'],
    ]))

    // 등록(서버 함수가 부르는 것과 같게 서비스 롤로)
    const [job] = await admin<{ id: string }>(`insert into recipe.inbox (household_id, url, source_key, added_by, state) values ($1,$2,$3,$4,'processing') returning id`, [hh, URL_, KEY, A])
    const d = difficulty(r)
    const [{ id: rid }] = await asRole<{ id: string }>('service_role', `select recipe.import_recipe($1, $2::jsonb, $3, $4::jsonb) as id`, [job.id, JSON.stringify(r), d.level, JSON.stringify(d.basis)])

    // 앱 저장소는 실제 줄을 심은 가짜 클라이언트로 돌리고, 낸 갱신을 실제 표에 적용한다
    const [rec] = await admin(`select * from recipe.recipes where id = $1`, [rid])
    const ings = await admin(`select * from recipe.ingredients where recipe_id = $1 order by position`, [rid])
    const steps = await admin(`select * from recipe.steps where recipe_id = $1 order by position`, [rid])
    const f = fakeClient({ 'recipe.recipes': [rec], 'recipe.ingredients': ings, 'recipe.steps': steps })
    const store = createRecipeStore(f.client, hh, A)
    const step = async (fn: () => Promise<void>) => {
      const from = f.calls.length
      await fn()
      await applyToDb(f.calls.slice(from), rid)
    }

    // 1) 확인 항목을 처음부터 하나씩: 후보가 있으면 첫 후보, 계량 도구는 고르고, 고칠 수 없는 항목은 "확인함", 후보 없는 칸은 직접 입력
    const typed: Record<string, string> = { amount: '2', value: '2', timer_seconds: '180', cue: '노릇하게' }
    for (let guard = 0; guard < 50; guard++) {
      const items = f.tables['recipe.recipes'][0]!.review_items as ReviewItem[]
      if (items.length === 0) break
      const item = items[0]!
      const t = parseTarget(item.target)
      const value = item.target === 'measuring_tool' ? '밥숟가락'
        : t && t.kind !== 'conflicts' && t.field !== 'origin' && t.field !== 'at_seconds' ? (item.candidates[0]?.value ?? typed[t.field] ?? 'x')
        : ''
      await step(() => store.resolveReview(rid, 0, { value, origin: 'user', at_seconds: null }))
    }
    // 2) 되돌릴 수 있는 고친 곳을 모두 되돌린다(화면의 "되돌리기"와 같은 순번)
    for (let guard = 0; guard < 50; guard++) {
      const cur = f.tables['recipe.recipes'][0]!
      const rows = correctionRows((cur.corrections ?? []) as never, { ingredients: ings as never, steps: steps as never, glossary: cur.glossary as never })
      const next = rows.find((x) => x.canRevert)
      if (!next) break
      await step(() => store.revertCorrection(rid, next.index))
    }

    const [final] = await admin<Row>(`select status, review_items, servings::float as servings, servings_origin, measuring_tool, glossary from recipe.recipes where id = $1`, [rid])
    expect(final).toMatchObject({ status: 'saved', review_items: [], servings: 4, servings_origin: 'user', measuring_tool: '밥숟가락' })
    expect((final!.glossary as Row[])[0]).toMatchObject({ origin: 'user', at_seconds: null })
    const fi = await admin<Row>(`select name, amount::float as amount, unit, origin, at_seconds, needs_review from recipe.ingredients where recipe_id = $1 order by position`, [rid])
    // V1이 지운 간장 3큰술, V3가 바꾼 고춧가루 1큰술: 되돌린 값은 사람이 고른 것(user), 영상 시각 없음
    expect(fi[1]).toMatchObject({ name: '간장', amount: 3, unit: '큰술', origin: 'user', at_seconds: null })
    expect(fi[3]).toMatchObject({ name: '고춧가루', amount: 1, unit: '큰술', origin: 'user', at_seconds: null })
    expect(fi.every((g) => g.needs_review === false)).toBe(true)
    const fs = await admin<Row>(`select timer_seconds, origin, cue, cue_origin, needs_review from recipe.steps where recipe_id = $1 order by position`, [rid])
    expect(fs[1]).toMatchObject({ timer_seconds: 300, origin: 'caption_auto', cue: '노릇해질 때까지', cue_origin: 'user', needs_review: false })
  })
})
