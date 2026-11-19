// yt-dlp 겹. 주소는 항상 source_key에서 만든다(저장된 url은 쓰지 않는다). 던지는 오류에는 정해진 한국어 까닭만 담는다.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { WorkerConfig } from '../config.ts'
import type { Evidence } from '../evidence.ts'
import { errText, type Runner } from './run.ts'

export const FAIL_GENERIC = '영상을 받지 못했어요'
export const FAIL_PRIVATE = '비공개 영상이에요'
export const FAIL_AGE = '연령 제한 영상이에요'
export const FAIL_TOO_LONG = '영상이 너무 길어요(60분 넘음)'
export const MAX_SECONDS = 3600

export function youtubeUrl(sourceKey: string): string {
  const m = /^youtube:([A-Za-z0-9_-]{11})$/.exec(sourceKey)
  if (!m) throw new Error(FAIL_GENERIC)
  return `https://www.youtube.com/watch?v=${m[1]}`
}

export function mapYtDlpError(text: string): string {
  if (/Private video/i.test(text)) return FAIL_PRIVATE
  if (/Sign in to confirm your age|age[- ]restricted/i.test(text)) return FAIL_AGE
  return FAIL_GENERIC
}

export type Meta = Evidence['meta'] & { captions: 'manual' | 'auto' | null }

const seoulDay = (d: Date): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d)

export type YtDlp = {
  meta(url: string): Promise<Meta>
  subs(url: string, dir: string, kind: 'manual' | 'auto'): Promise<unknown | null>
  audio(url: string, dir: string): Promise<string>
  video(url: string, dir: string): Promise<string>
}

export function createYtDlp(cfg: WorkerConfig, run: Runner, now: () => Date): YtDlp {
  const stateFile = join(cfg.cacheDir, '.yt-dlp-upgraded')

  /** 오늘(서울) 아직 안 올렸으면 brew upgrade yt-dlp를 한 번 돌린다. 돌렸으면 true. 실패해도 오늘은 다시 안 한다. */
  async function upgradeIfDue(): Promise<boolean> {
    const today = seoulDay(now())
    let last = ''
    try { last = readFileSync(stateFile, 'utf8').trim() } catch {}
    if (last === today) return false
    try { await run(cfg.brewPath, ['upgrade', 'yt-dlp']) } catch {}
    try {
      mkdirSync(cfg.cacheDir, { recursive: true })
      writeFileSync(stateFile, `${today}\n`)
    } catch {}
    return true
  }

  const base = (url: string, rest: string[]) => [
    '--ignore-config', '--use-extractors', 'youtube', '--no-playlist', ...cfg.ytDlpExtraArgs, ...rest, url,
  ]

  /** 하루 첫 일 전 업그레이드, 실패하면 그날 아직 안 했을 때만 업그레이드 뒤 한 번 더. 까닭은 한국어로만 던진다. */
  async function ytdlp(args: string[], first: boolean): Promise<Buffer> {
    if (first) await upgradeIfDue()
    let failure: unknown
    try {
      return (await run(cfg.ytDlpPath, args)).stdout
    } catch (e) {
      failure = e
    }
    const reason = mapYtDlpError(errText(failure))
    if (reason !== FAIL_GENERIC) throw new Error(reason)
    if (await upgradeIfDue()) {
      let again: unknown
      try {
        return (await run(cfg.ytDlpPath, args)).stdout
      } catch (e) {
        again = e
      }
      throw new Error(mapYtDlpError(errText(again)))
    }
    throw new Error(FAIL_GENERIC)
  }

  const isKo = (k: string) => /^ko(?:-|$)/.test(k)
  let firstCall = true
  const call = (args: string[]) => {
    const first = firstCall
    firstCall = false
    return ytdlp(args, first)
  }

  return {
    async meta(url) {
      const out = await call(base(url, ['-J', '--skip-download']))
      let j: Record<string, unknown>
      try { j = JSON.parse(out.toString('utf8')) as Record<string, unknown> } catch { throw new Error(FAIL_GENERIC) }
      const duration = j.duration
      if (typeof j.id !== 'string' || typeof duration !== 'number' || !Number.isFinite(duration)) throw new Error(FAIL_GENERIC)
      const keys = (v: unknown) => (typeof v === 'object' && v !== null ? Object.keys(v) : [])
      const manual = keys(j.subtitles).some(isKo)
      const lang = typeof j.language === 'string' ? j.language : ''
      // 자동 번역으로 생긴 'ko'는 쓰지 않는다: 'ko-orig'이거나, 영상 말이 한국어라고 적힌 경우만
      const auto = keys(j.automatic_captions).some((k) => /^ko-orig$/.test(k) || (k === 'ko' && lang.startsWith('ko')))
      const ud = typeof j.upload_date === 'string' && /^\d{8}$/.test(j.upload_date) ? `${j.upload_date.slice(0, 4)}-${j.upload_date.slice(4, 6)}-${j.upload_date.slice(6)}` : null
      const chapters = Array.isArray(j.chapters)
        ? j.chapters.flatMap((c: unknown) => {
            const o = c as { start_time?: unknown; title?: unknown }
            return typeof o?.start_time === 'number' && typeof o.title === 'string' ? [{ start: o.start_time, title: o.title }] : []
          })
        : []
      return {
        id: j.id,
        title: typeof j.title === 'string' ? j.title : '',
        channel: typeof j.channel === 'string' ? j.channel : typeof j.uploader === 'string' ? j.uploader : '',
        uploadDate: ud,
        duration,
        description: typeof j.description === 'string' ? j.description : '',
        chapters,
        captions: manual ? 'manual' : auto ? 'auto' : null,
      }
    },
    async subs(url, dir, kind) {
      await call(base(url, ['--skip-download', kind === 'manual' ? '--write-subs' : '--write-auto-subs', '--sub-langs', 'ko.*,ko', '--sub-format', 'json3', '-P', dir, '-o', 'subs']))
      const files = readdirSync(dir).filter((f) => /^subs\..+\.json3$/.test(f)).sort((a, b) => a.length - b.length)
      if (files.length === 0) return null
      try { return JSON.parse(readFileSync(join(dir, files[0]!), 'utf8')) as unknown } catch { return null }
    },
    async audio(url, dir) {
      await call(base(url, ['-f', 'bestaudio/best', '-x', '--audio-format', 'm4a', '-P', dir, '-o', 'audio.%(ext)s']))
      const f = readdirSync(dir).find((n) => /^audio\.[A-Za-z0-9]+$/.test(n) && !/\.(part|ytdl|wav)$/.test(n))
      if (!f) throw new Error(FAIL_GENERIC)
      return join(dir, f)
    },
    async video(url, dir) {
      await call(base(url, ['-f', 'bv*[height<=720]+ba/b[height<=720]', '-P', dir, '-o', 'video.%(ext)s']))
      const f = readdirSync(dir).find((n) => /^video\.[A-Za-z0-9]+$/.test(n) && !/\.(part|ytdl)$/.test(n))
      if (!f) throw new Error(FAIL_GENERIC)
      return join(dir, f)
    },
  }
}
