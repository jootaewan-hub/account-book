import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ApiError, createApi, type WorkerApi } from '../../../tools/recipe-worker/src/api'
import { createCaffeinate, readSecret } from '../../../tools/recipe-worker/src/cli'
import { loadConfig, type WorkerConfig } from '../../../tools/recipe-worker/src/config'
import { RateLimited, createDailyCounter, isOnHours, runOnce, startLoop, type LoopDeps } from '../../../tools/recipe-worker/src/loop'
import type { RecipeV2 } from '../../../tools/recipe-worker/src/types'

const job = { id: '00000000-0000-4000-8000-0000000000aa', url: 'https://www.youtube.com/watch?v=AkX6uA4BaDs', source_key: 'youtube:AkX6uA4BaDs' }
const recipe = { title: '시험' } as unknown as RecipeV2
const cfg: WorkerConfig = {
  endpoint: 'https://example.com/fn', secretFile: '/x/secret', cacheDir: '/x/cache', claudePath: '/x/claude', ytDlpPath: '/x/yt', ytDlpExtraArgs: [], brewPath: '/x/brew',
  ffmpegPath: '/x/ff', whisperCliPath: '/x/w', whisperModel: '/x/m', ocrPath: '/x/ocr',
  onHours: [['08:30', '18:20'], ['20:00', '06:30']], dailyLimit: 15, obsidianDir: null, driveTokenFile: null,
}
const at = (s: string) => new Date(`2026-11-22T${s}:00+09:00`)

function mkApi(over: Partial<WorkerApi> = {}) {
  const base = {
    claim: vi.fn(async () => job as typeof job | null),
    progress: vi.fn<WorkerApi['progress']>(async () => true),
    submit: vi.fn<WorkerApi['submit']>(async () => ({ ok: true, recipeId: 'r1' })),
    fail: vi.fn<WorkerApi['fail']>(async () => {}),
    release: vi.fn<WorkerApi['release']>(async () => {}),
    exports: vi.fn(async () => []),
    exported: vi.fn(async () => true),
    ping: vi.fn(async () => {}),
    dict: vi.fn(async () => []),
  } satisfies WorkerApi
  return { ...base, ...over } as typeof base
}

function mkDeps(api: WorkerApi, over: Partial<LoopDeps> = {}): LoopDeps {
  return { api, cfg, now: () => at('10:00'), doneToday: () => 0, process: async () => ({ recipe, dict: [] }), ...over }
}

describe('isOnHours (서울 시각)', () => {
  it('05:00은 켜짐, 07:00·19:00은 꺼짐, 경계', () => {
    expect(isOnHours(at('05:00'), cfg.onHours)).toBe(true)
    expect(isOnHours(at('07:00'), cfg.onHours)).toBe(false)
    expect(isOnHours(at('19:00'), cfg.onHours)).toBe(false)
    expect(isOnHours(at('08:30'), cfg.onHours)).toBe(true)
    expect(isOnHours(at('18:20'), cfg.onHours)).toBe(false)
    expect(isOnHours(at('23:59'), cfg.onHours)).toBe(true)
    expect(isOnHours(at('06:30'), cfg.onHours)).toBe(false)
  })
})

