// V2·V3: 두 번째 읽기와 다른 곳 가리기. 첫 결과를 주지 않고 근거만으로 재료·분량을 다시 읽어(secondRead) 첫 결과와 견주고(diffReads),
// 다른 곳은 근거의 좁은 구간만 주고 후보 중 하나를 고르게 한다(resolveDiffs). 고른 값은 근거에 글자로 있을 때만 쓴다.
// 모델이 낸 숫자를 그대로 믿지 않는다: 근거에서 못 찾거나 "모름"이면 확인 필요로 남긴다.
// 영상에서 온 글은 모두 JSON 값으로 울타리 안에만 둔다(organize.ts의 fence).
import { z } from 'zod'
import type { Correction, Origin, RecipeV2, ReviewItem } from '../../../../supabase/functions/_shared/recipeContract.ts'
import type { ClaudeRun } from '../claude.ts'
import type { Evidence } from '../evidence.ts'
import { RateLimited } from '../loop.ts'
import {
  DESCRIPTION_MAX, FRAMES_MAX, OCR_MAX, TRANSCRIPT_MAX, extractJsonObject, fence, fill, loadPrompt, mmss, oneLine, takeLines,
} from '../organize.ts'
import { canonUnit, findAmount, fmt, sameName } from './grounding.ts'

export const STAGE_SECOND = '다시 읽어 맞춰 보는 중'
export const DEFAULT_CAP = 8
/** 다른 곳 하나에 주는 구간: 자막·받아쓰기 ±15초, 화면 글자 ±5초, 장면 그림은 가까운 3장 */
const SPEECH_PAD = 15
const SCREEN_PAD = 5
const RESOLVE_FRAMES = 3
const MAX_LIST = 40
const REASON_DIFF = '두 번 읽은 분량이 달라 확인 필요'

export type IngredientRead = { name: string; amount: number | null; unit: string | null; at_seconds: number | null }
type Ingredient = RecipeV2['ingredients'][number]
export type Diff = {
  /** 첫 결과의 재료 번호(고친 곳·확인 필요가 가리킨다) */
  index: number
  name: string
  first: { amount: number | null; unit: string | null; origin: Origin; at_seconds: number | null }
  second: IngredientRead
}
/** 고른 값을 근거에서 찾아 레시피에 쓰라는 알림 */
export type Applied = { index: number; amount: number; unit: string | null; origin: Origin; at_seconds: number | null }

const ReadSchema = z.object({
  ingredients: z
    .array(
      z.object({
        name: z.string().min(1).max(60),
        amount: z.number().finite().nonnegative().nullable(),
        unit: z.string().max(20).nullable(),
        at_seconds: z.number().finite().min(0).nullable(),
      }),
    )
    .max(80),
})
const ChoiceSchema = z.object({ choice: z.enum(['a', 'b', 'unknown']) })

const clip = (s: string, n = 80) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
const valueText = (amount: number | null, unit: string | null) => (amount === null ? '' : `${fmt(amount)}${unit ?? ''}`)
const sec = (v: number | null | undefined) => (v == null ? null : Math.max(0, Math.round(v)))

function framesArg(frames: Evidence['frames']) {
  return frames.map((f) => ({ at: mmss(f.t), path: f.path }))
}

/** 첫 결과를 주지 않고 근거만으로 재료와 분량을 다시 읽는다. 장면 그림을 먼저 보게 한다. 결과가 틀리면 빈 목록(이 검사를 건너뜀) */
export async function secondRead(e: Evidence, run: ClaudeRun, jobDir = ''): Promise<IngredientRead[]> {
  const notes: string[] = []
  let description = e.meta.description
  if (description.length > DESCRIPTION_MAX) {
    description = description.slice(0, DESCRIPTION_MAX)
    notes.push(`설명란이 ${DESCRIPTION_MAX}자에서 잘렸다. 뒤쪽은 보지 못했다.`)
  }
  const tr = takeLines((e.transcript?.segments ?? []).map((s) => `[${mmss(s.start)}] ${oneLine(s.text)}`), TRANSCRIPT_MAX)
  if (tr.cut) notes.push(`말(자막·받아쓰기)이 ${TRANSCRIPT_MAX}자에서 잘렸다. 뒤쪽은 보지 못했다.`)
  const ocrLines: string[] = []
  let prev = ''
  for (const o of e.ocr) {
    const text = oneLine(o.text)
    if (!text || text === prev) continue
    prev = text
    ocrLines.push(`[${mmss(o.t)}] ${text}`)
  }
  const oc = takeLines(ocrLines, OCR_MAX)
  if (oc.cut) notes.push(`화면 글자가 ${OCR_MAX}자에서 잘렸다. 뒤쪽은 보지 못했다.`)
  const frames = e.frames.slice(0, FRAMES_MAX)
  if (!e.transcript) notes.push('자막도 받아쓰기도 없다. 말은 보지 못했다.')

  const evidence = fence({ description, transcript: tr.lines, screen_text: oc.lines, frames: framesArg(frames) }, 2)
  const prompt = fill(loadPrompt('second'), {
    SOURCE_INFO: `- 길이(초): ${Math.round(e.meta.duration)}`,
    NOTES: notes.length ? notes.map((n) => `- ${n}`).join('\n') : '(없음)',
    EVIDENCE: evidence,
  })
  const text = await run(prompt, { jobDir, images: frames.map((f) => f.path) })
  const json = extractJsonObject(text)
  const parsed = ReadSchema.safeParse(json)
  if (!parsed.success) return []
  return parsed.data.ingredients.map((x) => ({ name: x.name, amount: x.amount, unit: x.unit, at_seconds: sec(x.at_seconds) }))
}

