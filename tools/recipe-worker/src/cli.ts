// 사용법: node src/cli.ts run [설정 파일]
//        node src/cli.ts google-auth [설정 파일]
//        node src/cli.ts doctor [설정 파일]
//        node src/cli.ts dry-run <주소> --out <파일> [--no-description] [--config <설정 파일>]
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { normalizeRecipeUrl } from '../../../supabase/functions/_shared/recipeSource.ts'
import { createApi } from './api.ts'
import { createClaudeRun, type ClaudeRun } from './claude.ts'
import { DEFAULT_CONFIG_PATH, loadConfig, type WorkerConfig } from './config.ts'
import { doctor } from './doctor.ts'
import { createDrive, type Drive } from './export/drive.ts'
import { createBackoff, exportOnce } from './export/loop.ts'
import { googleAuth } from './export/google.ts'
import { createDailyCounter, isOnHours, startLoop, type LoopDeps } from './loop.ts'
import { cleanCache, processJob, processJobDetailed, type CollectFn } from './pipeline.ts'

const PING_MS = 5 * 60_000

/** 비밀 파일을 읽는다. 그룹·다른 사람이 읽을 수 있으면(권한 600이 아니면) 쓰지 않는다 */
export function readSecret(file: string): string {
  let mode: number
  try {
    mode = statSync(file).mode
  } catch {
    throw new Error('비밀 파일을 찾을 수 없어요. 설정의 secretFile을 확인해 주세요')
  }
  if ((mode & 0o077) !== 0) {
    throw new Error('비밀 파일의 권한이 너무 열려 있어요. chmod 600 으로 바꾼 뒤 다시 시작해 주세요')
  }
  const secret = readFileSync(file, 'utf8').trim()
  if (!secret) throw new Error('비밀 파일이 비어 있어요')
  return secret
}

export type Spawner = (cmd: string, args: string[]) => { kill: () => void }

const realSpawner: Spawner = (cmd, args) => {
  const child: ChildProcess = nodeSpawn(cmd, args, { stdio: 'ignore' })
  child.on('error', () => {})
  return { kill: () => { child.kill() } }
}

/**
 * 맥이 잠들지 않게 한다. 켜진 시간에는 `caffeinate -i -w <내 pid>`를 두고, 일하는 동안에는 시간과 상관없이 `caffeinate -i`를 쥔다.
 * sync(now)는 켜진 시간 여부에 맞춰 상시 하나를 켜고 끈다. busy(true/false)는 일하는 동안만 쥐는 하나다.
 */
export function createCaffeinate(spawn: Spawner, pid: number) {
  let standing: { kill: () => void } | null = null
  let working: { kill: () => void } | null = null
  return {
    sync(on: boolean) {
      if (on && !standing) standing = spawn('caffeinate', ['-i', '-w', String(pid)])
      else if (!on && standing) { standing.kill(); standing = null }
    },
    busy(b: boolean) {
      if (b && !working) working = spawn('caffeinate', ['-i', '-w', String(pid)])
      else if (!b && working) { working.kill(); working = null }
    },
    stop() {
      standing?.kill(); standing = null
      working?.kill(); working = null
    },
  }
}

