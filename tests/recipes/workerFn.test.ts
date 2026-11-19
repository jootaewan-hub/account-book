import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { DbError, STAGES, handle, statusForDbCode, type WorkerDeps } from '../../supabase/functions/recipe-worker/handle'
import { pickExports, toStoredRecipe } from '../../supabase/functions/_shared/recipeStored'
import { parseRecipe } from '../../supabase/functions/_shared/recipeContract'
import { secretMatches } from '../../supabase/functions/_shared/secret'

const gold = JSON.parse(readFileSync('docs/recipes/contract/examples/youtube-AkX6uA4BaDs.json', 'utf8'))
const now = new Date('2026-11-22T03:00:00Z')
const job = '00000000-0000-4000-8000-0000000000aa'
const secret = 'worker-only-secret'

const deps = () => ({
  secret,
  now: () => now,
  claim: vi.fn(async () => ({ id: job, source_key: 'youtube:AkX6uA4BaDs' }) as { id: string; source_key: string } | null),
  progress: vi.fn(async () => true),
  release: vi.fn(async () => {}),
  fail: vi.fn(async () => {}),
  importRecipe: vi.fn<WorkerDeps['importRecipe']>(async () => '00000000-0000-4000-8000-0000000000bb'),
  dictAdd: vi.fn(async () => {}),
  listExports: vi.fn<WorkerDeps['listExports']>(async () => []),
  exported: vi.fn<WorkerDeps['exported']>(async () => true),
  ping: vi.fn(async () => {}),
  dict: vi.fn(async () => [{ id: 'garlic', name: '마늘', aliases: ['다진 마늘'], category: '채소' }]),
}) satisfies WorkerDeps

const call = (d: WorkerDeps, body: unknown, opts: { method?: string; secret?: string | null; raw?: string } = {}) =>
  handle(new Request('https://example.com/recipe-worker', {
    method: opts.method ?? 'POST',
    headers: opts.secret === null ? {} : { 'x-recipe-worker-secret': opts.secret ?? secret },
    body: (opts.method ?? 'POST') === 'GET' ? undefined : opts.raw ?? JSON.stringify(body),
  }), d)

describe('recipe-worker 요청 규칙', () => {
  it('비밀이 없거나 틀리면 401이고 본문을 읽지도 DB를 부르지도 않는다', async () => {
    const d = deps()
    expect((await call(d, { action: 'claim' }, { secret: null })).status).toBe(401)
    expect((await call(d, { action: 'claim' }, { secret: 'wrong' })).status).toBe(401)
    // 본문이 깨져 있어도 비밀부터 본다(400이 아니라 401)
    expect((await call(d, null, { secret: 'wrong', raw: '{not json' })).status).toBe(401)
    expect(d.claim).not.toHaveBeenCalled()
  })

  it('서버 비밀이 비면 맞는 척하는 빈 헤더도 모든 요청이 401', async () => {
    const d = { ...deps(), secret: '' }
    expect((await call(d, { action: 'claim' }, { secret: '' })).status).toBe(401)
    expect((await call(d, { action: 'claim' })).status).toBe(401)
    expect(d.claim).not.toHaveBeenCalled()
  })

  it('POST만 받는다', async () => {
    const d = deps()
    expect((await call(d, {}, { method: 'GET' })).status).toBe(405)
    expect((await call(d, {}, { method: 'PUT' })).status).toBe(405)
  })

  it('1MB를 넘는 본문은 413: 선언된 길이로도 실제 읽은 길이로도 막는다', async () => {
    const d = deps()
    const big = JSON.stringify({ action: 'ping', version: 'x'.repeat(1024 * 1024) })
    expect((await call(d, null, { raw: big })).status).toBe(413)
    // Content-Length가 거짓(작게 선언)이어도 읽는 도중에 끊는다
    const lying = new Request('https://example.com/recipe-worker', {
      method: 'POST', headers: { 'x-recipe-worker-secret': secret, 'content-length': '10' }, body: big,
    })
    expect((await handle(lying, d)).status).toBe(413)
    expect(d.ping).not.toHaveBeenCalled()
  })

  it('모르는 action과 깨진 JSON은 400', async () => {
    const d = deps()
    expect((await call(d, { action: 'nope' })).status).toBe(400)
    expect((await call(d, {})).status).toBe(400)
    expect((await call(d, null, { raw: '{oops' })).status).toBe(400)
    expect((await call(d, null, { raw: '[1]' })).status).toBe(400)
  })

  it('CORS 머리글을 달지 않는다', async () => {
    const res = await call(deps(), { action: 'claim' })
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })
})