/** 두 읽기에서 분량이 다른 재료를 모은다. 이름은 띄어쓰기·괄호를 빼고 짝짓고, 사람이 고친 값(user)은 건드리지 않는다. */
export function diffReads(first: RecipeV2['ingredients'], second: IngredientRead[]): Diff[] {
  const used = new Set<number>()
  const out: Diff[] = []
  first.forEach((g, index) => {
    const j = second.findIndex((s, k) => !used.has(k) && sameName(s.name, g.name))
    if (j === -1) return
    used.add(j)
    const s = second[j]!
    if (g.origin === 'user' || g.amount === null || s.amount === null) return
    const sameAmount = Math.abs(g.amount - s.amount) < 0.001
    const sameUnit = g.unit == null || s.unit == null || canonUnit(g.unit) === canonUnit(s.unit)
    if (sameAmount && sameUnit) return
    out.push({ index, name: g.name, first: { amount: g.amount, unit: g.unit ?? null, origin: g.origin, at_seconds: g.at_seconds ?? null }, second: s })
  })
  return out
}

type Line = { t: number; text: string }
type Windows = { description: string; screen: Line[]; speech: Line[]; speechKind: NonNullable<Evidence['transcript']>['kind'] | null }

function windowsFor(e: Evidence, anchors: number[]): Windows {
  const near = (lines: Line[], pad: number) => lines.filter((l) => anchors.some((a) => Math.abs(l.t - a) <= pad)).sort((a, b) => a.t - b.t)
  return {
    description: e.meta.description ?? '',
    screen: near(e.ocr.map((o) => ({ t: o.t, text: o.text })), SCREEN_PAD),
    speech: near((e.transcript?.segments ?? []).map((s) => ({ t: s.start, text: s.text })), SPEECH_PAD),
    speechKind: e.transcript?.kind ?? null,
  }
}

/** 그 값이 구간 안의 근거에 이름과 함께 글자로 있는지. 설명란 > 화면 > 말 순으로 본다 */
function locate(w: Windows, name: string, amount: number, unit: string | null, others: string[]): { origin: Origin; timed: boolean } | null {
  if (findAmount(w.description, name, amount, unit, others)) return { origin: 'description', timed: false }
  if (w.screen.length > 0 && findAmount(w.screen.map((l) => l.text).join(' | '), name, amount, unit, others)) return { origin: 'screen', timed: true }
  if (w.speechKind && w.speech.length > 0 && findAmount(w.speech.map((l) => l.text).join(' '), name, amount, unit, others)) return { origin: w.speechKind, timed: true }
  return null
}

export type ResolveExtra = { jobDir?: string; others?: string[] }

