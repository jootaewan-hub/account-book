// 일 고리: 한 번에 일 하나. 켜진 시간·하루 한도를 지키고, 처리 중에는 30초마다 진행을 알린다.
import { RECIPE_EXISTS } from '../../../supabase/functions/_shared/recipeWorkerStatus.ts'
import { ApiError, type SubmitResult, type WorkerApi } from './api.ts'
import type { WorkerConfig } from './config.ts'
import { FAIL_EXISTS, FAIL_FORMAT, JobFailed } from './errors.ts'
import type { DictEntry, RecipeV2 } from './types.ts'

/** 처리 중 속도 제한을 만났다. retryAt 이후에 다시 시도하게 일을 돌려놓는다 */
export class RateLimited extends Error {
  retryAt: Date
  constructor(retryAt: Date, message = '잠시 쉬었다 다시 해요') {
    super(message)
    this.name = 'RateLimited'
    this.retryAt = retryAt
  }
}

/** 서버가 그 일을 더 이상 처리 중으로 보지 않는다 */
class JobGone extends Error {}

export type LoopDeps = {
  api: WorkerApi
  process: (job: { id: string; url: string }, onStage: (stage: string) => Promise<void>) => Promise<{ recipe: RecipeV2; dict: DictEntry[] }>
  now: () => Date
  doneToday: () => number
  cfg: WorkerConfig
  /**
   * 맡은 일 하나가 끝날 때 부른다(하루 세기용): 끝냄·실패·버려 둠은 세고, 돌려놓은 일(사용량 제한·서버 횟수 한도)은 세지 않는다.
   * 돌려놓은 일은 Claude를 다 쓰지 못했고 나중에 다시 하므로, 세면 사용량 제한 한 번에 그날 한도를 다 쓸 수 있다.
   */
  onCounted?: () => void
  /** 사용량 제한으로 돌려놓은 뒤 이 시각(ms)까지는 일을 가져오지 않는다. startLoop가 만든다 */
  state?: LoopState
  /** 일정한 간격으로 fn을 부르고, 멈추는 함수를 돌려준다. 시험에서 가짜로 바꾼다 */
  every?: (ms: number, fn: () => void) => () => void
  /** 처리 시작·끝(밤새 깨어 있기용) */
  onBusy?: (busy: boolean) => void
  /** 일이 없을 때 돌리는 사본 고리. 건수를 돌려준다(10건이면 더 있을 수 있어 바로 다시 돈다) */
  exportPass?: () => Promise<number>
}

/** 사본 고리는 아무리 자주 돌아도 이 간격보다 촘촘하지 않다 */
export const EXPORT_EVERY_MS = 2 * 60_000

export type RunResult = 'idle' | 'done' | 'failed' | 'released' | 'limited' | 'paused'
export type LoopState = { pausedUntil: number }

/** 보내기가 서버 횟수 한도(429)에 끝내 막히면 이만큼 뒤로 돌려놓는다 */
const SUBMIT_RETRY_MS = 60_000
const FAIL_SUBMIT = '레시피를 등록하지 못했어요'

/** 보내기가 거절된 까닭(대기 줄에 남는 글). 정해 둔 글만 쓴다 */
function submitReason(res: Exclude<SubmitResult, { ok: true }>): string {
  if (res.status === 409 && res.code === RECIPE_EXISTS) return FAIL_EXISTS
  return res.status === 422 ? FAIL_FORMAT : FAIL_SUBMIT
}

export const HEARTBEAT_MS = 30_000
const SEOUL = 'Asia/Seoul'
const FIRST_STAGE = '영상 정보 받는 중'

function realEvery(ms: number, fn: () => void): () => void {
  const t = setInterval(fn, ms)
  return () => clearInterval(t)
}

/** 서울 달력 날짜(YYYY-MM-DD) */
export function seoulDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SEOUL, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

/** 서울 시각의 하루 중 분(0~1439) */
function seoulMinutes(d: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: SEOUL, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  return get('hour') * 60 + get('minute')
}

const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

/** 켜진 시간인가(서울 시각). 끝이 시작보다 이르면 자정을 넘는 구간이다. 시작은 포함, 끝은 제외 */
export function isOnHours(now: Date, onHours: [string, string][]): boolean {
  const m = seoulMinutes(now)
  return onHours.some(([from, to]) => {
    const a = toMinutes(from)
    const b = toMinutes(to)
    return a <= b ? m >= a && m < b : m >= a || m < b
  })
}

/** 오늘(서울 날짜) 맡은 일 수. 메모리에만 두고 서울 자정에 0으로 돌아간다 */
export function createDailyCounter(now: () => Date): { doneToday: () => number; increment: () => void } {
  let day = seoulDate(now())
  let n = 0
  const roll = () => {
    const today = seoulDate(now())
    if (today !== day) { day = today; n = 0 }
  }
  return {
    doneToday: () => { roll(); return n },
    increment: () => { roll(); n += 1 },
  }
}

