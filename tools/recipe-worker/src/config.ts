import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'

export const DEFAULT_CONFIG_PATH = '~/.config/recipe-worker/config.json'

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM 꼴이어야 해요')

const ConfigSchema = z.object({
  endpoint: z.string().url().refine((u) => {
    let parsed: URL
    try { parsed = new URL(u) } catch { return false }
    const { protocol, hostname } = parsed
    return protocol === 'https:' || (protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1'))
  }, 'https 주소여야 해요(비밀이 평문으로 가지 않게)'),
  secretFile: z.string().min(1).default('~/.config/recipe-worker/secret'),
  cacheDir: z.string().min(1).default('~/Library/Caches/recipe-worker'),
  claudePath: z.string().min(1).default('~/.local/bin/claude'),
  ytDlpPath: z.string().min(1).default('/opt/homebrew/bin/yt-dlp'),
  // 설치된 yt-dlp가 더 필요로 하는 인자(예: JS 실행기). 설치 뒤 yt-dlp --help로 확인해 채운다.
  ytDlpExtraArgs: z.array(z.string()).default([]),
  brewPath: z.string().min(1).default('/opt/homebrew/bin/brew'),
  ffmpegPath: z.string().min(1).default('/opt/homebrew/bin/ffmpeg'),
  whisperCliPath: z.string().min(1).default('/opt/homebrew/bin/whisper-cli'),
  whisperModel: z.string().min(1).default('~/.config/recipe-worker/models/ggml-large-v3-turbo.bin'),
  ocrPath: z.string().min(1).default('~/.config/recipe-worker/bin/ocr'),
  onHours: z.array(z.tuple([hhmm, hhmm])).default([['08:30', '18:20'], ['20:00', '06:30']]),
  dailyLimit: z.number().int().min(1).max(200).default(15),
  obsidianDir: z.string().min(1).nullable().default(null),
  driveTokenFile: z.string().min(1).nullable().default(null),
})

export type WorkerConfig = {
  endpoint: string
  secretFile: string
  cacheDir: string
  claudePath: string
  ytDlpPath: string
  ytDlpExtraArgs: string[]
  brewPath: string
  ffmpegPath: string
  whisperCliPath: string
  whisperModel: string
  ocrPath: string
  onHours: [string, string][]
  dailyLimit: number
  obsidianDir: string | null
  driveTokenFile: string | null
}

export function expandHome(p: string): string {
  if (p === '~') return homedir()
  return p.startsWith('~/') ? join(homedir(), p.slice(2)) : p
}

/** 설정 파일을 읽어 기본값을 채우고 경로의 ~를 펼친다. 틀리면 무엇이 틀렸는지만 적어 던진다(값은 적지 않는다). */
export function loadConfig(path: string = DEFAULT_CONFIG_PATH): WorkerConfig {
  const file = expandHome(path)
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    throw new Error(`설정 파일을 읽을 수 없어요: ${path}`)
  }
  const parsed = ConfigSchema.safeParse(raw)
  if (!parsed.success) {
    const where = parsed.error.issues.map((i) => i.path.join('.') || '(전체)').join(', ')
    throw new Error(`설정 파일이 올바르지 않아요: ${where}`)
  }
  const c = parsed.data
  return {
    ...c,
    secretFile: expandHome(c.secretFile),
    cacheDir: expandHome(c.cacheDir),
    claudePath: expandHome(c.claudePath),
    ytDlpPath: expandHome(c.ytDlpPath),
    brewPath: expandHome(c.brewPath),
    ffmpegPath: expandHome(c.ffmpegPath),
    whisperCliPath: expandHome(c.whisperCliPath),
    whisperModel: expandHome(c.whisperModel),
    ocrPath: expandHome(c.ocrPath),
    obsidianDir: c.obsidianDir === null ? null : expandHome(c.obsidianDir),
    driveTokenFile: c.driveTokenFile === null ? null : expandHome(c.driveTokenFile),
  }
}
