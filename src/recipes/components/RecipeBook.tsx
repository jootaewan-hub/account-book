// 레시피북: 거르기와 찾기, 목록 줄.
import { useMemo, useState } from 'react'
import { CUISINES, DIFFICULTIES, MAINS, METHODS, OCCASIONS } from '../../../supabase/functions/_shared/recipeContract'
import type { CookableRow, RecipeSummary } from '../lib/store'

type Pick = '' | 'now' | 'few'

function Select({ label, value, options, onChange }: { label: string; value: string; options: readonly string[]; onChange: (v: string) => void }) {
  return (
    <select className="rcp-select" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{label}</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

export function RecipeBook({ recipes, cookable, loading, onOpen, onReview }: {
  recipes: RecipeSummary[]; cookable: CookableRow[] | null; loading: boolean; onOpen: (id: string) => void
  /** 확인 필요 거르기를 켠 채 "확인 시작"을 누르면, 보이는 첫 레시피의 확인 화면을 연다 */ onReview?: (id: string) => void
}) {
  const [cuisine, setCuisine] = useState('')
  const [main, setMain] = useState('')
  const [method, setMethod] = useState('')
  const [difficulty, setDifficulty] = useState('')
  const [occasion, setOccasion] = useState('')
  const [favorite, setFavorite] = useState(false)
  const [review, setReview] = useState(false)
  const [pick, setPick] = useState<Pick>('')
  const [query, setQuery] = useState('')

  const live = useMemo(() => recipes.filter((r) => r.status !== 'archived'), [recipes])
  const reviewCount = live.filter((r) => r.status === 'review').length
  const byId = useMemo(() => new Map((cookable ?? []).map((c) => [c.recipe_id, c])), [cookable])
  const q = query.trim().toLowerCase()

  const shown = live.filter((r) => {
    if (cuisine && r.cuisine !== cuisine) return false
    if (main && !r.mains.includes(main)) return false
    if (method && !r.methods.includes(method)) return false
    if (difficulty && r.difficulty !== difficulty) return false
    if (occasion && !r.occasions.includes(occasion)) return false
    if (favorite && !r.favorite) return false
    if (review && r.status !== 'review') return false
    if (pick && cookable) {
      const c = byId.get(r.id)
      if (!c) return false
      const missing = c.need - c.have
      if (pick === 'now' ? missing !== 0 : missing < 1) return false
    }
    if (q && ![r.title, ...r.mains, ...r.main_details].some((t) => t.toLowerCase().includes(q))) return false
    return true
  })

  return (
    <section className="rcp-book" aria-label="레시피">
      <input className="rcp-input" type="search" aria-label="레시피 찾기" placeholder="이름이나 재료로 찾기" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="rcp-filters">
        <Select label="요리 종류" value={cuisine} options={CUISINES} onChange={setCuisine} />
        <Select label="주재료" value={main} options={MAINS} onChange={setMain} />
        <Select label="조리법" value={method} options={METHODS} onChange={setMethod} />
        <Select label="난이도" value={difficulty} options={DIFFICULTIES} onChange={setDifficulty} />
        <Select label="상황" value={occasion} options={OCCASIONS} onChange={setOccasion} />
      </div>
      <div className="rcp-chips">
        <button className="rcp-chip" type="button" aria-pressed={favorite} onClick={() => setFavorite((x) => !x)}>즐겨찾기</button>
        {cookable && <button className="rcp-chip" type="button" aria-pressed={pick === 'now'} onClick={() => setPick(pick === 'now' ? '' : 'now')}>지금 만들 수 있음</button>}
        {cookable && <button className="rcp-chip" type="button" aria-pressed={pick === 'few'} onClick={() => setPick(pick === 'few' ? '' : 'few')}>1~2개만 사면 됨</button>}
        {reviewCount > 0 && <button className="rcp-chip" type="button" aria-pressed={review} onClick={() => setReview((x) => !x)}>확인 필요 {reviewCount}</button>}
      </div>
      {review && onReview && shown.length > 0 && (
        <button className="rcp-btn rcp-btn-primary rcp-review-start" type="button" onClick={() => onReview(shown[0].id)}>확인 시작</button>
      )}
      {loading && !live.length ? <p className="rcp-empty">레시피 불러오는 중</p>
        : !live.length ? <p className="rcp-empty">아직 담은 레시피가 없어요. 위 칸에 유튜브 주소를 붙여 넣어 담아 보세요.</p>
        : !shown.length ? <p className="rcp-empty">조건에 맞는 레시피가 없어요.</p>
        : (
          <ul className="rcp-list">
            {shown.map((r) => {
              const c = byId.get(r.id)
              const meta = [r.cuisine, [r.mains[0], r.main_details[0]].filter(Boolean).join('·'), r.methods.slice(0, 2).join('·'), r.difficulty,
                c ? `가진 재료 ${c.have}/${c.need}` : null].filter(Boolean).join(', ')
              return (
                <li key={r.id}>
                  <button className="rcp-row" type="button" onClick={() => onOpen(r.id)}>
                    <span className="rcp-row-title"><b>{r.title}</b>{r.favorite && <span className="rcp-fav">즐겨찾기</span>}{r.review_count > 0 && <span className="rcp-flag">확인 {r.review_count}</span>}</span>
                    <span className="rcp-meta">{meta}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
    </section>
  )
}
