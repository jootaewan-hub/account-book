// 사용법: node src/cli.ts run [설정 파일]
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { createApi } from './api.ts'
import { DEFAULT_CONFIG_PATH, loadConfig } from './config.ts'
import { createDailyCounter, isOnHours, startLoop, type LoopDeps } from './loop.ts'

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

  const deps: LoopDeps = {
    api,
    cfg,
    now,
    doneToday: counter.doneToday,
    onDone: counter.increment,
    onBusy: (b) => caffeine.busy(b),
    // 뒤 작업에서 처리 단계(영상 받기~저장)를 여기에 붙인다
    process: async () => {
      throw new Error('처리 단계가 아직 없어요')
    },
  }

  const version = packageVersion()
  const ping = () => { api.ping(version).catch(() => {}) }
  const syncCaffeine = () => caffeine.sync(isOnHours(now(), cfg.onHours))
  ping()
  syncCaffeine()
  const pingTimer = setInterval(ping, PING_MS)
  const caffeineTimer = setInterval(syncCaffeine, 60_000)
  const loop = startLoop(deps)

  const shutdown = async () => {
    clearInterval(pingTimer)
    clearInterval(caffeineTimer)
    await loop.stop()
    caffeine.stop()
    process.exit(0)
  }
  process.once('SIGINT', () => { void shutdown() })
  process.once('SIGTERM', () => { void shutdown() })
  console.error('레시피 처리기를 시작했어요')
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const [cmd, path] = process.argv.slice(2)
  if (cmd === 'run') {
    run(path).catch((e: unknown) => {
      console.error(e instanceof Error ? e.message : '시작하지 못했어요')
      process.exit(1)
    })
  } else {
    console.error('사용법: node src/cli.ts run [설정 파일]')
    process.exit(2)
  }
}
