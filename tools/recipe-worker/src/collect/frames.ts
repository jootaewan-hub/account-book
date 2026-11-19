// 장면: 1초에 한 장, 가로 720으로. 거의 같은 장은 16×16 작은 그림으로 견줘 버린다.
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { WorkerConfig } from '../config.ts'
import { dedupe, type Frame } from '../evidence.ts'
import type { Runner } from './run.ts'

const THUMB_BYTES = 16 * 16 * 3

export async function extractFrames(video: string, dir: string, cfg: WorkerConfig, run: Runner): Promise<Frame[]> {
  const framesDir = join(dir, 'frames')
  mkdirSync(framesDir, { recursive: true })
  await run(cfg.ffmpegPath, ['-nostdin', '-loglevel', 'error', '-y', '-i', video, '-vf', 'fps=1,scale=720:-2', '-q:v', '4', join(framesDir, 'f_%05d.jpg')])
  const files = readdirSync(framesDir).filter((f) => /^f_\d{5}\.jpg$/.test(f)).sort()
  // 같은 1초 간격으로 16×16 RGB 날 그림을 뽑아 견준다
  const { stdout } = await run(cfg.ffmpegPath, ['-nostdin', '-loglevel', 'error', '-i', video, '-vf', 'fps=1,scale=16:16', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
  const count = Math.min(files.length, Math.floor(stdout.length / THUMB_BYTES))
  const thumbs = Array.from({ length: count }, (_, t) => ({ t, pixels: new Uint8Array(stdout.subarray(t * THUMB_BYTES, (t + 1) * THUMB_BYTES)) }))
  const keep = new Set(dedupe(thumbs))
  const frames: Frame[] = []
  files.forEach((name, t) => {
    const path = join(framesDir, name)
    if (t < count && keep.has(t)) frames.push({ t, path })
    else rmSync(path, { force: true })
  })
  return frames
}
