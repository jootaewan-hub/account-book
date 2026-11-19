// 확인 화면: 확인이 필요한 항목을 하나씩 본다. 까닭, 지금 값, 후보(값·출처·영상 장면)를 보이고
// 후보 하나를 고르거나 직접 고친다. 엇갈림 같은 항목은 양쪽을 보이고 "확인함"만 둔다.
// 영상에서 온 글은 모두 글자로만 그린다(HTML로 읽지 않는다).
import { useEffect, useRef, useState } from 'react'
import { MEASURING_TOOLS, type Origin, type ReviewItem } from '../../../supabase/functions/_shared/recipeContract'
import type { StoredRecipe } from '../../../supabase/functions/_shared/recipeStored'
import { clock, originLabel, videoAt } from '../lib/display'
import { parseTarget, type RecipeStore } from '../lib/store'

const TIMED: readonly string[] = ['caption_manual', 'caption_auto', 'asr', 'screen']
const FIELD: Record<string, string> = {
  name: '이름', amount: '분량', unit: '단위', amount_text: '분량 글', note: '메모', title: '이름', body: '내용', cue: '넘어가는 신호',
  timer_seconds: '타이머', video_start_seconds: '영상 시각', heat: '불 세기', value: '인분', basis: '인분 근거', term: '용어', origin: '출처', at_seconds: '영상 시각',
}
/** DB 글자 수 한도(재료·단계·용어 풀이·인분 근거). 알 수 없는 칸은 200자 */
const LIMIT: Record<string, number> = { name: 60, unit: 12, amount_text: 20, note: 160, title: 30, cue: 200, heat: 30, term: 30, basis: 80 }
const MAY_BE_EMPTY = new Set(['note', 'amount_text', 'cue', 'heat'])

type Parsed = Exclude<NonNullable<ReturnType<typeof parseTarget>>, { kind: 'conflicts' }>

/** 값을 직접 고칠 수 있는 항목인가(출처·시각 칸은 고르지 않는다) */
function editable(t: ReturnType<typeof parseTarget>): t is Parsed {
  return !!t && t.kind !== 'conflicts' && t.field !== 'origin' && t.field !== 'at_seconds'
}

function whoOf(t: Parsed, r: StoredRecipe): string {
  if (t.kind === 'servings') return '인분'
  if (t.kind === 'ingredients') return r.ingredients[t.index]?.name ?? `재료 ${t.index + 1}`
  if (t.kind === 'steps') return r.steps[t.index]?.title ?? `단계 ${t.index + 1}`
  return r.glossary?.[t.index]?.term ?? `용어 ${t.index + 1}`
}

/** 항목 이름: "설탕 분량", "양념장 섞기 타이머", "인분", "계량 도구", "고기 양" */
function labelOf(item: ReviewItem, r: StoredRecipe): string {
  const t = parseTarget(item.target)
  if (t?.kind === 'conflicts') return r.conflicts?.[t.index]?.about ?? `엇갈린 곳 ${t.index + 1}`
  if (t) return t.kind === 'servings' ? '인분' : `${whoOf(t, r)} ${FIELD[t.field] ?? t.field}`
  if (item.target === 'measuring_tool') return '계량 도구'
  const p = /^principles\[(\d+)\]/.exec(item.target)
  if (p) return `원리 ${r.principles?.[Number(p[1])]?.title ?? Number(p[1]) + 1}`
  return item.target
}

/** 지금 저장된 값(없으면 null). 글은 저장된 그대로 */
function currentOf(t: Parsed, r: StoredRecipe): string | null {
  if (t.kind === 'servings') return t.field === 'value' && r.servings.value != null ? `${r.servings.value}인분` : null
  if (t.kind === 'glossary') { const v = (r.glossary?.[t.index] as Record<string, unknown> | undefined)?.[t.field]; return v == null ? null : String(v) }
  const row = (t.kind === 'ingredients' ? r.ingredients[t.index] : r.steps[t.index]) as Record<string, unknown> | undefined
  if (!row) return null
  if (t.field === 'amount') return row.amount == null ? (typeof row.amount_text === 'string' ? row.amount_text : null) : `${row.amount}${row.unit ?? ''}`
  const v = row[t.field]
  if (v == null || v === '') return null
  return t.field === 'timer_seconds' || t.field === 'video_start_seconds' ? clock(Number(v)) : String(v)
}