describe('recipe-worker 일', () => {
  it('claim: 주소를 source_key로 다시 만들어 준다 / 일이 없으면 null', async () => {
    const d = deps()
    expect(await (await call(d, { action: 'claim' })).json()).toEqual({
      job: { id: job, url: 'https://www.youtube.com/watch?v=AkX6uA4BaDs', source_key: 'youtube:AkX6uA4BaDs' },
    })
    expect(d.claim).toHaveBeenCalledWith(now)
    d.claim.mockResolvedValueOnce(null)
    expect(await (await call(d, { action: 'claim' })).json()).toEqual({ job: null })
  })

  it('progress: 진행 글 일곱 개만 받고, 일이 사라졌으면 ok:false', async () => {
    const d = deps()
    for (const stage of STAGES) {
      expect((await call(d, { action: 'progress', job, stage })).status).toBe(200)
    }
    expect(d.progress).toHaveBeenCalledTimes(7)
    expect(STAGES).toHaveLength(7)
    d.progress.mockClear()
    for (const stage of ['분석 중', 'AI 분석 중…', '', 7, null]) {
      expect((await call(d, { action: 'progress', job, stage })).status).toBe(400)
    }
    expect((await call(d, { action: 'progress', job: 'not-a-uuid', stage: STAGES[0] })).status).toBe(400)
    expect(d.progress).not.toHaveBeenCalled()
    d.progress.mockResolvedValueOnce(false)
    expect(await (await call(d, { action: 'progress', job, stage: STAGES[0] })).json()).toEqual({ ok: false })
  })

  it('submit: 계약에 안 맞으면 422와 errors, DB는 부르지 않는다', async () => {
    const d = deps()
    const g = structuredClone(gold)
    g.tags.cuisine = '이탈리안'
    const res = await call(d, { action: 'submit', job, recipe: g, dict: [{ id: 'x', name: 'x', aliases: [], category: '채소' }] })
    expect(res.status).toBe(422)
    const { errors } = await res.json()
    expect(errors.length).toBeGreaterThan(0)
    expect(d.dictAdd).not.toHaveBeenCalled()
    expect(d.importRecipe).not.toHaveBeenCalled()
  })

  it('submit: 맞으면 난이도(보통)와 근거를 계산해 import를 부른다', async () => {
    const d = deps()
    const res = await call(d, { action: 'submit', job, recipe: gold })
    expect(await res.json()).toEqual({ recipe_id: '00000000-0000-4000-8000-0000000000bb' })
    const parsed = parseRecipe(gold)
    if (!parsed.ok) throw new Error('fixture')
    expect(d.importRecipe).toHaveBeenCalledTimes(1)
    const [j, recipe, level, basis] = d.importRecipe.mock.calls[0]
    expect(j).toBe(job)
    expect(recipe).toEqual(parsed.value)
    expect(level).toBe('보통')
    expect(basis).toEqual({ required: expect.any(Number), steps: gold.steps.length, heavy: expect.any(Boolean) })
    expect(d.dictAdd).not.toHaveBeenCalled()
  })

  it('submit: dict가 있으면 import보다 먼저 dict_add', async () => {
    const d = deps()
    const order: string[] = []
    d.dictAdd.mockImplementation(async () => { order.push('dict') })
    d.importRecipe.mockImplementation(async () => { order.push('import'); return 'id' })
    const dict = [{ id: 'gochugaru', name: '고춧가루', aliases: ['고운 고춧가루'], category: '장·양념·소스' }]
    expect((await call(d, { action: 'submit', job, recipe: gold, dict })).status).toBe(200)
    expect(order).toEqual(['dict', 'import'])
    expect(d.dictAdd).toHaveBeenCalledWith(dict)
  })

  it('submit: 잘못된 dict는 400이고 아무것도 쓰지 않는다', async () => {
    const d = deps()
    const res = await call(d, { action: 'submit', job, recipe: gold, dict: [{ id: 'Bad Id', name: '', aliases: [], category: '채소' }] })
    expect(res.status).toBe(400)
    expect(d.dictAdd).not.toHaveBeenCalled()
    expect(d.importRecipe).not.toHaveBeenCalled()
  })

  it('submit: DB가 거절하면 409에 오류 번호만 싣고 SQL 내용은 싣지 않는다', async () => {
    const d = deps()
    d.importRecipe.mockRejectedValueOnce(new DbError('23514'))
    const res = await call(d, { action: 'submit', job, recipe: gold })
    expect(res.status).toBe(409)
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({ error: '레시피를 등록하지 못했어요.', code: '23514' })
    // DB가 아닌 예상 밖 오류는 본문 없이 500
    d.importRecipe.mockRejectedValueOnce(new Error('connection to 10.0.0.1 refused'))
    const res2 = await call(d, { action: 'submit', job, recipe: gold })
    expect(res2.status).toBe(500)
    expect(await res2.text()).toBe('')
  })

  it('release: retry_at(ISO)가 필수', async () => {
    const d = deps()
    expect((await call(d, { action: 'release', job })).status).toBe(400)
    expect((await call(d, { action: 'release', job, retry_at: 'tomorrow' })).status).toBe(400)
    expect((await call(d, { action: 'release', job, retry_at: '2026-11-22T05:00:00Z' })).status).toBe(200)
    expect(d.release).toHaveBeenCalledWith(job, '2026-11-22T05:00:00.000Z')
  })

  it('fail: 이유는 다듬어 200자까지', async () => {
    const d = deps()
    expect((await call(d, { action: 'fail', job, reason: '  자막이 없어요  ' })).status).toBe(200)
    expect(d.fail).toHaveBeenCalledWith(job, '자막이 없어요')
    for (const reason of ['', '   ', 'a'.repeat(201), undefined, 3]) {
      expect((await call(d, { action: 'fail', job, reason })).status).toBe(400)
    }
    expect((await call(d, { action: 'fail', job, reason: 'a'.repeat(200) })).status).toBe(200)
  })

  it('exports: skip(최대 100개 uuid)·need를 검사해 넘긴다', async () => {
    const d = deps()
    const u = '00000000-0000-4000-8000-0000000000dd'
    expect((await call(d, { action: 'exports', skip: [u], need: ['drive', 'obsidian'] })).status).toBe(200)
    expect(d.listExports).toHaveBeenLastCalledWith({ skip: [u], need: ['drive', 'obsidian'] })
    expect((await call(d, { action: 'exports' })).status).toBe(200)
    expect(d.listExports).toHaveBeenLastCalledWith({ skip: [], need: [] })
    expect((await call(d, { action: 'exports', skip: Array(100).fill(u) })).status).toBe(200)
    for (const body of [{ skip: Array(101).fill(u) }, { skip: ['x'] }, { skip: 'a' }, { need: ['sheet'] }, { need: 'drive' }, { need: ['drive', 'obsidian', 'drive'] }]) {
      expect((await call(d, { action: 'exports', ...body })).status).toBe(400)
    }
  })

  it('pickExports: skip은 saved·archived 모두 빼고, need는 비어 있는 칸이 있는 보관 건을 더 고른다', () => {
    const row = (id: string, doc: string | null, obs: string | null) => ({ recipe_id: id, drive_doc_id: doc, drive_path: null, obsidian_path: obs, exported_at: '2026-11-22T01:00:00Z' })
    const saved = ['a', 'b', 'c'].map((id) => ({ id, updated_at: '2026-11-22T00:00:00Z' }))
    const rows = [row('a', null, 'o'), row('b', 'd', null), row('c', 'd', 'o'), row('gone', 'd', null)]
    const archived = [{ id: 'gone' }]
    expect(pickExports(saved, archived, rows, 10).fill).toEqual([])
    expect(pickExports(saved, archived, rows, 10, { need: ['drive'] }).fill).toEqual(['a'])
    expect(pickExports(saved, archived, rows, 10, { need: ['obsidian'] }).fill).toEqual(['b'])
    expect(pickExports(saved, archived, rows, 10, { need: ['drive', 'obsidian'] }).fill).toEqual(['a', 'b'])
    expect(pickExports(saved, archived, rows, 10, { need: ['drive', 'obsidian'], skip: ['a'] }).fill).toEqual(['b'])
    expect(pickExports(saved, archived, rows, 10, { skip: ['gone'] }).trash).toEqual([])
  })

  it('exports·dict·ping·exported', async () => {
    const d = deps()
    d.listExports.mockResolvedValueOnce([{ recipe_id: 'r', recipe: null, prev: null, trash: true }])
    expect(await (await call(d, { action: 'exports' })).json()).toEqual({ items: [{ recipe_id: 'r', recipe: null, prev: null, trash: true }] })
    expect(await (await call(d, { action: 'dict' })).json()).toEqual({ entries: [{ id: 'garlic', name: '마늘', aliases: ['다진 마늘'], category: '채소' }] })
    expect((await call(d, { action: 'ping', version: '0.1.0' })).status).toBe(200)
    expect(d.ping).toHaveBeenCalledWith('0.1.0', now)
    expect((await call(d, { action: 'ping' })).status).toBe(400)

    const recipe_id = '00000000-0000-4000-8000-0000000000cc'
    const snap = '2026-11-22T01:00:00.123456+00:00'
    const ok = { action: 'exported', snapshot_updated_at: snap, recipe_id, drive_doc_id: 'doc', drive_path: '레시피/한식', obsidian_path: '레시피/한식/a.md' }
    expect((await call(d, ok)).status).toBe(200)
    expect(d.exported).toHaveBeenCalledWith({
      recipe_id, drive_doc_id: 'doc', drive_path: '레시피/한식', obsidian_path: '레시피/한식/a.md', exported_at: snap,
    })
    // 지운 레시피는 처리기가 null을 보내고, 보관 시각은 지금
    d.exported.mockClear()
    expect((await call(d, { action: 'exported', recipe_id, drive_doc_id: null, drive_path: null, obsidian_path: null })).status).toBe(200)
    expect(d.exported.mock.calls[0]?.[0]?.exported_at).toBe(now.toISOString())
    // 사본 시각이 없거나 ISO가 아니면 400
    expect((await call(d, { ...ok, snapshot_updated_at: undefined })).status).toBe(400)
    expect((await call(d, { ...ok, snapshot_updated_at: 'yesterday' })).status).toBe(400)
    expect((await call(d, { ...ok, snapshot_updated_at: '2026-11-22' })).status).toBe(400)
    expect((await call(d, { ...ok, drive_doc_id: 5 })).status).toBe(400)
    expect((await call(d, { ...ok, recipe_id: 'x' })).status).toBe(400)
    d.exported.mockResolvedValueOnce(false)
    expect((await call(d, ok)).status).toBe(404)
  })

  it('DB 오류(예상 밖)는 본문 없이 500', async () => {
    const d = deps()
    d.claim.mockRejectedValueOnce(new Error('relation "recipe.inbox" does not exist'))
    const res = await call(d, { action: 'claim' })
    expect(res.status).toBe(500)
    expect(await res.text()).toBe('')
  })
})

