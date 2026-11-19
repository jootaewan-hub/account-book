// claude -p 부르기. 실행 파일 전체 경로를 쓰고(launchd는 셸 별칭을 읽지 않는다), 셸 없이 인자 배열로 부른다.
// 도구는 그 일의 작업 폴더 Read만 허락한다. 프롬프트는 stdin으로 넘겨 인자·프로세스 목록에 남지 않게 한다.
// 사용자의 Claude Code 설정(허락 규칙·자동 모드·훅·플러그인·CLAUDE.md·기억·스킬)을 물려받지 않고, 세션을 디스크에 남기지 않는다
// (프롬프트에 설명란·자막·받아쓰기·화면 글자가 들어 있다). 구독 로그인은 그대로 쓴다(--bare는 구독 로그인을 쓰지 않아 쓰지 않는다).
import { execFile } from 'node:child_process'
import { userInfo } from 'node:os'
import { isAbsolute } from 'node:path'
import type { WorkerConfig } from './config.ts'
import { RateLimited } from './loop.ts'

/** 호출 한 번의 사용량(claude -p --output-format json의 usage·total_cost_usd·modelUsage). 값이 없으면 0 */
export type ClaudeCallUsage = {
  cost_usd: number
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
  models: string[]
}

/** onUsage: 결과(성공·오류 모두)마다 그 호출의 사용량을 함께 알린다. 결과 글은 그대로 돌려준다 */
export type ClaudeRun = (prompt: string, opts: { jobDir: string; images?: string[]; onUsage?: (u: ClaudeCallUsage) => void }) => Promise<string>

/**
 * 격리 인자(설치된 CLI 2.1.327의 --help로 확인한 것).
 * - --no-session-persistence: 세션을 ~/.claude/projects에 남기지 않는다.
 * - --restricted: 사용자·프로젝트·로컬 설정 파일을 읽지 않는다(허락 규칙·defaultMode·훅·플러그인 켜기). 파일 도구는 작업 폴더 안으로만.
 * - --safe-mode: CLAUDE.md·기억·스킬·설치된 플러그인·훅·MCP 서버 같은 사용자 꾸밈을 끈다(로그인·모델·내장 도구는 그대로).
 * - --settings {"disableAllHooks":true}: 남는 훅도 끈다.
 * - --permission-mode dontAsk, --permission-prompts none: 묻지 않고, 허락 규칙(작업 폴더 Read)에 없는 것은 거절한다.
 * - --disable-slash-commands: 스킬·명령 목록을 싣지 않는다. --strict-mcp-config: MCP 서버를 켜지 않는다.
 */
export const ISOLATION_ARGS = [
  '--no-session-persistence',
  '--restricted',
  '--safe-mode',
  '--settings',
  '{"disableAllHooks":true}',
  '--permission-mode',
  'dontAsk',
  '--permission-prompts',
  'none',
  '--disable-slash-commands',
  '--strict-mcp-config',
] as const

const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)
const MODEL_NAME = /^[A-Za-z0-9._:@-]{1,80}$/

/** JSON 결과에서 사용량만 읽는다(글은 읽지 않는다) */
export function usageOf(j: Record<string, unknown>): ClaudeCallUsage {
  const u = typeof j.usage === 'object' && j.usage !== null ? (j.usage as Record<string, unknown>) : {}
  const models = typeof j.modelUsage === 'object' && j.modelUsage !== null ? Object.keys(j.modelUsage).filter((k) => MODEL_NAME.test(k)) : []
  return {
    cost_usd: count(j.total_cost_usd),
    input_tokens: count(u.input_tokens),
    output_tokens: count(u.output_tokens),
    cache_creation_input_tokens: count(u.cache_creation_input_tokens),
    cache_read_input_tokens: count(u.cache_read_input_tokens),
    models,
  }
}

/** 일 하나의 사용량 합. 글(프롬프트·결과)은 담지 않는다 */
export type UsageTotal = ClaudeCallUsage & { calls: number }

