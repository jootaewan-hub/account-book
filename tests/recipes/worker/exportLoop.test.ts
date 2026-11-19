import { mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { difficulty } from '../../../supabase/functions/_shared/recipeClassify'
import type { RecipeV2 } from '../../../supabase/functions/_shared/recipeContract'
import type { ExportItem, StoredRecipe } from '../../../supabase/functions/_shared/recipeStored'
import type { WorkerApi } from '../../../tools/recipe-worker/src/api'
import type { WorkerConfig } from '../../../tools/recipe-worker/src/config'
import { DriveAuthError, DriveHttpError, type Drive } from '../../../tools/recipe-worker/src/export/drive'
import { createBackoff, exportOnce } from '../../../tools/recipe-worker/src/export/loop'
import { startLoop, type LoopDeps } from '../../../tools/recipe-worker/src/loop'
import gold from '../../../docs/recipes/contract/examples/youtube-AkX6uA4BaDs.json'

function stored(id: string, over: Partial<StoredRecipe> = {}): StoredRecipe {
  const r = structuredClone(gold) as unknown as RecipeV2
  const d = difficulty(r)
  return {
    ...r, id, difficulty: d.level, difficulty_basis: d.basis, memo: null, rating: null, favorite: false,
    saved_at: '2026-11-19T01:00:00Z', updated_at: '2026-11-19T02:03:04.567Z', ...over,
  }
}
const item = (id: string, over: Partial<ExportItem> = {}): ExportItem => ({ recipe_id: id, recipe: stored(id), prev: null, trash: false, ...over })

function mkApi(items: ExportItem[]) {
  return { exports: vi.fn(async () => items), exported: vi.fn<WorkerApi['exported']>(async () => true) } satisfies Pick<WorkerApi, 'exports' | 'exported'>
}
function mkDrive(over: Partial<Drive> = {}) {
  const d = {
    ensureFolder: vi.fn(async () => 'f'),
    upsertDoc: vi.fn(async (r: StoredRecipe) => ({ id: `doc-${r.id}`, path: `p/${r.id}` })),
    trash: vi.fn(async () => {}),
    upsertListRow: vi.fn(async () => {}),
    removeListRow: vi.fn(async () => {}),
  } satisfies Drive
  return { ...d, ...over } as typeof d
}
const quiet = () => {}

describe('exportOnce', () => {
  it('둘 다 없으면 아무것도 안 하고 서버도 부르지 않는다', async () => {
    const api = mkApi([item('a')])
    expect(await exportOnce(api, null, null, quiet)).toBe(0)
    expect(api.exports).not.toHaveBeenCalled()
  })

  it('드라이브와 옵시디언에 쓰고 snapshot_updated_at 그대로 알린다', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'vault-'))
    const api = mkApi([item('a')])
    const drive = mkDrive()
    expect(await exportOnce(api, drive, vault, quiet)).toBe(1)
    const call = api.exported.mock.calls[0][0]
    expect(call).toMatchObject({ recipe_id: 'a', drive_doc_id: 'doc-a', drive_path: 'p/a', snapshot_updated_at: '2026-11-19T02:03:04.567Z' })
    expect(existsSync(join(vault, call.obsidian_path!))).toBe(true)
    expect(drive.upsertListRow).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), 'doc-a')
  })

  it('이전 문서 id를 넘겨 같은 문서를 고친다', async () => {
    const drive = mkDrive()
    await exportOnce(mkApi([item('a', { prev: { drive_doc_id: 'D1', drive_path: 'x/y', obsidian_path: null } })]), drive, null, quiet)
    expect(drive.upsertDoc).toHaveBeenCalledWith(expect.anything(), { id: 'D1', path: 'x/y' })
  })

  it('드라이브만 켜졌으면 옵시디언 경로는 이전 값을 그대로 알린다', async () => {
    const api = mkApi([item('a', { prev: { drive_doc_id: null, drive_path: null, obsidian_path: 'old.md' } })])
    await exportOnce(api, mkDrive(), null, quiet)
    expect(api.exported.mock.calls[0][0].obsidian_path).toBe('old.md')
  })

  it('옵시디언만이면 드라이브 칸은 이전 값을 지키며 알린다', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'vault-'))
    const api = mkApi([item('a', { prev: { drive_doc_id: 'D1', drive_path: 'x/y', obsidian_path: null } })])
    await exportOnce(api, null, vault, quiet)
    expect(api.exported.mock.calls[0][0]).toMatchObject({ drive_doc_id: 'D1', drive_path: 'x/y' })
  })

  it('지움: 드라이브 휴지통, 옵시디언 .trash, 목록에서 빼고, 모두 null로 알린다(스냅샷 없음)', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'vault-'))
    // 옵시디언에 먼저 쓴 글
    const first = mkApi([item('a')])
    await exportOnce(first, null, vault, quiet)
    const obs = first.exported.mock.calls[0][0].obsidian_path!
    const api = mkApi([item('a', { recipe: null, trash: true, prev: { drive_doc_id: 'D1', drive_path: 'x', obsidian_path: obs } })])
    const drive = mkDrive()
    expect(await exportOnce(api, drive, vault, quiet)).toBe(1)
    expect(drive.trash).toHaveBeenCalledWith('D1')
    expect(drive.removeListRow).toHaveBeenCalledWith('a')
    expect(existsSync(join(vault, obs))).toBe(false)
    expect(existsSync(join(vault, '.trash'))).toBe(true)
    expect(api.exported).toHaveBeenCalledWith({ recipe_id: 'a', drive_doc_id: null, drive_path: null, obsidian_path: null, snapshot_updated_at: null })
  })

  it('한 건이 실패하면 그 건만 알리지 않고 다음 건으로 간다', async () => {
    const api = mkApi([item('a'), item('b')])
    const drive = mkDrive({ upsertDoc: vi.fn(async (r: StoredRecipe) => { if (r.id === 'a') throw new DriveHttpError(500); return { id: 'doc-b', path: 'p' } }) })
    const logs: string[] = []
    expect(await exportOnce(api, drive, null, (m) => logs.push(m))).toBe(1)
    expect(api.exported).toHaveBeenCalledTimes(1)
    expect(api.exported.mock.calls[0][0].recipe_id).toBe('b')
    expect(logs).toHaveLength(1)
  })

  it('구글 연결 오류: 이번 번의 드라이브 일은 멈추고 옵시디언은 계속, 알리지는 않는다', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'vault-'))
    const api = mkApi([item('a'), item('b')])
    const drive = mkDrive({ upsertDoc: vi.fn(async () => { throw new DriveAuthError() }) })
    const logs: string[] = []
    expect(await exportOnce(api, drive, vault, (m) => logs.push(m))).toBe(0)
    expect(drive.upsertDoc).toHaveBeenCalledTimes(1) // 두 번째 건은 드라이브를 부르지 않는다
    expect(api.exported).not.toHaveBeenCalled()
    expect(existsSync(join(vault, '레시피'))).toBe(true) // 옵시디언 글은 둘 다 썼다
    expect(logs[0]).toBe('구글 연결을 다시 해야 해요')
  })

  it('로그에 갱신 토큰 같은 글이 없다', async () => {
    const api = mkApi([item('a')])
    const drive = mkDrive({ upsertDoc: vi.fn(async () => { throw new Error('boom REFRESH-TOKEN-SECRET') }) })
    const logs: string[] = []
    await exportOnce(api, drive, null, (m) => logs.push(m))
    expect(logs.join(' ')).not.toContain('REFRESH-TOKEN-SECRET')
  })
})