describe('DB 오류 구분', () => {
  it('영구 거절만 409, 번호 없음·PGRST·일시 오류는 500', () => {
    for (const c of ['22023', '23514', 'P0002', '55000']) expect(statusForDbCode(c)).toBe(409)
    for (const c of ['', undefined, 'PGRST106', 'PGRST202', '40001', '40P01', '57014', '42501']) expect(statusForDbCode(c)).toBe(500)
  })

  it('submit: 인프라 오류는 409가 아니라 본문 없는 500', async () => {
    const d = deps()
    for (const code of ['', 'PGRST106', '40001']) {
      d.importRecipe.mockRejectedValueOnce(new DbError(code))
      const res = await call(d, { action: 'submit', job, recipe: gold })
      expect(res.status).toBe(500)
      expect(await res.text()).toBe('')
    }
  })
})

describe('공용 비밀 비교', () => {
  it('같을 때만 참, 비거나 512자를 넘으면 거짓', async () => {
    expect(await secretMatches('abc', 'abc')).toBe(true)
    expect(await secretMatches('abc', 'abd')).toBe(false)
    expect(await secretMatches('', '')).toBe(false)
    expect(await secretMatches('abc', '')).toBe(false)
    expect(await secretMatches('a'.repeat(513), 'a'.repeat(513))).toBe(false)
  })
})

