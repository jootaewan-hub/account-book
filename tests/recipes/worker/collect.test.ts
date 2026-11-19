import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { collect } from '../../../tools/recipe-worker/src/collect/index'
import { parseOcrOutput } from '../../../tools/recipe-worker/src/collect/ocr'
import type { Runner } from '../../../tools/recipe-worker/src/collect/run'
import { mapYtDlpError, youtubeUrl } from '../../../tools/recipe-worker/src/collect/ytdlp'
import { JobFailed } from '../../../tools/recipe-worker/src/errors'
import type { WorkerConfig } from '../../../tools/recipe-worker/src/config'
import { dedupe, ingredientNames, parseJson3, parseWhisperJson, selectFrames, type Frame, type OcrLine } from '../../../tools/recipe-worker/src/evidence'

const execFileP = promisify(execFile)

let root: string
let dir: string
let cfg: WorkerConfig
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'collect-test-'))
  dir = join(root, 'job')
  mkdirSync(dir)
  cfg = {
    endpoint: 'https://example.com/fn', secretFile: '/x/secret', cacheDir: join(root, 'cache'), claudePath: '/x/claude',
    ytDlpPath: '/bin/ytdlp', ytDlpExtraArgs: ['--extra-x'], brewPath: '/bin/brew', ffmpegPath: '/bin/ffmpeg',
    whisperCliPath: '/bin/whisper', whisperModel: '/m/model.bin', ocrPath: '/bin/ocr',
    onHours: [['08:30', '18:20']], dailyLimit: 15, obsidianDir: null, driveTokenFile: null,
  }
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('parseJson3', () => {
  it('조각을 이어 붙이고 시작 시각을 초로 바꾸며 빈 조각·줄바꿈만 있는 조각은 버린다', () => {
    const json = {
      events: [
        { tStartMs: 0, dDurationMs: 4200, segs: [{ utf8: '간장 ' }, { utf8: '세 큰술' }] },
        { tStartMs: 2000, segs: [{ utf8: '\n' }] },
        { tStartMs: 3000 },
        { tStartMs: 4200, segs: [{ utf8: '물\n두 컵' }] },
      ],
    }
    expect(parseJson3(json)).toEqual([
      { start: 0, text: '간장 세 큰술' },
      { start: 4.2, text: '물 두 컵' },
    ])
  })
  it('모양이 다르면 빈 목록', () => {
    expect(parseJson3(null)).toEqual([])
    expect(parseJson3({ events: 3 })).toEqual([])
  })
})

describe('parseWhisperJson', () => {
  it('밀리초 오프셋을 초로 바꾸고 빈 글은 버린다', () => {
    const json = {
      transcription: [
        { offsets: { from: 0, to: 2500 }, text: ' 안녕하세요 ' },
        { offsets: { from: 2500, to: 3000 }, text: '   ' },
        { offsets: { from: 61500, to: 63000 }, text: '불을 줄여요' },
      ],
    }
    expect(parseWhisperJson(json)).toEqual([
      { start: 0, text: '안녕하세요' },
      { start: 61.5, text: '불을 줄여요' },
    ])
    expect(parseWhisperJson({})).toEqual([])
  })
})

const flat = (v: number) => new Uint8Array(768).fill(v)
describe('dedupe', () => {
  it('같은 장 셋 중 첫 장만 남긴다', () => {
    const thumbs = [0, 1, 2].map((t) => ({ t, pixels: flat(100) }))
    expect(dedupe(thumbs)).toEqual([0])
  })
  it('문턱보다 많이 다르면 남기고, 마지막으로 남긴 장과 견준다', () => {
    const thumbs = [
      { t: 0, pixels: flat(10) },
      { t: 1, pixels: flat(14) }, // 차 4 < 8 → 버림
      { t: 2, pixels: flat(30) }, // 첫 장과 차 20 → 남김
      { t: 3, pixels: flat(33) }, // 30과 차 3 → 버림
    ]
    expect(dedupe(thumbs)).toEqual([0, 2])
    expect(dedupe(thumbs, 2)).toEqual([0, 1, 2, 3])
  })
  it('빈 목록', () => {
    expect(dedupe([])).toEqual([])
  })
})

