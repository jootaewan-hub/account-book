// 일 하나를 끝까지: 근거 모으기 → 정리(첫 읽기) → V1 기계 검사 → 두 번째 읽기(V2) → 다른 곳 가리기(V3) → 설명란과 말이 다른 곳(V4) → 저장할 결과.
// 작업 폴더는 cacheDir 아래 job-<일 번호>에 만들고, 성공하면 지우고 실패하면 남긴다(cleanCache가 하루 뒤 지운다).
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { parseRecipe } from '../../../supabase/functions/_shared/recipeContract.ts'
import type { Correction, ReviewItem } from '../../../supabase/functions/_shared/recipeContract.ts'
import { normalizeRecipeUrl } from '../../../supabase/functions/_shared/recipeSource.ts'
import { createUsageMeter, type ClaudeRun, type UsageTotal } from './claude.ts'
import { collect as realCollect } from './collect/index.ts'
import type { WorkerConfig } from './config.ts'
import { FAIL_FORMAT, JobFailed } from './errors.ts'
import type { Evidence } from './evidence.ts'
import { RateLimited } from './loop.ts'
import { FAIL_VIDEO, STAGE_ORGANIZE, assertVideoId, organize } from './organize.ts'
import type { DictEntry, RecipeV2 } from './types.ts'
import { checkRecipe, unitlessReviews } from './verify/rules.ts'
import { DEFAULT_CAP, STAGE_SECOND, applyAmounts, diffReads, mergeChecks, resolveDiffs, secondRead } from './verify/second.ts'

export const STAGE_SAVE = '저장 중'
const JOB_PREFIX = 'job-'
const KEEP_MS = 25 * 60 * 60_000
const CONFLICT_REASON = '출처끼리 값이 달라 확인 필요'

export type CollectFn = (job: { source_key: string }, dir: string, cfg: WorkerConfig, onStage: (stage: string) => Promise<void>) => Promise<Evidence>

export type PipelineDeps = {
  cfg: WorkerConfig
  run: ClaudeRun
  dict: { id: string; name: string; aliases: string[] }[]
  onStage: (stage: string) => Promise<void>
  collect?: CollectFn
  now?: () => Date
  /** 설명란을 비우고 읽는다(영상만으로 얼마나 읽는지 재는 데 쓴다) */
  noDescription?: boolean
  /** 이 일의 Claude 사용량을 모은다(실패해도 부른 쪽이 읽을 수 있게 밖에서 줄 수 있다) */
  meter?: ReturnType<typeof createUsageMeter>
}

export type Stats = { numbers: { total: number; grounded: number; nulled: number }; reviews: number; corrections: number; usage: UsageTotal }

const clip = (s: string, n = 80) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

/** 숫자(분량·인분·타이머) 자리 수를 센다 */
function numberSlots(r: RecipeV2): boolean[] {
  return [...r.ingredients.map((g) => g.amount !== null), r.servings.value !== null, ...r.steps.map((s) => s.timer_seconds != null)]
}

/** 설명란과 말이 다른 곳(conflicts)마다 확인 필요를 하나 만든다. 같은 것이 이미 있으면 만들지 않는다. */
function conflictReviews(r: RecipeV2): ReviewItem[] {
  const out: ReviewItem[] = []
  const prior = r.review_items ?? []
  ;(r.conflicts ?? []).forEach((c, i) => {
    const target = `conflicts[${i}]`
    if (prior.some((x) => x.target === target && x.reason === CONFLICT_REASON)) return
    const at = c.video_start_seconds ?? null
    // 설명란 쪽은 영상의 몇 초가 아니므로 시각을 비운다
    const when = (o: string) => (o === 'description' ? null : at)
    out.push({
      target,
      reason: CONFLICT_REASON,
      candidates: [
        { value: clip(c.chosen), origin: c.chosen_origin, at_seconds: when(c.chosen_origin) },
        { value: clip(c.other), origin: c.other_origin, at_seconds: when(c.other_origin) },
      ],
    })
  })
  return out
}