describe('저장된 레시피 되돌리기와 보관 대상 고르기', () => {
  it('열 값을 계약 v2 꼴로 되돌리고 번호 순서로 놓는다', () => {
    const row = {
      id: 'r1', source_kind: 'youtube', source_key: 'youtube:AkX6uA4BaDs', source_url: 'https://www.youtube.com/watch?v=AkX6uA4BaDs',
      source_title: '제목', channel: null, published_on: null, duration_seconds: 793, title: '김치찌개', summary: null,
      servings: '2', servings_origin: 'description', servings_basis: null, servings_suggested: null,
      cuisine: '한식', mains: ['돼지고기'], main_details: ['김치'], methods: ['찌개·전골'], occasions: [], difficulty: '보통',
      difficulty_basis: { required: 5, steps: 2, heavy: false }, measuring_tool: null, measuring_tool_basis: [],
      principles: [], conflicts: [], glossary: [], corrections: [], review_items: [],
      extraction: { levels: ['L1'], transcript_kind: 'none', tools: [], extracted_by: 'x', extracted_at: '2026-11-22T00:00:00+09:00' },
      memo: '맛있음', rating: 5, favorite: true, added_at: '2026-11-22T00:00:00Z', updated_at: '2026-11-22T01:00:00Z',
    }
    const ing = [
      { position: 2, name: '물', amount: null, unit: null, origin: 'editor', optional: false, needs_review: false, section: null },
      { position: 1, name: '김치', amount: '300.000', unit: 'g', origin: 'description', optional: false, needs_review: false, section: null, at_seconds: null },
    ]
    const steps = [
      { position: 2, title: '끓이기', body: '끓인다', origin: 'editor', uses: [], needs_review: false },
      { position: 1, title: '볶기', body: '볶는다', origin: 'description', uses: [{ name: '김치' }], needs_review: false, timer_seconds: 60 },
    ]
    const r = toStoredRecipe(row, ing, steps)
    expect(r.ingredients.map((g) => g.name)).toEqual(['김치', '물'])
    expect(r.ingredients[0].amount).toBe(300)
    expect(r.steps.map((s) => s.title)).toEqual(['볶기', '끓이기'])
    expect(r.servings.value).toBe(2)
    expect(r.tags.difficulty).toBe('보통')
    expect({ memo: r.memo, rating: r.rating, favorite: r.favorite, saved_at: r.saved_at }).toEqual({
      memo: '맛있음', rating: 5, favorite: true, saved_at: '2026-11-22T00:00:00Z',
    })
    // 계약 검사를 통과하는 꼴이다(저장 전용 칸은 계약 밖이라 빼고 본다)
    const { id: _i, difficulty: _d, difficulty_basis: _b, memo: _m, rating: _r, favorite: _f, saved_at: _s, updated_at: _u, ...contract } = r
    const parsed = parseRecipe(contract)
    expect(parsed.ok, parsed.ok ? '' : parsed.errors.join('\n')).toBe(true)
  })

  it('saved는 기록이 없거나 오래된 것만, archived는 지울 경로가 있을 때만, 합쳐 10건', () => {
    const exp = (id: string, at: string, doc: string | null = 'd', obs: string | null = 'o') =>
      ({ recipe_id: id, drive_doc_id: doc, drive_path: null, obsidian_path: obs, exported_at: at })
    const saved = [
      { id: 'new', updated_at: '2026-11-22T02:00:00Z' },
      { id: 'fresh', updated_at: '2026-11-22T01:00:00Z' },
      { id: 'stale', updated_at: '2026-11-22T01:30:00Z' },
    ]
    const archived = [{ id: 'gone' }, { id: 'cleaned' }, { id: 'never' }]
    const rows = [
      exp('fresh', '2026-11-22T01:00:00Z'), exp('stale', '2026-11-22T01:00:00Z'),
      exp('gone', '2026-11-20T00:00:00Z', 'doc', null), exp('cleaned', '2026-11-20T00:00:00Z', null, null),
    ]
    // 보관하는 사이 고친 레시피: 사본 시각(exported_at)이 고치기 전이라 계속 대상으로 남는다
    expect(pickExports([{ id: 'edited', updated_at: '2026-11-22T01:00:05Z' }], [], [exp('edited', '2026-11-22T01:00:00Z')]).fill).toEqual(['edited'])
    expect(pickExports([{ id: 'edited', updated_at: '2026-11-22T01:00:05Z' }], [], [exp('edited', '2026-11-22T01:00:05Z')]).fill).toEqual([])
    expect(pickExports(saved, archived, rows)).toEqual({ fill: ['stale', 'new'], trash: ['gone'] })
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, updated_at: `2026-11-22T00:${String(i).padStart(2, '0')}:00Z` }))
    const picked = pickExports(many, archived, rows)
    expect(picked.fill).toHaveLength(10)
    expect(picked.trash).toHaveLength(0)
    expect(pickExports(many.slice(0, 8), archived, rows).trash).toEqual(['gone'])
  })
})