describe('selectFrames', () => {
  const frames: Frame[] = Array.from({ length: 60 }, (_, i) => ({ t: i, path: `/j/f${i}.jpg` }))
  it('숫자+단위 글자와 재료 이름이 보이는 장을 먼저, 24장을 넘지 않는다', () => {
    const ocr: OcrLine[] = [
      { t: 50, text: '간장 3T' },
      { t: 51, text: '자막 없음' },
      { t: 55, text: '대파를 썰어요' },
      { t: 56, text: '물 200ml' },
    ]
    const out = selectFrames(frames, ocr, ['대파'])
    expect(out.length).toBeLessThanOrEqual(24)
    const ts = out.map((f) => f.t)
    expect(ts).toContain(50)
    expect(ts).toContain(55)
    expect(ts).toContain(56)
    expect(ts.length).toBe(24)
    expect([...ts].sort((a, b) => a - b)).toEqual(ts)
  })
  it('우선 장이 24개를 넘으면 24개로 자른다', () => {
    const ocr: OcrLine[] = frames.map((f) => ({ t: f.t, text: '소금 5g' }))
    expect(selectFrames(frames, ocr, []).length).toBe(24)
    expect(selectFrames(frames, ocr, [], 5).length).toBe(5)
  })
  it('글자가 없으면 시간대에 고르게 채운다', () => {
    const out = selectFrames(frames, [], [])
    expect(out.length).toBe(24)
    expect(out[0]!.t).toBeLessThan(5)
    expect(out[out.length - 1]!.t).toBeGreaterThan(54)
  })
  it('장이 적으면 전부', () => {
    expect(selectFrames(frames.slice(0, 3), [], []).length).toBe(3)
  })
})

describe('ingredientNames', () => {
  it('설명란의 재료 줄에서 한글 이름을 뽑는다', () => {
    const d = '맛있는 시험 요리\n\n[재료]\n간장 3T, 대파 1대\n두부 한 모\n\n만드는 법\n볶음 접시'
    const names = ingredientNames(d)
    expect(names).toEqual(expect.arrayContaining(['간장', '대파', '두부']))
    expect(names).not.toContain('볶음')
  })
  it('재료 칸이 없으면 빈 목록', () => {
    expect(ingredientNames('그냥 소개 글입니다')).toEqual([])
  })
})

describe('ytdlp 보조 함수', () => {
  it('열쇠에서만 주소를 만든다', () => {
    expect(youtubeUrl('youtube:AkX6uA4BaDs')).toBe('https://www.youtube.com/watch?v=AkX6uA4BaDs')
    for (const bad of ['youtube:short', 'instagram:AkX6uA4BaDs', 'https://evil.example/', 'youtube:AkX6uA4BaDs; rm', 'youtube:AkX6uA4BaD/']) {
      expect(() => youtubeUrl(bad)).toThrow('영상을 받지 못했어요')
    }
  })
  it('오류 글을 한국어 까닭으로 바꾼다', () => {
    expect(mapYtDlpError('ERROR: [youtube] x: Private video. Sign in if you ...')).toBe('비공개 영상이에요')
    expect(mapYtDlpError('ERROR: Sign in to confirm your age. This video may be inappropriate')).toBe('연령 제한 영상이에요')
    expect(mapYtDlpError('ERROR: This video is age-restricted')).toBe('연령 제한 영상이에요')
    expect(mapYtDlpError('ERROR: whatever')).toBe('영상을 받지 못했어요')
    expect(mapYtDlpError('ERROR: [youtube] x: Video unavailable')).toBe('볼 수 없는 영상이에요(지워졌거나 막혔어요)')
    expect(mapYtDlpError('ERROR: [youtube] x: This video has been removed by the uploader')).toBe('볼 수 없는 영상이에요(지워졌거나 막혔어요)')
    // 유튜브가 잠깐 막은 것은 다시 해 볼 일이다
    expect(mapYtDlpError("ERROR: [youtube] x: Video unavailable. This content isn't available, try again later.")).toBe('영상을 받지 못했어요')
  })
})