export function createUsageMeter(): { add: (u: ClaudeCallUsage) => void; total: () => UsageTotal } {
  const t: UsageTotal = { calls: 0, cost_usd: 0, input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, models: [] }
  return {
    add(u) {
      t.calls += 1
      t.cost_usd += u.cost_usd
      t.input_tokens += u.input_tokens
      t.output_tokens += u.output_tokens
      t.cache_creation_input_tokens += u.cache_creation_input_tokens
      t.cache_read_input_tokens += u.cache_read_input_tokens
      for (const m of u.models) if (!t.models.includes(m)) t.models.push(m)
    },
    total: () => ({ ...t, cost_usd: Math.round(t.cost_usd * 10_000) / 10_000, models: [...t.models] }),
  }
}

/** 처리기 기록 한 줄(내용 없이 수만). 값은 CLI가 알린 것이고, 금액은 정가 기준 추정이다 */
export function usageLine(t: UsageTotal): string {
  return `Claude ${t.calls}번 · 입력 ${t.input_tokens} · 캐시 생성 ${t.cache_creation_input_tokens} · 캐시 읽기 ${t.cache_read_input_tokens} · 출력 ${t.output_tokens} 토큰 · 정가 기준 $${t.cost_usd.toFixed(4)}`
}

type ExecCb = (err: Error | null, stdout: string, stderr: string) => void
type ExecLike = (
  file: string,
  args: string[],
  opts: { cwd: string; timeout: number; maxBuffer: number; encoding: 'utf8'; windowsHide: boolean; env: NodeJS.ProcessEnv },
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

/**
 * 처리기의 환경에 USER·LOGNAME이 없으면 채운다. 없으면 CLI가 키체인의 구독 로그인을 찾지 못해 "로그인 안 됨"으로 끝난다
 * (2026-11-19에 HOME·PATH만 준 환경에서 loggedIn false를 확인했다). 그 밖의 값은 그대로 넘긴다.
 */
export function claudeEnv(base: NodeJS.ProcessEnv = process.env, user: () => string = () => userInfo().username): NodeJS.ProcessEnv {
  if (base.USER && base.LOGNAME) return base
  const name = base.USER ?? base.LOGNAME ?? user()
  return { ...base, USER: base.USER ?? name, LOGNAME: base.LOGNAME ?? name }
}

export function createClaudeRun(cfg: WorkerConfig, exec: ExecLike = execFile as unknown as ExecLike, now: () => Date = () => new Date()): ClaudeRun {
  return (prompt, { jobDir, onUsage }) =>
    new Promise<string>((resolve, reject) => {
      // 빈 값이나 상대 경로면 Read 허락 규칙이 너른 범위로 읽힐 수 있다
      if (!jobDir || !isAbsolute(jobDir)) return reject(new Error('작업 폴더가 올바르지 않아요'))
      const args = [
        '-p',
        '--output-format',
        'json',
        ...ISOLATION_ARGS,
        '--allowedTools',
        // 절대 경로는 `//`로 시작해야 프로젝트 기준 상대 경로로 읽히지 않는다(Task 14 A2에서 작업 폴더의 그림 읽기를 확인했다).
        `Read(//${jobDir.replace(/^\/+/, '')}/**)`,
        // 쓸 수 있는 도구 자체를 Read 하나로 줄인다(허락 규칙은 그 도구가 어디를 읽을 수 있는지만 정한다).
        '--tools',
        'Read',
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
        { cwd: jobDir, timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8', windowsHide: true, env: claudeEnv() },
        (err, stdout, stderr) => {
          let parsed: { is_error?: unknown; result?: unknown } | null = null
          try {
            const j: unknown = JSON.parse(String(stdout))
            if (typeof j === 'object' && j !== null) parsed = j as { is_error?: unknown; result?: unknown }
          } catch {
            parsed = null
          }
          // 오류로 끝난 호출도 사용량을 쓴다(사용량 제한·없는 모델도 종료 코드 0과 is_error로 온다)
          if (parsed) {
            try { onUsage?.(usageOf(parsed as Record<string, unknown>)) } catch {}
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
