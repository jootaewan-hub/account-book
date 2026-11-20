// 레시피 상세: 출처, 분류·난이도 근거, 계량 도구, 인분, 재료, 순서, 원리, 다른 곳, 고친 곳, 메모, 고치기·지우기.
// 영상에서 온 글은 모두 글자로만 그린다(HTML로 읽지 않는다).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Origin } from '../../../supabase/functions/_shared/recipeContract'
import type { StoredRecipe } from '../../../supabase/functions/_shared/recipeStored'
import { servingsBase } from '../../../supabase/functions/_shared/recipeUnits'
import { useFocusTrap, useScrollLock } from '../../lib/dialog'
import { amountView, correctionRows, pantrySummary } from '../lib/detail'
import { clock, originLabel, videoAt } from '../lib/display'
import type { PantryEntry } from '../lib/groceryLink'
import type { RecipeStore } from '../lib/store'
import { CookMode } from './CookMode'
import { EditSheet } from './EditSheet'
import { GlossaryProvider, GlossaryText, type GlossaryEntry } from './Glossary'
import { ReviewSheet } from './ReviewSheet'
import { ServingsPicker } from './ServingsPicker'

const TIMED: readonly string[] = ['caption_manual', 'caption_auto', 'asr', 'screen']

/** "원래 2큰술 → 3큰술"은 새 값을 크게, 원래 값을 그 아래 작게 보인다(글자 순서는 그대로라 읽는 순서도 같다) */
function AmountText({ text }: { text: string | null }) {
  const m = text?.match(/^원래 (.+?) → (.+)$/)
  if (!m) return <>{text}</>
  return (
    <span className="rcp-amt-scaled">
      <span className="rcp-amt-orig">원래 {m[1]}</span><span className="rcp-amt-arrow"> → </span><span className="rcp-amt-new">{m[2]}</span>
    </span>
  )
}

/** 값이 어디서 왔는지. 영상 시각이 있으면 그 장면을 여는 링크, 덧붙임은 따로 표시 */
function Mark({ origin, at, url }: { origin: Origin; at: number | null | undefined; url: string | null }) {
  if (origin === 'editor') return <span className="rcp-edit-mark">덧붙임</span>
  const label = originLabel(origin, at ?? null)
  if (url && at != null && TIMED.includes(origin)) {
    return <a className="rcp-link rcp-origin" href={videoAt(url, at)} target="_blank" rel="noopener noreferrer">{label}</a>
  }
  return <span className="rcp-origin">{label}</span>
}