describe('parseOcrOutput', () => {
  it('경로를 장면 초로 되돌린다', () => {
    const frames: Frame[] = [{ t: 3, path: '/j/a.jpg' }, { t: 9, path: '/j/b.jpg' }]
    const out = [
      JSON.stringify({ path: '/j/a.jpg', lines: ['간장 3T', ' ', '대파'] }),
      'not json',
      JSON.stringify({ path: '/j/zzz.jpg', lines: ['모르는 장'] }),
      JSON.stringify({ path: '/j/b.jpg', lines: [] }),
    ].join('\n')
    expect(parseOcrOutput(out, frames)).toEqual([{ t: 3, text: '간장 3T' }, { t: 3, text: '대파' }])
  })
})

// ---- collect (대리 실행기) ----

const URL_RE = /^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/
type Calls = { file: string; args: string[] }[]

function fakeWorld(opts: {
  meta?: Record<string, unknown>
  ytFail?: (args: string[]) => string | null
  frameCount?: number
  asrSegments?: { offsets: { from: number; to: number }; text: string }[]
}) {
  const calls: Calls = []
  const meta = {
    id: 'AkX6uA4BaDs', title: '시험 요리', channel: '시험 채널', upload_date: '20261101', duration: 600,
    description: '[재료]\n간장 3T, 대파', language: 'ko', chapters: [{ start_time: 0, title: '시작' }],
    subtitles: { ko: [{ ext: 'json3' }] }, automatic_captions: {},
    ...opts.meta,
  }
  const n = opts.frameCount ?? 4
  const run: Runner = async (file, args) => {
    calls.push({ file, args })
    const arg = (flag: string) => args[args.indexOf(flag) + 1]!
    if (file === cfg.brewPath) return { stdout: Buffer.from('') }
    if (file === cfg.ytDlpPath) {
      const fail = opts.ytFail?.(args)
      if (fail) throw Object.assign(new Error('실행 실패'), { stderr: fail })
      if (args.includes('-J')) return { stdout: Buffer.from(JSON.stringify(meta)) }
      const out = arg('-P')
      if (args.includes('--write-subs') || args.includes('--write-auto-subs')) {
        writeFileSync(join(out, 'subs.ko.json3'), JSON.stringify({ events: [{ tStartMs: 0, segs: [{ utf8: '간장 세 큰술' }] }, { tStartMs: 4200, segs: [{ utf8: '대파' }] }] }))
      } else if (args.includes('-x')) {
        writeFileSync(join(out, 'audio.m4a'), 'x')
      } else {
        writeFileSync(join(out, 'video.mp4'), 'x')
      }
      return { stdout: Buffer.from('') }
    }
    if (file === cfg.ffmpegPath) {
      if (args.includes('rawvideo')) {
        const buf = Buffer.alloc(n * 768)
        buf.fill(255, 3 * 768) // 마지막 장만 다르다
        return { stdout: buf }
      }
      if (args.some((a) => a.endsWith('.wav'))) {
        writeFileSync(args[args.length - 1]!, 'wav')
      } else {
        const pattern = args[args.length - 1]!
        mkdirSync(join(pattern, '..'), { recursive: true })
        for (let i = 1; i <= n; i++) writeFileSync(pattern.replace('%05d', String(i).padStart(5, '0')), 'jpg')
      }
      return { stdout: Buffer.from('') }
    }
    if (file === cfg.whisperCliPath) {
      writeFileSync(`${arg('-of')}.json`, JSON.stringify({ transcription: opts.asrSegments ?? [{ offsets: { from: 0, to: 1000 }, text: '받아쓴 말' }] }))
      return { stdout: Buffer.from('') }
    }
    if (file === cfg.ocrPath) {
      const lines = args.map((p) => JSON.stringify({ path: p, lines: p.endsWith('f_00004.jpg') ? ['간장 3T'] : [] }))
      return { stdout: Buffer.from(lines.join('\n')) }
    }
    throw new Error(`예상 못한 실행: ${file}`)
  }
  return { run, calls, meta }
}

const ytCalls = (calls: Calls, cfgPath: string) => calls.filter((c) => c.file === cfgPath)
const now = () => new Date('2026-11-19T10:00:00+09:00')