describe('runOnce', () => {
  it('일이 없으면 idle', async () => {
    const api = mkApi({ claim: vi.fn(async () => null) })
    expect(await runOnce(mkDeps(api))).toBe('idle')
    expect(api.submit).not.toHaveBeenCalled()
  })

  it('처리 성공이면 submit 한 번, done', async () => {
    const api = mkApi()
        const dict = [{ id: 'x', name: '엑스', aliases: [], category: '채소', origin: 'added' as const }]
    expect(await runOnce(mkDeps(api, { process: async () => ({ recipe, dict }) }))).toBe('done')
    expect(api.submit).toHaveBeenCalledTimes(1)
    expect(api.submit).toHaveBeenCalledWith(job.id, recipe, dict)
  })

  it('처리 단계 알림은 바로 progress로 가고, 처리 중에는 30초마다 마지막 단계를 다시 알린다', async () => {
    const api = mkApi()
    let beat: () => void = () => {}
    const stop = vi.fn()
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const run = runOnce(mkDeps(api, {
      every: (ms, fn) => { expect(ms).toBe(30_000); beat = fn; return stop },
      process: async (_j, onStage) => {
        await onStage('자막 받는 중')
        await gate
        return { recipe, dict: [] }
      },
    }))
    await vi.waitFor(() => expect(api.progress).toHaveBeenCalledWith(job.id, '자막 받는 중'))
    api.progress.mockClear()
    beat()
    expect(api.progress).toHaveBeenCalledWith(job.id, '자막 받는 중')
    release()
    expect(await run).toBe('done')
    expect(stop).toHaveBeenCalled()
  })

  it('첫 단계가 오기 전 심장박동은 첫 단계 이름으로 보낸다', async () => {
    const api = mkApi()
    let beat: () => void = () => {}
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const run = runOnce(mkDeps(api, { every: (_m, fn) => { beat = fn; return () => {} }, process: async () => { await gate; return { recipe, dict: [] } } }))
    await vi.waitFor(() => expect(api.claim).toHaveBeenCalled())
    await Promise.resolve()
    beat()
    expect(api.progress).toHaveBeenCalledWith(job.id, '영상 정보 받는 중')
    release()
    await run
  })

  it('RateLimited면 release(job, retryAt)과 released', async () => {
    const api = mkApi()
    const retryAt = new Date('2026-11-22T05:00:00Z')
    const r = await runOnce(mkDeps(api, { process: async () => { throw new RateLimited(retryAt) } }))
    expect(r).toBe('released')
    expect(api.release).toHaveBeenCalledWith(job.id, '2026-11-22T05:00:00.000Z')
    expect(api.fail).not.toHaveBeenCalled()
    expect(api.submit).not.toHaveBeenCalled()
  })

  it('오늘 15건이면 claim을 부르지 않고 limited', async () => {
    const api = mkApi()
    expect(await runOnce(mkDeps(api, { doneToday: () => 15 }))).toBe('limited')
    expect(api.claim).not.toHaveBeenCalled()
  })

  it('submit이 409면 fail(짧은 까닭), failed', async () => {
    const api = mkApi({ submit: vi.fn(async () => ({ ok: false as const, status: 409 as const, errors: [] })) })
    expect(await runOnce(mkDeps(api))).toBe('failed')
    expect(api.fail).toHaveBeenCalledTimes(1)
    const reason = api.fail.mock.calls[0]![1]
    expect(reason.length).toBeGreaterThan(0)
    expect(reason).not.toMatch(/\/|secret|Error|at /)
  })

  it('submit이 422면 정해 둔 까닭으로 fail', async () => {
    const api = mkApi({ submit: vi.fn(async () => ({ ok: false as const, status: 422 as const, errors: ['/secret/path 틀림'] })) })
    expect(await runOnce(mkDeps(api))).toBe('failed')
    expect(api.fail).toHaveBeenCalledWith(job.id, '레시피 정리 결과가 형식에 맞지 않아요')
  })

  it('submit 500·네트워크 오류는 아무것도 더 부르지 않고(임대 만료에 맡김) failed', async () => {
    const api = mkApi({ submit: vi.fn(async () => { throw new ApiError(500, 'x') }) })
    expect(await runOnce(mkDeps(api))).toBe('failed')
    expect(api.fail).not.toHaveBeenCalled()
    expect(api.release).not.toHaveBeenCalled()
  })

  it('그 밖의 처리 오류도 abandon: fail·release·submit 모두 부르지 않는다', async () => {
    const api = mkApi()
    expect(await runOnce(mkDeps(api, { process: async () => { throw new Error('/Users/x/secret.txt 터짐') } }))).toBe('failed')
    expect(api.fail).not.toHaveBeenCalled()
    expect(api.release).not.toHaveBeenCalled()
    expect(api.submit).not.toHaveBeenCalled()
  })

  it('progress가 ok:false면 처리를 멈추고 submit·fail 없이 failed', async () => {
    const api = mkApi({ progress: vi.fn(async () => false) })
    const after = vi.fn()
    const r = await runOnce(mkDeps(api, {
      process: async (_j, onStage) => { await onStage('자막 받는 중'); after(); return { recipe, dict: [] } },
    }))
    expect(r).toBe('failed')
    expect(after).not.toHaveBeenCalled()
    expect(api.submit).not.toHaveBeenCalled()
    expect(api.fail).not.toHaveBeenCalled()
  })

  it('심장박동이 ok:false를 받으면 처리 끝에서 submit 없이 failed', async () => {
    const api = mkApi({ progress: vi.fn(async () => false) })
    let beat: () => void = () => {}
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const run = runOnce(mkDeps(api, { every: (_m, fn) => { beat = fn; return () => {} }, process: async () => { await gate; return { recipe, dict: [] } } }))
    await vi.waitFor(() => expect(api.claim).toHaveBeenCalled())
    await Promise.resolve()
    beat()
    await vi.waitFor(() => expect(api.progress).toHaveBeenCalled())
    await Promise.resolve()
    release()
    expect(await run).toBe('failed')
    expect(api.submit).not.toHaveBeenCalled()
  })
})