describe('exportOnce 보완', () => {
  it('need와 skip을 서버에 보낸다', async () => {
    const api = mkApi([])
    const b = createBackoff()
    b.fail('x')
    await exportOnce(api, mkDrive(), mkdtempSync(join(tmpdir(), 'vault-')), quiet, { backoff: b })
    expect(api.exports).toHaveBeenCalledWith({ skip: ['x'], need: ['drive', 'obsidian'] })
  })

  it('물러서기: 5분, 두 배씩, 6시간까지, 성공하면 지운다', () => {
    let t = 0
    const b = createBackoff(() => t)
    b.fail('a')
    expect(b.skipped()).toEqual(['a'])
    t = 5 * 60_000 + 1
    expect(b.skipped()).toEqual([])
    b.fail('a') // 두 번째: 10분
    t += 9 * 60_000
    expect(b.skipped()).toEqual(['a'])
    t += 2 * 60_000
    expect(b.skipped()).toEqual([])
    for (let i = 0; i < 12; i++) b.fail('a')
    t += 6 * 60 * 60_000 + 1
    expect(b.skipped()).toEqual([])
    b.fail('a')
    b.ok('a')
    expect(b.skipped()).toEqual([])
  })

  it('계속 실패하는 건은 물러서 있는 동안 skip으로 빠져 새 건에 닿는다', async () => {
    const failing = Array.from({ length: 3 }, (_, i) => item(`bad${i}`))
    const drive = mkDrive({ upsertDoc: vi.fn(async (r: StoredRecipe) => { if (r.id.startsWith('bad')) throw new DriveHttpError(500); return { id: 'd', path: 'p' } }) })
    const b = createBackoff()
    const api = { exports: vi.fn<WorkerApi['exports']>(async (o) => [...failing, item('new')].filter((x) => !o?.skip?.includes(x.recipe_id))), exported: vi.fn<WorkerApi['exported']>(async () => true) }
    expect(await exportOnce(api, drive, null, quiet, { backoff: b })).toBe(1) // new도 같은 번에 닿지만
    expect(api.exports.mock.calls[1]).toBeUndefined()
    await exportOnce(api, drive, null, quiet, { backoff: b })
    expect(api.exports.mock.calls[1][0]?.skip?.sort()).toEqual(['bad0', 'bad1', 'bad2'])
  })

  it('드라이브가 설정됐는데 쓸 수 없으면(토큰 파일 없음) 옵시디언만 쓰고 알리지 않는다', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'vault-'))
    const api = mkApi([item('a')])
    expect(await exportOnce(api, null, vault, quiet, { driveConfigured: true })).toBe(0)
    expect(api.exported).not.toHaveBeenCalled()
    expect(api.exports).toHaveBeenCalledWith({ skip: [], need: ['drive', 'obsidian'] })
    expect(existsSync(join(vault, '레시피'))).toBe(true)
  })

  it('지움: 쓸 수 없는 자리에 이전 값이 있으면 알리지 않는다', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'vault-'))
    const t = (prev: ExportItem['prev']) => item('a', { recipe: null, trash: true, prev })
    // 드라이브 못 씀(설정됨, drive null)
    let api = mkApi([t({ drive_doc_id: 'D', drive_path: 'x', obsidian_path: null })])
    expect(await exportOnce(api, null, vault, quiet, { driveConfigured: true })).toBe(0)
    expect(api.exported).not.toHaveBeenCalled()
    // 연결 오류
    api = mkApi([t({ drive_doc_id: 'D', drive_path: 'x', obsidian_path: null })])
    const drive = mkDrive({ trash: vi.fn(async () => { throw new DriveAuthError() }) })
    expect(await exportOnce(api, drive, vault, quiet)).toBe(0)
    // 옵시디언이 설정 안 됐는데 이전 경로가 있다
    api = mkApi([t({ drive_doc_id: null, drive_path: null, obsidian_path: 'a.md' })])
    expect(await exportOnce(api, mkDrive(), null, quiet)).toBe(0)
    // 값이 없는 자리는 안 쓰는 자리여도 알린다
    api = mkApi([t({ drive_doc_id: null, drive_path: null, obsidian_path: 'a.md' })])
    expect(await exportOnce(api, null, vault, quiet, { driveConfigured: true })).toBe(1)
  })
})