describe('collect', () => {
  it('작성자 한국어 자막이 있으면 그것만 받고 받아쓰기·오디오는 건너뛴다. 단계 글 순서', async () => {
    const w = fakeWorld({})
    const stages: string[] = []
    const ev = await collect({ source_key: 'youtube:AkX6uA4BaDs' }, dir, cfg, async (s) => { stages.push(s) }, { run: w.run, now })
    expect(stages).toEqual(['영상 정보 받는 중', '자막 받는 중', '화면 글자 읽는 중'])
    expect(ev.meta).toEqual({
      id: 'AkX6uA4BaDs', title: '시험 요리', channel: '시험 채널', uploadDate: '2026-11-01', duration: 600,
      description: '[재료]\n간장 3T, 대파', chapters: [{ start: 0, title: '시작' }],
    })
    expect(ev.transcript).toEqual({ kind: 'caption_manual', segments: [{ start: 0, text: '간장 세 큰술' }, { start: 4.2, text: '대파' }] })
    const yt = ytCalls(w.calls, cfg.ytDlpPath)
    const subsCall = yt.find((c) => c.args.includes('--write-subs'))!
    expect(subsCall.args).not.toContain('--write-auto-subs')
    expect(subsCall.args).toEqual(expect.arrayContaining(['--sub-langs', 'ko.*,ko', '--sub-format', 'json3', '--skip-download']))
    expect(yt.some((c) => c.args.includes('-x'))).toBe(false)
    expect(w.calls.some((c) => c.file === cfg.whisperCliPath)).toBe(false)
    // 장면: 4장 중 앞의 같은 3장은 첫 장만 → 2장, 글자는 읽힌다
    expect(ev.frames.map((f) => f.t)).toEqual([0, 3])
    expect(ev.ocr).toEqual([{ t: 3, text: '간장 3T' }])
    for (const f of ev.frames) expect(f.path.startsWith(dir)).toBe(true)
  })

  it('모든 yt-dlp 호출: 열쇠로 만든 주소, youtube 추출기만, 재생목록·쿠키 없음, 추가 인자 포함', async () => {
    const w = fakeWorld({})
    await collect({ source_key: 'youtube:AkX6uA4BaDs' }, dir, cfg, async () => {}, { run: w.run, now })
    const yt = ytCalls(w.calls, cfg.ytDlpPath)
    expect(yt.length).toBeGreaterThanOrEqual(3)
    for (const c of yt) {
      expect(c.args).toEqual(expect.arrayContaining(['--use-extractors', 'youtube', '--no-playlist', '--extra-x']))
      expect(c.args.some((a) => /cookie/i.test(a))).toBe(false)
      expect(c.args[c.args.indexOf('--ffmpeg-location') + 1]).toBe(cfg.ffmpegPath)
      expect(c.args[c.args.length - 2]).toBe('--')
      expect(URL_RE.test(c.args[c.args.length - 1]!)).toBe(true)
      expect(c.args[c.args.length - 1]).toBe('https://www.youtube.com/watch?v=AkX6uA4BaDs')
    }
  })

  it('작성자 자막이 없고 자동 자막만 있으면 자동 자막을 받는다', async () => {
    const w = fakeWorld({ meta: { subtitles: {}, automatic_captions: { 'ko-orig': [{ ext: 'json3' }] } } })
    const ev = await collect({ source_key: 'youtube:AkX6uA4BaDs' }, dir, cfg, async () => {}, { run: w.run, now })
    const subs = ytCalls(w.calls, cfg.ytDlpPath).find((c) => c.args.includes('--write-auto-subs'))!
    expect(subs.args).not.toContain('--write-subs')
    expect(ev.transcript?.kind).toBe('caption_auto')
  })

  it('한국어 자막이 없으면 오디오를 받아 16kHz 모노 wav로 바꿔 받아쓴다(재료 이름이 처음 말)', async () => {
    const w = fakeWorld({ meta: { subtitles: {}, automatic_captions: {} } })
    const stages: string[] = []
    const ev = await collect({ source_key: 'youtube:AkX6uA4BaDs' }, dir, cfg, async (s) => { stages.push(s) }, { run: w.run, now })
    expect(stages).toEqual(['영상 정보 받는 중', '자막 받는 중', '말 받아쓰는 중', '화면 글자 읽는 중'])
    expect(ev.transcript).toEqual({ kind: 'asr', segments: [{ start: 0, text: '받아쓴 말' }] })
    const ff = w.calls.find((c) => c.file === cfg.ffmpegPath && c.args.some((a) => a.endsWith('.wav')))!
    expect(ff.args).toEqual(expect.arrayContaining(['-ar', '16000', '-ac', '1']))
    const wh = w.calls.find((c) => c.file === cfg.whisperCliPath)!
    expect(wh.args).toEqual(expect.arrayContaining(['-l', 'ko', '-oj', '-m', '/m/model.bin']))
    const prompt = wh.args[wh.args.indexOf('--prompt') + 1]!
    expect(prompt).toContain('간장')
    expect(prompt).toContain('대파')
  })

  it('받아쓴 말이 비어 있으면 transcript는 null', async () => {
    const w = fakeWorld({ meta: { subtitles: {}, automatic_captions: {} }, asrSegments: [] })
    const ev = await collect({ source_key: 'youtube:AkX6uA4BaDs' }, dir, cfg, async () => {}, { run: w.run, now })
    expect(ev.transcript).toBeNull()
  })

  it('길이 3601초면 영상은 받지 않고 실패한다', async () => {
    const w = fakeWorld({ meta: { duration: 3601 } })
    const e = await collect({ source_key: 'youtube:AkX6uA4BaDs' }, dir, cfg, async () => {}, { run: w.run, now }).catch((x: unknown) => x)
    expect((e as Error).message).toBe('영상이 너무 길어요(60분 넘음)')
    expect(e).toBeInstanceOf(JobFailed) // 다시 해도 같으므로 일 고리가 바로 실패로 끝내는 오류다
    const yt = ytCalls(w.calls, cfg.ytDlpPath)
    expect(yt.length).toBe(1)
    expect(yt[0]!.args).toContain('-J')
  })

  it('3600초는 통과', async () => {
    const w = fakeWorld({ meta: { duration: 3600 } })
    const ev = await collect({ source_key: 'youtube:AkX6uA4BaDs' }, dir, cfg, async () => {}, { run: w.run, now })
    expect(ev.meta.duration).toBe(3600)
  })

  it('Private video → "비공개 영상이에요"만 던지고 stderr·경로는 담지 않는다', async () => {
    const w = fakeWorld({ ytFail: () => 'ERROR: [youtube] AkX6uA4BaDs: Private video. /Users/secret/path' })
    const e = await collect({ source_key: 'youtube:AkX6uA4BaDs' }, dir, cfg, async () => {}, { run: w.run, now }).catch((x: unknown) => x)
    expect((e as Error).message).toBe('비공개 영상이에요')
    expect(e).toBeInstanceOf(JobFailed)
  })

  it('그 밖의 실패는 "영상을 받지 못했어요"이고 일시 오류(JobFailed 아님)', async () => {
    const w = fakeWorld({ ytFail: () => 'ERROR: HTTP Error 403 /Users/secret' })
    const e = await collect({ source_key: 'youtube:AkX6uA4BaDs' }, dir, cfg, async () => {}, { run: w.run, now }).catch((x: unknown) => x)
    expect((e as Error).message).toBe('영상을 받지 못했어요')
    expect(e).not.toBeInstanceOf(JobFailed)
  })

  it('열쇠가 유튜브가 아니면 프로그램을 돌리기 전에 거절한다', async () => {
    const w = fakeWorld({})
    await expect(collect({ source_key: 'instagram:abc' }, dir, cfg, async () => {}, { run: w.run, now })).rejects.toThrow('영상을 받지 못했어요')
    expect(w.calls.length).toBe(0)
  })
})

