// claude -p 부르기. 실행 파일 전체 경로를 쓰고(launchd는 셸 별칭을 읽지 않는다), 셸 없이 인자 배열로 부른다.
// 도구는 그 일의 작업 폴더 Read만 허락한다. 프롬프트는 stdin으로 넘겨 인자·프로세스 목록에 남지 않게 한다.
import { execFile } from 'node:child_process'
import { isAbsolute } from 'node:path'
import type { WorkerConfig } from './config.ts'
import { RateLimited } from './loop.ts'

export type ClaudeRun = (prompt: string, opts: { jobDir: string; images?: string[] }) => Promise<string>

type ExecCb = (err: Error | null, stdout: string, stderr: string) => void
type ExecLike = (
  file: string,
  args: string[],
  opts: { cwd: string; timeout: number; maxBuffer: number; encoding: 'utf8'; windowsHide: boolean },
  cb: ExecCb,
) => { stdin: { on(ev: 'error', cb: () => void): unknown; end(data?: string): unknown } | null }

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

const MIN_WAIT_MS = 5 * 60_000
const MAX_WAIT_MS = 24 * 60 * 60_000

function rateLimited(text: string, now: Date): RateLimited {
  const at = parseResetTime(text, now)
  // 시각이 있으면 1분 여유를 두고, 없으면 한 시간 뒤. 어느 쪽이든 5분~24시간 안으로 가둔다(글에서 읽은 값을 그대로 믿지 않는다).
  const want = at ? at.getTime() + 60_000 : now.getTime() + FALLBACK_WAIT_MS
  const t = Math.min(Math.max(want, now.getTime() + MIN_WAIT_MS), now.getTime() + MAX_WAIT_MS)
  return new RateLimited(new Date(t))
}

export function createClaudeRun(cfg: WorkerConfig, exec: ExecLike = execFile as unknown as ExecLike, now: () => Date = () => new Date()): ClaudeRun {
  return (prompt, { jobDir }) =>
    new Promise<string>((resolve, reject) => {
      // 빈 값이나 상대 경로면 Read 허락 규칙이 너른 범위로 읽힐 수 있다
      if (!jobDir || !isAbsolute(jobDir)) return reject(new Error('작업 폴더가 올바르지 않아요'))
      const args = [
        '-p',
        '--output-format',
        'json',
        '--allowedTools',
        // 절대 경로는 `//`로 시작해야 프로젝트 기준 상대 경로로 읽히지 않는다. 실제 동작은 Task 14(A2)에서 확인한다.
        `Read(//${jobDir.replace(/^\/+/, '')}/**)`,
        // 허락 규칙은 자동 승인일 뿐이라, 쓸 수 있는 도구 자체를 Read 하나로 줄이고 MCP 서버도 끈다.
        '--tools',
        'Read',
        '--strict-mcp-config',
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
        (err, stdout, stderr) => {
          let parsed: { is_error?: unknown; result?: unknown } | null = null
          try {
            const j: unknown = JSON.parse(String(stdout))
            if (typeof j === 'object' && j !== null) parsed = j as { is_error?: unknown; result?: unknown }
          } catch {
            parsed = null
          }
          const result = typeof parsed?.result === 'string' ? parsed.result : ''
          // 사용량 제한은 CLI가 오류라고 알릴 때(is_error 또는 비정상 종료)만, 그 오류 글에서 읽는다. 성공한 결과는 제어 신호로 보지 않는다.
          const failed = parsed?.is_error === true || err !== null
          if (failed) {
            const text = result || String(stderr ?? '')
            if (LIMIT_WORDS.test(text)) return reject(rateLimited(text, now()))
            return reject(new Error(parsed?.is_error === true ? 'Claude가 오류로 끝났어요' : 'Claude 실행이 실패했어요'))
          }
          if (!parsed) return reject(new Error('Claude 결과를 읽을 수 없어요'))
          resolve(result)
        },
      )
      child.stdin?.on('error', () => {}) // 일찍 끝난 프로그램에 쓰다 나는 EPIPE로 처리기가 죽지 않게. 실패는 위 콜백이 알린다.
      child.stdin?.end(prompt)
    })
}