/** 후보 값을 적힌 그대로(분량은 그 재료의 단위를 붙이고, 시간은 분:초로). 단위를 바꾸지 않는다 */
function candidateText(t: ReturnType<typeof parseTarget>, value: string, r: StoredRecipe): string {
  if (!t || t.kind === 'conflicts') return value
  if (t.kind === 'servings' && t.field === 'value') return `${value}인분`
  if (t.kind === 'ingredients' && t.field === 'amount') return `${value}${r.ingredients[t.index]?.unit ?? ''}`
  if (t.field === 'timer_seconds' && Number.isFinite(Number(value))) return clock(Number(value))
  return value
}

type Check = { ok: true; value: string } | { ok: false; error: string }
/** 직접 고친 값 검사. 숫자는 0보다 크고, 타이머는 초나 분:초, 글은 DB 한도 안 */
function check(t: Parsed, raw: string): Check {
  const text = raw.trim()
  const f = t.field
  if (f === 'amount' || f === 'value' || f === 'suggested_amount') {
    const n = Number(text)
    return text !== '' && Number.isFinite(n) && n > 0 ? { ok: true, value: String(n) } : { ok: false, error: '0보다 큰 숫자로 적어 주세요' }
  }
  if (f === 'timer_seconds') {
    const m = /^(\d+):([0-5]?\d)$/.exec(text)
    const sec = m ? Number(m[1]) * 60 + Number(m[2]) : Number(text)
    return text !== '' && Number.isInteger(sec) && sec > 0 ? { ok: true, value: String(sec) } : { ok: false, error: '초(90)나 분:초(1:30)로, 0보다 크게 적어 주세요' }
  }
  if (f === 'video_start_seconds') {
    const n = Number(text)
    return text !== '' && Number.isInteger(n) && n >= 0 ? { ok: true, value: String(n) } : { ok: false, error: '0 이상의 정수 초로 적어 주세요' }
  }
  const max = f === 'body' ? (t.kind === 'glossary' ? 200 : 400) : (LIMIT[f] ?? 200)
  if (!text && !MAY_BE_EMPTY.has(f)) return { ok: false, error: '값을 적어 주세요' }
  if (text.length > max) return { ok: false, error: `${max}자 안에서 적어 주세요` }
  return { ok: true, value: text }
}

function Source({ origin, at, url }: { origin: Origin; at: number | null; url: string | null }) {
  const label = originLabel(origin, at)
  if (url && at !== null && TIMED.includes(origin)) {
    return <a className="rcp-link rcp-origin" href={videoAt(url, at)} target="_blank" rel="noopener noreferrer"><span aria-hidden="true">▶ </span>{label}</a>
  }
  return <span className="rcp-origin">{label}</span>
}