describe('brew upgrade yt-dlp (서울 날짜 하루 한 번)', () => {
  it('그날 첫 일 전에 한 번, 같은 날 둘째 일은 건너뛰고, 다음 날 다시', async () => {
    const w = fakeWorld({})
    const brews = () => w.calls.filter((c) => c.file === cfg.brewPath)
    await collect({ source_key: 'youtube:AkX6uA4BaDs' }, dir, cfg, async () => {}, { run: w.run, now })
    expect(brews().length).toBe(1)
    expect(brews()[0]!.args).toEqual(['upgrade', 'yt-dlp'])
    // 브루가 yt-dlp보다 먼저
    expect(w.calls[0]!.file).toBe(cfg.brewPath)
    expect(readFileSync(join(cfg.cacheDir, '.yt-dlp-upgraded'), 'utf8').trim()).toBe('2026-11-19')
    await collect({ source_key: 'youtube:AkX6uA4BaDs' }, dir, cfg, async () => {}, { run: w.run, now: () => new Date('2026-11-19T23:00:00+09:00') })
    expect(brews().length).toBe(1)
    // 서울 자정을 넘기면(UTC로는 아직 같은 날 15시) 새 날
    await collect({ source_key: 'youtube:AkX6uA4BaDs' }, dir, cfg, async () => {}, { run: w.run, now: () => new Date('2026-11-19T15:30:00Z') })
    expect(brews().length).toBe(2)
    expect(readFileSync(join(cfg.cacheDir, '.yt-dlp-upgraded'), 'utf8').trim()).toBe('2026-11-20')
  })

  it('brew가 실패해도 그날 다시 돌리지 않고 일은 계속된다', async () => {
    const w = fakeWorld({})
    const run: Runner = async (file, args) => {
      if (file === cfg.brewPath) { w.calls.push({ file, args }); throw new Error('brew 실패') }
      return w.run(file, args)
    }
    await collect({ source_key: 'youtube:AkX6uA4BaDs' }, dir, cfg, async () => {}, { run, now })
    await collect({ source_key: 'youtube:AkX6uA4BaDs' }, dir, cfg, async () => {}, { run, now })
    expect(w.calls.filter((c) => c.file === cfg.brewPath).length).toBe(1)
  })

  it('받기가 실패해도 다시 올리거나 다시 받지 않는다', async () => {
    const w1 = fakeWorld({ ytFail: () => 'ERROR: boom' })
    await collect({ source_key: 'youtube:AkX6uA4BaDs' }, dir, cfg, async () => {}, { run: w1.run, now }).catch(() => {})
    expect(w1.calls.filter((c) => c.file === cfg.brewPath).length).toBe(1)
    expect(ytCalls(w1.calls, cfg.ytDlpPath).length).toBe(1)
  })
})

