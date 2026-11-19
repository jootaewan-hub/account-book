import { homedir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import type { WorkerConfig } from '../../../tools/recipe-worker/src/config'
import { doctor, type DoctorDeps } from '../../../tools/recipe-worker/src/doctor'
import { BASE_PATH, renderPlist, servicePathDirs } from '../../../tools/recipe-worker/src/launchd'

describe('servicePathDirs', () => {
  it('plist PATH와 같은 목록을 쓴다', () => {
    expect(servicePathDirs(['/x'])).toEqual([...BASE_PATH, '/x'])
    expect(renderPlist({ label: 'a', node: '/n', script: '/s', logDir: '/l', extraPath: ['/x'] })).toContain(`<string>${servicePathDirs(['/x']).join(':')}</string>`)
  })
})

describe('renderPlist', () => {
  const base = { label: 'local.recipe-worker', node: '/opt/homebrew/bin/node', script: '/Users/x/Library/Application Support/recipe-worker/tools/recipe-worker/src/cli.ts', logDir: '/Users/x/Library/Logs/recipe-worker' }
  const xml = renderPlist(base)

  it('로그인 때 켜고 죽으면 다시 켠다', () => {
    expect(xml).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/)
    expect(xml).toMatch(/<key>KeepAlive<\/key>\s*<true\/>/)
    expect(xml).toContain('<string>local.recipe-worker</string>')
  })
  it('ProgramArguments는 절대 경로 node, cli.ts, run이고 셸 별칭을 쓰지 않는다', () => {
    const args = [...xml.match(/<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/)![1].matchAll(/<string>(.*?)<\/string>/g)].map((m) => m[1])
    expect(args).toEqual(['/opt/homebrew/bin/node', base.script, 'run'])
    expect(args[0].startsWith('/')).toBe(true)
    expect(xml).not.toMatch(/\/bin\/(zsh|bash|sh)|alias|\bsource\b/)
  })
  it('로그는 logDir로, PATH는 정해진 목록이다', () => {
    expect(xml).toContain('<key>StandardOutPath</key>')
    expect(xml).toContain('/Users/x/Library/Logs/recipe-worker/out.log')
    expect(xml).toContain('/Users/x/Library/Logs/recipe-worker/err.log')
    expect(xml).toMatch(/<key>PATH<\/key>\s*<string>\/opt\/homebrew\/bin:\/usr\/local\/bin:\/usr\/bin:\/bin<\/string>/)
  })
  it('claude 위치를 PATH에 더할 수 있다', () => {
    const x = renderPlist({ ...base, extraPath: ['/Users/x/.local/bin'] })
    expect(x).toContain('/bin:/Users/x/.local/bin</string>')
  })
  it('& < > 와 공백이 든 경로를 XML로 막아 쓴다', () => {
    const x = renderPlist({ ...base, script: '/Users/a & b/Application Support/<x>/cli.ts', logDir: '/tmp/l&g' })
    expect(x).toContain('/Users/a &amp; b/Application Support/&lt;x&gt;/cli.ts')
    expect(x).toContain('/tmp/l&amp;g/out.log')
    expect(x).not.toMatch(/a & b/)
  })
  it('절대 경로가 아니면 거절한다', () => {
    expect(() => renderPlist({ ...base, node: 'node' })).toThrow('절대 경로')
    expect(() => renderPlist({ ...base, script: 'src/cli.ts' })).toThrow('절대 경로')
    expect(() => renderPlist({ ...base, logDir: '~/Logs' })).toThrow('절대 경로')
  })
})

