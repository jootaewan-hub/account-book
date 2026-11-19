// claude -p 부르기. 실행 파일 전체 경로를 쓰고(launchd는 셸 별칭을 읽지 않는다), 셸 없이 인자 배열로 부른다.
// 도구는 그 일의 작업 폴더 Read만 허락한다. 프롬프트는 stdin으로 넘겨 인자·프로세스 목록에 남지 않게 한다.
import { execFile } from 'node:child_process'
import type { WorkerConfig } from './config.ts'
import { RateLimited } from './loop.ts'

export type ClaudeRun = (prompt: string, opts: { jobDir: string; images?: string[] }) => Promise<string>

type ExecCb = (err: Error | null, stdout: string, stderr: string) => void
type ExecLike = (
  file: string,
  args: string[],
  opts: { cwd: string; timeout: number; maxBuffer: number; encoding: 'utf8'; windowsHide: boolean },
  cb: ExecCb,
) => { stdin: { end(data?: string): unknown } | null }

const TIMEOUT_MS = 15 * 60_000
const FALLBACK_WAIT_MS = 60 * 60_000
const LIMIT_WORDS = /usage limit|rate limit|limit reached|hit your limit|resets/i

/** "resets 3pm", "resets 3:30am (Asia/Seoul)", "…|1800000000" 같은 말에서 다시 할 수 있는 시각을 읽는다. 못 읽으면 null. */
export function parseResetTime(text: string, now: Date): Date | null {
  const epoch = /\|(\d{10})\b/.exec(text)
  if (epoch) return new Date(Number(epoch[1]) * 1000)
  const m = /resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i.exec(text)
  if (!m) return null
  let h = Number(m[1]) % 12
  if (m[3]!.toLowerCase() === 'pm') h += 12
  const t = new Date(now)
  t.setHours(h, Number(m[2] ?? 0), 0, 0)
  if (t.getTime() <= now.getTime()) t.setDate(t.getDate() + 1)
  return t
}

function rateLimited(text: string, now: Date): RateLimited {
  const at = parseResetTime(text, now)
  // 시각이 있으면 1분 여유를 두고, 없으면 한 시간 뒤
  const retry = at ? new Date(at.getTime() + 60_000) : new Date(now.getTime() + FALLBACK_WAIT_MS)
  return new RateLimited(retry)
}

export function createClaudeRun(cfg: WorkerConfig, exec: ExecLike = execFile as unknown as ExecLike, now: () => Date = () => new Date()): ClaudeRun {
  return (prompt, { jobDir }) =>
    new Promise<string>((resolve, reject) => {
      const args = [
        '-p',
        '--output-format',
        'json',
        '--allowedTools',
        `Read(${jobDir}/**)`,
        '--disallowedTools',
        'Bash',
        'Edit',
        'Write',
        'NotebookEdit',
        'WebFetch',
        'WebSearch',
        ...(cfg.claudeModel ? ['--model', cfg.claudeModel] : []),
      ]
      const child = exec(
        cfg.claudePath,
        args,
        { cwd: jobDir, timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8', windowsHide: true },
        (err, stdout) => {
          // 사용량 제한은 종료 코드가 0이 아니어도 표준 출력에 JSON으로 온다. 먼저 그것을 본다.
          let parsed: { is_error?: unknown; result?: unknown } | null = null
          try {
            const j: unknown = JSON.parse(String(stdout))
            if (typeof j === 'object' && j !== null) parsed = j as { is_error?: unknown; result?: unknown }
          } catch {
            parsed = null
          }
          const result = typeof parsed?.result === 'string' ? parsed.result : ''
          if (parsed?.is_error === true || (parsed && result.length < 400 && LIMIT_WORDS.test(result))) {
            if (LIMIT_WORDS.test(result)) return reject(rateLimited(result, now()))
            return reject(new Error('Claude가 오류로 끝났어요'))
          }
          if (err) return reject(new Error('Claude 실행이 실패했어요'))
          if (!parsed) return reject(new Error('Claude 결과를 읽을 수 없어요'))
          resolve(result)
        },
      )
      child.stdin?.end(prompt)
    })
}
