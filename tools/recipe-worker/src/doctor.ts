// 설치 점검: 필요한 프로그램·파일이 있는지, 서버와 이어지는지, 비밀 파일 권한, 옵시디언·드라이브에 쓸 수 있는지.
// 비밀 값은 어떤 결과 글에도 넣지 않는다. 파일·네트워크는 deps로 바꿔 끼운다(시험은 가짜로).
import { readFileSync, statSync } from 'node:fs'
import { unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createApi } from './api.ts'
import type { WorkerConfig } from './config.ts'
import { createDrive } from './export/drive.ts'

export type Check = { name: string; ok: boolean; detail: string }

export type DoctorDeps = {
  stat: (path: string) => { mode: number } | null
  readText: (path: string) => string
  writeFile: (path: string, text: string) => Promise<void>
  unlink: (path: string) => Promise<void>
  ping: (endpoint: string, secret: string) => Promise<void>
  drive: (cfg: WorkerConfig) => { probe: () => Promise<void> }
  now: () => number
}

function packageVersion(): string {
  try {
    const p = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: string }
    return p.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

export const realDeps: DoctorDeps = {
  stat: (p) => {
    try {
      return statSync(p)
    } catch {
      return null
    }
  },
  readText: (p) => readFileSync(p, 'utf8'),
  writeFile: (p, t) => writeFile(p, t, { encoding: 'utf8', flag: 'wx' }),
  unlink: (p) => unlink(p),
  ping: (endpoint, secret) => createApi(endpoint, secret).ping(packageVersion()),
  drive: (cfg) => createDrive(cfg.driveTokenFile ?? '', fetch, { cacheDir: cfg.cacheDir }),
  now: Date.now,
}

const isFile = (m: number) => (m & 0o170000) === 0o100000
const isExec = (m: number) => isFile(m) && (m & 0o111) !== 0

function denoCandidates(): string[] {
  return ['/opt/homebrew/bin/deno', '/usr/local/bin/deno', join(homedir(), '.deno/bin/deno')]
}

/** 비밀 값이 글에 새지 않게 오류 글에서 지운다 */
function clean(e: unknown, secret: string | null): string {
  const msg = e instanceof Error ? e.message : '알 수 없는 오류'
  const out = secret ? msg.split(secret).join('***') : msg
  return out.slice(0, 200)
}

export async function doctor(cfg: WorkerConfig, deps: DoctorDeps = realDeps): Promise<Check[]> {
  const checks: Check[] = []
  const add = (name: string, ok: boolean, detail: string) => { checks.push({ name, ok, detail }) }

  const program = (name: string, path: string) => {
    const s = deps.stat(path)
    if (!s) add(name, false, `${path} 에 없어요`)
    else if (!isExec(s.mode)) add(name, false, `${path} 을 실행할 수 없어요(실행 권한 확인)`)
    else add(name, true, path)
  }
  program('yt-dlp', cfg.ytDlpPath)
  const deno = denoCandidates().find((p) => {
    const s = deps.stat(p)
    return s !== null && isExec(s.mode)
  })
  if (deno) add('deno', true, deno)
  else add('deno', false, `없어요(yt-dlp가 필요로 해요). 찾아본 곳: ${denoCandidates().join(', ')}`)
  program('ffmpeg', cfg.ffmpegPath)
  program('whisper-cli', cfg.whisperCliPath)
  const model = deps.stat(cfg.whisperModel)
  if (model && isFile(model.mode)) add('받아쓰기 모델', true, cfg.whisperModel)
  else add('받아쓰기 모델', false, `${cfg.whisperModel} 파일이 없어요`)
  program('ocr', cfg.ocrPath)
  program('claude', cfg.claudePath)

  // 비밀 파일: 권한이 600이어야 하고, 그래야 서버 확인에 쓴다
  let secret: string | null = null
  const sf = deps.stat(cfg.secretFile)
  if (!sf) add('비밀 파일', false, `${cfg.secretFile} 이 없어요`)
  else if ((sf.mode & 0o077) !== 0) add('비밀 파일', false, `권한이 너무 열려 있어요 (${(sf.mode & 0o777).toString(8)}). chmod 600 으로 바꿔 주세요`)
  else {
    try {
      const t = deps.readText(cfg.secretFile).trim()
      if (t) { secret = t; add('비밀 파일', true, '권한 600') }
      else add('비밀 파일', false, '비어 있어요')
    } catch {
      add('비밀 파일', false, '읽지 못했어요')
    }
  }

  if (secret === null) add('서버 연결', false, '비밀 파일을 먼저 고쳐 주세요')
  else {
    try {
      await deps.ping(cfg.endpoint, secret)
      add('서버 연결', true, '답이 왔어요')
    } catch (e) {
      add('서버 연결', false, clean(e, secret))
    }
  }

  if (!cfg.obsidianDir) add('옵시디언 폴더', false, '옵시디언 폴더를 정하지 않았어요')
  else {
    const file = join(cfg.obsidianDir, `.recipe-worker-점검-${deps.now()}.tmp`)
    try {
      await deps.writeFile(file, 'ok')
      try {
        await deps.unlink(file)
        add('옵시디언 폴더', true, '시험 파일을 쓰고 지웠어요')
      } catch (e) {
        add('옵시디언 폴더', false, `시험 파일을 썼지만 지우지 못했어요: ${clean(e, null)}`)
      }
    } catch (e) {
      add('옵시디언 폴더', false, `쓰지 못했어요: ${clean(e, null)}`)
    }
  }

  if (!cfg.driveTokenFile || !deps.stat(cfg.driveTokenFile)) add('구글 드라이브', false, '구글 드라이브 연결 전이에요 (google-auth)')
  else {
    try {
      await deps.drive(cfg).probe()
      add('구글 드라이브', true, '시험 파일을 만들고 휴지통으로 보냈어요')
    } catch (e) {
      add('구글 드라이브', false, clean(e, null))
    }
  }
  return checks
}
