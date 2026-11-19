// 모자란 재료를 장보기 목록에 담는 창. 모자란 필수 재료가 체크된 채로 보이고, 이미 장보기에 있는 것은 "이미 있음"으로 뺀다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { StoredRecipe } from '../../../supabase/functions/_shared/recipeStored'
import { useFocusTrap, useScrollLock } from '../../lib/dialog'
import { missingIngredients, type MissingResult } from '../lib/groceryLink'
import type { RecipeStore } from '../lib/store'

export function MissingSheet({ recipe, store, onClose }: { recipe: StoredRecipe; store: RecipeStore; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null)
  useFocusTrap(root, true, { onEscape: onClose })
  useScrollLock(true)
  const [result, setResult] = useState<MissingResult | null>(null)
  const [skip, setSkip] = useState<ReadonlySet<string>>(new Set()) // 사람이 체크를 뺀 재료
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)

  const load = useCallback(async () => {
    const mine = ++seq.current
    try {
      const [pantry, grocery] = await Promise.all([store.listPantry(), store.activeGroceryNames()])
      if (mine !== seq.current) return
      setResult(missingIngredients(recipe, pantry, grocery)); setLoadError(null)
    } catch (e) {
      if (mine === seq.current) setLoadError(e instanceof Error ? e.message : '모자란 재료를 불러오지 못했어요')
    }
  }, [store, recipe])
  useEffect(() => { void load() }, [load])

  const pickable = useMemo(() => (result?.missing ?? []).filter((m) => !m.inGrocery), [result])
  const chosen = pickable.filter((m) => !skip.has(m.key))

  async function submit() {
    if (busy || !chosen.length) return
    setBusy(true); setError(null)
    try {
      const n = await store.addMissingToGrocery(recipe, chosen.map((m) => m.key))
      setDone(n)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : '담지 못했어요. 잠시 뒤 다시 해 주세요')
    } finally { setBusy(false) }
  }

  return (
    <div className="rcp-sheet-layer">
      <div className="rcp-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="rcp-sheet" role="dialog" aria-modal="true" aria-label="모자란 재료" ref={root} tabIndex={-1}>
        <div className="rcp-sheet-head">
          <h2 className="rcp-h2">모자란 재료</h2>
          <button type="button" className="rcp-btn-text" onClick={onClose}>닫기</button>
        </div>
        <div className="rcp-sheet-body">
          {loadError && (
            <div className="rcp-error" role="alert">
              <p>{loadError}</p>
              <button className="rcp-btn rcp-btn-quiet" type="button" onClick={() => void load()}>다시 불러오기</button>
            </div>
          )}
          {!result ? (!loadError && <p className="rcp-empty">불러오는 중</p>) : (
            <>
              {result.missing.length === 0 ? <p className="rcp-empty">모자란 필수 재료가 없어요</p> : (
                <ul className="rcp-missing-list">
                  {result.missing.map((m) => (
                    <li key={m.key} className="rcp-missing-row">
                      {m.inGrocery ? (
                        <>
                          <span className="rcp-missing-name">{m.name}</span>
                          <span className="rcp-meta">이미 있음</span>
                        </>
                      ) : (
                        <label className="rcp-missing-check">
                          <input type="checkbox" checked={!skip.has(m.key)} aria-label={m.name}
                            onChange={(e) => setSkip((s) => { const n = new Set(s); if (e.target.checked) n.delete(m.key); else n.add(m.key); return n })} />
                          <span className="rcp-missing-name">{m.name}</span>
                        </label>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {result.unmatched.length > 0 && (
                <p className="rcp-meta">{result.unmatched.map((u) => u.name).join(', ')}은(는) 사전에 없어 가진 재료와 비교하지 못했어요</p>
              )}
            </>
          )}
        </div>
        <div className="rcp-sheet-foot">
          {done !== null && <p className="rcp-notice" role="status">장보기에 {done}개 담았어요</p>}
          {error && <p className="rcp-error" role="alert">{error}</p>}
          {result && <button type="button" className="rcp-btn rcp-btn-primary" disabled={busy || chosen.length === 0} onClick={() => void submit()}>장보기에 {chosen.length}개 담기</button>}
        </div>
      </div>
    </div>
  )
}