export async function processJobDetailed(
  job: { id: string; url: string },
  deps: PipelineDeps,
): Promise<{ recipe: RecipeV2; dict: DictEntry[]; stats: Stats }> {
  const { cfg, onStage } = deps
  // 호출마다 사용량을 모은다(글은 모으지 않는다)
  const meter = deps.meter ?? createUsageMeter()
  const run: ClaudeRun = (prompt, o) => deps.run(prompt, { ...o, onUsage: (u) => { meter.add(u); o.onUsage?.(u) } })
  const norm = normalizeRecipeUrl(job.url)
  if (!norm) throw new Error(FAIL_VIDEO)
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(job.id)) throw new Error(FAIL_VIDEO)
  const jobDir = join(cfg.cacheDir, `${JOB_PREFIX}${job.id}`)
  await mkdir(jobDir, { recursive: true })

  const e = await (deps.collect ?? realCollect)({ source_key: norm.key }, jobDir, cfg, onStage)
  assertVideoId(e.meta.id)
  if (deps.noDescription) e.meta.description = ''

  await onStage(STAGE_ORGANIZE)
  const organized = await organize(e, run, deps.dict, {
    jobDir,
    source: { kind: norm.kind, key: norm.key, url: norm.url, duration_seconds: Math.max(1, Math.round(e.meta.duration)) },
    now: deps.now,
  })
  const slots0 = numberSlots(organized.recipe)

  // V1: 기계 검사(한 번만). 돌려받은 레시피에는 고친 곳·확인 필요가 이미 붙어 있다.
  const v1 = checkRecipe(organized.recipe, e)
  let recipe = v1.recipe

  // V2·V3: 두 번째 읽기가 틀렸거나 실패하면 이 검사만 건너뛴다(속도 제한은 일을 돌려놓아야 하므로 그대로 던진다)
  await onStage(STAGE_SECOND)
  const extraCorrections: Correction[] = []
  const extraReviews: ReviewItem[] = []
  try {
    const second = await secondRead(e, run, jobDir)
    const diffs = diffReads(recipe.ingredients, second)
    if (diffs.length > 0) {
      const v3 = await resolveDiffs(diffs, e, run, DEFAULT_CAP, { jobDir, others: recipe.ingredients.map((g) => g.name) })
      applyAmounts(recipe.ingredients, v3.applied)
      extraCorrections.push(...v3.corrections)
      extraReviews.push(...v3.reviews)
      // 고른 값의 단위를 근거에서 못 읽었으면(세는 재료가 아니면) 확인 필요(R3)
      if (v3.applied.length > 0) extraReviews.push(...unitlessReviews(recipe, e, v3.applied.map((a) => a.index)))
      if (v3.conflicts.length > 0) {
        recipe = structuredClone(recipe)
        recipe.conflicts = [...(recipe.conflicts ?? []), ...v3.conflicts].slice(0, 20)
      }
    }
  } catch (err) {
    if (err instanceof RateLimited) throw err
  }
  // V4
  extraReviews.push(...conflictReviews(recipe))

  recipe = structuredClone(recipe)
  mergeChecks(recipe, extraCorrections, extraReviews)

  const parsed = parseRecipe(recipe)
  // 검사를 거친 결과가 계약에 맞지 않으면 다시 해도 같다(같은 근거·같은 규칙)
  if (!parsed.ok) throw new JobFailed(FAIL_FORMAT)
  recipe = parsed.value

  const slots1 = numberSlots(recipe)
  const total = slots0.filter(Boolean).length
  const nulled = slots0.filter((was, i) => was && !slots1[i]).length
  await onStage(STAGE_SAVE)
  await rm(jobDir, { recursive: true, force: true })
  return {
    recipe,
    dict: organized.dict,
    stats: {
      numbers: { total, grounded: total - nulled, nulled }, reviews: recipe.review_items?.length ?? 0, corrections: recipe.corrections?.length ?? 0,
      usage: meter.total(),
    },
  }
}

export async function processJob(job: { id: string; url: string }, deps: PipelineDeps): Promise<{ recipe: RecipeV2; dict: DictEntry[] }> {
  const { recipe, dict } = await processJobDetailed(job, deps)
  return { recipe, dict }
}

/** 실패로 남긴 작업 폴더를 25시간 뒤에 지운다. cacheDir 안의 job-로 시작하는 폴더만 본다 */
export async function cleanCache(cacheDir: string, now: Date): Promise<void> {
  let names: string[]
  try {
    names = await readdir(cacheDir)
  } catch {
    return
  }
  for (const name of names) {
    if (!name.startsWith(JOB_PREFIX)) continue
    const dir = join(cacheDir, name)
    try {
      const s = await stat(dir)
      if (s.isDirectory() && now.getTime() - s.mtimeMs > KEEP_MS) await rm(dir, { recursive: true, force: true })
    } catch {
      // 못 지운 폴더는 다음에 다시 본다
    }
  }
}