const cfg: WorkerConfig = {
  endpoint: 'https://example.test/functions/v1/recipe-worker',
  secretFile: '/h/.config/recipe-worker/secret',
  cacheDir: '/h/cache',
  claudePath: '/h/.local/bin/claude',
  ytDlpPath: '/opt/homebrew/bin/yt-dlp',
  ytDlpExtraArgs: [],
  brewPath: '/opt/homebrew/bin/brew',
  ffmpegPath: '/opt/homebrew/bin/ffmpeg',
  whisperCliPath: '/opt/homebrew/bin/whisper-cli',
  whisperModel: '/h/.config/recipe-worker/models/m.bin',
  ocrPath: '/h/.config/recipe-worker/bin/ocr',
  onHours: [['08:30', '18:20']],
  dailyLimit: 15,
  obsidianDir: '/h/vault',
  driveTokenFile: '/h/.config/recipe-worker/google-token.json',
}
const EXEC = 0o100755
const SECRET = 'SECRET-VALUE-XYZ'

function mkDeps(over: { files?: Record<string, number>; ping?: DoctorDeps['ping']; vault?: DoctorDeps['probeVault']; probe?: () => Promise<void> } = {}) {
  const files: Record<string, number> = {
    [cfg.ytDlpPath]: EXEC, '/opt/homebrew/bin/deno': EXEC, [cfg.ffmpegPath]: EXEC, [cfg.whisperCliPath]: EXEC,
    [cfg.whisperModel]: 0o100644, [cfg.ocrPath]: EXEC, [cfg.claudePath]: EXEC,
    [cfg.secretFile]: 0o100600, [cfg.driveTokenFile!]: 0o100600,
    ...over.files,
  }
  const probe = vi.fn(over.probe ?? (async () => {}))
  const deps = {
    stat: (p: string) => (p in files ? { mode: files[p] } : null),
    readText: () => SECRET,
    probeVault: vi.fn<DoctorDeps['probeVault']>(over.vault ?? (async () => {})),
    ping: vi.fn<DoctorDeps['ping']>(over.ping ?? (async () => {})),
    drive: () => ({ probe }),
    now: () => 1_700_000_000_000,
  } satisfies DoctorDeps
  return { deps, probe }
}
const find = (r: { name: string; ok: boolean; detail: string }[], part: string) => {
  const c = r.find((x) => x.name.includes(part))
  if (!c) throw new Error(`검사 없음: ${part}`)
  return c
}

