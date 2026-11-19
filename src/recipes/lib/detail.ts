// 상세 화면의 순수 계산: 분량 글, 가진 재료 수, 고친 곳 묶기. 화면에서만 계산하고 저장하지 않는다.
import type { Correction, Origin, MeasuringTool } from '../../../supabase/functions/_shared/recipeContract'
import { UNIT_ML, scaleAmount, unitMl } from '../../../supabase/functions/_shared/recipeUnits'
import { clock, originLabel } from './display'
import { missingIngredients, type PantryEntry } from './groceryLink'
import { parseTarget } from './store'

type Amounts = { amount?: number | null; unit?: string | null; amount_text?: string | null; suggested_amount?: number | null; suggested_unit?: string | null }

export type AmountView = {
  /** 출처 분량. 인분을 바꾸면 "원래 2큰술 → 4큰술". 숫자가 없으면 "약간" 같은 출처 글 */
  main: string | null
  /** 덧붙인 분량("덧붙임" 표시는 화면에서 붙인다). 인분을 바꾸면 "8장쯤 → 16장쯤" */
  suggested: string | null
}

const GLYPH_VALUE: Record<string, number> = { '¼': 0.25, '½': 0.5, '¾': 0.75 }
/** scaleAmount가 만든 글("1½", "¾", "500")을 숫자로. 화면에 보이는 값 그대로 ml를 셈하려고 쓴다 */
export function parseQty(text: string): number {
  const last = text.slice(-1)
  if (last in GLYPH_VALUE) return Number(text.slice(0, -1) || 0) + GLYPH_VALUE[last]
  return Number(text)
}
const fmtMl = (v: number) => `${Number(v.toFixed(1))}ml`
const join = (n: string, unit: string | null | undefined) => `${n}${unit ?? ''}`
const SPOON = new Set(Object.keys(UNIT_ML))

/**
 * @param factor 고른 인분 ÷ 기준 인분(기준을 모르면 1)
 * @param scaled 고른 인분이 기준과 다른가(다르면 원래 값을 함께 보인다)
 */
export function amountView(g: Amounts, factor: number, scaled: boolean, tool: MeasuringTool | undefined): AmountView {
  const spoon = g.unit != null && SPOON.has(g.unit)
  const tail = tool === '밥숟가락' && spoon ? ' · 밥숟가락 기준' : ''
  let main: string | null = null
  if (g.amount != null) {
    const ml = (n: number) => { const v = unitMl(g.unit ?? null, tool ?? '확인 못 함'); return v === null ? '' : ` (${fmtMl(v * n)})` }
    const orig = join(String(g.amount), g.unit) + ml(g.amount)
    const shownQty = scaled ? scaleAmount(g.amount, g.unit ?? null, factor) : ''
    main = scaled ? `원래 ${join(String(g.amount), g.unit)}${ml(g.amount)} → ${join(shownQty, g.unit)}${ml(parseQty(shownQty))}` : orig
    main += tail
  } else if (g.amount_text) main = g.amount_text
  let suggested: string | null = null
  if (g.suggested_amount != null) {
    const base = `${join(String(g.suggested_amount), g.suggested_unit)}쯤`
    suggested = scaled ? `${base} → ${join(scaleAmount(g.suggested_amount, g.suggested_unit ?? null, factor), g.suggested_unit)}쯤` : base
  }
  return { main, suggested }
}

/** 필수 재료 중 사전에 있는 것 M개와 그중 가진 N개, 사전에 없어 세지 못한 것 */
export function pantrySummary(recipe: { ingredients: readonly { name: string; optional?: boolean; ingredient_key?: string | null }[] }, pantry: readonly PantryEntry[]) {
  const { missing, unmatched } = missingIngredients(recipe, pantry, [])
  const keys = new Set(recipe.ingredients.filter((g) => !g.optional && g.ingredient_key).map((g) => g.ingredient_key as string))
  return { have: keys.size - missing.length, need: keys.size, missing, unmatched }
}

// ── 고친 곳 ─────────────────────────────────────────────────────────
export type CorrectionRow = { index: number; label: string; text: string; canRevert: boolean }

const FIELD: Record<string, string> = {
  name: '이름', amount: '분량', unit: '단위', amount_text: '분량 글', note: '메모', origin: '출처', at_seconds: '영상 시각',
  title: '이름', body: '내용', cue: '넘어가는 신호', timer_seconds: '타이머', video_start_seconds: '영상 시각', heat: '불 세기', value: '인분', basis: '인분 근거',
  term: '용어', suggested_amount: '덧붙인 분량', suggested_unit: '덧붙인 단위',
}
const ORIGINS = ['description', 'caption_manual', 'caption_auto', 'asr', 'screen', 'user', 'editor']

function shown(field: string, v: string | null): string {
  if (v === null || v === 'null' || v === '') return '없음'
  if (field === 'origin' || field === 'cue_origin') return ORIGINS.includes(v) ? originLabel(v as Origin, null) : v
  if (field === 'at_seconds' || field === 'timer_seconds' || field === 'video_start_seconds') return Number.isFinite(Number(v)) ? clock(Number(v)) : v
  return v
}

export function correctionRows(
  list: readonly Correction[],
  recipe: { ingredients: readonly { name: string }[]; steps: readonly { title: string }[]; glossary?: readonly { term: string }[] },
): CorrectionRow[] {
  const keyOf = (t: NonNullable<ReturnType<typeof parseTarget>>) => (t.kind === 'servings' ? 'servings' : `${t.kind}[${(t as { index: number }).index}]`)
  const groups = new Map<string, number[]>()
  const order: (string | number)[] = []
  list.forEach((c, i) => {
    const t = parseTarget(c.target)
    if (!t || t.kind === 'conflicts') { order.push(i); return }
    const k = keyOf(t)
    if (!groups.has(k)) { groups.set(k, []); order.push(k) }
    groups.get(k)?.push(i)
  })
  return order.map((o): CorrectionRow => {
    if (typeof o === 'number') {
      const c = list[o]
      return { index: o, label: c.target, text: `${c.before ?? '없음'} → ${c.after ?? '없음'}`, canRevert: false }
    }
    const idx = groups.get(o) as number[]
    // 값이 바뀐 고침이 있으면 그것을 보이고, 출처·시각만 바뀐 묶음은 첫 줄 하나만 보인다
    const pick = idx.find((i) => { const f = (parseTarget(list[i].target) as { field: string }).field; return f !== 'origin' && f !== 'at_seconds' }) ?? idx[0]
    const c = list[pick]
    const t = parseTarget(c.target) as Exclude<NonNullable<ReturnType<typeof parseTarget>>, { kind: 'conflicts' }>
    const who = t.kind === 'servings' ? '인분'
      : t.kind === 'ingredients' ? (recipe.ingredients[t.index]?.name ?? `재료 ${t.index + 1}`)
      : t.kind === 'steps' ? (recipe.steps[t.index]?.title ?? `단계 ${t.index + 1}`)
      : (recipe.glossary?.[t.index]?.term ?? `용어 ${t.index + 1}`)
    const field = FIELD[t.field] ?? t.field
    return { index: pick, label: t.kind === 'servings' ? '인분' : `${who} ${field}`, text: `${shown(t.field, c.before)} → ${shown(t.field, c.after)}`, canRevert: true }
  })
}