/** 일 하나를 가져와 끝까지 한다 */
export async function runOnce(deps: LoopDeps): Promise<RunResult> {
  const { api, cfg } = deps
  if (deps.doneToday() >= cfg.dailyLimit) return 'limited'
  // 사용량 제한을 만났으면 풀릴 때까지 다음 일을 가져오지 않는다(가져와 모으기만 하고 다시 돌려놓는 일을 막는다)
  if (deps.state && deps.now().getTime() < deps.state.pausedUntil) return 'paused'
  let job: Awaited<ReturnType<WorkerApi['claim']>>
  try {
    job = await api.claim()
  } catch (e) {
    // 우리 서버의 횟수 한도(429): 일을 건드린 것이 아니므로 일이 없을 때와 같이 다음 확인을 기다린다
    if (e instanceof ApiError && e.status === 429) return 'idle'
    throw e
  }
  if (!job) return 'idle'

  deps.onBusy?.(true)
  let counted = true
  let lastStage = FIRST_STAGE
  let gone = false
  const stopBeat = (deps.every ?? realEvery)(HEARTBEAT_MS, () => {
    api.progress(job.id, lastStage).then((ok) => { if (!ok) gone = true }, () => {})
  })

  try {
    let produced: { recipe: RecipeV2; dict: DictEntry[] }
    try {
      produced = await deps.process({ id: job.id, url: job.url }, async (stage) => {
        if (gone) throw new JobGone()
        lastStage = stage
        if (!(await api.progress(job.id, stage))) {
          gone = true
          throw new JobGone()
        }
      })
    } catch (e) {
      if (e instanceof RateLimited) {
        counted = false
        if (deps.state) deps.state.pausedUntil = e.retryAt.getTime()
        await api.release(job.id, e.retryAt.toISOString())
        return 'released'
      }
      // 다시 해도 같은 실패(너무 긴·비공개·볼 수 없는 영상, 형식이 끝내 맞지 않음): 정해 둔 까닭으로 바로 실패로 끝낸다
      if (e instanceof JobFailed && !gone) {
        await api.fail(job.id, e.reason)
        return 'failed'
      }
      // 그 밖의 오류(일이 없어진 것 포함): 아무것도 더 부르지 않는다. 임대가 끝나면 서버가 다시 맡기고 시도 횟수를 센다.
      return 'failed'
    }
    if (gone) return 'failed'

    let res: SubmitResult
    try {
      res = await api.submit(job.id, produced.recipe, produced.dict)
    } catch (e) {
      // 서버 횟수 한도에 끝내 막혔다: 끝낸 일을 버려 두지 않고 돌려놓는다(시도 횟수를 쓰지 않는다)
      if (e instanceof ApiError && e.status === 429) {
        counted = false
        await api.release(job.id, new Date(deps.now().getTime() + SUBMIT_RETRY_MS).toISOString())
        return 'released'
      }
      throw e
    }
    if (res.ok) return 'done'
    await api.fail(job.id, submitReason(res))
    return 'failed'
  } catch {
    // 보내기 500·네트워크 오류·fail/release 호출 실패: 임대 만료에 맡긴다
    return 'failed'
  } finally {
    stopBeat()
    deps.onBusy?.(false)
    if (counted) deps.onCounted?.()
  }
}

/** 간격마다 일을 가져온다(켜진 시간 밖에서도). 겹쳐 돌지 않는다. stop()은 돌던 일이 끝나기를 기다린다 */
export function startLoop(input: LoopDeps, intervalMs = 20_000): { stop: () => Promise<void> } {
  const deps: LoopDeps = { ...input, state: input.state ?? { pausedUntil: 0 } }
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let current: Promise<void> = Promise.resolve()
  let lastExport = -Infinity

  const tick = async () => {
    let next = intervalMs
    try {
      // 켜진 시간은 잠 막기(caffeinate)에만 쓴다. 깨어 있으면 시간과 상관없이 일을 가져온다.
      const r = await runOnce(deps)
      if (r === 'done') next = 0
      // 서버에 닿았고(claim이 던지지 않았다) 일이 돌고 있지 않을 때만. 같은 tick 안이라 일과 겹치지 않는다
      else if (deps.exportPass && (r === 'idle' || r === 'limited' || r === 'paused') && deps.now().getTime() - lastExport >= EXPORT_EVERY_MS) {
        lastExport = deps.now().getTime()
        try {
          if ((await deps.exportPass()) >= 10) lastExport = -Infinity
        } catch {
          console.error('사본을 만들지 못했어요')
        }
      }
    } catch {
      console.error('일을 가져오지 못했어요')
    }
    if (!stopped) timer = setTimeout(() => { current = tick() }, next)
  }
  current = tick()

  return {
    async stop() {
      stopped = true
      if (timer) clearTimeout(timer)
      await current
    },
  }
}