// ---- macOS 전용: 실제 ocr.swift ----

describe('ocr.swift', () => {
  it.skipIf(process.platform !== 'darwin')('만든 그림의 "간장 3T"를 읽는다', async () => {
    const work = mkdtempSync(join(tmpdir(), 'ocr-swift-'))
    try {
      const env = { ...process.env, CLANG_MODULE_CACHE_PATH: join(work, 'mc'), SWIFT_MODULECACHE_PATH: join(work, 'mc') }
      const gen = join(work, 'gen.swift')
      writeFileSync(gen, `import AppKit
let out = CommandLine.arguments[1]
let size = NSSize(width: 640, height: 180)
let img = NSImage(size: size)
img.lockFocus()
NSColor.white.setFill()
NSRect(origin: .zero, size: size).fill()
let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 90), .foregroundColor: NSColor.black]
("간장 3T" as NSString).draw(at: NSPoint(x: 30, y: 40), withAttributes: attrs)
img.unlockFocus()
let rep = NSBitmapImageRep(data: img.tiffRepresentation!)!
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
`)
      const genBin = join(work, 'gen')
      await execFileP('swiftc', ['-O', gen, '-o', genBin], { env })
      const png = join(work, 'test.png')
      await execFileP(genBin, [png], { env })
      expect(existsSync(png)).toBe(true)
      const ocrBin = join(work, 'ocr')
      await execFileP('swiftc', ['-O', join(import.meta.dirname, '../../../tools/recipe-worker/src/collect/ocr.swift'), '-o', ocrBin], { env })
      const { stdout } = await execFileP(ocrBin, [png, join(work, 'missing.png')], { env })
      const rows = stdout.trim().split('\n').map((l) => JSON.parse(l) as { path: string; lines: string[] })
      expect(rows.length).toBe(2)
      expect(rows[0]!.path).toBe(png)
      expect(rows[0]!.lines.join(' ')).toContain('간장 3T')
      expect(rows[1]!.lines).toEqual([]) // 없는 파일은 빈 목록(멈추지 않는다)
      expect(readdirSync(work).length).toBeGreaterThan(0)
    } finally {
      rmSync(work, { recursive: true, force: true })
    }
  }, 240_000)
})
