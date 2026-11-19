import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkOutPath, dryRun } from '../../../tools/recipe-worker/src/cli'
import type { ClaudeRun } from '../../../tools/recipe-worker/src/claude'
import type { WorkerConfig } from '../../../tools/recipe-worker/src/config'
import type { Evidence } from '../../../tools/recipe-worker/src/evidence'
import { RateLimited } from '../../../tools/recipe-worker/src/loop'
import { cleanCache, processJob } from '../../../tools/recipe-worker/src/pipeline'

let cacheDir = ''
beforeEach(() => { cacheDir = mkdtempSync(join(tmpdir(), 'rw-pipeline-')) })
afterEach(() => { rmSync(cacheDir, { recursive: true, force: true }) })

const cfgOf = () => ({
  endpoint: 'https://example.com/fn', secretFile: '/x/secret', cacheDir, claudePath: '/x/bin/claude', ytDlpPath: '/x/yt', ytDlpExtraArgs: [], brewPath: '/x/brew',
  ffmpegPath: '/x/ff', whisperCliPath: '/x/w', whisperModel: '/x/m', ocrPath: '/x/ocr',
  onHours: [['08:30', '18:20']], dailyLimit: 15, obsidianDir: null, driveTokenFile: null,
}) as WorkerConfig

const URL_ = 'https://www.youtube.com/watch?v=AAAAAAAAAAA'
const evidence = (): Evidence => ({
  meta: { id: 'AAAAAAAAAAA', title: '시험 영상', channel: '시험 채널', uploadDate: '2026-01-02', duration: 300, description: '재료\n시험감자 1큰술\n시험소금 1작은술', chapters: [] },
  transcript: { kind: 'caption_auto', segments: [{ start: 3, text: '시험감자 2큰술을 볶아요' }, { start: 65, text: '시험소금 넣어요' }] },
  ocr: [],
  frames: [{ t: 10, path: '/x/job/f1.jpg' }],
})

const recipe = (extra: Record<string, unknown> = {}) => ({
  contract_version: '2',
  source: { kind: 'youtube', key: 'youtube:AAAAAAAAAAA', url: URL_, title: '시험 영상', channel: '시험 채널', published_on: '2026-01-02', duration_seconds: 300 },
  title: '시험 볶음',
  servings: { value: null, origin: null, suggested: 2 },
  tags: { cuisine: '한식', mains: ['채소'], main_details: ['시험감자'], methods: ['볶음'], occasions: ['반찬'] },
  ingredients: [
    { name: '시험감자', amount: 1, unit: '큰술', origin: 'description' },
    { name: '시험소금', amount: 1, unit: '작은술', origin: 'description' },
  ],
  steps: [{ title: '볶기', body: '시험감자와 시험소금을 볶는다', origin: 'caption_auto', video_start_seconds: 3, uses: [{ name: '시험감자' }, { name: '시험소금' }] }],
  extraction: { levels: ['L0', 'L1'], transcript_kind: 'caption_auto', tools: [], extracted_by: 'x', extracted_at: '2026-11-22T00:00:00+09:00' },
  ...extra,
})

/** 프롬프트에 따라 첫 읽기·두 번째 읽기·고르기에 답하는 가짜 */
function fakeRun(over: { organize?: unknown; second?: string; resolve?: string } = {}) {
  return vi.fn(async (prompt: string, _o: { jobDir: string; images?: string[] }) => {
    if (prompt.includes('재료와 분량만 따로 읽는다')) {
      return over.second ?? JSON.stringify({ ingredients: [{ name: '시험감자', amount: 2, unit: '큰술', at_seconds: 3 }, { name: '시험소금', amount: 1, unit: '작은술', at_seconds: null }] })
    }
    if (prompt.includes('어느 쪽이 근거와 맞는지만 고른다')) return over.resolve ?? '{"choice":"b"}'
    return JSON.stringify({ recipe: over.organize ?? recipe(), dict: [] })
  })
}

const job = { id: 'job1', url: URL_ }
const deps = (run: ReturnType<typeof fakeRun>, onStage = vi.fn(async (_s: string) => {})) => ({
  cfg: cfgOf(), run, dict: [], onStage, collect: vi.fn(async () => evidence()), now: () => new Date('2026-11-22T00:00:00+09:00'),
})