/** 다른 곳마다 구간만 주고 후보 중 하나를 고르게 한다. cap개까지만 묻고 나머지는 확인 필요로 남긴다. */
export async function resolveDiffs(
  diffs: Diff[],
  e: Evidence,
  run: ClaudeRun,
  cap = DEFAULT_CAP,
  extra: ResolveExtra = {},
): Promise<{ corrections: Correction[]; reviews: ReviewItem[]; applied: Applied[] }> {
  const corrections: Correction[] = []
  const reviews: ReviewItem[] = []
  const applied: Applied[] = []

  for (const [n, d] of diffs.entries()) {
    const anchors = [d.first.at_seconds, d.second.at_seconds].filter((v): v is number => v !== null)
    const w = windowsFor(e, anchors)
    const others = (extra.others ?? diffs.map((x) => x.name)).filter((o) => !sameName(o, d.name))
    const anyOrigin: Origin = w.speechKind ?? 'description'
    const review = () => {
      const a = d.first.amount!
      const b = d.second.amount!
      const loc = locate(w, d.name, b, d.second.unit, others)
      reviews.push({
        target: `ingredients[${d.index}].amount`,
        reason: REASON_DIFF,
        candidates: [
          { value: clip(valueText(a, d.first.unit)), origin: d.first.origin, at_seconds: d.first.at_seconds },
          { value: clip(valueText(b, d.second.unit)), origin: loc?.origin ?? anyOrigin, at_seconds: d.second.at_seconds },
        ],
      })
    }

    if (n >= cap) {
      review()
      continue
    }

    let choice: 'a' | 'b' | 'unknown' = 'unknown'
    try {
      const frames = anchors.length === 0
        ? []
        : [...e.frames].sort((x, y) => Math.min(...anchors.map((a) => Math.abs(x.t - a))) - Math.min(...anchors.map((a) => Math.abs(y.t - a)))).slice(0, RESOLVE_FRAMES).sort((x, y) => x.t - y.t)
      const evidence = fence({
        ingredient: d.name,
        candidates: {
          a: { amount: d.first.amount, unit: d.first.unit },
          b: { amount: d.second.amount, unit: d.second.unit },
        },
        description_lines: w.description.split(/\r?\n/).map(oneLine).filter((l) => l !== ''),
        transcript_near: w.speech.map((l) => `[${mmss(l.t)}] ${oneLine(l.text)}`),
        screen_text_near: w.screen.map((l) => `[${mmss(l.t)}] ${oneLine(l.text)}`),
        frames: framesArg(frames),
      }, 2)
      const text = await run(fill(loadPrompt('resolve'), { EVIDENCE: evidence }), { jobDir: extra.jobDir ?? '', images: frames.map((f) => f.path) })
      const parsed = ChoiceSchema.safeParse(extractJsonObject(text))
      if (parsed.success) choice = parsed.data.choice
    } catch (err) {
      if (err instanceof RateLimited) throw err
      // 그 밖의 실패는 "모름"으로 본다
    }

    if (choice === 'unknown') {
      review()
      continue
    }
    const chosen = choice === 'a' ? d.first : d.second
    const amount = chosen.amount!
    const loc = locate(w, d.name, amount, chosen.unit, others)
    if (!loc) {
      review()
      continue
    }
    if (choice === 'a') continue // 첫 결과의 값이 근거에 있다: 고칠 것이 없다
    const at = loc.timed ? d.second.at_seconds ?? d.first.at_seconds : null
    if (loc.timed && at === null) {
      review()
      continue
    }
    applied.push({ index: d.index, amount, unit: chosen.unit, origin: loc.origin, at_seconds: at })
    corrections.push({
      target: `ingredients[${d.index}].amount`,
      before: clip(valueText(d.first.amount, d.first.unit)),
      after: clip(valueText(amount, chosen.unit)),
      origin: loc.origin,
      at_seconds: at,
      method: 'compare',
    })
  }
  return { corrections, reviews, applied }
}

/** 고른 값을 재료에 쓴다 */
export function applyAmounts(ingredients: Ingredient[], applied: Applied[]): void {
  for (const a of applied) {
    const g = ingredients[a.index]
    if (!g) continue
    g.amount = a.amount
    g.unit = a.unit
    g.origin = a.origin
    g.at_seconds = a.at_seconds
  }
}

/** 모은 고친 곳·확인 필요를 레시피에 한 번만 붙인다(각 40개까지). needs_review ⇔ 확인 필요 항목을 지킨다. */
export function mergeChecks(recipe: RecipeV2, corrections: Correction[], reviews: ReviewItem[]): void {
  if (corrections.length > 0) recipe.corrections = [...(recipe.corrections ?? []), ...corrections].slice(0, MAX_LIST)
  if (reviews.length === 0) return
  for (const item of reviews) {
    const m = /^(ingredients|steps|principles)\[(\d+)\]/.exec(item.target)
    const list: { needs_review?: boolean }[] | undefined = m ? (recipe as unknown as Record<string, { needs_review?: boolean }[] | undefined>)[m[1]!] : undefined
    const x = m ? list?.[Number(m[2])] : undefined
    if (x) x.needs_review = true
  }
  const prior = recipe.review_items ?? []
  const last = prior[prior.length - 1]
  const summary = last?.target === '확인 필요' ? last : undefined
  const carried = summary ? Number(/(\d+)곳/.exec(summary.reason)?.[1] ?? 0) : 0
  const all = [...(summary ? prior.slice(0, -1) : prior), ...reviews]
  recipe.review_items =
    all.length + carried <= MAX_LIST
      ? all
      : [...all.slice(0, MAX_LIST - 1), { target: '확인 필요', reason: `확인할 곳이 ${all.length + carried - (MAX_LIST - 1)}곳 더 있음`, candidates: [] }]
}
