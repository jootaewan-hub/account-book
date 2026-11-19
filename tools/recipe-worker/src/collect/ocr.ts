// 화면 글자 읽기: 컴파일해 둔 ocr 실행 파일(ocr.swift)에 그림 경로를 넘기고, 경로를 장면 초로 되돌린다.
import type { WorkerConfig } from '../config.ts'
import type { Frame, OcrLine } from '../evidence.ts'
import type { Runner } from './run.ts'

const CHUNK = 40

export function parseOcrOutput(stdout: string, frames: Frame[]): OcrLine[] {
  const byPath = new Map(frames.map((f) => [f.path, f.t]))
  const out: OcrLine[] = []
  for (const row of stdout.split('\n')) {
    if (!row.trim()) continue
    let j: unknown
    try { j = JSON.parse(row) } catch { continue }
    if (typeof j !== 'object' || j === null) continue
    const { path, lines } = j as { path?: unknown; lines?: unknown }
    if (typeof path !== 'string' || !Array.isArray(lines)) continue
    const t = byPath.get(path)
    if (t === undefined) continue
    for (const l of lines) if (typeof l === 'string' && l.trim()) out.push({ t, text: l.trim() })
  }
  return out
}

export async function readScreenText(frames: Frame[], cfg: WorkerConfig, run: Runner): Promise<OcrLine[]> {
  const out: OcrLine[] = []
  for (let i = 0; i < frames.length; i += CHUNK) {
    const chunk = frames.slice(i, i + CHUNK)
    const { stdout } = await run(cfg.ocrPath, chunk.map((f) => f.path))
    out.push(...parseOcrOutput(stdout.toString('utf8'), chunk))
  }
  return out.sort((a, b) => a.t - b.t)
}