describe('processJob', () => {
  it('단계 글을 차례로 알리고, 두 읽기가 다른 곳을 근거로 고치고(시각은 맞은 줄의 것), 폴더를 지운다', async () => {
    const stages: string[] = []
    const e = evidence()
    e.meta.description = '재료\n시험소금 1작은술'
    e.transcript = { kind: 'caption_auto', segments: [{ start: 3, text: '시험감자 1큰술 넣고' }, { start: 10, text: '아니 시험감자 2큰술' }] }
    const org = recipe({ ingredients: [{ name: '시험감자', amount: 1, unit: '큰술', origin: 'caption_auto', at_seconds: 3 }, { name: '시험소금', amount: 1, unit: '작은술', origin: 'description' }] })
    const run = fakeRun({ organize: org, second: JSON.stringify({ ingredients: [{ name: '시험감자', amount: 2, unit: '큰술', at_seconds: 9999 }, { name: '시험소금', amount: 1, unit: '작은술', at_seconds: null }] }) })
    const d = { ...deps(run, vi.fn(async (s: string) => { stages.push(s) })), collect: vi.fn(async () => e) }
    const out = await processJob(job, d)
    expect(stages).toEqual(['레시피 정리 중', '다시 읽어 맞춰 보는 중', '저장 중'])
    expect(run).toHaveBeenCalledTimes(3) // 정리, 두 번째 읽기, 고르기 하나
    expect(out.recipe.ingredients[0]).toMatchObject({ name: '시험감자', amount: 2, unit: '큰술', origin: 'caption_auto', at_seconds: 10 })
    expect(out.recipe.ingredients[1]).toMatchObject({ amount: 1, unit: '작은술' })
    expect(out.recipe.corrections).toEqual([expect.objectContaining({ target: 'ingredients[0].amount', before: '1큰술', after: '2큰술', at_seconds: 10, method: 'compare' })])
    expect(out.recipe.review_items ?? []).toEqual([])
    expect(existsSync(join(cacheDir, 'job-job1'))).toBe(false)
    expect(d.collect).toHaveBeenCalledWith({ source_key: 'youtube:AAAAAAAAAAA' }, join(cacheDir, 'job-job1'), expect.anything(), expect.any(Function))
  })

  it('설명란 값이 영상 값과 다르면 설명란 값을 두고 다른 곳과 확인 필요를 남긴다', async () => {
    const out = await processJob(job, deps(fakeRun()))
    expect(out.recipe.ingredients[0]).toMatchObject({ amount: 1, unit: '큰술', origin: 'description' })
    expect(out.recipe.corrections ?? []).toEqual([])
    expect(out.recipe.conflicts).toEqual([{ about: '시험감자', chosen: '1큰술', chosen_origin: 'description', other: '2큰술', other_origin: 'caption_auto', video_start_seconds: 3 }])
    expect(out.recipe.review_items).toEqual([
      { target: 'conflicts[0]', reason: expect.any(String), candidates: [{ value: '1큰술', origin: 'description', at_seconds: null }, { value: '2큰술', origin: 'caption_auto', at_seconds: 3 }] },
    ])
  })

  it('고른 값이 근거에 없으면 값을 두고 확인 필요, 모름도 같다', async () => {
    for (const resolve of ['{"choice":"unknown"}', '{"choice":"b"}']) {
      const e = evidence()
      e.transcript = { kind: 'caption_auto', segments: [{ start: 3, text: '시험감자를 볶아요' }] }
      const d = { ...deps(fakeRun({ resolve })), collect: vi.fn(async () => e) }
      const out = await processJob(job, d)
      expect(out.recipe.ingredients[0]).toMatchObject({ amount: 1, unit: '큰술', needs_review: true })
      expect(out.recipe.review_items).toEqual([expect.objectContaining({ target: 'ingredients[0].amount' })])
      expect(out.recipe.corrections ?? []).toEqual([])
    }
  })

  it('두 번째 읽기가 틀리면 이 검사만 건너뛰고 일은 이어진다', async () => {
    const run = fakeRun({ second: '죄송합니다' })
    const out = await processJob(job, deps(run))
    expect(run).toHaveBeenCalledTimes(2)
    expect(out.recipe.ingredients[0]).toMatchObject({ amount: 1 })
  })

  it('설명란과 말이 다른 곳(conflicts)은 값을 두고 확인 필요에도 센다', async () => {
    const conflicts = [{ about: '소금', chosen: '1작은술', chosen_origin: 'description', other: '2작은술', other_origin: 'caption_auto', video_start_seconds: 65 }]
    const d = deps(fakeRun({ organize: recipe({ conflicts }), second: '{"ingredients":[]}' }))
    d.collect = vi.fn(async () => { const e = evidence(); e.transcript!.segments[1]!.text = '시험소금 2작은술 넣어요'; return e })
    const out = await processJob(job, d)
    expect(out.recipe.ingredients[1]).toMatchObject({ amount: 1, unit: '작은술' })
    expect(out.recipe.conflicts).toHaveLength(1)
    expect(out.recipe.review_items).toEqual([
      { target: 'conflicts[0]', reason: expect.any(String), candidates: [{ value: '1작은술', origin: 'description', at_seconds: null }, { value: '2작은술', origin: 'caption_auto', at_seconds: 65 }] },
    ])
  })

  it('정리가 낸 다른 곳의 한쪽이 근거에 없으면 그쪽은 덧붙임(출처 이름·시각 없음)', async () => {
    const conflicts = [{ about: '소금', chosen: '1작은술', chosen_origin: 'description', other: '2작은술', other_origin: 'caption_auto', video_start_seconds: 65 }]
    const out = await processJob(job, deps(fakeRun({ organize: recipe({ conflicts }), second: '{"ingredients":[]}' })))
    expect(out.recipe.conflicts).toEqual([{ ...conflicts[0], other_origin: 'editor', video_start_seconds: null }])
    expect(out.recipe.review_items![0]!.candidates).toEqual([
      { value: '1작은술', origin: 'description', at_seconds: null }, { value: '2작은술', origin: 'editor', at_seconds: null },
    ])
  })

  it('같은 확인 필요가 이미 있으면 conflicts에서 또 만들지 않는다', async () => {
    const conflicts = [{ about: '소금', chosen: '1작은술', chosen_origin: 'description', other: '2작은술', other_origin: 'caption_auto' }]
    const prior = [{ target: 'conflicts[0]', reason: '출처끼리 값이 달라 확인 필요', candidates: [] }]
    const out = await processJob(job, deps(fakeRun({ organize: recipe({ conflicts, review_items: prior }), second: '{"ingredients":[]}' })))
    expect(out.recipe.review_items).toHaveLength(1)
  })

  it('실패하면 폴더를 남긴다', async () => {
    const d = deps(fakeRun({ organize: { title: 'x' } }))
    await expect(processJob(job, d)).rejects.toThrow('레시피 정리 결과가 형식에 맞지 않아요')
    expect(existsSync(join(cacheDir, 'job-job1'))).toBe(true)
  })

  it('속도 제한은 그대로 던진다(폴더는 남는다)', async () => {
    const run = vi.fn(async (p: string) => {
      if (p.includes('재료와 분량만 따로 읽는다')) throw new RateLimited(new Date())
      return JSON.stringify({ recipe: recipe(), dict: [] })
    })
    await expect(processJob(job, deps(run as never))).rejects.toBeInstanceOf(RateLimited)
  })

  it('유튜브 주소가 아니거나 영상 id가 틀리면 영상을 받지 못한 것', async () => {
    await expect(processJob({ id: 'j', url: 'https://example.com/x' }, deps(fakeRun()))).rejects.toThrow('영상을 받지 못했어요')
    const e = evidence()
    e.meta.id = '../../etc/passwd'
    await expect(processJob(job, { ...deps(fakeRun()), collect: vi.fn(async () => e) })).rejects.toThrow('영상을 받지 못했어요')
  })
})

