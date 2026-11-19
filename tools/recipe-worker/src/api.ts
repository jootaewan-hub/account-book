// 서버 함수(recipe-worker)를 부르는 얇은 겹. 동작마다 메서드 하나. 비밀은 요청 머리글에만 쓰고 오류 글에는 넣지 않는다.
import type { DictEntry, ExportItem, Job, RecipeV2 } from './types.ts'

/** 서버가 2xx가 아닌 답을 했거나(status = HTTP 상태) 네트워크가 끊겼다(status = 0) */
export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export type SubmitResult =
  | { ok: true; recipeId: string }
  | { ok: false; status: 409 | 422; errors: string[] }

export type ExportedInput = {
  recipe_id: string
  drive_doc_id: string | null
  drive_path: string | null
  obsidian_path: string | null
  snapshot_updated_at: string | null
}

export type WorkerApi = {
  claim(): Promise<Job | null>
  /** false면 그 일이 없어졌거나 처리 중이 아니다 → 그만둔다 */
  progress(job: string, stage: string): Promise<boolean>
  submit(job: string, recipe: RecipeV2, dict: DictEntry[]): Promise<SubmitResult>
  fail(job: string, reason: string): Promise<void>
  release(job: string, retryAt: string): Promise<void>
  exports(): Promise<ExportItem[]>
  exported(input: ExportedInput): Promise<boolean>
  ping(version: string): Promise<void>
  dict(): Promise<{ id: string; name: string; aliases: string[]; category: string }[]>
}

const TIMEOUT_MS = 30_000

export function createApi(endpoint: string, secret: string, fetchImpl: typeof fetch = fetch): WorkerApi {
  async function post(body: Record<string, unknown>): Promise<Response> {
    try {
      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-recipe-worker-secret': secret },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        // 3xx가 비밀 머리글을 다른 곳으로 실어 가지 못하게 한다
        redirect: 'error',
      })
      // 3xx는 따라가지 않는다(fetch가 던지지만, 대리 구현이 돌려줘도 같은 취급)
      if (res.status >= 300 && res.status < 400) throw new Error('redirect')
      return res
    } catch {
      throw new ApiError(0, '서버에 닿지 못했어요')
    }
  }
  async function call<T>(body: Record<string, unknown>): Promise<T> {
    const res = await post(body)
    if (!res.ok) throw new ApiError(res.status, `서버가 ${res.status}로 답했어요`)
    try {
      return (await res.json()) as T
    } catch {
      throw new ApiError(res.status, '서버 답을 읽을 수 없어요')
    }
  }

  return {
    async claim() {
      return (await call<{ job: Job | null }>({ action: 'claim' })).job
    },
    async progress(job, stage) {
      return (await call<{ ok: boolean }>({ action: 'progress', job, stage })).ok === true
    },
    async submit(job, recipe, dict) {
      const res = await post({ action: 'submit', job, recipe, dict })
      if (res.status === 200) {
        try {
          return { ok: true, recipeId: ((await res.json()) as { recipe_id: string }).recipe_id }
        } catch {
          throw new ApiError(200, '서버 답을 읽을 수 없어요')
        }
      }
      if (res.status === 409 || res.status === 422) {
        let errors: string[] = []
        try {
          const j = (await res.json()) as { errors?: unknown }
          if (Array.isArray(j.errors)) errors = j.errors.filter((e): e is string => typeof e === 'string')
        } catch {}
        return { ok: false, status: res.status, errors }
      }
      throw new ApiError(res.status, `서버가 ${res.status}로 답했어요`)
    },
    async fail(job, reason) {
      await call({ action: 'fail', job, reason })
    },
    async release(job, retryAt) {
      await call({ action: 'release', job, retry_at: retryAt })
    },
    async exports() {
      return (await call<{ items: ExportItem[] }>({ action: 'exports' })).items
    },
    async exported(input) {
      const res = await post({ action: 'exported', ...input })
      if (res.status === 404) return false
      if (!res.ok) throw new ApiError(res.status, `서버가 ${res.status}로 답했어요`)
      return true
    },
    async ping(version) {
      await call({ action: 'ping', version })
    },
    async dict() {
      return (await call<{ entries: { id: string; name: string; aliases: string[]; category: string }[] }>({ action: 'dict' })).entries
    },
  }
}
