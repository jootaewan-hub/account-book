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
import { amountMatches, canonUnit, fmt, hasQuantity, nearbyQuantities, sameName } from './grounding.ts'

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

const ReadItem = z.object({
  name: z.string().min(1).max(60),
  amount: z.number().finite().positive().nullable(),
  unit: z.string().max(12).nullable(),
  at_seconds: z.number().finite().min(0).nullable(),
})
const ChoiceSchema = z.object({ choice: z.enum(['a', 'b', 'unknown']) })

const clip = (s: string, n = 80) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
const valueText = (amount: number | null, unit: string | null) => (amount === null ? '' : `${fmt(amount)}${unit ?? ''}`)
const sec = (v: number | null | undefined) => (v == null ? null : Math.max(0, Math.round(v)))

function framesArg(frames: Evidence['frames']) {
  return frames.map((f) => ({ at: mmss(f.t), path: f.path }))
}

/** 첫 결과를 주지 않고 근거만으로 재료와 분량을 다시 읽는다. 장면 그림을 먼저 보게 한다. 결과가 틀리면 빈 목록(이 검사를 건너뜀) */
export async function secondRead(e: Evidence, run: ClaudeRun, jobDir: string): Promise<IngredientRead[]> {
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
  const list = typeof json === 'object' && json !== null ? (json as { ingredients?: unknown }).ingredients : undefined
  if (!Array.isArray(list)) return []
  // 틀린 항목은 그 항목만 버린다(나쁜 두 번째 읽기가 일을 실패시키지 않는다)
  const out: IngredientRead[] = []
  for (const item of list.slice(0, 80)) {
    const p = ReadItem.safeParse(item)
    if (p.success) out.push({ name: p.data.name, amount: p.data.amount, unit: p.data.unit, at_seconds: sec(p.data.at_seconds) })
  }
  return out
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

type Located = { origin: Origin; at: number | null; unit: string | null }

/** 글 한 덩이에서 이 재료의 이 분량이 적힌 수. 단위는 근거에 적힌 것이다 */
function matchedQuantity(text: string, name: string, amount: number, unit: string | null, others: string[]) {
  return nearbyQuantities(text, name, others).find((q) => amountMatches(q, amount, unit))
}
const evidenceUnit = (q: { unit: string | null; word: string | null }) => q.unit ?? q.word ?? null

/** 줄 하나씩, 안 되면 이웃한 두 줄(말 중간에서 끊긴 조각)을 이어 본다. 시각은 맞은 줄 자신의 것(내림) */
function searchLines(lines: Line[], sep: string, name: string, amount: number, unit: string | null, others: string[]): { at: number; unit: string | null } | null {
  for (const l of lines) {
    const q = matchedQuantity(l.text, name, amount, unit, others)
    if (q) return { at: Math.floor(l.t), unit: evidenceUnit(q) }
  }
  for (let i = 0; i + 1 < lines.length; i++) {
    const a = lines[i]!
    const b = lines[i + 1]!
    const q = matchedQuantity(a.text + sep + b.text, name, amount, unit, others)
    if (q) return { at: Math.floor(hasQuantity(a.text, amount, unit) || !hasQuantity(b.text, amount, unit) ? a.t : b.t), unit: evidenceUnit(q) }
  }
  return null
}

/** 그 값이 구간 안의 근거에 이름과 함께 글자로 있는지. 설명란 > 화면 > 말 순으로 보고, 맞은 곳의 출처·시각·단위를 근거에서 읽는다 */
function locate(w: Windows, name: string, amount: number, unit: string | null, others: string[]): Located | null {
  const d = matchedQuantity(w.description, name, amount, unit, others)
  if (d) return { origin: 'description', at: null, unit: evidenceUnit(d) }
  const sc = searchLines(w.screen, ' | ', name, amount, unit, others)
  if (sc) return { origin: 'screen', ...sc }
  if (w.speechKind) {
    const sp = searchLines(w.speech, ' ', name, amount, unit, others)
    if (sp) return { origin: w.speechKind, ...sp }
  }
  return null
}

export type ResolveExtra = { jobDir: string; others?: string[] }
/** 설명란 값과 영상 값이 다를 때 설명란 값을 두고 남기는 기록(계약의 conflicts 한 칸) */
export type ConflictNote = { about: string; chosen: string; chosen_origin: Origin; other: string; other_origin: Origin; video_start_seconds: number | null }

/** 다른 곳마다 구간만 주고 후보 중 하나를 고르게 한다. cap개까지만 묻고 나머지는 확인 필요로 남긴다. */
export async function resolveDiffs(
  diffs: Diff[],
  e: Evidence,
  run: ClaudeRun,
  cap: number,
  extra: ResolveExtra,
): Promise<{ corrections: Correction[]; reviews: ReviewItem[]; applied: Applied[]; conflicts: ConflictNote[] }> {
  const corrections: Correction[] = []
  const reviews: ReviewItem[] = []
  const applied: Applied[] = []
  const conflicts: ConflictNote[] = []

  for (const [n, d] of diffs.entries()) {
    const anchors = [d.first.at_seconds, d.second.at_seconds].filter((v): v is number => v !== null)
    const w = windowsFor(e, anchors)
    const others = (extra.others ?? diffs.map((x) => x.name)).filter((o) => !sameName(o, d.name))
    const firstText = valueText(d.first.amount, d.first.unit)
    // 후보의 출처·시각은 근거에서 찾은 것만 쓴다. 못 찾은 값은 덧붙임(editor)으로 두고 시각을 비운다.
    const candidate = (amount: number, unit: string | null) => {
      const loc = locate(w, d.name, amount, unit, others)
      return { value: clip(valueText(amount, unit)), origin: loc ? loc.origin : ('editor' as Origin), at_seconds: loc ? loc.at : null }
    }
    const review = () => {
      const first = locate(w, d.name, d.first.amount!, d.first.unit, others)
      reviews.push({
        target: `ingredients[${d.index}].amount`,
        reason: REASON_DIFF,
        candidates: [
          { value: clip(firstText), origin: first?.origin ?? d.first.origin, at_seconds: first ? first.at : d.first.at_seconds },
          candidate(d.second.amount!, d.second.unit),
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
      const text = await run(fill(loadPrompt('resolve'), { EVIDENCE: evidence }), { jobDir: extra.jobDir, images: frames.map((f) => f.path) })
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
    const loc = locate(w, d.name, chosen.amount!, chosen.unit, others)
    if (!loc) {
      review()
      continue
    }
    if (choice === 'a') continue // 첫 결과의 값이 근거에 있다: 고칠 것이 없다

    // 설명란이 분명히 적은 값은 영상 값으로 바꾸지 않는다(R-02, R-04): 설명란 값을 두고 다른 곳(conflicts)에 남겨 확인 필요로 센다
    const descValue = d.first.origin === 'description' && locate({ ...w, screen: [], speech: [], speechKind: null }, d.name, d.first.amount!, d.first.unit, others)
    if (descValue) {
      if (loc.origin === 'description') review()
      else {
        conflicts.push({
          about: clip(d.name, 60),
          chosen: clip(firstText, 200),
          chosen_origin: 'description',
          other: clip(valueText(d.second.amount, loc.unit ?? d.second.unit), 200),
          other_origin: loc.origin,
          video_start_seconds: loc.at,
        })
      }
      continue
    }

    if (loc.at === null && loc.origin !== 'description') {
      review()
      continue
    }
    const unit = loc.unit
    applied.push({ index: d.index, amount: d.second.amount!, unit, origin: loc.origin, at_seconds: loc.at })
    corrections.push({
      target: `ingredients[${d.index}].amount`,
      before: clip(firstText),
      after: clip(valueText(d.second.amount, unit)),
      origin: loc.origin,
      at_seconds: loc.at,
      method: 'compare',
    })
  }
  return { corrections, reviews, applied, conflicts }
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