describe('하루 한도는 맡은 일을 모두 센다', () => {
  it('성공 12 + 실패 3 = 15면 다음은 claim 없이 limited', async () => {
    const counter = createDailyCounter(() => at('10:00'))
    const results: string[] = []
    for (let i = 0; i < 15; i++) {
      const api = mkApi(i < 12 ? {} : { submit: vi.fn(async () => ({ ok: false as const, status: 409 as const, errors: [] })) })
      results.push(await runOnce(mkDeps(api, { doneToday: counter.doneToday, onClaimed: counter.increment })))
    }
    expect(results.filter((r) => r === 'done')).toHaveLength(12)
    expect(counter.doneToday()).toBe(15)
    const api = mkApi()
    expect(await runOnce(mkDeps(api, { doneToday: counter.doneToday, onClaimed: counter.increment }))).toBe('limited')
    expect(api.claim).not.toHaveBeenCalled()
  })

  it('돌려놓은(released) 일과 abandon도 센다, 일이 없으면 세지 않는다', async () => {
    const counter = createDailyCounter(() => at('10:00'))
    const d = (api: WorkerApi, process?: LoopDeps['process']) => mkDeps(api, { doneToday: counter.doneToday, onClaimed: counter.increment, ...(process ? { process } : {}) })
    await runOnce(d(mkApi(), async () => { throw new RateLimited(new Date()) }))
    await runOnce(d(mkApi(), async () => { throw new Error('x') }))
    await runOnce(d(mkApi({ claim: vi.fn(async () => null) })))
    expect(counter.doneToday()).toBe(2)
  })
})

describe('createDailyCounter', () => {
  it('서울 자정에 0으로 돌아간다', () => {
    let t = new Date('2026-11-22T14:50:00Z') // 서울 23:50
    const c = createDailyCounter(() => t)
    c.increment(); c.increment()
    expect(c.doneToday()).toBe(2)
    t = new Date('2026-11-22T15:10:00Z') // 서울 다음 날 00:10 (UTC로는 같은 날)
    expect(c.doneToday()).toBe(0)
    c.increment()
    expect(c.doneToday()).toBe(1)
  })
})