function packageVersion(): string {
  try {
    const p = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: string }
    return p.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

export async function run(configPath: string = DEFAULT_CONFIG_PATH, spawn: Spawner = realSpawner): Promise<void> {
  const cfg = loadConfig(configPath)
  const secret = readSecret(cfg.secretFile)
  const api = createApi(cfg.endpoint, secret)
  const counter = createDailyCounter(() => new Date())
  const caffeine = createCaffeinate(spawn, process.pid)
  const now = () => new Date()
  const claudeRun = createClaudeRun(cfg)

  // 드라이브는 토큰 파일이 생기면(google-auth 뒤) 다음 번부터 쓴다. 없으면 건너뛰고 옵시디언만
  let drive: Drive | null = null
  const getDrive = (): Drive | null => {
    if (!cfg.driveTokenFile || !existsSync(cfg.driveTokenFile)) return null
    drive ??= createDrive(cfg.driveTokenFile, fetch, { cacheDir: cfg.cacheDir })
    return drive
  }

  const backoff = createBackoff()
  const deps: LoopDeps = {
    api,
    cfg,
    now,
    doneToday: counter.doneToday,
    onClaimed: counter.increment,
    onBusy: (b) => caffeine.busy(b),
    exportPass: () => exportOnce(api, getDrive(), cfg.obsidianDir, undefined, { driveConfigured: !!cfg.driveTokenFile, backoff }),
    process: async (job, onStage) => {
      const dict = await api.dict() // 일마다 한 번
      return processJob(job, { cfg, run: claudeRun, dict, onStage, now })
    },
  }

  const version = packageVersion()
  const ping = () => { api.ping(version).catch(() => {}) }
  const syncCaffeine = () => caffeine.sync(isOnHours(now(), cfg.onHours))
  ping()
  syncCaffeine()
  const pingTimer = setInterval(ping, PING_MS)
  const caffeineTimer = setInterval(syncCaffeine, 60_000)
  const clean = () => { cleanCache(cfg.cacheDir, now()).catch(() => {}) }
  clean()
  const cleanTimer = setInterval(clean, 24 * 60 * 60_000)
  const loop = startLoop(deps)

  const shutdown = async () => {
    clearInterval(pingTimer)
    clearInterval(caffeineTimer)
    clearInterval(cleanTimer)
    await loop.stop()
    caffeine.stop()
    process.exit(0)
  }
  process.once('SIGINT', () => { void shutdown() })
  process.once('SIGTERM', () => { void shutdown() })
  console.error('레시피 처리기를 시작했어요')
}

export type DryRunDeps = { cfg: WorkerConfig; run: ClaudeRun; collect?: CollectFn; now?: () => Date }

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

/** 저장소 안에는 .recipe-cache/ 밑에만 쓴다(저장소는 공개다). 저장소 밖은 어디든 된다 */
export function checkOutPath(out: string): string {
  const abs = resolve(out)
  const inRepo = abs === REPO_ROOT || abs.startsWith(REPO_ROOT + sep)
  if (inRepo && !abs.startsWith(resolve(REPO_ROOT, '.recipe-cache') + sep)) throw new Error('저장소 안에서는 .recipe-cache/ 밑에만 쓸 수 있어요')
  return abs
}

/** 서버 없이 영상 하나를 끝까지 돌려 결과와 요약을 파일에 쓴다 */
export async function dryRun(url: string, out: string, opts: { noDescription?: boolean }, deps: DryRunDeps): Promise<void> {
  const norm = normalizeRecipeUrl(url)
  if (!norm) throw new Error('유튜브 영상 주소가 아니에요')
  const file = checkOutPath(out)
  const started = Date.now()
  const id = `dry-${norm.key.slice('youtube:'.length)}`
  const r = await processJobDetailed(
    { id, url: norm.url },
    { cfg: deps.cfg, run: deps.run, dict: [], onStage: async (s) => { console.error(s) }, collect: deps.collect, now: deps.now, noDescription: opts.noDescription },
  )
  const summary = { seconds: Math.round((Date.now() - started) / 1000), ...r.stats }
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ recipe: r.recipe, dict: r.dict, summary }, null, 2))
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const [cmd, path, ...rest] = process.argv.slice(2)
  if (cmd === 'dry-run') {
    const outAt = rest.indexOf('--out')
    const cfgAt = rest.indexOf('--config')
    const out = outAt >= 0 ? rest[outAt + 1] : undefined
    if (!path || !out) {
      console.error('사용법: node src/cli.ts dry-run <주소> --out <파일> [--no-description] [--config <설정 파일>]')
      process.exit(2)
    }
    const cfg = loadConfig(cfgAt >= 0 ? rest[cfgAt + 1] : DEFAULT_CONFIG_PATH)
    dryRun(path, out, { noDescription: rest.includes('--no-description') }, { cfg, run: createClaudeRun(cfg) }).catch((e: unknown) => {
      console.error(e instanceof Error ? e.message : '끝내지 못했어요')
      process.exit(1)
    })
  } else if (cmd === 'google-auth') {
    googleAuth(loadConfig(path ?? DEFAULT_CONFIG_PATH)).then(() => { console.error('구글 연결을 저장했어요') }, (e: unknown) => {
      console.error(e instanceof Error ? e.message : '구글 연결을 하지 못했어요')
      process.exit(1)
    })
  } else if (cmd === 'doctor') {
    doctor(loadConfig(path ?? DEFAULT_CONFIG_PATH)).then((checks) => {
      for (const c of checks) console.log(`${c.ok ? '✓' : '✗'} ${c.name} — ${c.detail}`)
      if (checks.some((c) => !c.ok)) process.exit(1)
    }, (e: unknown) => {
      console.error(e instanceof Error ? e.message : '점검하지 못했어요')
      process.exit(1)
    })
  } else if (cmd === 'run') {
    run(path).catch((e: unknown) => {
      console.error(e instanceof Error ? e.message : '시작하지 못했어요')
      process.exit(1)
    })
  } else {
    console.error('사용법: node src/cli.ts run [설정 파일] | google-auth [설정 파일] | doctor [설정 파일] | dry-run <주소> --out <파일> [--no-description]')
    process.exit(2)
  }
}
