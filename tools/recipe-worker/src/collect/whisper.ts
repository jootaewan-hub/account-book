// 받아쓰기: ffmpeg로 16kHz 모노 wav를 만들고 whisper-cli(-oj)로 한국어를 받아쓴다.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { WorkerConfig } from '../config.ts'
import { parseWhisperJson, type TranscriptSegment } from '../evidence.ts'
import type { Runner } from './run.ts'

export async function transcribe(audio: string, dir: string, cfg: WorkerConfig, names: string[], run: Runner): Promise<TranscriptSegment[]> {
  const wav = join(dir, 'audio.wav')
  await run(cfg.ffmpegPath, ['-nostdin', '-loglevel', 'error', '-y', '-i', audio, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav])
  const outBase = join(dir, 'asr')
  const args = ['-m', cfg.whisperModel, '-f', wav, '-l', 'ko', '-oj', '-of', outBase]
  const prompt = names.join(', ').slice(0, 200)
  if (prompt) args.push('--prompt', prompt)
  await run(cfg.whisperCliPath, args)
  return parseWhisperJson(JSON.parse(readFileSync(`${outBase}.json`, 'utf8')))
}
