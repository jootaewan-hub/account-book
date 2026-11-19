// 레시피 처리기(맥)가 부르는 서버 함수. 순수 처리(handle)만 둔다: 환경변수·Deno·npm: 가져오기는 index.ts에서 연결한다.
import { difficulty } from '../_shared/recipeClassify.ts'
import { parseRecipe, type RecipeV2 } from '../_shared/recipeContract.ts'
import type { ExportItem } from '../_shared/recipeStored.ts'
import { secretMatches } from '../_shared/secret.ts'

export const STAGES = [
  '영상 정보 받는 중', '자막 받는 중', '말 받아쓰는 중', '화면 글자 읽는 중', '레시피 정리 중', '다시 읽어 맞춰 보는 중', '저장 중',
] as const

export const MAX_BODY_BYTES = 1024 * 1024

/** 데이터베이스가 거절한 일. code는 PostgreSQL 오류 번호(23514 따위)만 담고 SQL 내용은 담지 않는다 */
export class DbError extends Error {
  constructor(public readonly code: string) {
    super(`db:${code}`)
  }
}

/**
 * DB 오류 번호 → 응답 상태. 일 자체가 거절된 영구 오류만 409(SQLSTATE 22·23 계열, 일이 없음 P0002, 처리 중 아님 55000).
 * 번호가 없거나(네트워크·게이트웨이) PGRST*(설정), 40001·40P01·57014 같은 일시 오류는 처리기가 다시 시도할 수 있게 500.
 */
export function statusForDbCode(code: string | undefined): 409 | 500 {
  if (!code || code.startsWith('PGRST')) return 500
  return code.startsWith('22') || code.startsWith('23') || code === 'P0002' || code === '55000' ? 409 : 500
}

export interface DictEntry { id: string; name: string; aliases: string[]; category: string; broader?: string | null }
export interface ClaimedJob { id: string; source_key: string }
/** exported_at: 지운 보고는 지금, 그 밖에는 처리기가 받은 사본의 updated_at 그대로(만드는 사이 고친 것이 다시 보관 대상으로 남게) */
export interface ExportedInput { recipe_id: string; drive_doc_id: string | null; drive_path: string | null; obsidian_path: string | null; exported_at: string }

export interface WorkerDeps {
  /** 비어 있으면 모든 요청을 401로 거절한다 */
  secret: string
  now: () => Date
  claim: (now: Date) => Promise<ClaimedJob | null>
  progress: (job: string, stage: string, now: Date) => Promise<boolean>
  release: (job: string, retryAt: string) => Promise<void>
  fail: (job: string, reason: string) => Promise<void>
  /** 계약 검사를 마친 레시피를 넣는다. 거절되면 DbError를 던진다 */
  importRecipe: (job: string, recipe: RecipeV2, level: string, basis: { required: number; steps: number; heavy: boolean }) => Promise<string>
  dictAdd: (entries: DictEntry[]) => Promise<void>
  listExports: (opts: { skip: string[]; need: ('drive' | 'obsidian')[] }) => Promise<ExportItem[]>
  /** 그 레시피가 없으면 false */
  exported: (input: ExportedInput) => Promise<boolean>
  ping: (version: string, now: Date) => Promise<void>
  dict: () => Promise<{ id: string; name: string; aliases: string[]; category: string }[]>
}

const headers = { 'Cache-Control': 'no-store' }
const json = (body: unknown, status = 200) => Response.json(body, { status, headers })
const bad = (error: string) => json({ error }, 400)

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isoDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/
const sourceKey = /^youtube:([A-Za-z0-9_-]{11})$/

type Body = Record<string, unknown>
const isUuid = (v: unknown): v is string => typeof v === 'string' && uuid.test(v)
const nullableText = (v: unknown, max: number): v is string | null => v === null || (typeof v === 'string' && v.length <= max)

function validDict(v: unknown): v is DictEntry[] {
  return Array.isArray(v) && v.length <= 100 && v.every((e) => {
    if (typeof e !== 'object' || e === null || Array.isArray(e)) return false
    const d = e as Body
    return typeof d.id === 'string' && /^[a-z0-9_]{1,60}$/.test(d.id)
      && typeof d.name === 'string' && d.name.length >= 1 && d.name.length <= 40
      && typeof d.category === 'string' && d.category.length > 0 && d.category.length <= 20
      && Array.isArray(d.aliases) && d.aliases.length <= 30 && d.aliases.every((a) => typeof a === 'string' && a.length >= 1 && a.length <= 40)
      && (d.broader === undefined || d.broader === null || (typeof d.broader === 'string' && /^[a-z0-9_]{1,60}$/.test(d.broader)))
  })
}

/** 본문을 실제로 읽은 바이트 수로 막는다(Content-Length가 없거나 거짓이어도) */
async function readBody(req: Request): Promise<{ text: string } | { tooLarge: true }> {
  const declared = Number(req.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return { tooLarge: true }
  const reader = req.body?.getReader()
  if (!reader) return { text: '' }
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BODY_BYTES) {
      await reader.cancel()
      return { tooLarge: true }
    }
    chunks.push(value)
  }
  const all = new Uint8Array(size)
  let at = 0
  for (const c of chunks) { all.set(c, at); at += c.byteLength }
  return { text: new TextDecoder().decode(all) }
}