describe('startLoop', () => {
  it('겹쳐 돌지 않고, 켜진 시간 밖(19:00)에도 일을 가져온다', async () => {
    vi.useFakeTimers()
    try {
      let release!: () => void
      const gate = new Promise<void>((r) => { release = r })
      const api = mkApi()
      const proc = vi.fn(async () => { await gate; return { recipe, dict: [] } })
      const loop = startLoop(mkDeps(api, { process: proc }), 1000)
      await vi.advanceTimersByTimeAsync(5000)
      expect(api.claim).toHaveBeenCalledTimes(1)
      release()
      await loop.stop()

      const off = mkApi()
      const loop2 = startLoop(mkDeps(off, { now: () => at('19:00') }), 1000)
      await vi.advanceTimersByTimeAsync(1500)
      expect(off.claim).toHaveBeenCalled()
      await loop2.stop()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('createApi', () => {
  const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

  it('비밀을 머리글로 보내고 동작마다 본문을 만든다', async () => {
    const f = vi.fn(async () => ok({ job: null }))
    const api = createApi('https://e/fn', 's3cret', f as unknown as typeof fetch)
    expect(await api.claim()).toBeNull()
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://e/fn')
    expect((init.headers as Record<string, string>)['x-recipe-worker-secret']).toBe('s3cret')
    expect(JSON.parse(init.body as string)).toEqual({ action: 'claim' })
  })

  it('non-2xx는 ApiError(status)이고 비밀이 글에 없다', async () => {
    const api = createApi('https://e/fn', 's3cret', (async () => new Response(null, { status: 401 })) as unknown as typeof fetch)
    const e = await api.claim().catch((x: unknown) => x)
    expect(e).toBeInstanceOf(ApiError)
    expect((e as ApiError).status).toBe(401)
    expect((e as ApiError).message).not.toContain('s3cret')
  })

  it('네트워크 오류도 ApiError(0)이고 비밀이 글에 없다', async () => {
    const api = createApi('https://e/fn', 's3cret', (async () => { throw new Error('connect s3cret failed') }) as unknown as typeof fetch)
    const e = await api.progress('j', '저장 중').catch((x: unknown) => x)
    expect(e).toBeInstanceOf(ApiError)
    expect((e as ApiError).status).toBe(0)
    expect((e as ApiError).message).not.toContain('s3cret')
  })

  it('모든 호출에 redirect: error, 3xx 답은 네트워크 실패와 같고 비밀이 글에 없다', async () => {
    const f = vi.fn(async (_u: string, init: RequestInit) => {
      expect(init.redirect).toBe('error')
      return new Response(null, { status: 302, headers: { location: 'https://evil.example/x' } })
    })
    const api = createApi('https://e/fn', 's3cret', f as unknown as typeof fetch)
    const e = await api.claim().catch((x: unknown) => x)
    expect(e).toBeInstanceOf(ApiError)
    expect((e as ApiError).status).toBe(0)
    expect((e as ApiError).message).not.toContain('s3cret')
    expect((e as ApiError).message).not.toContain('evil')
    const e2 = await api.exported({ recipe_id: 'r', drive_doc_id: null, drive_path: null, obsidian_path: null, snapshot_updated_at: null }).catch((x: unknown) => x)
    expect((e2 as ApiError).status).toBe(0)
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('submit: 200은 recipeId, 409·422는 결과 값, 500은 던진다', async () => {
    const mk = (res: Response) => createApi('https://e/fn', 's', (async () => res) as unknown as typeof fetch)
    expect(await mk(ok({ recipe_id: 'r9' })).submit('j', recipe, [])).toEqual({ ok: true, recipeId: 'r9' })
    expect(await mk(ok({ errors: ['a'] }, 422)).submit('j', recipe, [])).toEqual({ ok: false, status: 422, errors: ['a'] })
    expect(await mk(ok({ error: 'x' }, 409)).submit('j', recipe, [])).toEqual({ ok: false, status: 409, errors: [] })
    await expect(mk(new Response(null, { status: 500 })).submit('j', recipe, [])).rejects.toMatchObject({ status: 500 })
  })

  it('exported는 404면 false', async () => {
    const api = createApi('https://e/fn', 's', (async () => ok({ error: 'x' }, 404)) as unknown as typeof fetch)
    expect(await api.exported({ recipe_id: 'r', drive_doc_id: null, drive_path: null, obsidian_path: null, snapshot_updated_at: null })).toBe(false)
  })
})

describe('설정과 비밀 파일', () => {
  it('loadConfig는 기본값을 채우고 ~를 펼친다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rw-'))
    const p = join(dir, 'config.json')
    writeFileSync(p, JSON.stringify({ endpoint: 'https://example.com/fn' }))
    const c = loadConfig(p)
    expect(c.dailyLimit).toBe(15)
    expect(c.onHours).toEqual([['08:30', '18:20'], ['20:00', '06:30']])
    expect(c.secretFile.startsWith('~')).toBe(false)
    expect(c.obsidianDir).toBeNull()
  })

  it('endpoint는 https만(http는 localhost·127.0.0.1만)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rw-'))
    const p = join(dir, 'config.json')
    const load = (endpoint: string) => { writeFileSync(p, JSON.stringify({ endpoint })); return loadConfig(p) }
    expect(() => load('http://example.com/fn')).toThrow(/endpoint/)
    expect(load('https://example.com/fn').endpoint).toBe('https://example.com/fn')
    expect(load('http://localhost:54321/fn').endpoint).toContain('localhost')
    expect(load('http://127.0.0.1:54321/fn').endpoint).toContain('127.0.0.1')
    expect(() => load('http://localhost.evil.com/fn')).toThrow(/endpoint/)
  })

  it('loadConfig는 잘못된 값의 위치만 말한다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rw-'))
    const p = join(dir, 'config.json')
    writeFileSync(p, JSON.stringify({ endpoint: 'nope', dailyLimit: 0 }))
    expect(() => loadConfig(p)).toThrow(/endpoint/)
  })

  it('readSecret은 권한이 열려 있으면 거절하고, 600이면 앞뒤 공백을 지워 읽는다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rw-'))
    const f = join(dir, 'secret')
    writeFileSync(f, ' abc \n')
    chmodSync(f, 0o644)
    expect(() => readSecret(f)).toThrow(/권한/)
    chmodSync(f, 0o600)
    expect(readSecret(f)).toBe('abc')
    try { readSecret(join(dir, 'none')) } catch (e) { expect((e as Error).message).not.toContain(dir) }
  })
})

describe('createCaffeinate', () => {
  it('켜진 시간에는 -w pid 하나를 두고 꺼지면 끄며, 일하는 동안은 따로 쥔다', () => {
    const killed: string[] = []
    const spawn = vi.fn((cmd: string, args: string[]) => ({ kill: () => { killed.push(`${cmd} ${args.join(' ')}`) } }))
    const c = createCaffeinate(spawn, 4242)
    c.sync(true); c.sync(true)
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(spawn).toHaveBeenCalledWith('caffeinate', ['-i', '-w', '4242'])
    c.sync(false)
    expect(killed).toHaveLength(1)
    c.busy(true)
    expect(spawn).toHaveBeenCalledTimes(2)
    c.busy(false)
    expect(killed).toHaveLength(2)
    c.stop()
  })

  it('잠 막기 상시 하나는 05:00에 켜지고 07:00에 풀린다', () => {
    const killed = vi.fn()
    const spawn = vi.fn(() => ({ kill: killed }))
    const c = createCaffeinate(spawn, 1)
    c.sync(isOnHours(at('05:00'), cfg.onHours))
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(killed).not.toHaveBeenCalled()
    c.sync(isOnHours(at('07:00'), cfg.onHours))
    expect(killed).toHaveBeenCalledTimes(1)
  })
})