export function ReviewSheet({ recipe, store, onDone, onChanged }: {
  recipe: StoredRecipe; store: Pick<RecipeStore, 'resolveReview'>; onDone: () => void; onChanged?: () => void
}) {
  // 처리한 항목은 이 목록에서도 빼서 저장소의 순번과 맞춘다
  const [items, setItems] = useState<ReviewItem[]>(() => [...(recipe.review_items ?? [])])
  const [total] = useState(items.length)
  const [handled, setHandled] = useState(0)
  const [cursor, setCursor] = useState(0)
  const [typing, setTyping] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const head = useRef<HTMLHeadingElement>(null)
  const url = recipe.source.url ?? null

  // 항목이 바뀔 때마다 제목으로 포커스를 옮긴다
  const place = `${handled}:${cursor}`
  useEffect(() => { if (place) head.current?.focus() }, [place])

  const item = items[cursor] as ReviewItem | undefined
  const t = item ? parseTarget(item.target) : null
  const canEdit = editable(t)

  async function resolve(choice: { value: string; origin: Origin; at_seconds: number | null }) {
    if (!item || busy) return
    setBusy(true); setError(null)
    try {
      await store.resolveReview(recipe.id, cursor, choice)
      setItems((list) => list.filter((_, i) => i !== cursor))
      setHandled((n) => n + 1); setTyping(false); setDraft('')
      onChanged?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장하지 못했어요. 잠시 뒤 다시 해 주세요')
    } finally { setBusy(false) }
  }
  function saveTyped() {
    if (!canEdit) return
    const out = check(t, draft)
    if (!out.ok) { setError(out.error); return }
    void resolve({ value: out.value, origin: 'user', at_seconds: null })
  }
  function later() {
    setCursor((c) => c + 1); setHandled((n) => n + 1); setTyping(false); setDraft(''); setError(null)
  }

  if (!item) {
    const left = items.length
    return (
      <section className="rcp-review" aria-label="확인">
        <h2 className="rcp-h2" ref={head} tabIndex={-1}>{total === 0 ? '확인할 항목이 없어요' : left === 0 ? '모두 확인했어요' : `확인하지 않은 항목 ${left}개가 남았어요`}</h2>
        <div className="rcp-actions"><button type="button" className="rcp-btn rcp-btn-primary" onClick={onDone}>확인을 마침</button></div>
      </section>
    )
  }

  const tool = item.target === 'measuring_tool'
  const conflict = t?.kind === 'conflicts' ? recipe.conflicts?.[t.index] : undefined
  const current = canEdit ? currentOf(t, recipe) : null
  return (
    <section className="rcp-review" aria-label="확인">
      <div className="rcp-review-top">
        <p className="rcp-meta">{Math.min(handled + 1, total)} / {total}</p>
        <button type="button" className="rcp-btn-text" onClick={onDone}>나가기</button>
      </div>
      <h2 className="rcp-h2" ref={head} tabIndex={-1}>{labelOf(item, recipe)}</h2>
      <p className="rcp-review-reason">{item.reason}</p>
      {tool && <p className="rcp-meta">지금 값: <b>{recipe.measuring_tool ?? '없음'}</b></p>}
      {canEdit && <p className="rcp-meta">지금 값: <b>{current ?? '없음'}</b></p>}
      {conflict && (
        <div className="rcp-block">
          <p>고른 값: <b>{conflict.chosen}</b> <Source origin={conflict.chosen_origin} at={null} url={url} /></p>
          <p>다른 말: <b>{conflict.other}</b> <Source origin={conflict.other_origin} at={conflict.video_start_seconds ?? null} url={url} /></p>
          {conflict.note && <p className="rcp-meta">{conflict.note}</p>}
        </div>
      )}
      {item.candidates.length > 0 && (
        <ul className="rcp-cands" aria-label="후보">
          {item.candidates.map((c, i) => {
            const shown = candidateText(t, c.value, recipe)
            return (
              <li key={i} className="rcp-cand">
                <span className="rcp-cand-main"><b>{shown}</b> <Source origin={c.origin} at={c.at_seconds} url={url} /></span>
                {canEdit && <button type="button" className="rcp-btn rcp-btn-quiet" disabled={busy} aria-label={`이 값 ${shown}`} onClick={() => void resolve(c)}>이 값</button>}
              </li>
            )
          })}
        </ul>
      )}
      {canEdit && typing && (
        <div className="rcp-field">
          <label className="rcp-label" htmlFor="rcp-review-input">직접 입력</label>
          <input id="rcp-review-input" className="rcp-input" value={draft} inputMode={['amount', 'value', 'timer_seconds', 'video_start_seconds'].includes(t.field) ? 'decimal' : 'text'}
            onChange={(e) => { setDraft(e.target.value); setError(null) }} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) saveTyped() }} />
          <div className="rcp-actions">
            <button type="button" className="rcp-btn rcp-btn-primary" disabled={busy} onClick={saveTyped}>이 값으로 저장</button>
            <button type="button" className="rcp-btn rcp-btn-quiet" onClick={() => { setTyping(false); setError(null) }}>취소</button>
          </div>
        </div>
      )}
      {tool && (
        <div className="rcp-chips" role="group" aria-label="계량 도구 고르기">
          {MEASURING_TOOLS.map((m) => (
            <button key={m} type="button" className="rcp-chip" disabled={busy} onClick={() => void resolve({ value: m, origin: 'user', at_seconds: null })}>{m}</button>
          ))}
        </div>
      )}
      {error && <p className="rcp-bad" role="alert">{error}</p>}
      <div className="rcp-actions rcp-review-foot">
        {canEdit
          ? !typing && <button type="button" className="rcp-btn rcp-btn-quiet" onClick={() => { setTyping(true); setDraft(''); setError(null) }}>직접 고치기</button>
          : !tool && <button type="button" className="rcp-btn rcp-btn-primary" disabled={busy} onClick={() => void resolve({ value: '', origin: 'user', at_seconds: null })}>확인함</button>}
        <button type="button" className="rcp-btn rcp-btn-quiet" onClick={later}>나중에</button>
      </div>
    </section>
  )
}
