// 고치기 시트: 이름·분류·메모·별점·즐겨찾기, 재료와 단계의 글. 고친 재료·단계의 출처는 user가 된다(store가 정한다).
import { useRef, useState } from 'react'
import type { StoredRecipe } from '../../../supabase/functions/_shared/recipeStored'
import { CUISINES, DIFFICULTIES, MAINS, METHODS, OCCASIONS } from '../../../supabase/functions/_shared/recipeContract'
import { parseAmountValue } from '../../../supabase/functions/_shared/recipeValue'
import { useFocusTrap, useScrollLock } from '../../lib/dialog'
import type { IngredientPatch, RecipePatch, RecipeStore, StepPatch } from '../lib/store'

type Draft = {
  title: string; cuisine: string; mains: string[]; mainDetails: string[]; methods: string[]; occasions: string[]; difficulty: string
  memo: string; rating: number | null; favorite: boolean
  ingredients: { name: string; amount: string; unit: string; note: string }[]
  steps: { title: string; body: string }[]
}

const same = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((x, i) => x === b[i])
const toggle = (list: string[], v: string, max: number) => (list.includes(v) ? list.filter((x) => x !== v) : list.length >= max ? list : [...list, v])

function draftOf(r: StoredRecipe): Draft {
  return {
    title: r.title, cuisine: r.tags.cuisine, mains: [...r.tags.mains], mainDetails: [...r.tags.main_details], methods: [...r.tags.methods], occasions: [...r.tags.occasions],
    difficulty: r.difficulty ?? '', memo: r.memo ?? '', rating: r.rating, favorite: r.favorite,
    ingredients: r.ingredients.map((g) => ({ name: g.name, amount: g.amount == null ? '' : String(g.amount), unit: g.unit ?? '', note: g.note ?? '' })),
    steps: r.steps.map((s) => ({ title: s.title, body: s.body })),
  }
}

function Chips({ label, options, value, max, onChange }: { label: string; options: readonly string[]; value: string[]; max: number; onChange: (v: string[]) => void }) {
  return (
    <fieldset className="rcp-field" aria-label={label}>
      <legend className="rcp-label">{label}<span className="rcp-meta"> {value.length}/{max}</span></legend>
      <div className="rcp-chips">
        {options.map((o) => <button key={o} type="button" className="rcp-chip" aria-pressed={value.includes(o)} onClick={() => onChange(toggle(value, o, max))}>{o}</button>)}
      </div>
    </fieldset>
  )
}