describe('일 고리의 사본 고리', () => {
  const cfg = { dailyLimit: 15 } as WorkerConfig
  const mkLoopDeps = (over: Partial<LoopDeps>): LoopDeps => ({
    api: { claim: vi.fn(async () => null) } as unknown as WorkerApi, cfg, now: () => new Date(), doneToday: () => 0,
    process: async () => { throw new Error('안 불러야 해요') }, ...over,
  })

  it('일이 없을 때 돌고, 2분 안에는 다시 돌지 않는다', async () => {
    vi.useFakeTimers()
    try {
      let t = Date.parse('2026-11-22T10:00:00Z')
      const pass = vi.fn(async () => 0)
      const loop = startLoop(mkLoopDeps({ exportPass: pass, now: () => new Date(t) }), 1000)
      await vi.advanceTimersByTimeAsync(0)
      expect(pass).toHaveBeenCalledTimes(1)
      t += 60_000
      await vi.advanceTimersByTimeAsync(1000)
      expect(pass).toHaveBeenCalledTimes(1)
      t += 61_000
      await vi.advanceTimersByTimeAsync(1000)
      expect(pass).toHaveBeenCalledTimes(2)
      await loop.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('서버에 닿지 못하면(claim 오류) 돌지 않는다, 사본 고리 오류는 삼킨다', async () => {
    vi.useFakeTimers()
    try {
      const pass = vi.fn(async () => { throw new Error('x') })
      const down = startLoop(mkLoopDeps({ exportPass: pass, api: { claim: vi.fn(async () => { throw new Error('down') }) } as unknown as WorkerApi }), 1000)
      await vi.advanceTimersByTimeAsync(0)
      expect(pass).not.toHaveBeenCalled()
      await down.stop()
      const up = startLoop(mkLoopDeps({ exportPass: pass }), 1000)
      await vi.advanceTimersByTimeAsync(0)
      expect(pass).toHaveBeenCalledTimes(1)
      await up.stop()
    } finally {
      vi.useRealTimers()
    }
  })
})