describe('cleanCache', () => {
  it('25시간 지난 작업 폴더만 지운다', async () => {
    const now = new Date('2026-11-22T12:00:00+09:00')
    const make = (name: string, hoursAgo: number) => {
      const p = join(cacheDir, name)
      mkdirSync(p)
      writeFileSync(join(p, 'a.txt'), 'x')
      const t = new Date(now.getTime() - hoursAgo * 3600_000)
      utimesSync(p, t, t)
    }
    make('job-old', 26)
    make('job-new', 24)
    make('other-old', 100)
    await cleanCache(cacheDir, now)
    expect(existsSync(join(cacheDir, 'job-old'))).toBe(false)
    expect(existsSync(join(cacheDir, 'job-new'))).toBe(true)
    expect(existsSync(join(cacheDir, 'other-old'))).toBe(true)
  })
  it('폴더가 없어도 조용하다', async () => {
    await expect(cleanCache(join(cacheDir, 'nope'), new Date())).resolves.toBeUndefined()
  })
})

describe('dry-run', () => {
  it('서버 없이 돌려 결과와 요약을 쓴다', async () => {
    const out = join(cacheDir, 'out', 'r.json')
    const collect = vi.fn(async () => evidence())
    await dryRun('youtu.be/AAAAAAAAAAA', out, {}, { cfg: cfgOf(), run: fakeRun(), collect, now: () => new Date('2026-11-22T00:00:00+09:00') })
    const j = JSON.parse(readFileSync(out, 'utf8'))
    expect(j.recipe.title).toBe('시험 볶음')
    expect(j.dict).toEqual([])
    expect(j.summary).toMatchObject({ numbers: { total: 2, grounded: 2, nulled: 0 }, reviews: 1, corrections: 0 })
    expect(typeof j.summary.seconds).toBe('number')
  })

  it('요약에 일 하나의 Claude 사용량 합(호출 수·토큰·정가 기준 금액)이 들어간다(R1)', async () => {
    const inner = fakeRun()
    const run = vi.fn(async (prompt: string, o: Parameters<ClaudeRun>[1]) => {
      o.onUsage?.({ cost_usd: 0.01, input_tokens: 3, output_tokens: 100, cache_creation_input_tokens: 2000, cache_read_input_tokens: 5000, models: ['m1'] })
      return inner(prompt, o)
    })
    const out = join(cacheDir, 'u.json')
    await dryRun('youtu.be/AAAAAAAAAAA', out, {}, { cfg: cfgOf(), run, collect: vi.fn(async () => evidence()) })
    const j = JSON.parse(readFileSync(out, 'utf8'))
    const calls = run.mock.calls.length
    expect(calls).toBeGreaterThanOrEqual(2)
    expect(j.summary.usage).toEqual({
      calls, cost_usd: 0.01 * calls, input_tokens: 3 * calls, output_tokens: 100 * calls,
      cache_creation_input_tokens: 2000 * calls, cache_read_input_tokens: 5000 * calls, models: ['m1'],
    })
  })

  it('--no-description은 설명란을 비우고 돌린다', async () => {
    const seen: string[] = []
    const run = fakeRun()
    const out = join(cacheDir, 'r.json')
    await dryRun('https://www.youtube.com/watch?v=AAAAAAAAAAA', out, { noDescription: true }, {
      cfg: cfgOf(), run, collect: vi.fn(async () => evidence()),
    })
    for (const c of run.mock.calls) seen.push(c[0])
    expect(seen.every((p) => !p.includes('시험감자 1큰술'))).toBe(true)
    const j = JSON.parse(readFileSync(out, 'utf8'))
    expect(j.summary.numbers.nulled).toBeGreaterThan(0)
  })

  it('유튜브가 아니면 거절하고, 저장소 안에서는 .recipe-cache 밑만 쓴다', async () => {
    await expect(dryRun('https://example.com/a', join(cacheDir, 'r.json'), {}, { cfg: cfgOf(), run: fakeRun() })).rejects.toThrow('유튜브')
    expect(() => checkOutPath(join(process.cwd(), 'docs', 'r.json'))).toThrow('.recipe-cache')
    expect(() => checkOutPath(join(process.cwd(), '.recipe-cache', 'r.json'))).not.toThrow()
    expect(() => checkOutPath(join(tmpdir(), 'r.json'))).not.toThrow()
  })
})