function ConfirmDelete({ title, busy, onCancel, onConfirm }: { title: string; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const root = useRef<HTMLDivElement>(null)
  useFocusTrap(root, true, { onEscape: onCancel })
  useScrollLock(true)
  return (
    <div className="rcp-sheet-layer rcp-center">
      <div className="rcp-backdrop" onClick={onCancel} aria-hidden="true" />
      <div className="rcp-dialog" role="alertdialog" aria-modal="true" aria-label="레시피 지우기" ref={root} tabIndex={-1}>
        <p className="rcp-confirm-title">“{title}”을(를) 지울까요?</p>
        <p className="rcp-meta">레시피북에서 사라져요. 다시 담으려면 영상 주소를 한 번 더 담아야 해요.</p>
        <div className="rcp-confirm-actions">
          <button type="button" className="rcp-btn rcp-btn-quiet" onClick={onCancel}>취소</button>
          <button type="button" className="rcp-btn rcp-btn-danger" disabled={busy} onClick={onConfirm}>지우기</button>
        </div>
      </div>
    </div>
  )
}

export function RecipeDetail({ store, recipeId, title, onBack, onMissing, initialMode, reloadToken }: {
  store: RecipeStore; recipeId: string; /** 목록에서 아는 이름(불러오는 동안 보인다) */ title?: string
  onBack: () => void; onMissing?: (recipe: StoredRecipe) => void
  /** 'review'면 확인 화면부터 연다(레시피북의 "확인 시작") */ initialMode?: 'review'
  /** 값이 바뀌면 레시피와 가진 재료를 다시 읽는다(장보기에 담은 뒤) */ reloadToken?: number
}) {
  const [mode, setMode] = useState<'detail' | 'review' | 'cook'>(initialMode ?? 'detail')
  const [recipe, setRecipe] = useState<StoredRecipe | null>(null)
  const [pantry, setPantry] = useState<PantryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [servings, setServings] = useState<number | null>(null)
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const seq = useRef(0)

  const load = useCallback(async () => {
    const mine = ++seq.current
    try {
      const [r, p] = await Promise.all([store.getRecipe(recipeId), store.listPantry()])
      if (mine !== seq.current) return
      setRecipe(r); setPantry(p); setError(r ? null : '이 레시피를 찾지 못했어요. 다른 기기에서 지웠을 수 있어요.')
    } catch (e) {
      if (mine === seq.current) setError(e instanceof Error ? e.message : '레시피를 불러오지 못했어요')
    } finally { if (mine === seq.current) setLoading(false) }
  }, [store, recipeId])
  useEffect(() => { void load() }, [load])
  const seenToken = useRef(reloadToken)
  useEffect(() => { if (seenToken.current !== reloadToken) { seenToken.current = reloadToken; void load() } }, [reloadToken, load])

  const base = useMemo(() => (recipe ? servingsBase(recipe) : null), [recipe])
  const chosen = servings ?? base?.base ?? null
  const scaled = base !== null && chosen !== null && chosen !== base.base
  const factor = base && chosen ? chosen / base.base : 1
  const url = recipe?.source.url ?? null
  const entries = useMemo<GlossaryEntry[]>(() => (recipe?.glossary ?? []).map((g) => ({ term: g.term, body: g.body, origin: g.origin, at_seconds: g.at_seconds })), [recipe])
  const summary = useMemo(() => (recipe ? pantrySummary(recipe, pantry) : null), [recipe, pantry])
  const haveKeys = useMemo(() => new Map(pantry.map((p) => [p.ingredient_key, p.state])), [pantry])
  const corrections = useMemo(() => (recipe ? correctionRows(recipe.corrections ?? [], recipe) : []), [recipe])

  async function run(fn: () => Promise<void>, done?: string) {
    setNotice(null)
    try { await fn(); if (done) setNotice(done) } catch (e) { setNotice(e instanceof Error ? e.message : '하지 못했어요. 잠시 뒤 다시 해 주세요') }
    void load()
  }
  async function remove() {
    if (!recipe) return
    setBusy(true)
    try { await store.archive(recipe.id); onBack() } catch (e) {
      setConfirming(false); setNotice(e instanceof Error ? e.message : '지우지 못했어요. 잠시 뒤 다시 해 주세요')
    } finally { setBusy(false) }
  }

  const heading = recipe?.title ?? title ?? ''
  if (mode === 'review' && recipe) {
    return <ReviewSheet recipe={recipe} store={store} onChanged={() => void load()} onDone={() => { setMode('detail'); void load() }} />
  }
  return (
    <section className="rcp-detail" aria-label="레시피 상세">
      <button className="rcp-btn-text" type="button" onClick={onBack}>목록으로</button>
      <h2 className="rcp-h2">{heading}</h2>
      {loading && !recipe && !error && <p className="rcp-empty">레시피 불러오는 중</p>}
      {error && !recipe && (
        <div className="rcp-error" role="alert"><p>{error}</p><button className="rcp-btn rcp-btn-quiet" type="button" onClick={() => void load()}>다시 불러오기</button></div>
      )}
      {notice && <p className="rcp-notice" role="status">{notice}</p>}
      {recipe && summary && (
        <GlossaryProvider entries={entries} videoUrl={url}>
          {recipe.summary && <p className="rcp-summary">{recipe.summary}</p>}
          <div className="rcp-actions">
            {recipe.steps.length > 0 && <button type="button" className="rcp-btn rcp-btn-primary" onClick={() => setMode('cook')}>요리 시작</button>}
            {(recipe.review_items?.length ?? 0) > 0 && (
              <button type="button" className="rcp-btn rcp-btn-quiet" onClick={() => setMode('review')}>확인하기 {recipe.review_items?.length}</button>
            )}
          </div>
          <div className="rcp-block">
            <p className="rcp-meta">
              {url ? <a className="rcp-link" href={url} target="_blank" rel="noopener noreferrer">{recipe.source.title ?? '영상 보기'}</a> : (recipe.source.title ?? '')}
              {recipe.source.channel ? `, ${recipe.source.channel}` : ''}
              {recipe.source.duration_seconds ? `, ${clock(recipe.source.duration_seconds)}` : ''}
            </p>
            <p className="rcp-meta">{[recipe.tags.cuisine, [...recipe.tags.mains, ...recipe.tags.main_details].join('·'), recipe.tags.methods.join('·'), recipe.tags.occasions.join('·')].filter(Boolean).join(', ')}</p>
            {recipe.difficulty && (
              <p className="rcp-meta">
                {/* 셈한 근거가 있으면 근거와 함께, 사람이 고른 난이도(근거가 비었다)는 직접 고침으로 */}
                {recipe.difficulty_basis
                  ? `재료 ${recipe.difficulty_basis.required} · 단계 ${recipe.difficulty_basis.steps} → ${recipe.difficulty}${recipe.difficulty_basis.heavy ? ' · 손 많이 감' : ''}`
                  : `난이도 ${recipe.difficulty} · 직접 고침`}
              </p>
            )}
            <p className="rcp-meta">
              {recipe.measuring_tool && recipe.measuring_tool !== '확인 못 함' ? `계량 도구 ${recipe.measuring_tool}` : '계량 도구 확인 못 함'}
            </p>
            {(recipe.rating !== null || recipe.favorite) && <p className="rcp-meta">{[recipe.favorite ? '즐겨찾기' : null, recipe.rating !== null ? `별점 ${recipe.rating}/5` : null].filter(Boolean).join(', ')}</p>}
            {recipe.memo && <p className="rcp-memo"><b>우리 집 메모</b> {recipe.memo}</p>}
          </div>

          <div className="rcp-block">
            <h3 className="rcp-h3">인분</h3>
            {base && chosen !== null ? (
              <>
                <p className="rcp-meta">{base.fromEditor ? `기준 ${base.base}인분(덧붙임, 영상에 인분 없음)` : `기준 ${base.base}인분`}</p>
                <ServingsPicker value={chosen} onChange={setServings} />
              </>
            ) : <p className="rcp-meta">인분을 알 수 없어 분량을 적힌 그대로 보여요.</p>}
          </div>

          <div className="rcp-block">
            <h3 className="rcp-h3">재료</h3>
            <p className="rcp-meta" role="status">가진 재료 {summary.have}/{summary.need}</p>
            {summary.unmatched.length > 0 && <p className="rcp-meta">사전에 없는 재료 {summary.unmatched.length}개는 세지 않았어요</p>}
            <button type="button" className="rcp-btn rcp-btn-quiet" disabled={summary.missing.length === 0} onClick={() => onMissing?.(recipe)}>모자란 재료 장보기에 담기</button>
            <ul className="rcp-ings">
              {recipe.ingredients.map((g, i) => {
                const a = amountView(g, factor, scaled, recipe.measuring_tool)
                const sect = g.section && g.section !== recipe.ingredients[i - 1]?.section ? g.section : null
                const key = g.ingredient_key ?? null
                const state = key ? haveKeys.get(key) : undefined
                return (
                  <li key={i} className="rcp-ing">
                    {sect && <p className="rcp-sect">{sect}</p>}
                    <div className="rcp-ing-row">
                      <span className="rcp-ing-check">
                        {key && (
                          <button type="button" className="rcp-have" aria-pressed={state !== undefined} disabled={state === 'always'}
                            aria-label={`${g.name} ${state === 'always' ? '항상 있음' : '있음'}`}
                            onClick={() => void run(() => store.setPantry(key, state ? null : 'have'))}>
                            <span className="rcp-have-box" aria-hidden="true" />
                          </button>
                        )}
                      </span>
                      <div className="rcp-ing-body">
                        <div className="rcp-ing-main">
                          <span className="rcp-ing-name">
                            <GlossaryText blockId={`i${i}n`} text={g.name} />{g.optional ? <span className="rcp-meta"> (선택)</span> : null}
                          </span>
                          <span className="rcp-ing-amt">
                            <AmountText text={a.main} />
                            {a.suggested && <span className="rcp-edit"> {a.main ? '(' : ''}<span className="rcp-edit-mark">덧붙임</span> {a.suggested}{a.main ? ')' : ''}</span>}
                          </span>
                        </div>
                        <p className="rcp-meta rcp-ing-meta">
                          <Mark origin={g.origin} at={g.at_seconds} url={url} />
                          {state === 'always' && <span> · 항상 있음</span>}
                          {g.note && <span> · <GlossaryText blockId={`i${i}t`} text={g.note} /></span>}
                        </p>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>

          <div className="rcp-block">
            <h3 className="rcp-h3">순서</h3>
            <ol className="rcp-steps">
              {recipe.steps.map((s, i) => (
                <li key={i} className="rcp-step">
                  <p className="rcp-step-title"><b>{i + 1}. {s.title}</b>{s.heat ? <span className="rcp-meta"> 불 {s.heat}</span> : null}</p>
                  <p><GlossaryText blockId={`s${i}b`} text={s.body} /></p>
                  {s.cue && <p className="rcp-meta">넘어가는 신호: <GlossaryText blockId={`s${i}c`} text={s.cue} />{s.cue_origin ? <> <Mark origin={s.cue_origin} at={null} url={url} /></> : null}</p>}
                  {s.editor_tip && <p className="rcp-meta"><span className="rcp-edit-mark">덧붙임</span> {s.editor_tip}</p>}
                  <p className="rcp-meta">
                    {url && s.video_start_seconds != null && <a className="rcp-link" href={videoAt(url, s.video_start_seconds)} target="_blank" rel="noopener noreferrer">영상 {clock(s.video_start_seconds)}</a>}
                    {s.timer_seconds ? <span> 타이머 {clock(s.timer_seconds)}</span> : null}
                  </p>
                </li>
              ))}
            </ol>
          </div>

          {(recipe.principles?.length ?? 0) > 0 && (
            <div className="rcp-block">
              <h3 className="rcp-h3">원리</h3>
              <ul className="rcp-plain">
                {recipe.principles?.map((p, i) => (
                  <li key={i}><b>{p.title}</b> <span className="rcp-meta">{p.body}</span> <Mark origin={p.origin} at={p.video_start_seconds} url={url} /></li>
                ))}
              </ul>
            </div>
          )}

          {(recipe.conflicts?.length ?? 0) > 0 && (
            <div className="rcp-block">
              <h3 className="rcp-h3">다른 곳</h3>
              <ul className="rcp-plain">
                {recipe.conflicts?.map((c, i) => (
                  <li key={i}>
                    <b>{c.about}</b>
                    <span className="rcp-meta"> 고른 값: {c.chosen} (<Mark origin={c.chosen_origin} at={null} url={url} />), 다른 말: {c.other} (<Mark origin={c.other_origin} at={c.video_start_seconds} url={url} />){c.note ? `. ${c.note}` : ''}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {corrections.length > 0 && (
            <div className="rcp-block">
              <h3 className="rcp-h3">고친 곳</h3>
              <ul className="rcp-plain">
                {corrections.map((c) => (
                  <li key={c.index} className="rcp-fix">
                    <span><b>{c.label}</b> <span className="rcp-meta">{c.text}</span></span>
                    {c.canRevert && <button type="button" className="rcp-btn-text" aria-label={`${c.label} 되돌리기`} onClick={() => void run(() => store.revertCorrection(recipe.id, c.index))}>되돌리기</button>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rcp-actions">
            <button type="button" className="rcp-btn rcp-btn-quiet" onClick={() => setEditing(true)}>고치기</button>
            <button type="button" className="rcp-btn rcp-btn-quiet rcp-btn-warn" onClick={() => setConfirming(true)}>지우기</button>
          </div>
          {editing && <EditSheet recipe={recipe} store={store} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); void load() }} />}
          {mode === 'cook' && <CookMode recipe={recipe} servings={chosen} pantry={pantry} store={store} onExit={() => setMode('detail')} onPantryChanged={() => void load()} />}
          {confirming && <ConfirmDelete title={recipe.title} busy={busy} onCancel={() => setConfirming(false)} onConfirm={() => void remove()} />}
        </GlossaryProvider>
      )}
    </section>
  )
}