export async function handle(req: Request, deps: WorkerDeps): Promise<Response> {
  if (req.method !== 'POST') return new Response(null, { status: 405, headers })
  // 비밀부터 본다: 본문을 읽거나 해석하기 전에, 비밀이 없거나 틀리면 아무 일도 하지 않는다.
  if (!(await secretMatches(req.headers.get('x-recipe-worker-secret') ?? '', deps.secret))) {
    return new Response(null, { status: 401, headers })
  }
  const read = await readBody(req)
  if ('tooLarge' in read) return json({ error: '본문이 너무 커요.' }, 413)
  let body: Body
  try {
    const parsed: unknown = JSON.parse(read.text)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return bad('JSON 객체가 필요해요.')
    body = parsed as Body
  } catch {
    return bad('JSON을 읽을 수 없어요.')
  }

  try {
    const now = deps.now()
    switch (body.action) {
      case 'claim': {
        const job = await deps.claim(now)
        if (!job) return json({ job: null })
        const m = sourceKey.exec(job.source_key)
        if (!m) return json({ error: 'source_key' }, 500)
        return json({ job: { id: job.id, url: `https://www.youtube.com/watch?v=${m[1]}`, source_key: job.source_key } })
      }
      case 'progress': {
        if (!isUuid(body.job)) return bad('job이 필요해요.')
        if (typeof body.stage !== 'string' || !(STAGES as readonly string[]).includes(body.stage)) return bad('stage가 올바르지 않아요.')
        return json({ ok: await deps.progress(body.job, body.stage, now) })
      }
      case 'submit': {
        if (!isUuid(body.job)) return bad('job이 필요해요.')
        const parsed = parseRecipe(body.recipe)
        if (!parsed.ok) return json({ errors: parsed.errors }, 422)
        if (body.dict !== undefined && body.dict !== null && !validDict(body.dict)) return bad('dict가 올바르지 않아요.')
        const { level, basis } = difficulty(parsed.value)
        try {
          if (Array.isArray(body.dict) && body.dict.length > 0) await deps.dictAdd(body.dict)
          return json({ recipe_id: await deps.importRecipe(body.job, parsed.value, level, basis) })
        } catch (e) {
          if (e instanceof DbError && statusForDbCode(e.code) === 409) return json({ error: '레시피를 등록하지 못했어요.', code: e.code }, 409)
          throw e
        }
      }
      case 'release': {
        if (!isUuid(body.job)) return bad('job이 필요해요.')
        if (typeof body.retry_at !== 'string' || !Number.isFinite(Date.parse(body.retry_at))) return bad('retry_at이 필요해요.')
        await deps.release(body.job, new Date(body.retry_at).toISOString())
        return json({ ok: true })
      }
      case 'fail': {
        if (!isUuid(body.job)) return bad('job이 필요해요.')
        const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
        if (reason.length < 1 || reason.length > 200) return bad('reason은 1~200자예요.')
        await deps.fail(body.job, reason)
        return json({ ok: true })
      }
      case 'exports': {
        const skip = body.skip ?? []
        if (!Array.isArray(skip) || skip.length > 100 || !skip.every(isUuid)) return bad('skip이 올바르지 않아요.')
        const need = body.need ?? []
        if (!Array.isArray(need) || need.length > 2 || !need.every((n) => n === 'drive' || n === 'obsidian')) return bad('need가 올바르지 않아요.')
        return json({ items: await deps.listExports({ skip: skip as string[], need: need as ('drive' | 'obsidian')[] }) })
      }
      case 'exported': {
        if (!isUuid(body.recipe_id)) return bad('recipe_id가 필요해요.')
        if (!nullableText(body.drive_doc_id, 200) || !nullableText(body.drive_path, 500) || !nullableText(body.obsidian_path, 500)) {
          return bad('보관 경로가 올바르지 않아요.')
        }
        const trash = body.drive_doc_id === null && body.drive_path === null && body.obsidian_path === null
        if (!trash && (typeof body.snapshot_updated_at !== 'string' || !isoDateTime.test(body.snapshot_updated_at) || !Number.isFinite(Date.parse(body.snapshot_updated_at)))) {
          return bad('snapshot_updated_at이 필요해요.')
        }
        const found = await deps.exported({
          recipe_id: body.recipe_id, drive_doc_id: body.drive_doc_id, drive_path: body.drive_path, obsidian_path: body.obsidian_path,
          exported_at: trash ? now.toISOString() : (body.snapshot_updated_at as string),
        })
        return found ? json({ ok: true }) : json({ error: '레시피를 찾을 수 없어요.' }, 404)
      }
      case 'ping': {
        if (typeof body.version !== 'string' || body.version.length < 1 || body.version.length > 80) return bad('version이 필요해요.')
        await deps.ping(body.version, now)
        return json({ ok: true })
      }
      case 'dict':
        return json({ entries: await deps.dict() })
      default:
        return bad('알 수 없는 action이에요.')
    }
  } catch {
    // 일의 식별자나 DB 내용이 로그·응답에 남지 않게 한다.
    return new Response(null, { status: 500, headers })
  }
}
