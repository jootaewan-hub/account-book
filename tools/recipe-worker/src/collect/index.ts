// 근거 모으기: 영상 정보 → 자막 → (한국어 자막이 없으면) 받아쓰기 → 장면·화면 글자.
// 파일은 모두 넘겨받은 작업 폴더 안에만 만든다.
import type { WorkerConfig } from '../config.ts'
import { ingredientNames, parseJson3, selectFrames, type Evidence } from '../evidence.ts'
import { extractFrames } from './frames.ts'
import { readScreenText } from './ocr.ts'
import { defaultRun, type Runner } from './run.ts'
import { FAIL_GENERIC, FAIL_TOO_LONG, MAX_SECONDS, createYtDlp, youtubeUrl } from './ytdlp.ts'
import { transcribe } from './whisper.ts'

export type CollectDeps = { run: Runner; now: () => Date }

export async function collect(
  job: { source_key: string },
  dir: string,
  cfg: WorkerConfig,
  onStage: (stage: string) => Promise<void>,
  deps: Partial<CollectDeps> = {},
): Promise<Evidence> {
  const run = deps.run ?? defaultRun
  const url = youtubeUrl(job.source_key)
  const yt = createYtDlp(cfg, run, deps.now ?? (() => new Date()))

  await onStage('영상 정보 받는 중')
  const { captions, ...meta } = await yt.meta(url)
  if (meta.duration > MAX_SECONDS) throw new Error(FAIL_TOO_LONG)
  const names = ingredientNames(meta.description)

  await onStage('자막 받는 중')
  let transcript: Evidence['transcript'] = null
  if (captions) {
    const json = await yt.subs(url, dir, captions)
    const segments = json ? parseJson3(json) : []
    if (segments.length > 0) transcript = { kind: captions === 'manual' ? 'caption_manual' : 'caption_auto', segments }
  }

  if (!transcript) {
    await onStage('말 받아쓰는 중')
    const audio = await yt.audio(url, dir)
    let segments
    try {
      segments = await transcribe(audio, dir, cfg, names, run)
    } catch {
      throw new Error(FAIL_GENERIC)
    }
    if (segments.length > 0) transcript = { kind: 'asr', segments }
  }

  await onStage('화면 글자 읽는 중')
  const video = await yt.video(url, dir)
  let all
  let ocr
  try {
    all = await extractFrames(video, dir, cfg, run)
    ocr = await readScreenText(all, cfg, run)
  } catch {
    throw new Error(FAIL_GENERIC)
  }
  return { meta, transcript, ocr, frames: selectFrames(all, ocr, names) }
}