export function EditSheet({ recipe, store, onClose, onSaved }: { recipe: StoredRecipe; store: RecipeStore; onClose: () => void; onSaved: () => void }) {
  const root = useRef<HTMLDivElement>(null)
  useFocusTrap(root, true, { onEscape: onClose })
  useScrollLock(true)
  const [d, setD] = useState<Draft>(() => draftOf(recipe))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const first = useRef(draftOf(recipe)).current
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }))

  const names = d.ingredients.map((g) => g.name.trim()).filter(Boolean)
  const problem = !d.title.trim() ? '이름을 적어 주세요'
    : d.mains.length < 1 ? '주재료를 1개 이상 골라 주세요'
    : d.methods.length < 1 ? '조리법을 1개 이상 골라 주세요'
    : d.mainDetails.length < 1 ? '세부 재료를 1개 이상 골라 주세요'
    : d.ingredients.some((g) => !g.name.trim()) ? '재료 이름을 비워 둘 수 없어요'
    : d.steps.some((s) => !s.title.trim() || !s.body.trim()) ? '단계 이름과 내용을 비워 둘 수 없어요'
    : null

  async function save() {
    if (problem || busy) return
    setBusy(true); setError(null)
    try {
      // 이름을 바꾼 재료가 세부 재료였으면 세부 재료도 새 이름으로 따라간다
      const renamed = new Map<string, string>()
      d.ingredients.forEach((g, i) => { if (g.name.trim() !== first.ingredients[i].name) renamed.set(first.ingredients[i].name, g.name.trim()) })
      for (let i = 0; i < d.ingredients.length; i++) {
        const a = d.ingredients[i], b = first.ingredients[i]
        const p: IngredientPatch = {}
        if (a.name.trim() !== b.name) p.name = a.name
        if (a.amount.trim() !== b.amount) {
          // 천 단위 쉼표("1,000")는 1000이다. 쉼표를 소수점으로 바꾸지 않는다(단위 칸이 따로 있어 단위가 붙은 값은 받지 않는다)
          const parsed = a.amount.trim() === '' ? null : parseAmountValue(a.amount.trim())
          const n = parsed && parsed.unit === null ? parsed.amount : null
          if (a.amount.trim() !== '' && n === null) throw new Error(`${a.name} 분량은 0보다 큰 숫자로 적어 주세요`)
          p.amount = n
        }
        if (a.unit.trim() !== b.unit) p.unit = a.unit
        if (a.note.trim() !== b.note) p.note = a.note
        if (Object.keys(p).length) await store.editIngredient(recipe.id, i, p)
      }
      for (let i = 0; i < d.steps.length; i++) {
        const p: StepPatch = {}
        if (d.steps[i].title.trim() !== first.steps[i].title) p.title = d.steps[i].title
        if (d.steps[i].body.trim() !== first.steps[i].body) p.body = d.steps[i].body
        if (Object.keys(p).length) await store.editStep(recipe.id, i, p)
      }
      const patch: RecipePatch = {}
      if (d.title.trim() !== first.title) patch.title = d.title
      if (d.cuisine !== first.cuisine) patch.cuisine = d.cuisine
      if (!same(d.mains, first.mains)) patch.mains = d.mains
      const details = d.mainDetails.map((x) => renamed.get(x) ?? x)
      if (!same(details, first.mainDetails)) patch.main_details = details
      if (!same(d.methods, first.methods)) patch.methods = d.methods
      if (!same(d.occasions, first.occasions)) patch.occasions = d.occasions
      if (d.difficulty !== first.difficulty) patch.difficulty = d.difficulty || null
      if (d.memo.trim() !== first.memo) patch.memo = d.memo
      if (d.rating !== first.rating) patch.rating = d.rating
      if (d.favorite !== first.favorite) patch.favorite = d.favorite
      if (Object.keys(patch).length) await store.update(recipe.id, patch)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장하지 못했어요. 잠시 뒤 다시 해 주세요')
    } finally { setBusy(false) }
  }

  return (
    <div className="rcp-sheet-layer">
      <div className="rcp-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="rcp-sheet" role="dialog" aria-modal="true" aria-label="레시피 고치기" ref={root} tabIndex={-1}>
        <div className="rcp-sheet-head">
          <h2 className="rcp-h2">고치기</h2>
          <button type="button" className="rcp-btn-text" onClick={onClose}>닫기</button>
        </div>
        <div className="rcp-sheet-body">
          <label className="rcp-field"><span className="rcp-label">이름</span>
            <input className="rcp-input" value={d.title} maxLength={80} onChange={(e) => set({ title: e.target.value })} />
          </label>
          <label className="rcp-field"><span className="rcp-label">요리 종류</span>
            <select className="rcp-select" value={d.cuisine} onChange={(e) => set({ cuisine: e.target.value })}>{CUISINES.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          </label>
          <Chips label="주재료" options={MAINS} value={d.mains} max={3} onChange={(mains) => set({ mains })} />
          <Chips label="세부 재료" options={[...new Set([...names, ...d.mainDetails])]} value={d.mainDetails} max={3} onChange={(mainDetails) => set({ mainDetails })} />
          <Chips label="조리법" options={METHODS} value={d.methods} max={3} onChange={(methods) => set({ methods })} />
          <Chips label="상황" options={OCCASIONS} value={d.occasions} max={4} onChange={(occasions) => set({ occasions })} />
          <label className="rcp-field"><span className="rcp-label">난이도</span>
            <select className="rcp-select" value={d.difficulty} onChange={(e) => set({ difficulty: e.target.value })}>
              <option value="">정하지 않음</option>{DIFFICULTIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <div className="rcp-field" role="group" aria-label="별점">
            <span className="rcp-label">별점</span>
            <div className="rcp-chips">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" className="rcp-chip rcp-chip-n" aria-pressed={d.rating === n} aria-label={`별점 ${n}`} onClick={() => set({ rating: d.rating === n ? null : n })}>{n}</button>
              ))}
            </div>
          </div>
          <button type="button" className="rcp-chip rcp-chip-wide" aria-pressed={d.favorite} onClick={() => set({ favorite: !d.favorite })}>즐겨찾기</button>
          <label className="rcp-field"><span className="rcp-label">우리 집 메모</span>
            <textarea className="rcp-input rcp-textarea" rows={3} maxLength={2000} value={d.memo} onChange={(e) => set({ memo: e.target.value })} />
          </label>

          <h3 className="rcp-h3">재료</h3>
          {d.ingredients.map((g, i) => (
            <div key={i} className="rcp-edit-row" role="group" aria-label={`재료 ${i + 1}`}>
              <input className="rcp-input" aria-label={`재료 ${i + 1} 이름`} value={g.name} maxLength={60}
                onChange={(e) => set({ ingredients: d.ingredients.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              <div className="rcp-edit-pair">
                <input className="rcp-input" aria-label={`재료 ${i + 1} 분량`} inputMode="decimal" placeholder="분량" value={g.amount}
                  onChange={(e) => set({ ingredients: d.ingredients.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)) })} />
                <input className="rcp-input" aria-label={`재료 ${i + 1} 단위`} placeholder="단위" maxLength={12} value={g.unit}
                  onChange={(e) => set({ ingredients: d.ingredients.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)) })} />
              </div>
              <input className="rcp-input" aria-label={`재료 ${i + 1} 메모`} placeholder="메모" maxLength={160} value={g.note}
                onChange={(e) => set({ ingredients: d.ingredients.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)) })} />
            </div>
          ))}

          <h3 className="rcp-h3">단계</h3>
          {d.steps.map((s, i) => (
            <div key={i} className="rcp-edit-row" role="group" aria-label={`단계 ${i + 1}`}>
              <input className="rcp-input" aria-label={`단계 ${i + 1} 이름`} value={s.title} maxLength={30}
                onChange={(e) => set({ steps: d.steps.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} />
              <textarea className="rcp-input rcp-textarea" aria-label={`단계 ${i + 1} 내용`} rows={3} maxLength={400} value={s.body}
                onChange={(e) => set({ steps: d.steps.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)) })} />
            </div>
          ))}
        </div>
        <div className="rcp-sheet-foot">
          {(error || problem) && <p className="rcp-bad" role="alert">{error ?? problem}</p>}
          <button type="button" className="rcp-btn rcp-btn-primary" disabled={busy || !!problem} onClick={() => void save()}>{busy ? '저장 중' : '저장'}</button>
        </div>
      </div>
    </div>
  )
}