describe('doctor', () => {
  it('모두 괜찮으면 모두 ok이고 시험 파일을 쓰고 지운다', async () => {
    const { deps, probe } = mkDeps()
    const r = await doctor(cfg, deps)
    expect(r.filter((c) => !c.ok)).toEqual([])
    expect(deps.ping).toHaveBeenCalledWith(cfg.endpoint, SECRET)
    expect(deps.probeVault).toHaveBeenCalledTimes(1)
    expect(deps.probeVault.mock.calls[0][0]).toBe('/h/vault')
    expect(probe).toHaveBeenCalledTimes(1)
  })
  it('비밀 파일이 644면 "권한이 너무 열려 있어요"로 잡는다', async () => {
    const { deps } = mkDeps({ files: { [cfg.secretFile]: 0o100644 } })
    const c = find(await doctor(cfg, deps), '비밀')
    expect(c.ok).toBe(false)
    expect(c.detail).toContain('권한이 너무 열려 있어요')
    expect(deps.ping).not.toHaveBeenCalled()
  })
  it('없는 프로그램은 어느 것인지 적는다', async () => {
    const { deps } = mkDeps()
    const r = await doctor(cfg, { ...deps, stat: (p: string) => (p === cfg.ffmpegPath ? null : deps.stat(p)) })
    expect(find(r, 'ffmpeg').ok).toBe(false)
    expect(find(r, 'ffmpeg').detail).toContain(cfg.ffmpegPath)
    expect(find(r, 'yt-dlp').ok).toBe(true)
  })
  it('실행 권한이 없으면 안 된다고 한다', async () => {
    const { deps } = mkDeps({ files: { [cfg.ocrPath]: 0o100644 } })
    const c = find(await doctor(cfg, deps), 'ocr')
    expect(c.ok).toBe(false)
    expect(c.detail).toContain('실행')
  })
  it('deno가 서비스 PATH 밖(~/.deno/bin)에만 있으면 실패이고 어디 있는지 알려 준다', async () => {
    const { deps } = mkDeps()
    const off = `${homedir()}/.deno/bin/deno`
    const r = await doctor(cfg, { ...deps, stat: (p: string) => (p === off ? { mode: EXEC } : p.endsWith('/deno') ? null : deps.stat(p)) })
    const c = find(r, 'deno')
    expect(c.ok).toBe(false)
    expect(c.detail).toContain(off)
    expect(c.detail).toContain('PATH')
  })
  it('deno가 claude가 있는 폴더(plist PATH에 더해지는 곳)에 있으면 통과다', async () => {
    const { deps } = mkDeps()
    const r = await doctor(cfg, { ...deps, stat: (p: string) => (p === '/opt/homebrew/bin/deno' ? null : p === '/h/.local/bin/deno' ? { mode: EXEC } : deps.stat(p)) })
    expect(find(r, 'deno')).toMatchObject({ ok: true, detail: '/h/.local/bin/deno' })
  })
  it('deno가 어디에도 없으면 실패다', async () => {
    const { deps } = mkDeps()
    const r = await doctor(cfg, { ...deps, stat: (p: string) => (p.endsWith('/deno') ? null : deps.stat(p)) })
    expect(find(r, 'deno').ok).toBe(false)
  })
  it('받아쓰기 모델 파일이 없으면 실패다', async () => {
    const { deps } = mkDeps()
    const r = await doctor(cfg, { ...deps, stat: (p: string) => (p === cfg.whisperModel ? null : deps.stat(p)) })
    expect(find(r, '모델').ok).toBe(false)
  })
  it('서버 확인이 실패하면 이유를 적되 비밀은 적지 않는다', async () => {
    const { deps } = mkDeps({ ping: async () => { throw new Error(`서버가 401로 답했어요 ${SECRET}`) } })
    const r = await doctor(cfg, deps)
    const c = find(r, '서버')
    expect(c.ok).toBe(false)
    expect(JSON.stringify(r)).not.toContain(SECRET)
  })
  it('옵시디언 폴더를 정하지 않았으면 그렇게 말한다', async () => {
    const { deps } = mkDeps()
    const c = find(await doctor({ ...cfg, obsidianDir: null }, deps), '옵시디언')
    expect(c).toMatchObject({ ok: false, detail: '옵시디언 폴더를 정하지 않았어요' })
    expect(deps.probeVault).not.toHaveBeenCalled()
  })
  it('옵시디언 폴더에 쓰지 못하면 실패다', async () => {
    const { deps } = mkDeps({ vault: async () => { throw new Error('EPERM') } })
    const c = find(await doctor(cfg, deps), '옵시디언')
    expect(c.ok).toBe(false)
    expect(c.detail).toContain('EPERM')
  })
  it('드라이브 토큰 파일을 정하지 않았거나 파일이 없으면 연결 전이라고 한다', async () => {
    const a = mkDeps()
    expect(find(await doctor({ ...cfg, driveTokenFile: null }, a.deps), '드라이브')).toMatchObject({ ok: false, detail: '구글 드라이브 연결 전이에요 (google-auth)' })
    const b = mkDeps()
    const r = await doctor(cfg, { ...b.deps, stat: (p: string) => (p === cfg.driveTokenFile ? null : b.deps.stat(p)) })
    expect(find(r, '드라이브')).toMatchObject({ ok: false, detail: '구글 드라이브 연결 전이에요 (google-auth)' })
    expect(a.probe).not.toHaveBeenCalled()
    expect(b.probe).not.toHaveBeenCalled()
  })
  it('드라이브 시험이 실패하면 실패다', async () => {
    const { deps } = mkDeps({ probe: async () => { throw new Error('구글 연결을 다시 해야 해요') } })
    const c = find(await doctor(cfg, deps), '드라이브')
    expect(c).toMatchObject({ ok: false })
    expect(c.detail).toContain('구글 연결을 다시 해야 해요')
  })
})
